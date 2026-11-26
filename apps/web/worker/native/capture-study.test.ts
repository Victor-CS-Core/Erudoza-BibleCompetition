// @vitest-environment node
// CROSS-WIRE CONTRACT suite for the study/session surface (card 15, Nov 24
// audit follow-up; pattern from capture-control-center.test.ts +
// control-center-contract.test.ts). Drives the REAL study flow over HTTP
// against the real native app — start → next → attempt → resume → complete →
// recap, plus the progress reads — then (a) pins every payload to the CLIENT
// contract (src/api/types.ts + src/api/trainingTypes.ts): every field the
// client reads must exist with the right name/type, and (b) captures the
// exact server-emitted payloads as fixtures for
// src/features/student/study-real.test.tsx, which renders the real pages
// from them. A routine run COMPARES against the checked-in fixture and
// fails on drift (card 28); regenerate only after an intentional contract
// change:
//   UPDATE_FIXTURES=1 npx vitest run worker/native/capture-study.test.ts
// A hand-edited fixture is no evidence at all — regenerate, never patch.
import { afterAll, beforeAll, expect, it } from "vitest";
import { createNativeTestApp, persistCaptureFixture, TEST_ORG, TEST_USER } from "./test-runtime";
import type { AttemptResult, ChallengeCard, Progress, ResumedSession, Session, SessionSummary } from "../../src/api/types";
import type { SessionRecap } from "../../src/api/trainingTypes";

