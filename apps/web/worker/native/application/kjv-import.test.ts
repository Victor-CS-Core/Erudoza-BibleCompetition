// @vitest-environment node
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { parseContentPackImport, type ImportContentPackRequest } from "../../../src/features/admin/contentPackImport";
import { createNativeTestApp, TEST_ORG } from "../test-runtime";
import { Store } from "../store";
import type { RequestContext } from "../types";
import type { D1Database } from "@cloudflare/workers-types";
import { effectiveSources } from "./model";

let app: Awaited<ReturnType<typeof createNativeTestApp>>, cookie: string;
beforeAll(async () => {
  app = await createNativeTestApp();
  const login = await app.login();
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
}, 30000);
afterAll(async () => { await app?.runtime.dispose(); });

const call = (path: string, method = "GET", input?: unknown) => path === "/content-packs/import" ? app.importFixture(input,cookie) : app.fetch(
  `/api/v1/organizations/${TEST_ORG}${path}`,
  { method, headers: { Cookie: cookie, Origin: "https://erudoza.test", "Content-Type": "application/json" },
    ...(input === undefined ? {} : { body: typeof input === "string" ? input : JSON.stringify(input) }) },
);
const countForPack = (key: string) => app.db.prepare(
  "SELECT COUNT(*) AS count FROM Records WHERE kind='pack' AND json_extract(data,'$.packKey')=?",
).bind(key).first("count");

it("reuses one complete Psalms pack in two seasons with exact text, separate scopes, and idempotent reimport", async () => {
  const master = JSON.parse(await readFile(new URL("../../../../../content/kjv/kjv-1769.master.json", import.meta.url), "utf8"));
  const psalms = master.documents.find((document: { name: string }) => document.name === "Psalms");
  expect(psalms).toBeDefined();
  const input = parseContentPackImport(JSON.stringify({ ...master, packKey: "kjv-psalms-whole-book", documents: [psalms] }));
  const expected = input.documents[0].units;
  expect(expected).toHaveLength(2461);
  const response = await call("/content-packs/import", "POST", input);
  const pack = await response.json() as { id: string; unitCount: number; licensingStatus: string };
  expect(response.status, JSON.stringify(pack)).toBe(200);
  expect(pack).toMatchObject({ unitCount: 2461, licensingStatus: "public-domain" });
  const sourceResponse = await call(`/content-packs/${pack.id}/source-units`);
  expect(sourceResponse.status).toBe(200);
  const sources = await sourceResponse.json() as {
    citation: string; bookKey: string; chapter: number; verse: number; ordinal: number; canonicalText: string;
  }[];
  expect(sources.map(({ citation, bookKey, chapter, verse, ordinal, canonicalText }) => ({
    citation, bookKey, chapter, verse, ordinal, text: canonicalText,
  }))).toEqual(expected);
  const store = new Store(app.db as unknown as D1Database);
  const ctx = { orgId: TEST_ORG, store, env:{DB:app.db} } as unknown as RequestContext;
  for (const chapter of [1, 119]) {
    const verses = expected.filter(unit => unit.chapter === chapter);
    const created = await call("/seasons", "POST", {
      name: `Psalms ${chapter} season`, yearLabel: "2026", ruleProfileKey: "PBE_STYLE_V1",
    });
    expect(created.status).toBe(201);
    const season = await created.json() as { id: string };
    const scope = { contentPackId: pack.id, includes: [{ bookKey: "PSA", startChapter: chapter,
      startVerse: verses[0].verse, endChapter: chapter, endVerse: verses.at(-1)!.verse }], excludes: [] };
    expect((await call(`/seasons/${season.id}/scope`, "POST", scope)).status).toBe(204);
    const scopeRead = await call(`/seasons/${season.id}/scope`);
    expect(await scopeRead.json()).toMatchObject(scope);
    const seasonRead = await call(`/seasons/${season.id}`);
    expect(await seasonRead.json()).toMatchObject({ status: "ContentReady", scopeUnitCount: verses.length });
    expect((await effectiveSources(ctx, season.id)).map(source => ({
      citation: source.citation, bookKey: source.bookKey, chapter: source.chapter,
      verse: source.verse, ordinal: source.ordinal, text: source.canonicalText,
    }))).toEqual(verses);
  }
  const again = await call("/content-packs/import", "POST", input);
  expect(again.status).toBe(200);
  expect(await again.json()).toMatchObject({ id: pack.id, unitCount: 2461 });
  expect(await countForPack(input.packKey)).toBe(1);
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM Records WHERE kind='source' AND owner_id=?")
    .bind(pack.id).first("count")).toBe(2461);

  const changed = structuredClone(input);
  changed.documents[0].units[0].text += " Changed for validation.";
  const conflict = await call("/content-packs/import", "POST", changed);
  expect(conflict.status).toBe(400);
  expect(await conflict.text()).toContain("requires a new version");
}, 30000);

