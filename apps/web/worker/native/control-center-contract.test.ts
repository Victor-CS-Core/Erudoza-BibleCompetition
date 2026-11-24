// @vitest-environment node
import { afterAll, beforeAll, expect, it } from "vitest";
import { createNativeTestApp, TEST_ORG, TEST_USER } from "./test-runtime";
import { LIBRARY_ORG } from "./application/library-access";

/** Control Center CONTRACT guard (Nov 24 audit). The production Content-tab
 *  crash came from client/server field-name drift where each side's tests
 *  encoded its own dialect and both were green. This suite pins the wire to
 *  the CLIENT contract (src/api/controlCenter.ts): every field the client
 *  consumes must be present with the right type, and no legacy-dialect
 *  field name may reappear. It also pins the anonymous gate (401). */

const ORG2 = "22222222-2222-4222-8222-222222222222";
const STUDENT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
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

beforeAll(async () => {
  app = await createNativeTestApp({ bindings: { SUPPORT_INGEST_TOKEN: "contract-ingest-token" } });
  await app.db.prepare("UPDATE Users SET email = 'viticopq12@gmail.com' WHERE id = ?").bind(TEST_USER).run();
  await app.db.prepare("INSERT INTO Organizations(id, name, slug) VALUES(?,?,?)").bind(ORG2, "Northgate Club", "northgate").run();
  await app.db.prepare("INSERT INTO Organizations(id, name, slug) VALUES(?,?,?)").bind(LIBRARY_ORG, "Immutable Scripture Library", "scripture-library").run();
  await addUser(STUDENT_A, TEST_ORG, "studenta", "Student", "Student", Date.parse("2026-11-05T00:00:00Z"));
  const login = await app.fetch("/api/v1/auth/login", { method: "POST", headers: { Origin: "https://erudoza.test", "Content-Type": "application/json" }, body: JSON.stringify({ identifier: "coach", password: "Testing!123" }) });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];

  const xpId = `${TEST_ORG}:${STUDENT_A}`;
  await record("training-xp", xpId, TEST_ORG, { id: xpId, totalXp: 80, xpBySeason: {}, attemptXpByDay: {}, xpByDay: { "2026-11-23": 50, "2026-11-24": 30 }, xpByDaySeason: {}, updatedAtUtc: "2026-11-24T00:00:00Z" });
  await app.db.prepare("INSERT INTO DailyActivity(day, org_id, sessions) VALUES(?,?,?)").bind(TODAY, TEST_ORG, 3).run();
  const season1 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
  await record("season", season1, TEST_ORG, { id: season1, name: "2026-27 PBE Season", status: "Active", organizationId: TEST_ORG });
  await record("membership", `${season1}:${STUDENT_A}`, TEST_ORG, { id: `${season1}:${STUDENT_A}`, seasonId: season1, userId: STUDENT_A }, season1, STUDENT_A);
  await record("pbe-dispute", "dispute-1", TEST_ORG, { id: "dispute-1", status: "Pending", acceptedAtUtc: "2026-11-22T09:00:00Z" });
  await record("pbe-watcher-run", "run-1", LIBRARY_ORG, { id: "run-1", checkedAt: "2026-11-23T10:00:00Z", trigger: "scheduled", mediaChecked: 12, drafted: 1, newsDrafted: 1 });
  await record("pbe-material-proposal", "prop-1", LIBRARY_ORG, { id: "prop-1", status: "draft", proposedAtUtc: "2026-11-20T00:00:00Z" });
  await record("pbe-material", "pbe-material-2026-27", LIBRARY_ORG, { id: "pbe-material-2026-27", yearLabel: "2026-27" });
  await record("pbe-news-article", "news-1", LIBRARY_ORG, { id: "news-1", status: "draft", createdBy: "nad-watcher", createdAtUtc: "2026-11-19T00:00:00Z" });
  await record("pack", "nkjv-pack", LIBRARY_ORG, { id: "nkjv-pack", isBuiltIn: true });
  await record("source", "lib-source-0", LIBRARY_ORG, { id: "lib-source-0" }, null, "nkjv-pack");
  await record("master-digest", "2026-11-16", LIBRARY_ORG, { weekStart: "2026-11-16", weekEnd: "2026-11-22", newUsers: 1, activeClubs: 1, activeUsers: 2, sessions: 9, xpAwarded: 40, openTickets: 0, errors7d: 2, generatedAtUtc: "2026-11-23T10:00:00Z" });

  // One support email through the real ingest path, converted to a ticket.
  const ingest = await app.fetch("/api/v1/support/ingest", { method: "POST", headers: { Origin: "https://erudoza.test", "Content-Type": "application/json", Authorization: "Bearer contract-ingest-token" }, body: JSON.stringify({ messageId: "contract-1", fromName: "Ana Ruiz", fromEmail: "ana@example.com", subject: "Cannot sign in", body: "The code never arrives.", receivedAt: "2026-11-24T08:00:00Z" }) });
  expect(ingest.status).toBe(201);
}, 60000);
afterAll(async () => { await app?.runtime.dispose(); });

const get = (path: string, withCookie = true) => app.fetch(`${BASE}/${path}`, { headers: { Origin: "https://erudoza.test", ...(withCookie ? { Cookie: cookie } : {}) } });

function expectKeys(obj: Record<string, unknown>, required: string[], context: string) {
  for (const key of required) expect(obj, `${context} missing ${key}`).toHaveProperty(key);
}
const LEGACY_DIALECT = ["liveReleases", "materialDrafts", "materialDraftOldestAt", "newsSuggestionOldestAt", "organizationName", "organizationId", "checkedAt", "generatedAtUtc", "students"];

