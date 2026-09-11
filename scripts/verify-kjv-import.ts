import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNativeTestApp, TEST_ORG, TEST_USER } from "../apps/web/worker/native/test-runtime.ts";
import { parseContentPackImport } from "../apps/web/src/features/admin/contentPackImport.ts";

// Explicitly uses an ephemeral Miniflare test database, never the app database or a remote binding.
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputDirectory = path.resolve(process.argv[2] ?? path.join(repositoryRoot, "content/kjv/import-packs"));
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const output = path.resolve(process.argv[3] ?? path.join(repositoryRoot, "content/kjv/import-verification.json"));
const candidates = [];
for (const name of await readdir(inputDirectory)) {
  if (!name.endsWith(".json")) continue;
  const file = path.resolve(inputDirectory, name);
  const raw = await readFile(file, "utf8");
  const json = JSON.parse(raw);
  if (!json.packKey || !Array.isArray(json.documents)) continue;
  const input = parseContentPackImport(raw);
  const count = input.documents.reduce((total, document) => total + document.units.length, 0);
  candidates.push({ file, fileSha256: digest(raw), rawBytes: Buffer.byteLength(raw, "utf8"), input, count });
}
assert.equal(candidates.length, 66, "Expected all 66 whole-book import packs.");
for (const candidate of candidates) {
  assert(candidate.count <= 5000, `${candidate.file} exceeds the source-unit limit`);
  assert(candidate.rawBytes <= 1_800_000, `${candidate.file} exceeds the chosen size budget`);
  assert.equal(candidate.input.licensingStatus, "public-domain");
}
const masterRaw = await readFile(path.resolve(inputDirectory, "../kjv-1769.master.json"), "utf8");
const master = parseContentPackImport(masterRaw);
const masterUnits = master.documents.flatMap(document => document.units).sort((a, b) => a.ordinal - b.ordinal);
const allUnits = candidates.flatMap(candidate => candidate.input.documents.flatMap(document => document.units))
  .sort((a, b) => a.ordinal - b.ordinal);