function syntheticPack(key: string, count: number): ImportContentPackRequest {
  return { packKey: key, version: 1, locale: "en", sourceType: "Scripture", licensingStatus: "public-domain",
    documents: [{ name: "Synthetic import limit test", units: Array.from({ length: count }, (_, index) => ({
      citation: `Test ${Math.floor(index / 500) + 1}:${index % 500 + 1}`, bookKey: "TST",
      chapter: Math.floor(index / 500) + 1, verse: index % 500 + 1, ordinal: index + 1,
      text: `Synthetic ${key} source ${index + 1}. ${"A".repeat(225)}`,
    })) }],
  };
}

it("imports and retrieves 5000 sources when added storage metadata requires multiple bounded inserts", async () => {
  const input = syntheticPack("bounded-source-inserts", 5000);
  expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(1_048_576);
  expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThan(2 * 1024 * 1024);
  const response = await call("/content-packs/import", "POST", input);
  const pack = await response.json() as { id: string; unitCount: number };
  expect(response.status, JSON.stringify(pack)).toBe(200);
  expect(pack.unitCount).toBe(5000);
  const sourceResponse = await call(`/content-packs/${pack.id}/source-units`);
  expect(sourceResponse.status).toBe(200);
  const sources = await sourceResponse.json() as { ordinal: number; canonicalText: string }[];
  expect(Buffer.byteLength(JSON.stringify(sources))).toBeGreaterThan(2_000_000);
  expect(sources.map(source => ({ ordinal: source.ordinal, text: source.canonicalText }))).toEqual(
    input.documents[0].units.map(unit => ({ ordinal: unit.ordinal, text: unit.text })),
  );
}, 30000);

it("rolls back earlier source chunks and the pack if a later chunk fails", async () => {
  const input = syntheticPack("reject-later-source-chunk", 5000);
  const sourceCount = () => app.db.prepare("SELECT COUNT(*) AS count FROM Records WHERE kind='source'").first("count");
  const before = await sourceCount();
  await app.db.prepare("CREATE TRIGGER RejectLastImportSource BEFORE INSERT ON Records WHEN NEW.kind='source' AND json_extract(NEW.data,'$.ordinal')=5000 BEGIN SELECT RAISE(ABORT,'reject final chunk for test'); END").run();
  try {
    expect((await call("/content-packs/import", "POST", input)).status).toBe(503);
    expect(await countForPack(input.packKey)).toBe(0);
    expect(await sourceCount()).toBe(before);
  } finally {
    await app.db.prepare("DROP TRIGGER RejectLastImportSource").run();
  }
}, 30000);

it("rejects more than 5000 verses and oversized request bodies before creating a pack", async () => {
  const tooMany = syntheticPack("over-unit-limit", 5001);
  const unitResponse = await call("/content-packs/import", "POST", tooMany);
  expect(unitResponse.status).toBe(400);
  expect(await unitResponse.text()).toContain("at most 5000");
  expect(await countForPack(tooMany.packKey)).toBe(0);
  const tooLarge = syntheticPack("over-body-limit", 1);
  const oversized = JSON.stringify(tooLarge) + " ".repeat(2 * 1024 * 1024);
  expect((await call("/content-packs/import", "POST", oversized)).status).toBe(413);
  expect(await countForPack(tooLarge.packKey)).toBe(0);
}, 30000);
