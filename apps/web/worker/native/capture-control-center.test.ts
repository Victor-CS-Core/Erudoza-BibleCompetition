// @vitest-environment node
// Fixture generator for src/features/admin/control-center-real.test.tsx:
// captures REAL control-center endpoint payloads from this native app so the
// client render test runs on server-emitted shapes, not hand-written ones
// (the Nov 24 drift lesson). Re-run when the CC contract changes:
//   npx vitest run worker/native/capture-control-center.test.ts
import { afterAll, beforeAll, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { createNativeTestApp, TEST_ORG, TEST_USER } from "./test-runtime";
import { LIBRARY_ORG } from "./application/library-access";

const ORG2 = "22222222-2222-4222-8222-222222222222";
const STUDENT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const STUDENT_C = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6";
const TODAY = "2026-11-24", WEEK_START = "2026-11-23";
const Q = `?today=${TODAY}&weekStart=${WEEK_START}`;
const BASE = "/api/v1/admin/control-center";

let app: Awaited<ReturnType<typeof createNativeTestApp>>;
let cookie = "";

async function addUser(id: string, org: string, userName: string, kind: string, role: string, createdAt: number | null) {
  await app.db.prepare(`INSERT INTO Users(id, org_id, user_name, email, display_name, kind, role, password_hash, credential_version, created_at)
    SELECT ?, ?, ?, NULL, ?, ?, ?, password_hash, credential_version, ? FROM Users WHERE id = ?`)
    .bind(id, org, userName, userName, kind, role, createdAt, TEST_USER).run();
}
async function record(kind: string, id: string, org: string, value: unknown, seasonId: string | null = null, owner: string | null = null) {
  await app.db.prepare("INSERT INTO Records(kind, id, org_id, season_id, owner_id, data) VALUES(?,?,?,?,?,?)").bind(kind, id, org, seasonId, owner, JSON.stringify(value)).run();
}
async function xp(org: string, userId: string, xpByDay: Record<string, number>) {
  const id = `${org}:${userId}`;
  await record("training-xp", id, org, { id, totalXp: Object.values(xpByDay).reduce((a, b) => a + b, 0), xpBySeason: {}, attemptXpByDay: {}, xpByDay, xpByDaySeason: {}, updatedAtUtc: "2026-11-24T00:00:00Z" });
}

beforeAll(async () => {
  app = await createNativeTestApp({ bindings: { SUPPORT_INGEST_TOKEN: "capture-ingest-token" } });
  await app.db.prepare("UPDATE Users SET email = 'viticopq12@gmail.com' WHERE id = ?").bind(TEST_USER).run();
  await app.db.prepare("INSERT INTO Organizations(id, name, slug) VALUES(?,?,?)").bind(ORG2, "Northgate Club", "northgate").run();
  await app.db.prepare("INSERT INTO Organizations(id, name, slug) VALUES(?,?,?)").bind(LIBRARY_ORG, "Immutable Scripture Library", "scripture-library").run();
  await addUser(STUDENT_A, TEST_ORG, "studenta", "Student", "Student", Date.parse("2026-11-05T00:00:00Z"));
  await addUser(STUDENT_C, ORG2, "studentc", "Student", "Student", Date.parse("2026-09-01T00:00:00Z"));
  await xp(TEST_ORG, STUDENT_A, { "2026-11-23": 50, "2026-11-24": 30 });
  await xp(ORG2, STUDENT_C, { "2026-11-24": 20 });
  await app.db.prepare("INSERT INTO DailyActivity(day, org_id, sessions) VALUES(?,?,?)").bind(TODAY, TEST_ORG, 3).run();
  await app.db.prepare("INSERT INTO DailyActivity(day, org_id, sessions) VALUES(?,?,?)").bind(TODAY, ORG2, 2).run();
  await app.db.prepare("INSERT INTO DailyActivity(day, org_id, sessions) VALUES(?,?,?)").bind("2026-11-23", TEST_ORG, 4).run();
  const season1 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
  await record("season", season1, TEST_ORG, { id: season1, name: "2026-27 PBE Season", status: "Active", organizationId: TEST_ORG });
  await record("membership", `${season1}:${STUDENT_A}`, TEST_ORG, { id: `${season1}:${STUDENT_A}`, seasonId: season1, userId: STUDENT_A }, season1, STUDENT_A);
  await record("pbe-dispute", "dispute-1", TEST_ORG, { id: "dispute-1", status: "Pending", acceptedAtUtc: "2026-11-22T09:00:00Z" });
  await record("pbe-watcher-run", "run-1", LIBRARY_ORG, { id: "run-1", checkedAt: "2026-11-23T10:00:00Z", trigger: "scheduled", mediaChecked: 12, drafted: 1, newsDrafted: 1 });
  await record("pbe-material-proposal", "prop-1", LIBRARY_ORG, { id: "prop-1", status: "draft", proposedAtUtc: "2026-11-20T00:00:00Z" });
  await record("pbe-material", "pbe-material-2026-27", LIBRARY_ORG, { id: "pbe-material-2026-27", yearLabel: "2026-27" });
  await record("pbe-news-article", "news-1", LIBRARY_ORG, { id: "news-1", status: "draft", createdBy: "nad-watcher", createdAtUtc: "2026-11-19T00:00:00Z" });
  await record("pbe-news-article", "news-2", LIBRARY_ORG, { id: "news-2", status: "published", createdBy: "nad-watcher", createdAtUtc: "2026-11-10T00:00:00Z" });
  await record("pack", "nkjv-pack", LIBRARY_ORG, { id: "nkjv-pack", isBuiltIn: true });
  for (let i = 0; i < 3; i++) await record("source", `lib-source-${i}`, LIBRARY_ORG, { id: `lib-source-${i}` }, null, "nkjv-pack");
  await record("master-digest", "2026-11-16", LIBRARY_ORG, { weekStart: "2026-11-16", weekEnd: "2026-11-22", newUsers: 1, activeClubs: 2, activeUsers: 2, sessions: 9, xpAwarded: 40, openTickets: 1, errors7d: 2, generatedAtUtc: "2026-11-23T10:00:00Z" });
  const login = await app.fetch("/api/v1/auth/login", { method: "POST", headers: { Origin: "https://erudoza.test", "Content-Type": "application/json" }, body: JSON.stringify({ identifier: "coach", password: "Testing!123" }) });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  const ingest = await app.fetch("/api/v1/support/ingest", { method: "POST", headers: { Origin: "https://erudoza.test", "Content-Type": "application/json", Authorization: "Bearer capture-ingest-token" }, body: JSON.stringify({ messageId: "capture-1", fromName: "Ana Ruiz", fromEmail: "ana@example.com", subject: "Cannot sign in", body: "The code never arrives.", receivedAt: "2026-11-24T08:00:00Z" }) });
  expect(ingest.status).toBe(201);
  const manual = await app.fetch(`${BASE}/support/tickets`, { method: "POST", headers: { Cookie: cookie, Origin: "https://erudoza.test", "Content-Type": "application/json" }, body: JSON.stringify({ requesterName: "Coach Pat", subject: "Question about seasons", body: "When does the next season open?" }) });
  expect(manual.status).toBe(201);
}, 60000);
afterAll(async () => { await app?.runtime.dispose(); });

it("captures real control-center payloads", async () => {
  const get = async (path: string) => {
    const res = await app.fetch(`${BASE}/${path}`, { headers: { Cookie: cookie, Origin: "https://erudoza.test" } });
    expect(res.status, path).toBe(200);
    return { status: res.status, body: await res.json() };
  };
  const out: Record<string, unknown> = {
    overview: await get(`overview${Q}`),
    users: await get("users"),
    clubs: await get(`clubs${Q}`),
    funnel: await get(`funnel${Q}`),
    content: await get("content"),
    seasons: await get("seasons"),
    system: await get("system"),
    digest: await get("digest"),
    support: await get("support"),
  };
  const support = (out.support as { body: { tickets: unknown[]; inbox: unknown[] } }).body;
  expect(support.tickets.length).toBeGreaterThan(0);
  expect(support.inbox.length).toBe(1);
  writeFileSync(new URL("../../src/features/admin/__fixtures__/control-center-payloads.json", import.meta.url), JSON.stringify(out, null, 2));
});
