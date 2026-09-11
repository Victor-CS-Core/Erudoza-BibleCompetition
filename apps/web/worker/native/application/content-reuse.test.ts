// @vitest-environment node
import { afterAll, beforeAll, expect, it } from "vitest";
import { createNativeTestApp, TEST_ORG, TEST_USER } from "../test-runtime";

let app: Awaited<ReturnType<typeof createNativeTestApp>>, coach: string, otherCoach: string;
beforeAll(async () => {
  app = await createNativeTestApp();
  coach = (await app.login()).headers.get("set-cookie")!.split(";")[0];
  await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT ?,org_id,?,?,'Adult','Admin',password_hash,'v1' FROM Users WHERE id=?")
    .bind("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "second-coach", "Second Coach", TEST_USER).run();
  const login = await app.fetch("/api/v1/auth/login", { method: "POST", headers: { Origin: "https://erudoza.test" },
    body: JSON.stringify({ identifier: "second-coach", password: "Testing!123" }) });
  expect(login.status).toBe(200);
  otherCoach = login.headers.get("set-cookie")!.split(";")[0];
}, 30000);
afterAll(async () => { await app?.runtime.dispose(); });

const payload = (packKey: string) => ({ packKey, version: 1, locale: "en", sourceType: "Scripture", licensingStatus: "public-domain",
  documents: [{ name: "Daniel", units: [1, 2, 3].map(verse => ({ citation: `Daniel 1:${verse}`, bookKey: "DAN",
    chapter: 1, verse, ordinal: verse, text: `Shared canonical source ${verse}.` })) }],
});
const importPack = (input: unknown, cookie = coach, org = TEST_ORG) => app.importFixture(input,cookie,org);

it("reuses one pack and its source IDs when two coaches concurrently import identical selectors under different names", async () => {
  const responses = await Promise.all([importPack(payload("first-coach-name")), importPack(payload("second-coach-name"), otherCoach)]);
  expect(responses.map(response => response.status)).toEqual([200, 200]);
  const packs = await Promise.all(responses.map(response => response.json())) as { id: string }[];
  expect(packs[0].id).toBe(packs[1].id);
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM Records WHERE kind='pack' AND org_id=?").bind(TEST_ORG).first("count")).toBe(1);
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM Records WHERE kind='source' AND org_id=?").bind(TEST_ORG).first("count")).toBe(3);
  const originalIds = await app.db.prepare("SELECT id FROM Records WHERE kind='source' AND owner_id=? ORDER BY id").bind(packs[0].id).all();
  const repeated = await importPack(payload("third-name"), otherCoach);
  expect(repeated.status).toBe(200);
  expect(await repeated.json()).toMatchObject({ id: packs[0].id });
  expect(await app.db.prepare("SELECT id FROM Records WHERE kind='source' AND owner_id=? ORDER BY id").bind(packs[0].id).all()).toMatchObject({ results: originalIds.results });
});

it("reuses a legacy pack with lowercase book keys without changing stored IDs, keys, or text", async () => {
  const input = payload("legacy-existing");
  input.documents[0].units.forEach(unit => { unit.chapter = 7; unit.citation = `Daniel 7:${unit.verse}`; });
  const legacyId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const pack = { id: legacyId, ...input, unitCount: 3, isActive: true };
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,data) VALUES('pack',?,?,?)").bind(legacyId, TEST_ORG, JSON.stringify(pack)).run();
  const sources = input.documents[0].units.map(unit => ({ id: crypto.randomUUID(), contentPackId: legacyId,
    citation: unit.citation, bookKey: unit.bookKey.toLowerCase(), chapter: unit.chapter, verse: unit.verse, ordinal: unit.ordinal, canonicalText: unit.text, isActive: true }));
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) SELECT 'source',json_extract(value,'$.id'),?,?,value FROM json_each(?)")
    .bind(TEST_ORG, legacyId, JSON.stringify(sources)).run();
  const response = await importPack({ ...input, packKey: "new-coach-legacy-alias" });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ id: legacyId, packKey: "legacy-existing" });
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM Records WHERE kind='source' AND owner_id=?").bind(legacyId).first("count")).toBe(3);
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM Records WHERE kind='pack' AND json_extract(data,'$.packKey')='new-coach-legacy-alias'").first("count")).toBe(0);
  expect(await app.db.prepare("SELECT json_extract(data,'$.bookKey') AS bookKey FROM Records WHERE kind='source' AND owner_id=? LIMIT 1").bind(legacyId).first("bookKey")).toBe("dan");
});

it("keeps different versions, metadata, source text, selectors, and source ordering distinct", async () => {
  const baseline = await (await importPack(payload("metadata-base"))).json() as { id: string };
  const variants = [
    { ...payload("different-version"), version: 2 },
    { ...payload("different-locale"), locale: "es" },
    { ...payload("different-source-type"), sourceType: "Supplemental" },
    { ...payload("different-license"), licensingStatus: "approved" },
    payload("different-wording"), payload("different-selectors"), payload("different-ordering"),
  ];
  variants[4].documents[0].units[0].text = "Different translation wording.";
  variants[5].documents[0].units.forEach(unit => { unit.chapter = 2; });
  variants[6].documents[0].units.forEach(unit => { unit.ordinal += 100; });
  const ids = new Set([baseline.id]);
  for (const variant of variants) {
    const response = await importPack(variant);
    expect(response.status).toBe(200);
    const pack = await response.json() as { id: string };
    expect(ids.has(pack.id)).toBe(false);
    ids.add(pack.id);
  }
});