assert.deepEqual(allUnits, masterUnits, "Whole-book packs must exactly cover the master once.");
assert.equal(allUnits.length, 31102);
const largest = [...candidates].sort((a, b) => b.rawBytes - a.rawBytes || b.count - a.count)[0];
type StoredSource = {
  id: string; citation: string; bookKey: string; chapter: number; verse: number; ordinal: number; canonicalText: string;
};
const sourceFields = ({ citation, bookKey, chapter, verse, ordinal, canonicalText }: StoredSource) => ({
  citation, bookKey, chapter, verse, ordinal, text: canonicalText,
});
const app = await createNativeTestApp();
try {
  const login = await app.login();
  assert.equal(login.status, 200, await login.text());
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const call = (suffix: string, method = "GET", data?: unknown, auth = cookie) => app.fetch(
    `/api/v1/organizations/${TEST_ORG}${suffix}`,
    { method, headers: { Cookie: auth, Origin: "https://erudoza.test", "Content-Type": "application/json" },
      ...(data === undefined ? {} : { body: JSON.stringify(data, null, 2) }) },
  );
  const importedPacks = new Map<string, { id: string; unitCount: number; licensingStatus: string }>();
  for (const candidate of candidates) {
    const imported = await call("/content-packs/import", "POST", candidate.input);
    const pack = await imported.json() as { id: string; unitCount: number; licensingStatus: string };
    assert.equal(imported.status, 200, `${candidate.file}: ${JSON.stringify(pack)}`);
    assert.equal(pack.unitCount, candidate.count);
    assert.equal(pack.licensingStatus, "public-domain");
    importedPacks.set(candidate.file, pack);
  }
  const totalSources = () => app.db.prepare("SELECT COUNT(*) AS count FROM Records WHERE kind='source'").first("count");
  const totalPacks = () => app.db.prepare("SELECT COUNT(*) AS count FROM Records WHERE kind='pack'").first("count");
  assert.equal(await totalSources(), 31102);
  assert.equal(await totalPacks(), 66);
  const packReceipts = [];
  let psalmsSources: StoredSource[] = [];
  // Read every book only after all 31,102 sources exist in this same organization.
  for (const candidate of candidates) {
    const pack = importedPacks.get(candidate.file)!;
    const storedResponse = await call(`/content-packs/${pack.id}/source-units`);
    assert.equal(storedResponse.status, 200, candidate.file);
    const stored = await storedResponse.json() as StoredSource[];
    const expected = candidate.input.documents.flatMap(document => document.units).sort((a, b) => a.ordinal - b.ordinal);
    assert.deepEqual(stored.map(sourceFields), expected, `${candidate.file}: every source field must round-trip exactly`);
    const repeated = await call("/content-packs/import", "POST", candidate.input);
    assert.equal(repeated.status, 200, candidate.file);
    assert.equal((await repeated.json() as { id: string }).id, pack.id);
    if (expected[0].bookKey === "PSA") psalmsSources = stored;
    packReceipts.push({ file: path.relative(path.dirname(output), candidate.file).replaceAll("\\", "/"),
      packKey: candidate.input.packKey, version: candidate.input.version, verseCount: candidate.count,
      inputBytes: candidate.rawBytes, fileSha256: candidate.fileSha256,
      sourceFieldsSha256: digest(JSON.stringify(stored.map(sourceFields))), exactReadback: true, idempotentReimport: true });
  }
  assert.equal(await totalSources(), 31102);
  assert.equal(await totalPacks(), 66);
  const largestPack = importedPacks.get(largest.file)!;
  await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT ?,org_id,?,?,'Adult','Admin',password_hash,'v1' FROM Users WHERE id=?")
    .bind("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "second-kjv-coach", "Second KJV Coach", TEST_USER).run();
  const secondLogin = await app.fetch("/api/v1/auth/login", { method: "POST", headers: { Origin: "https://erudoza.test" },
    body: JSON.stringify({ identifier: "second-kjv-coach", password: "Testing!123" }) });
  assert.equal(secondLogin.status, 200);
  const secondCookie = secondLogin.headers.get("set-cookie")!.split(";")[0];
  const aliases = await Promise.all([
    call("/content-packs/import", "POST", { ...largest.input, packKey: "coach-one-whole-psalms" }),
    call("/content-packs/import", "POST", { ...largest.input, packKey: "coach-two-whole-psalms" }, secondCookie),
  ]);
  for (const alias of aliases) {
    assert.equal(alias.status, 200);
    assert.equal((await alias.json() as { id: string }).id, largestPack.id);
  }
  assert.equal(await totalSources(), 31102);
  assert.equal(await totalPacks(), 66);
  const changedInput = structuredClone(largest.input);
  changedInput.documents[0].units[0].text += " [validation-only change]";
  const changed = await call("/content-packs/import", "POST", changedInput);
  assert.equal(changed.status, 400, await changed.text());
  assert.equal(psalmsSources.length, 2461);
  assert.equal(largest.input.documents[0].units[0].bookKey, "PSA");
  const reusableSeasonScopes = [];
  for (const chapter of [1, 119]) {
    const expected = psalmsSources.filter(source => source.chapter === chapter);
    const created = await call("/seasons", "POST", {
      name: `KJV Psalms ${chapter} reuse validation`, yearLabel: "2026", ruleProfileKey: "PBE_STYLE_V1",
    });
    assert.equal(created.status, 201);
    const season = await created.json() as { id: string };
    const scope = { contentPackId: largestPack.id, includes: [{ bookKey: "PSA", startChapter: chapter,
      startVerse: expected[0].verse, endChapter: chapter, endVerse: expected.at(-1)!.verse }], excludes: [] };
    const scoped = await call(`/seasons/${season.id}/scope`, "POST", scope);
    assert.equal(scoped.status, 204, await scoped.text());
    const scopeRead = await call(`/seasons/${season.id}/scope`);
    assert.equal(scopeRead.status, 200);
    assert.deepEqual(await scopeRead.json(), scope);
    const seasonRead = await call(`/seasons/${season.id}`);
    assert.equal(seasonRead.status, 200);
    const savedSeason = await seasonRead.json() as { status: string; scopeUnitCount: number };
    assert.equal(savedSeason.status, "ContentReady");
    assert.equal(savedSeason.scopeUnitCount, expected.length);
    reusableSeasonScopes.push({ bookKey: "PSA", chapter, expectedVerseCount: expected.length,
      resolvedVerseCount: savedSeason.scopeUnitCount, sameStoredPackReferenced: true });
  }
  const afterReuse = await call(`/content-packs/${largestPack.id}/source-units`);
  assert.equal(afterReuse.status, 200);
  assert.deepEqual(await afterReuse.json(), psalmsSources, "Both seasons must reference the original source IDs and text.");
  assert.equal(await totalSources(), 31102);
  assert.equal(await totalPacks(), 66);

  const report = {
    schemaVersion: 1, validatedAtUtc: new Date().toISOString(), runtime: "local Miniflare/D1, not deployed",
    databaseLifetime: "ephemeral test fixture", sourceMasterSha256: digest(masterRaw),
    importedPackCount: candidates.length, importedVerseCount: allUnits.length,
    allBooksReadAfterCompleteImportIntoSameOrganization: true, publicDomainStatusPreserved: true,
    exactTextAndLocatorRoundTrip: true, allPacksReimportedWithoutDuplicates: true,
    changedTextWithoutVersionBumpRejected: true, concurrentCoachesDifferentNamesReusedPsalms: true,
    reusableSeasonScopes, additionalSourceRowsFromTwoSeasons: 0,
    psalmsSourceIdsUnchanged: true, storedPsalmsVerseCount: psalmsSources.length,
    finalPackRows: await totalPacks(), finalSourceRows: await totalSources(),
    packs: packReceipts,
    persistentAppDatabaseWrites: false, remoteWrites: false,
  };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, ...report, packs: `${packReceipts.length} exact readback receipts in file` }, null, 2));
} finally {
  await app.runtime.dispose();
}