it("rejects anonymous callers with 401 on every endpoint", async () => {
  for (const path of ["overview", "users", "content", "seasons", "clubs", "funnel", "system", "digest", "support"]) {
    expect((await get(`${path}${Q}`, false)).status, path).toBe(401);
  }
  const post = await app.fetch(`${BASE}/support/tickets`, { method: "POST", headers: { Origin: "https://erudoza.test", "Content-Type": "application/json" }, body: JSON.stringify({ requesterName: "X", subject: "Y" }) });
  expect(post.status).toBe(401);
});

it("serves the client contract on every endpoint (no field drift)", async () => {
  const overview = await (await get(`overview${Q}`)).json() as Record<string, any>;
  expectKeys(overview, ["totalUsers", "newThisMonth", "xpThisWeek", "xpLastWeek", "activeThisWeek", "activeLastWeek", "sessionsToday", "sessionsDailyAverage", "chart", "todayByClub"], "overview");
  expectKeys(overview.chart[0], ["day", "sessions"], "overview.chart[]");
  expectKeys(overview.todayByClub[0], ["orgId", "name", "sessions", "students"], "overview.todayByClub[]");

  const users = await (await get("users")).json() as Record<string, any>;
  expectKeys(users, ["clubs", "newest"], "users");
  expectKeys(users.newest[0], ["id", "displayName", "userName", "email", "kind", "role", "orgName", "active", "joinedAtUtc"], "users.newest[]");

  const clubs = await (await get(`clubs${Q}`)).json() as Record<string, any>;
  expectKeys(clubs.clubs[0], ["orgId", "name", "learners", "activeLearners", "sessionsThisWeek", "quietLearners"], "clubs[]");

  const funnel = await (await get(`funnel${Q}`)).json() as Record<string, any>;
  expectKeys(funnel.steps[0], ["key", "label", "count", "source"], "funnel.steps[]");

  const content = await (await get("content")).json() as Record<string, any>;
  expectKeys(content, ["watcher", "proposalsPending", "proposalsOldestAtUtc", "releasesLive", "newsSuggestions", "newsDrafts", "newsPublished", "newsOldestSuggestionAtUtc", "libraryPacks", "libraryVerses"], "content");
  expectKeys(content.watcher, ["checkedAtUtc", "mediaChecked", "notes"], "content.watcher");

  const seasons = await (await get("seasons")).json() as Record<string, any>;
  expectKeys(seasons, ["openDisputes", "oldestDisputeAtUtc", "seasons"], "seasons");
  expectKeys(seasons.seasons[0], ["id", "name", "status", "orgName", "members"], "seasons.seasons[]");

  const system = await (await get("system")).json() as Record<string, any>;
  expectKeys(system, ["version", "database", "cron", "secrets", "supportIngestConfigured", "supportAddress", "errors"], "system");
  expect(system.database).toBe("ok");
  expectKeys(system.cron, ["expression", "label"], "system.cron");
  expectKeys(system.errors, ["last24h", "last7d", "byArea"], "system.errors");
  // Secret entries carry a NAME and a presence flag only — never a value.
  for (const secret of system.secrets) expect(Object.keys(secret).sort()).toEqual(["name", "present"]);

  const digest = await (await get("digest")).json() as Record<string, any>;
  expectKeys(digest.digest, ["weekStart", "weekEnd", "newUsers", "activeClubs", "activeUsers", "sessions", "xpAwarded", "openTickets", "errors7d", "composedAtUtc"], "digest");

  const support = await (await get("support")).json() as Record<string, any>;
  expectKeys(support, ["supportAddress", "counts", "inbox", "tickets"], "support");
  expectKeys(support.counts, ["newEmails", "openTickets", "aging48h", "stale7d"], "support.counts");
  expectKeys(support.inbox[0], ["id", "requesterName", "requesterEmail", "subject", "snippet", "body", "receivedAtUtc", "ticketId", "ticketNumber"], "support.inbox[]");

  // Convert the ingested email and pin the ticket DTO + both POST responses.
  const inboxId = support.inbox[0].id as string;
  const created = await app.fetch(`${BASE}/support/tickets`, { method: "POST", headers: { Cookie: cookie, Origin: "https://erudoza.test", "Content-Type": "application/json" }, body: JSON.stringify({ inboxId }) });
  expect(created.status).toBe(201);
  const createdBody = await created.json() as Record<string, any>;
  expectKeys(createdBody, ["ticket", "alreadyProcessed"], "createTicket response");
  expectKeys(createdBody.ticket, ["id", "number", "source", "requesterName", "requesterEmail", "subject", "body", "status", "createdAtUtc", "updatedAtUtc", "ageHours"], "ticket");
  const after = await (await get("support")).json() as Record<string, any>;
  expectKeys(after.tickets[0], ["id", "number", "source", "requesterName", "requesterEmail", "subject", "body", "status", "createdAtUtc", "updatedAtUtc", "ageHours"], "support.tickets[]");
  expect(after.inbox[0].ticketNumber).toBe(after.tickets[0].number);

  // No legacy-dialect field name in the payload it once corrupted (scoped:
  // "students" is a legitimate todayByClub field — it was only wrong inside
  // seasons rows, where the client reads "members").
  const scoped: [string, Record<string, unknown>][] = [
    ["content", content], ["seasons", seasons], ["users", users], ["clubs", clubs], ["digest", digest],
  ];
  for (const [name, payload] of scoped) {
    const text = JSON.stringify(payload);
    for (const legacy of LEGACY_DIALECT) expect(text, `${name}: legacy field ${legacy} reappeared`).not.toContain(`"${legacy}":`);
  }
});