const season = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const pack = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const sourceIds = [1, 2, 3].map(n => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, "0")}`);

let app: Awaited<ReturnType<typeof createNativeTestApp>>;
let cookie = "";

async function record(kind: string, id: string, value: unknown, seasonId: string | null = null, owner: string | null = null) {
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) VALUES(?,?,?,?,?,?)").bind(kind, id, TEST_ORG, seasonId, owner, JSON.stringify(value)).run();
}
async function request<T>(path: string, method = "GET", value?: unknown): Promise<{ status: number; body: T }> {
  const res = await app.fetch(path, { method, headers: { Cookie: cookie, Origin: "https://erudoza.test", "Content-Type": "application/json" }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  return { status: res.status, body: await res.json() as T };
}
function expectKeys(obj: Record<string, unknown>, required: string[], context: string) {
  for (const key of required) expect(obj, `${context} missing ${key}`).toHaveProperty(key);
}
function expectTypes(obj: Record<string, unknown>, spec: Record<string, string>, context: string) {
  for (const [key, type] of Object.entries(spec)) {
    const value = obj[key];
    const ok = type === "array" ? Array.isArray(value) : type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value) : type === "null-or-string" ? value === null || typeof value === "string" : typeof value === type;
    expect(ok, `${context}.${key} should be ${type}, got ${Array.isArray(value) ? "array" : value === null ? "null" : typeof value}`).toBe(true);
  }
}

beforeAll(async () => {
  app = await createNativeTestApp();
  await app.db.prepare("UPDATE Users SET kind='Student',role='Student' WHERE id=?").bind(TEST_USER).run();
  cookie = (await app.login()).headers.get("set-cookie")!.split(";")[0];
  await record("season", season, { id: season, name: "Synthetic study", status: "Active", organizationId: TEST_ORG, ruleProfileKey: "PBE_STYLE_V1", ruleProfileVersion: 1 });
  await record("pack", pack, { id: pack, isActive: true, licensingStatus: "development-sample" });
  const range = { bookKey: "GEN", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 3 };
  await record("scope", season, { contentPackId: pack, includes: [range], excludes: [] });
  await record("assignment", "assignment", { id: "assignment", seasonId: season, studentUserId: TEST_USER, contentPackId: pack, type: "PrimarySpecialist", ...range }, season, TEST_USER);
  await record("membership", `${season}:${TEST_USER}`, { id: `${season}:${TEST_USER}`, seasonId: season, userId: TEST_USER, studentUserId: TEST_USER, difficulty: "Foundation" }, season, TEST_USER);
  for (const [i, id] of sourceIds.entries()) await record("source", id, { id, knowledgeUnitId: id, contentPackId: pack, citation: `Genesis 1:${i + 1}`, bookKey: "GEN", chapter: 1, verse: i + 1, ordinal: i + 1, canonicalText: `Synthetic verse ${i + 1} has words for this exercise.`, isActive: true }, null, pack);
}, 60000);
afterAll(async () => { await app?.runtime.dispose(); });

it("captures real study/session payloads and pins them to the client contract", async () => {
  const seasons = await request<Array<{ id: string; name: string }>>("/api/v1/progress/me/seasons");
  expect(seasons.status).toBe(200);
  expect(seasons.body).toEqual([{ id: season, name: "Synthetic study" }]);

  const start = await request<Session>("/api/v1/study/sessions", "POST", { seasonId: season, mode: "Practice" });
  expect(start.status).toBe(200);
  // Session (client Session type): every field the client reads.
  expectKeys(start.body, ["id", "seasonId", "status", "mode", "targetCardCount"], "session start");
  expectTypes(start.body, { id: "string", seasonId: "string", status: "string", mode: "string", targetCardCount: "number", difficulty: "string" }, "session start");
  const sessionId = start.body.id;
  const base = `/api/v1/study/sessions/${sessionId}`;

  const next = await request<ChallengeCard>(`${base}/next`);
  expect(next.status).toBe(200);
  // ChallengeCard: id/sessionId/activityType/citation/prompt/tokens/sequence/total.
  expectKeys(next.body, ["id", "sessionId", "activityType", "citation", "prompt", "tokens", "sequence", "total"], "card");
  expectTypes(next.body, { id: "string", sessionId: "string", activityType: "string", citation: "string", prompt: "string", tokens: "array", sequence: "number", total: "number" }, "card");
  for (const token of next.body.tokens) expectKeys(token, ["display", "hidden", "index"], "card.tokens[]");
  expect((next.body as Record<string, unknown>).debugAnswer ?? null).toBeNull();

  // Answer with the card's own stored key (the routes.test.ts pattern) so the
  // attempt result is a genuine correct-answer payload.
  const row = await app.db.prepare("SELECT data FROM Records WHERE kind='session' AND id=?").bind(sessionId).first<{ data: string }>();
  const savedCard = (JSON.parse(row!.data).cards as { id: string; answerKey: { canonicalAnswer: string } }[]).find(c => c.id === next.body.id)!;
  const attempt = await request<AttemptResult>(`${base}/attempts`, "POST", { clientSubmissionId: "capture-1", challengeCardId: next.body.id, submittedAnswer: savedCard.answerKey.canonicalAnswer, responseTimeMs: 30, hintsUsed: false });
  expect(attempt.status).toBe(200);
  // AttemptResult: the full feedback contract the client renders.
  expectKeys(attempt.body, ["attemptId", "isCorrect", "evaluationResult", "canonicalAnswer", "citation", "sourceText", "masteryLevel", "exactWordingScore", "skillKey", "skillLabel", "skillScore", "reviewDueAtUtc", "alreadyProcessed"], "attempt result");
  expectTypes(attempt.body, { attemptId: "string", isCorrect: "boolean", evaluationResult: "string", canonicalAnswer: "string", citation: "string", sourceText: "string", masteryLevel: "string", exactWordingScore: "number", skillKey: "string", skillLabel: "string", skillScore: "number", alreadyProcessed: "boolean" }, "attempt result");
  expect(attempt.body.isCorrect).toBe(true);

  const resume = await request<ResumedSession>(base);
  expect(resume.status).toBe(200);
  // ResumedSession: { session, card, attempt, summary }.
  expectKeys(resume.body, ["session", "card", "attempt", "summary"], "resume");
  expectKeys(resume.body.session, ["id", "seasonId", "status", "mode", "targetCardCount"], "resume.session");
  expect(resume.body.attempt?.attemptId).toBe(attempt.body.attemptId);
  expect(resume.body.summary).toBeNull();

  const complete = await request<SessionSummary>(`${base}/complete`, "POST");
  expect(complete.status).toBe(200);
  // SessionSummary.
  expectKeys(complete.body, ["sessionId", "mode", "attempted", "correct", "targetCardCount", "status"], "complete summary");
  expectTypes(complete.body, { attempted: "number", correct: "number", targetCardCount: "number", status: "string" }, "complete summary");
  expect(complete.body).toMatchObject({ attempted: 1, correct: 1, status: "Completed" });

  const recap = await request<SessionRecap>(`${base}/recap`);
  expect(recap.status).toBe(200);
  // SessionRecap (trainingTypes): the recap page's whole contract.
  expectKeys(recap.body, ["version", "sessionId", "seasonId", "mode", "completedAtUtc", "attempted", "correct", "targetCardCount", "fullTargetReached", "newlyCreditedDay", "missionLocalDate", "creditedLocalDate", "weeklyGoalComplete", "personalBest", "xp", "levelUp", "missionSteps", "earnedBadges", "questsCompleted", "passageChanges"], "recap");
  expectKeys(recap.body.xp, ["earned", "total", "level", "levelName"], "recap.xp");
  expectTypes(recap.body.xp, { earned: "number", total: "number", level: "number", levelName: "string" }, "recap.xp");
  // Value-level pin (found live by this suite's first run): the recap is
  // built inside the completion transaction, so its xp.total must reflect
  // the completion-time quest award that commits with it — not the stale
  // pre-award record. First run showed earned 60 vs total 35 while the
  // committed training-xp record held 60.
  const xpRow = await app.db.prepare("SELECT data FROM Records WHERE kind='training-xp'").first<{ data: string }>();
  const committedTotal = (JSON.parse(xpRow!.data) as { totalXp: number }).totalXp;
  expect(recap.body.xp.earned).toBeGreaterThan(0);
  expect(recap.body.xp.total, "recap xp.total must equal the committed XP total").toBe(committedTotal);
  expect(recap.body.xp.total).toBeGreaterThanOrEqual(recap.body.xp.earned);
  for (const change of recap.body.passageChanges) {
    expectKeys(change, ["knowledgeUnitId", "title", "delta", "before", "after", "events"], "recap.passageChanges[]");
    expectKeys(change.delta, ["exactWording", "recognition", "reference", "sequence", "factualRecall"], "recap.passageChanges[].delta");
  }

  // Progress AFTER the flow: mastery + recentAttempts now carry real rows.
  const progress = await request<Progress>(`/api/v1/progress/me?seasonId=${season}`);
  expect(progress.status).toBe(200);
  expectKeys(progress.body, ["seasonId", "seasonName", "seasonStatus", "assignments", "masteredCount", "reviewDueCount", "attemptCount", "mastery", "recentAttempts", "studentUserId", "studentDisplayName"], "progress");
  expectTypes(progress.body, { seasonId: "string", seasonName: "string", seasonStatus: "string", assignments: "array", masteredCount: "number", reviewDueCount: "number", attemptCount: "number", mastery: "array", recentAttempts: "array" }, "progress");
  expect(progress.body.attemptCount).toBe(1);
  expectKeys(progress.body.assignments[0]!, ["id", "seasonId", "studentUserId", "contentPackId", "type", "difficulty"], "progress.assignments[]");
  expectKeys(progress.body.mastery[0]!, ["knowledgeUnitId", "title", "level", "exactWordingScore", "recognitionScore", "reviewDueAtUtc"], "progress.mastery[]");
  expectKeys(progress.body.recentAttempts![0]!, ["id", "title", "activityType", "isCorrect", "submittedAnswer", "evaluationResult", "createdAtUtc"], "progress.recentAttempts[]");

  const out = {
    seasons: { status: seasons.status, body: seasons.body },
    progress: { status: progress.status, body: progress.body },
    start: { status: start.status, body: start.body },
    card: { status: next.status, body: next.body },
    attempt: { status: attempt.status, body: attempt.body },
    resume: { status: resume.status, body: resume.body },
    complete: { status: complete.status, body: complete.body },
    recap: { status: recap.status, body: recap.body },
  };
  persistCaptureFixture(new URL("../../src/features/student/__fixtures__/study-payloads.json", import.meta.url), JSON.stringify(out, null, 2));
}, 60000);