it("keeps one named version when conflicting content is imported concurrently", async () => {
  const left = payload("same-name-race"), right = payload("same-name-race");
  left.documents[0].units[0].text = "First distinct candidate.";
  right.documents[0].units[0].text = "Second distinct candidate.";
  const responses = await Promise.all([importPack(left), importPack(right, otherCoach)]);
  expect(responses.filter(response => response.status === 200)).toHaveLength(1);
  expect(responses.filter(response => [400, 409].includes(response.status))).toHaveLength(1);
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM Records WHERE kind='pack' AND json_extract(data,'$.packKey')='same-name-race'").first("count")).toBe(1);
});

it("does not share source storage across organizations", async () => {
  const foreignOrg = "22222222-2222-4222-8222-222222222222";
  await app.db.prepare("INSERT INTO Organizations(id,name,slug) VALUES(?,?,?)").bind(foreignOrg, "Another Club", "another-club").run();
  await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT ?,?,?,?,'Adult','Owner',password_hash,'v1' FROM Users WHERE id=?")
    .bind("dddddddd-dddd-4ddd-8ddd-dddddddddddd", foreignOrg, "foreign-coach", "Foreign Coach", TEST_USER).run();
  const login = await app.fetch("/api/v1/auth/login", { method: "POST", headers: { Origin: "https://erudoza.test" },
    body: JSON.stringify({ identifier: "foreign-coach", password: "Testing!123" }) });
  expect(login.status).toBe(200);
  const foreignCookie = login.headers.get("set-cookie")!.split(";")[0];
  const first = await (await importPack(payload("first-organization"))).json() as { id: string };
  const foreign = await importPack(payload("foreign-organization"), foreignCookie, foreignOrg);
  expect(foreign.status).toBe(200);
  expect((await foreign.json() as { id: string }).id).not.toBe(first.id);
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM Records WHERE kind='source' AND org_id=?").bind(foreignOrg).first("count")).toBe(3);
});

it("keeps recognized catalog translations separate even if a selected passage has identical wording", async () => {
  const generic = await (await importPack(payload("generic-edition"))).json() as { id: string };
  const ids = new Set([generic.id]);
  for (const edition of ["kjv", "web", "asv", "oeb-us"]) {
    const response = await importPack(payload(`${edition}-dan-1-1`));
    expect(response.status).toBe(200);
    const imported = await response.json() as { id: string };
    expect(ids.has(imported.id)).toBe(false);
    ids.add(imported.id);
    const sameEdition = await importPack(payload(`${edition.toUpperCase()}-DAN-1-1`), otherCoach);
    expect(sameEdition.status).toBe(200);
    expect(await sameEdition.json()).toMatchObject({ id: imported.id });
  }
});

it("returns a clear domain error when the matching canonical pack is inactive", async () => {
  const input = payload("inactive-original");
  input.documents[0].units.forEach(unit => { unit.text = `Inactive edition source ${unit.verse}.`; });
  const initial = await importPack(input);
  expect(initial.status).toBe(200);
  const pack = await initial.json() as { id: string };
  await app.db.prepare("UPDATE Records SET data=json_set(data,'$.isActive',json('false')) WHERE kind='pack' AND id=?")
    .bind(pack.id).run();
  const retry = await importPack({ ...input, packKey: "inactive-alias" }, otherCoach);
  expect(retry.status).toBe(400);
  expect(await retry.text()).toContain("new version");
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM Records WHERE kind='source' AND owner_id=?").bind(pack.id).first("count")).toBe(3);
});

it.each(["inactive", "retired"])("does not bypass %s legacy content by renaming, but prefers an active equivalent", async state => {
  const input = payload(`legacy-${state}-original`);
  input.documents[0].units.forEach(unit => { unit.text = `Legacy ${state} comparison ${unit.verse}.`; });
  const insertLegacy = async (packId: string, available: boolean) => {
    const pack = { id: packId, packKey: available ? `available-${state}` : input.packKey,
      version: 1, locale: "en", sourceType: "Scripture", licensingStatus: "public-domain",
      unitCount: 3, isActive: available || state !== "inactive" };
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,data) VALUES('pack',?,?,?)").bind(packId, TEST_ORG, JSON.stringify(pack)).run();
    const sources = input.documents[0].units.map(unit => ({ id: crypto.randomUUID(), contentPackId: packId,
      citation: unit.citation, bookKey: unit.bookKey, chapter: unit.chapter, verse: unit.verse, ordinal: unit.ordinal,
      canonicalText: unit.text, isActive: true, isRetired: !available && state === "retired" }));
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) SELECT 'source',json_extract(value,'$.id'),?,?,value FROM json_each(?)")
      .bind(TEST_ORG, packId, JSON.stringify(sources)).run();
  };
  await insertLegacy(crypto.randomUUID(), false);
  const alias = { ...input, packKey: `legacy-${state}-renamed` };
  const blocked = await importPack(alias);
  expect(blocked.status).toBe(400);
  expect(await blocked.text()).toContain("new version");
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM Records WHERE kind='pack' AND json_extract(data,'$.packKey')=?").bind(alias.packKey).first("count")).toBe(0);
  const availableId = crypto.randomUUID();
  await insertLegacy(availableId, true);
  const reused = await importPack(alias, otherCoach);
  expect(reused.status).toBe(200);
  expect(await reused.json()).toMatchObject({ id: availableId });
});
