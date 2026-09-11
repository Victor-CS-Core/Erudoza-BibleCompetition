// @vitest-environment node
import { afterAll, beforeAll, expect, it } from "vitest";
import { createNativeTestApp, TEST_ORG, TEST_USER } from "../test-runtime";
let app: Awaited<ReturnType<typeof createNativeTestApp>>;
let cookie: string;
const season = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", pack = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const url = `/api/v1/study/seasons/${season}/scripture`;
async function record(kind: string, id: string, value: unknown, seasonId: string | null = null, owner: string | null = null, org = TEST_ORG) {
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) VALUES(?,?,?,?,?,?)").bind(kind, id, org, seasonId, owner, JSON.stringify(value)).run();
}
const request = (path = url) => app.fetch(path, { headers: { Cookie: cookie } });
beforeAll(async () => {
  app = await createNativeTestApp();
  await app.db.prepare("UPDATE Users SET kind='Student',role='Student' WHERE id=?").bind(TEST_USER).run();
  cookie = (await app.login()).headers.get("set-cookie")!.split(";")[0];
  await record("season", season, { id: season, status: "Active" });
  await record("pack", pack, { id: pack, isActive: true, licensingStatus: "public-domain" });
  const range = { bookKey: "GEN", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 6 };
  await record("scope", season, { contentPackId: pack, includes: [range], excludes: [{ ...range, startVerse: 2, endVerse: 2 }] });
  await record("assignment", "assignment", { contentPackId: pack, ...range }, season, TEST_USER);
  await record("membership", `${season}:${TEST_USER}`, { id: `${season}:${TEST_USER}` }, season, TEST_USER);
  for (let verse = 1; verse <= 7; verse++) await record("source", `source-${verse}`, { id: `source-${verse}`, contentPackId: pack, citation: `Genesis 1:${verse}`, bookKey: "GEN", chapter: 1, verse, ordinal: verse, canonicalText: `Assigned text ${verse}.`, isActive: verse !== 4, isRetired: verse === 3 }, null, pack);
  await record("source", "private-source", { id: "private-source", contentPackId: "other-pack", citation: "Private 1:1", bookKey: "GEN", chapter: 1, verse: 1, ordinal: 1, canonicalText: "Not assigned", isActive: true }, null, "other-pack");
}, 30000);
afterAll(async () => { await app?.runtime.dispose(); });

it("returns ordered locators and text only for active, assigned, included verses", async () => {
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const result = await response.json() as { seasonId: string; verses: { verse: number; citation: string; canonicalText: string }[] };
  expect(result.seasonId).toBe(season);
  expect(result.verses.map(verse => verse.verse)).toEqual([1, 5, 6]);
  expect(result.verses[0]).toMatchObject({ citation: "Genesis 1:1", canonicalText: "Assigned text 1." });
});

it("requires student authentication, tenant ownership and season membership", async () => {
  expect((await app.fetch(url)).status).toBe(401);
  const otherSeason = "aaaaaaaa-aaaa-4aaa-8aaa-bbbbbbbbbbbb";
  await app.db.prepare("INSERT INTO Organizations(id,name,slug) VALUES('another-organization','Isolated','isolated-reader')").run();
  await record("season", otherSeason, { id: otherSeason, status: "Active" }, null, null, "another-organization");
  expect((await request(`/api/v1/study/seasons/${otherSeason}/scripture`)).status).toBe(404);
  await app.db.prepare("DELETE FROM Records WHERE kind='membership' AND id=?").bind(`${season}:${TEST_USER}`).run();
  expect((await request()).status).toBe(404);
  await record("membership", `${season}:${TEST_USER}`, { id: `${season}:${TEST_USER}` }, season, TEST_USER);
  await app.db.prepare("UPDATE Users SET kind='Adult',role='Owner' WHERE id=?").bind(TEST_USER).run();
  expect((await request()).status).toBe(403);
  await app.db.prepare("UPDATE Users SET kind='Student',role='Student' WHERE id=?").bind(TEST_USER).run();
});

it("does not expose a pack whose license or active status no longer allows use", async () => {
  await app.db.prepare("UPDATE Records SET data=json_set(data,'$.licensingStatus','unknown') WHERE kind='pack' AND id=?").bind(pack).run();
  expect(await (await request()).json()).toEqual({ seasonId: season, verses: [] });
  await app.db.prepare("UPDATE Records SET data=json_set(data,'$.licensingStatus','public-domain','$.isActive',0) WHERE kind='pack' AND id=?").bind(pack).run();
  expect(await (await request()).json()).toEqual({ seasonId: season, verses: [] });
});

it("returns every verse at the 5,000-unit bound and rejects larger collections explicitly", async () => {
  const capSeason = "dddddddd-dddd-4ddd-8ddd-dddddddddddd", capPack = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  await record("season", capSeason, { id: capSeason, status: "Active" });
  await record("pack", capPack, { id: capPack, isActive: true, licensingStatus: "public-domain" });
  const range = { bookKey: "PSA", startChapter: 1, startVerse: 1, endChapter: 51, endVerse: 100 };
  await record("scope", capSeason, { contentPackId: capPack, includes: [range], excludes: [] });
  await record("assignment", "cap-assignment", { contentPackId: capPack, ...range }, capSeason, TEST_USER);
  await record("membership", `${capSeason}:${TEST_USER}`, { id: `${capSeason}:${TEST_USER}` }, capSeason, TEST_USER);
  const source = (index: number) => ({ id: `cap-source-${index}`, contentPackId: capPack, bookKey: "PSA", chapter: Math.floor(index / 100) + 1, verse: index % 100 + 1, ordinal: index + 1, citation: `Psalms ${Math.floor(index / 100) + 1}:${index % 100 + 1}`, canonicalText: `Bounded reader fixture ${index + 1}.`, isActive: true });
  for (let offset = 0; offset < 5000; offset += 500) await app.db.prepare(
    "INSERT INTO Records(kind,id,org_id,owner_id,data) SELECT 'source',json_extract(value,'$.id'),?,?,value FROM json_each(?)"
  ).bind(TEST_ORG, capPack, JSON.stringify(Array.from({ length: 500 }, (_, index) => source(offset + index)))).run();
  const path = `/api/v1/study/seasons/${capSeason}/scripture`;
  const response = await request(path);
  expect(response.status).toBe(200);
  const result = await response.json() as { verses: { ordinal: number; canonicalText: string }[] };
  expect(result.verses).toHaveLength(5000);
  expect(result.verses.at(-1)).toMatchObject({ ordinal: 5000, canonicalText: "Bounded reader fixture 5000." });
  const excess = source(5000);
  await record("source", excess.id, excess, null, capPack);
  expect((await request(path)).status).toBe(413);
}, 30000);
