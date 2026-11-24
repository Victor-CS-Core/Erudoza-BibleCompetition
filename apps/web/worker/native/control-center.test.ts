// @vitest-environment node
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createNativeTestApp, TEST_ORG, TEST_USER } from "./test-runtime";
import { APP_VERSION } from "./version";
import { routeArea, recordErrorEvent } from "./error-events";
import { composeWeeklyDigest, runMasterDigest } from "./control-center";
import { LIBRARY_ORG } from "./application/library-access";

/** Control Center: master gate, cross-org aggregation, tickets, backfills,
 *  the completion rollup, error windows, and the Monday digest. One app,
 *  fixtures in beforeAll; the week is pinned by query params so the XP and
 *  activity windows are deterministic (today = Tue 2026-11-24). */

const ORG2 = "22222222-2222-4222-8222-222222222222";
const MASTER = TEST_USER;
const ADMIN1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const CM1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const STUDENT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const STUDENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4";
const OWNER2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5";
const STUDENT_C = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6";
const TODAY = "2026-11-24", WEEK_START = "2026-11-23";
const Q = `?today=${TODAY}&weekStart=${WEEK_START}`;

let app: Awaited<ReturnType<typeof createNativeTestApp>>;
const cookies = new Map<string, string>();

async function loginAs(userName: string): Promise<string> {
  const res = await app.fetch("/api/v1/auth/login", { method: "POST", headers: { Origin: "https://erudoza.test", "Content-Type": "application/json" }, body: JSON.stringify({ identifier: userName, password: "Testing!123" }) });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
  cookies.set(userName, cookie);
  return cookie;
}
async function request(path: string, userName = "coach", method = "GET", value?: unknown) {
  return app.fetch(path, { method, headers: { Cookie: cookies.get(userName)!, Origin: "https://erudoza.test", "Content-Type": "application/json" }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
async function addUser(id: string, org: string, userName: string, kind: string, role: string, createdAt: number | null, email?: string) {
  await app.db.prepare(`INSERT INTO Users(id, org_id, user_name, email, display_name, kind, role, password_hash, credential_version, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, password_hash, credential_version, ? FROM Users WHERE id = ?`)
    .bind(id, org, userName, email ?? null, userName, kind, role, createdAt, TEST_USER).run();
}
async function record(kind: string, id: string, org: string, value: unknown, seasonId: string | null = null, owner: string | null = null) {
  await app.db.prepare("INSERT INTO Records(kind, id, org_id, season_id, owner_id, data) VALUES(?,?,?,?,?,?)").bind(kind, id, org, seasonId, owner, JSON.stringify(value)).run();
}
async function xpRecord(org: string, userId: string, xpByDay: Record<string, number>) {
  const id = `${org}:${userId}`;
  await record("training-xp", id, org, { id, totalXp: Object.values(xpByDay).reduce((a, b) => a + b, 0), xpBySeason: {}, attemptXpByDay: {}, xpByDay, xpByDaySeason: {}, updatedAtUtc: "2026-11-24T00:00:00Z" });
}

beforeAll(async () => {
  app = await createNativeTestApp({ bindings: { SUPPORT_INGEST_TOKEN: "test-ingest-token" } });
  await app.db.prepare("UPDATE Users SET email = 'viticopq12@gmail.com' WHERE id = ?").bind(TEST_USER).run();
  await app.db.prepare("INSERT INTO Organizations(id, name, slug) VALUES(?,?,?)").bind(ORG2, "Northgate Club", "northgate").run();
  // The built-in library lives in its own organization row; it is storage,
  // not a club, and must never surface in club listings.
  await app.db.prepare("INSERT INTO Organizations(id, name, slug) VALUES(?,?,?)").bind(LIBRARY_ORG, "Immutable Scripture Library", "scripture-library").run();
  await addUser(ADMIN1, TEST_ORG, "admin1", "Adult", "Admin", null);
  await addUser(CM1, TEST_ORG, "cm1", "Adult", "Content Manager", null);
  await addUser(STUDENT_A, TEST_ORG, "studenta", "Student", "Student", null);
  await addUser(STUDENT_B, TEST_ORG, "studentb", "Student", "Student", Date.parse("2026-11-05T00:00:00Z"));
  await addUser(OWNER2, ORG2, "owner2", "Adult", "Owner", null, "owner2@example.com");
  await addUser(STUDENT_C, ORG2, "studentc", "Student", "Student", Date.parse("2026-09-01T00:00:00Z"));
  for (const name of ["coach", "admin1", "cm1", "studenta", "owner2"]) await loginAs(name);

  await xpRecord(TEST_ORG, STUDENT_A, { "2026-11-23": 50, "2026-11-24": 30, "2026-11-20": 10 });
  await xpRecord(ORG2, STUDENT_C, { "2026-11-24": 20 });
  await xpRecord(TEST_ORG, MASTER, { "2026-11-18": 5 });

  const act = (day: string, org: string, sessions: number) => app.db.prepare("INSERT INTO DailyActivity(day, org_id, sessions) VALUES(?,?,?)").bind(day, org, sessions).run();
  await act(TODAY, TEST_ORG, 3); await act(TODAY, ORG2, 2); await act("2026-11-23", TEST_ORG, 4);

  for (let i = 0; i < 3; i++)
    await app.db.prepare("INSERT INTO CoachInvitations(id, org_id, email, inviter_id, token_hash, version, status, created_at, expires_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(`inv-${i}`, TEST_ORG, `invitee${i}@example.com`, TEST_USER, `hash-${i}`, "v1", i === 0 ? "accepted" : "pending", Date.parse("2026-11-01T00:00:00Z"), Date.parse("2026-12-01T00:00:00Z")).run();
  await record("attempt", "attempt-a", TEST_ORG, { id: "attempt-a" }, null, STUDENT_A);
  await record("pbe-attempt", "attempt-c", ORG2, { id: "attempt-c" }, null, STUDENT_C);

  const season1 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", season2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
  await record("season", season1, TEST_ORG, { id: season1, name: "2026-27 PBE Season", status: "Active", organizationId: TEST_ORG });
  await record("season", season2, ORG2, { id: season2, name: "Summer 2027", status: "Draft", organizationId: ORG2 });
  await record("membership", `${season1}:${STUDENT_A}`, TEST_ORG, { id: `${season1}:${STUDENT_A}`, seasonId: season1, userId: STUDENT_A }, season1, STUDENT_A);
  await record("membership", `${season1}:${STUDENT_B}`, TEST_ORG, { id: `${season1}:${STUDENT_B}`, seasonId: season1, userId: STUDENT_B }, season1, STUDENT_B);
  await record("membership", `${season2}:${STUDENT_C}`, ORG2, { id: `${season2}:${STUDENT_C}`, seasonId: season2, userId: STUDENT_C }, season2, STUDENT_C);
  await record("pbe-dispute", "dispute-1", TEST_ORG, { id: "dispute-1", status: "Pending", acceptedAtUtc: "2026-11-22T09:00:00Z" });

  await record("pbe-watcher-run", "run-1", LIBRARY_ORG, { id: "run-1", checkedAt: "2026-11-23T10:00:00Z", trigger: "scheduled", mediaChecked: 12, drafted: 1, newsDrafted: 1 });
  await record("pbe-material-proposal", "prop-1", LIBRARY_ORG, { id: "prop-1", status: "draft", proposedAtUtc: "2026-11-20T00:00:00Z" });
  await record("pbe-material-proposal", "prop-2", LIBRARY_ORG, { id: "prop-2", status: "draft", proposedAtUtc: "2026-11-21T00:00:00Z" });
  await record("pbe-material", "pbe-material-2026-27", LIBRARY_ORG, { id: "pbe-material-2026-27", yearLabel: "2026-27" });
  await record("pbe-news-article", "news-1", LIBRARY_ORG, { id: "news-1", status: "draft", createdBy: "nad-watcher", createdAtUtc: "2026-11-19T00:00:00Z" });
  await record("pbe-news-article", "news-2", LIBRARY_ORG, { id: "news-2", status: "published", createdBy: "nad-watcher", createdAtUtc: "2026-11-10T00:00:00Z" });
  await record("pack", "nkjv-pack", LIBRARY_ORG, { id: "nkjv-pack", isBuiltIn: true });
  for (let i = 0; i < 3; i++) await record("source", `lib-source-${i}`, LIBRARY_ORG, { id: `lib-source-${i}` }, null, "nkjv-pack");
}, 60000);
afterAll(async () => { await app?.runtime.dispose(); });

it("gates every control-center endpoint to the master account", async () => {
  for (const path of ["overview", "users", "content", "seasons", "clubs", "funnel", "system", "digest", "support"]) {
    expect((await request(`/api/v1/admin/control-center/${path}${Q}`, "coach")).status, path).toBe(200);
    for (const other of ["admin1", "cm1", "studenta", "owner2"])
      expect((await request(`/api/v1/admin/control-center/${path}${Q}`, other)).status, `${path} as ${other}`).toBe(403);
  }
  expect((await request("/api/v1/admin/control-center/support/tickets", "admin1", "POST", { requesterName: "X", subject: "Y" })).status).toBe(403);
});

it("aggregates the overview across both clubs", async () => {
  const body = await (await request(`/api/v1/admin/control-center/overview${Q}`)).json() as Record<string, any>;
  expect(body.totalUsers).toBe(7);
  expect(body.newThisMonth).toBe(1); // only studentb carries a November created_at
  expect(body.xpThisWeek).toBe(100); // 80 org1 + 20 org2
  expect(body.xpLastWeek).toBe(15); // 10 student a + 5 master, previous week
  expect(body.activeThisWeek).toBe(2);
  expect(body.activeLastWeek).toBe(2);
  expect(body.sessionsToday).toBe(5);
  expect(body.chart).toHaveLength(14);
  expect(body.chart.at(-1)).toEqual({ day: TODAY, sessions: 5 });
  expect(body.chart.at(-2)).toEqual({ day: "2026-11-23", sessions: 4 });
  expect(body.todayByClub).toEqual([
    { organizationId: TEST_ORG, name: "Practice Club", sessions: 3, students: 2 },
    { organizationId: ORG2, name: "Northgate Club", sessions: 2, students: 1 },
  ]);
});

it("lists newest users across clubs with join dates where known", async () => {
  const body = await (await request("/api/v1/admin/control-center/users")).json() as Record<string, any>;
  expect(body.clubs).toBe(2);
  expect(body.newest[0].displayName).toBe("studentb");
  expect(body.newest[0].joinedAtUtc).toBe("2026-11-05T00:00:00.000Z");
  expect(body.newest[0].organizationName).toBe("Practice Club");
  const seed = body.newest.find((u: any) => u.id === STUDENT_C);
  expect(seed.organizationName).toBe("Northgate Club");
  expect(body.newest.at(-1).joinedAtUtc).toBeNull(); // unknown dates sort last, shown as a dash client-side
});

it("reports club health: active learners, sessions, and quiet learners per club", async () => {
  const body = await (await request(`/api/v1/admin/control-center/clubs${Q}`)).json() as Record<string, any>;
  const byId = new Map(body.clubs.map((c: any) => [c.organizationId, c]));
  expect(byId.get(TEST_ORG)).toMatchObject({ learners: 2, activeLearners: 1, sessionsThisWeek: 7, quietLearners: 1 });
  expect(byId.get(ORG2)).toMatchObject({ learners: 1, activeLearners: 1, sessionsThisWeek: 2, quietLearners: 0 });
});

it("builds the onboarding funnel with labeled sources", async () => {
  const body = await (await request(`/api/v1/admin/control-center/funnel${Q}`)).json() as Record<string, any>;
  expect(body.steps.map((s: any) => [s.key, s.count])).toEqual([
    ["invitations", 3], ["accounts", 7], ["first-practice", 2], ["active-week", 2],
  ]);
  for (const step of body.steps) expect(step.source.length).toBeGreaterThan(5);
});

it("summarizes content, watcher, seasons, and open disputes", async () => {
  const content = await (await request("/api/v1/admin/control-center/content")).json() as Record<string, any>;
  expect(content.watcher).toMatchObject({ checkedAt: "2026-11-23T10:00:00Z", mediaChecked: 12 });
  expect(content).toMatchObject({ materialDrafts: 2, liveReleases: 1, newsSuggestions: 1, newsPublished: 1, libraryPacks: 1, libraryVerses: 3 });
  const seasons = await (await request("/api/v1/admin/control-center/seasons")).json() as Record<string, any>;
  expect(seasons.seasons).toHaveLength(2);
  expect(seasons.seasons.find((s: any) => s.id.endsWith("c1"))).toMatchObject({ students: 2, status: "Active", organizationName: "Practice Club" });
  expect(seasons.openDisputes).toBe(1);
  expect(seasons.oldestDisputeAt).toBe("2026-11-22T09:00:00Z");
});

it("reports system state: version, cron, secret names only, ingest flag", async () => {
  const body = await (await request("/api/v1/admin/control-center/system")).json() as Record<string, any>;
  expect(body.version).toBe(APP_VERSION);
  expect(body.cron.expression).toBe("0 10 * * 1");
  expect(body.secrets.map((s: any) => s.name)).toEqual(["RESEND_API_KEY", "TURNSTILE_SECRET_KEY", "AUTH_CODE_SECRET"]);
  expect(body.supportIngestConfigured).toBe(true);
  expect(JSON.stringify(body)).not.toContain("test-ingest-token");
  const health = await (await app.fetch("/api/v1/health")).json() as Record<string, any>;
  expect(health.version).toBe(APP_VERSION);
});

it("counts errors in 24h and 7d windows by route area", async () => {
  const now = Date.now();
  const ins = (id: string, at: number, area: string) => app.db.prepare("INSERT INTO ErrorEvents(id, occurred_at, route_area, status, error_name) VALUES(?,?,?,503,'HttpError')").bind(id, at, area).run();
  await ins("err-1", now - 3_600_000, "Accounts");
  await ins("err-2", now - 25 * 3_600_000, "Accounts");
  await ins("err-3", now - 3 * 86_400_000, "Study");
  await ins("err-4", now - 8 * 86_400_000, "PBE");
  const body = await (await request("/api/v1/admin/control-center/system")).json() as Record<string, any>;
  expect(body.errors.last24h).toBe(1);
  expect(body.errors.last7d).toBe(3);
  expect(body.errors.byArea).toEqual([
    { area: "Accounts", last24h: 1, last7d: 2 },
    { area: "Study", last24h: 0, last7d: 1 },
  ]);
  expect(routeArea("/api/v1/auth/coach-options")).toBe("Accounts"); // the onboarding 503 class lands here
  expect(routeArea("/api/v1/study/sessions")).toBe("Study");
  await recordErrorEvent({ DB: app.db } as never, "/api/v1/pbe/disputes", 503, "HttpError");
  const after = await (await request("/api/v1/admin/control-center/system")).json() as Record<string, any>;
  expect(after.errors.last24h).toBe(2);
});

it("runs the ticket lifecycle: ingest, convert once, manual create, transitions, aging counts", async () => {
  const ingest = (messageId: string, token = "test-ingest-token") => app.fetch("/api/v1/support/ingest", { method: "POST", headers: { Origin: "https://erudoza.test", "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ messageId, fromName: "Maria L.", fromEmail: "maria@example.com", subject: "Can two clubs share one season?", snippet: "We run a small club…", body: "We run a small club and wondered if we could share a season." }) });
  expect((await ingest("msg-1", "wrong-token")).status).toBe(403);
  const first = await ingest("msg-1");
  expect(first.status).toBe(201);
  const entry = (await first.json() as Record<string, any>).entry;
  const dupe = await ingest("msg-1");
  expect(dupe.status).toBe(200);
  expect((await dupe.json() as Record<string, any>).alreadyProcessed).toBe(true);

  const created = await request("/api/v1/admin/control-center/support/tickets", "coach", "POST", { inboxId: entry.id });
  expect(created.status).toBe(201);
  const ticket = (await created.json() as Record<string, any>).ticket;
  expect(ticket).toMatchObject({ number: 101, label: "#S-101", source: "email", sourceMessageId: "msg-1", status: "New", requesterName: "Maria L." });
  const again = await request("/api/v1/admin/control-center/support/tickets", "coach", "POST", { inboxId: entry.id });
  expect(again.status).toBe(200);
  expect((await again.json() as Record<string, any>)).toMatchObject({ alreadyProcessed: true, ticket: { id: ticket.id } });

  const manual = await request("/api/v1/admin/control-center/support/tickets", "coach", "POST", { requesterName: "Coach Daniel", subject: "Printer question", body: "How do I print the leaderboard?" });
  expect(manual.status).toBe(201);
  const manualTicket = (await manual.json() as Record<string, any>).ticket;
  expect(manualTicket.number).toBe(102);

  for (const status of ["Open", "Waiting", "Resolved"]) {
    const res = await request(`/api/v1/admin/control-center/support/tickets/${ticket.id}/status`, "coach", "POST", { status });
    expect(res.status).toBe(200);
    expect((await res.json() as Record<string, any>).ticket.status).toBe(status);
  }
  expect((await request(`/api/v1/admin/control-center/support/tickets/${ticket.id}/status`, "coach", "POST", { status: "Bogus" })).status).toBe(400);
  expect((await request(`/api/v1/admin/control-center/support/tickets/nope/status`, "coach", "POST", { status: "Open" })).status).toBe(404);

  // Aging counts read created_at: a 3-day-old open ticket is aging, an
  // 8-day-old one is stale; the resolved ticket counts in neither.
  const now = Date.now();
  const old = (id: string, number: number, at: number) => app.db.prepare("INSERT INTO SupportTickets(id, number, source, requester_name, subject, status, created_at, updated_at) VALUES(?,?,'manual','Old',?,'Open',?,?)").bind(id, number, id, at, at).run();
  await old("ticket-aging", 150, now - 3 * 86_400_000);
  await old("ticket-stale", 151, now - 8 * 86_400_000);
  const support = await (await request("/api/v1/admin/control-center/support")).json() as Record<string, any>;
  expect(support.counts).toEqual({ newEmails: 0, openTickets: 3, aging48h: 2, stale7d: 1 });
  expect(support.inbox).toHaveLength(1);
  expect(support.inbox[0].ticketId).toBe(ticket.id);
  const stale = support.tickets.find((t: any) => t.id === "ticket-stale");
  expect(stale.ageHours).toBeGreaterThanOrEqual(192);
});

it("404s the ingest endpoint when its token is not configured", async () => {
  const bare = await createNativeTestApp();
  try {
    const res = await bare.fetch("/api/v1/support/ingest", { method: "POST", headers: { Origin: "https://erudoza.test", "Content-Type": "application/json", Authorization: "Bearer anything" }, body: JSON.stringify({ messageId: "m", fromName: "A", subject: "B" }) });
    expect(res.status).toBe(404);
  } finally { await bare.runtime.dispose(); }
}, 60000);

it("backfills created_at and DailyActivity from the migration SQL itself", async () => {
  // The harness applies migrations before seeding, so the backfill is proven
  // by executing the migration's own UPDATE/INSERT statements against rows
  // staged in their pre-migration shape.
  const sql = await readFile(new URL("../../migrations/0009_control_center.sql", import.meta.url), "utf8");
  const statements = sql.split(";").map(s => s.trim()).filter(s => s.startsWith("UPDATE Users SET created_at") || s.startsWith("INSERT INTO DailyActivity"));
  expect(statements).toHaveLength(4);
  const ghost = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  await addUser(ghost, TEST_ORG, "ghost", "Student", "Student", null);
  await app.db.prepare("INSERT INTO AuthChallenges(id, purpose, email, code_digest, user_id, created_at, expires_at, consumed_at) VALUES('chal-1','signup','ghost@example.com','x',?,1000,2000,?)").bind(ghost, Date.parse("2026-10-03T00:00:00Z")).run();
  const sessDay = "2026-10-20";
  await record("session", "ghost-session", TEST_ORG, { id: "ghost-session", status: "Completed", createdAtUtc: `${sessDay}T09:00:00Z`, completedAtUtc: `${sessDay}T10:00:00Z`, training: { creditedLocalDate: sessDay } }, null, STUDENT_B);
  for (const statement of statements) await app.db.prepare(statement).run();
  const row = await app.db.prepare("SELECT created_at FROM Users WHERE id = ?").bind(ghost).first<{ created_at: number }>();
  expect(row?.created_at).toBe(Date.parse("2026-10-03T00:00:00Z")); // the challenge source wins over later sources
  const rollup = await app.db.prepare("SELECT sessions FROM DailyActivity WHERE day = ? AND org_id = ?").bind(sessDay, TEST_ORG).first<{ sessions: number }>();
  expect(rollup?.sessions).toBe(1);
}, 30000);

it("stamps created_at on new students and counts a completed session once in the rollup", async () => {
  const before = await app.db.prepare("SELECT COALESCE(sum(sessions), 0) AS n FROM DailyActivity WHERE org_id = ?").bind(TEST_ORG).first<{ n: number }>();
  const created = await request(`/api/v1/organizations/${TEST_ORG}/students`, "coach", "POST", { userName: "newstudent", displayName: "New Student", password: "Testing!123" });
  expect(created.status).toBe(201);
  const stamp = await app.db.prepare("SELECT created_at FROM Users WHERE user_name = 'newstudent'").first<{ created_at: number | null }>();
  expect(stamp?.created_at).not.toBeNull();
  expect(Math.abs(Date.now() - (stamp?.created_at ?? 0))).toBeLessThan(60_000);

  // Full Memory-session flow (the spelling-fix fixture shape): start, draw,
  // freeze the card to known blanks, answer, complete — twice, proving the
  // completion write (and its rollup increment) is idempotent.
  const season = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", pack = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const sourceIds = [1, 2, 3].map(n => `99999999-9999-4999-8999-${String(n).padStart(12, "0")}`);
  await record("season", season, TEST_ORG, { id: season, name: "Rollup season", status: "Active", organizationId: TEST_ORG, ruleProfileKey: "PBE_STYLE_V1", ruleProfileVersion: 1 });
  await record("pack", pack, TEST_ORG, { id: pack, isActive: true, licensingStatus: "development-sample" });
  const range = { bookKey: "GEN", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 3 };
  await record("scope", season, TEST_ORG, { contentPackId: pack, includes: [range], excludes: [] });
  await record("assignment", "rollup-assignment", TEST_ORG, { id: "rollup-assignment", seasonId: season, studentUserId: TEST_USER, contentPackId: pack, type: "PrimarySpecialist", ...range }, season, TEST_USER);
  await record("membership", `${season}:${TEST_USER}`, TEST_ORG, { id: `${season}:${TEST_USER}`, seasonId: season, userId: TEST_USER, studentUserId: TEST_USER, difficulty: "Foundation" }, season, TEST_USER);
  for (const [i, id] of sourceIds.entries()) await record("source", id, TEST_ORG, { id, knowledgeUnitId: id, contentPackId: pack, citation: `Genesis 1:${i + 1}`, bookKey: "GEN", chapter: 1, verse: i + 1, ordinal: i + 1, canonicalText: `Synthetic verse ${i + 1} has words for this exercise.`, isActive: true }, null, pack);

  const session = await (await request("/api/v1/study/sessions", "coach", "POST", { seasonId: season, mode: "Practice" })).json() as { id: string };
  const base = `/api/v1/study/sessions/${session.id}`;
  await request(`${base}/next`);
  const saved = JSON.parse((await app.db.prepare("SELECT data FROM Records WHERE kind='session' AND id=?").bind(session.id).first<{ data: string }>())!.data);
  const card = saved.cards[0];
  const expected = ["beginning", "created", "earth"];
  card.payload.tokens = [{ index: 0, text: "Visible", hidden: false }, ...expected.map((text, i) => ({ index: i + 2, text, hidden: true }))];
  card.payload.prompt = "Visible " + expected.map(() => "____").join(" ");
  card.answerKey.canonicalAnswer = expected.join(" ");
  await app.db.prepare("UPDATE Records SET data=?, revision=revision+1 WHERE kind='session' AND id=?").bind(JSON.stringify(saved), session.id).run();
  const submit = await request(`${base}/attempts`, "coach", "POST", { clientSubmissionId: crypto.randomUUID(), challengeCardId: card.id, responseTimeMs: 42, hintsUsed: false, missingWordAnswers: expected.map((text, i) => ({ index: i + 2, text })) });
  expect(submit.status).toBe(200);
  expect((await request(`${base}/complete`, "coach", "POST", {})).status).toBe(200);
  expect((await request(`${base}/complete`, "coach", "POST", {})).status).toBe(200);
  const after = await app.db.prepare("SELECT COALESCE(sum(sessions), 0) AS n FROM DailyActivity WHERE org_id = ?").bind(TEST_ORG).first<{ n: number }>();
  expect((after?.n ?? 0) - (before?.n ?? 0)).toBe(1);
}, 60000);

it("composes and stores the Monday digest once per week", async () => {
  const digest = await composeWeeklyDigest({ DB: app.db } as never, "2026-11-16");
  // Week of Nov 16–22: master's 5 XP day (Nov 18) and student a's 10 XP day (Nov 20).
  expect(digest).toMatchObject({ weekStart: "2026-11-16", weekEnd: "2026-11-22", activeUsers: 2, xpAwarded: 15, sessions: 0, newUsers: 0 });
  const run = await runMasterDigest({ DB: app.db } as never);
  expect(run.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const stored = await app.db.prepare("SELECT count(*) AS n FROM Records WHERE kind = 'master-digest'").first<{ n: number }>();
  expect(stored?.n).toBe(1);
  await runMasterDigest({ DB: app.db } as never);
  const storedAgain = await app.db.prepare("SELECT count(*) AS n FROM Records WHERE kind = 'master-digest'").first<{ n: number }>();
  expect(storedAgain?.n).toBe(1);
  const endpoint = await (await request("/api/v1/admin/control-center/digest")).json() as Record<string, any>;
  expect(endpoint.digest.weekStart).toBe(run.weekStart);
}, 30000);
