// @vitest-environment node
// CROSS-WIRE CONTRACT suite for the training surface (card 15; pattern from
// capture-control-center.test.ts + control-center-contract.test.ts). Boots
// the real native app, plays one real Memory session so XP/mastery/attempt
// records are genuine, seeds a PBE season the way
// pbe/chapter-progress.integration.test.ts does, then (a) pins every payload
// to the CLIENT contract (src/api/trainingTypes.ts + src/api/pbeTypes.ts)
// and (b) saves the exact server-emitted payloads as fixtures for
// src/features/student/training-real.test.tsx. Re-run when the training
// contract changes:
//   npx vitest run worker/native/capture-training.test.ts
// A hand-edited fixture is no evidence at all — regenerate, never patch.
import { afterAll, beforeAll, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { createNativeTestApp, TEST_ORG, TEST_USER } from "./test-runtime";
import { Store } from "./store";
import { sourceProof } from "./pbe/bank";
import type { PbeQuestion, PbeTarget } from "./pbe/types";

const season = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const pack = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const sourceIds = [1, 2, 3].map(n => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, "0")}`);
const pbeSeason = "cccccccc-0000-0000-0000-000000000001";
const pbePack = "aaaaaaaa-0000-0000-0000-000000000001";
const pbeSource = "aaaaaaaa-0000-0000-0000-000000000002";
const tid = (n: number) => `bbbbbbbb-0000-0000-0000-${String(n).padStart(12, "0")}`;

let app: Awaited<ReturnType<typeof createNativeTestApp>>;
let cookie = "";

async function record(kind: string, id: string, value: unknown, seasonId: string | null = null, owner: string | null = null) {
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) VALUES(?,?,?,?,?,?)").bind(kind, id, TEST_ORG, seasonId, owner, JSON.stringify(value)).run();
}
async function request(path: string, method = "GET", value?: unknown) {
  const res = await app.fetch(path, { method, headers: { Cookie: cookie, Origin: "https://erudoza.test", "Content-Type": "application/json" }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  return { status: res.status, body: await res.json() as Record<string, any> };
}
function expectKeys(obj: Record<string, unknown>, required: string[], context: string) {
  for (const key of required) expect(obj, `${context} missing ${key}`).toHaveProperty(key);
}

beforeAll(async () => {
  app = await createNativeTestApp();
  await app.db.prepare("UPDATE Users SET kind='Student',role='Student' WHERE id=?").bind(TEST_USER).run();
  cookie = (await app.login()).headers.get("set-cookie")!.split(";")[0];
  // Memory season (mirrors capture-study.test.ts).
  await record("season", season, { id: season, name: "Synthetic study", status: "Active", organizationId: TEST_ORG, ruleProfileKey: "PBE_STYLE_V1", ruleProfileVersion: 1 });
  await record("pack", pack, { id: pack, isActive: true, licensingStatus: "development-sample" });
  const range = { bookKey: "GEN", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 3 };
  await record("scope", season, { contentPackId: pack, includes: [range], excludes: [] });
  await record("assignment", "assignment", { id: "assignment", seasonId: season, studentUserId: TEST_USER, contentPackId: pack, type: "PrimarySpecialist", ...range }, season, TEST_USER);
  await record("membership", `${season}:${TEST_USER}`, { id: `${season}:${TEST_USER}`, seasonId: season, userId: TEST_USER, studentUserId: TEST_USER, difficulty: "Foundation" }, season, TEST_USER);
  for (const [i, id] of sourceIds.entries()) await record("source", id, { id, knowledgeUnitId: id, contentPackId: pack, citation: `Genesis 1:${i + 1}`, bookKey: "GEN", chapter: 1, verse: i + 1, ordinal: i + 1, canonicalText: `Synthetic verse ${i + 1} has words for this exercise.`, isActive: true }, null, pack);
  // PBE season (mirrors pbe/chapter-progress.integration.test.ts setup).
  const store = new Store(app.db as never);
  await store.insert("season", pbeSeason, TEST_ORG, { id: pbeSeason, name: "Synthetic PBE", organizationId: TEST_ORG, status: "Active", pbeEnabled: true });
  await store.insert("pack", pbePack, TEST_ORG, { id: pbePack, isActive: true, licensingStatus: "approved", sourceType: "Scripture" });
  const unit = { id: pbeSource, contentPackId: pbePack, bookKey: "GEN", chapter: 1, verse: 1, ordinal: 1, citation: "GEN 1:1", canonicalText: "Alpha and Beta", isActive: true };
  await store.insert("source", pbeSource, TEST_ORG, unit, { ownerId: pbePack });
  const pbeRange = { bookKey: "GEN", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1 };
  await store.insert("scope", pbeSeason, TEST_ORG, { contentPackId: pbePack, includes: [pbeRange], excludes: [] });
  await store.insert("assignment", "pbe-assignment", TEST_ORG, { id: "pbe-assignment", seasonId: pbeSeason, studentUserId: TEST_USER, contentPackId: pbePack, ...pbeRange }, { seasonId: pbeSeason, ownerId: TEST_USER });
  await store.insert("membership", `${pbeSeason}:${TEST_USER}`, TEST_ORG, { id: `${pbeSeason}:${TEST_USER}`, seasonId: pbeSeason, userId: TEST_USER, difficulty: "Standard" }, { seasonId: pbeSeason, ownerId: TEST_USER });
  const targets: PbeTarget[] = [1, 2].map(n => ({ id: tid(n), sourceUnitIds: [pbeSource], skill: "FactualRecall", label: `Label ${n}` }));
  for (const t of targets) await store.insert("pbe-target", t.id, TEST_ORG, t, { seasonId: pbeSeason, ownerId: pbeSource });
  for (let n = 0; n < 2; n++) {
    const q: PbeQuestion = { schemaVersion: 2, id: tid(100 + n), version: 1, contentPackId: pbePack, sourceUnitId: pbeSource, sourceUnitIds: [pbeSource], sourceKind: "Scripture", reference: "GEN 1:1", evidence: "Alpha and Beta", kind: "List", prompt: "Name the two labels.", ordered: false, parts: targets.map((t, i) => ({ targetId: t.id, acceptedAnswers: [i ? "Beta" : "Alpha"], points: 1 })) };
    await store.insert("pbe-question-head", q.id, TEST_ORG, { id: q.id, seasonId: pbeSeason, published: true, sourceFingerprint: await sourceProof(q, new Map([[pbeSource, unit]])), question: q }, { seasonId: pbeSeason, ownerId: pbeSource });
  }
}, 60000);
afterAll(async () => { await app?.runtime.dispose(); });

it("captures real training payloads and pins them to the client contract", async () => {
  // One real Memory session so today/honors/journey carry genuine values.
  const start = await request("/api/v1/study/sessions", "POST", { seasonId: season, mode: "Practice" });
  expect(start.status).toBe(200);
  const base = `/api/v1/study/sessions/${start.body.id}`;
  const card = await request(`${base}/next`);
  const row = await app.db.prepare("SELECT data FROM Records WHERE kind='session' AND id=?").bind(start.body.id).first<{ data: string }>();
  const savedCard = (JSON.parse(row!.data).cards as { id: string; answerKey: { canonicalAnswer: string } }[]).find(c => c.id === card.body.id)!;
  expect((await request(`${base}/attempts`, "POST", { clientSubmissionId: "capture-t1", challengeCardId: card.body.id, submittedAnswer: savedCard.answerKey.canonicalAnswer, responseTimeMs: 30, hintsUsed: false })).status).toBe(200);
  expect((await request(`${base}/complete`, "POST")).status).toBe(200);

  const today = await request(`/api/v1/progress/me/today?seasonId=${season}`);
  expect(today.status).toBe(200);
  // TrainingToday: the HQ contract.
  expectKeys(today.body, ["seasonId", "seasonName", "seasonStatus", "localDate", "preferences", "week", "mission", "nextAction", "honors", "xp", "quests", "streak", "streakNudge"], "today");
  expectKeys(today.body.preferences, ["timeZone", "weeklyTarget", "pending"], "today.preferences");
  expectKeys(today.body.week, ["weekStartLocalDate", "timeZone", "target", "completedDays", "days"], "today.week");
  for (const day of today.body.week.days) expectKeys(day, ["localDate", "credited", "isToday"], "today.week.days[]");
  expectKeys(today.body.mission, ["id", "revision", "status", "scopeVersion", "steps", "explanation"], "today.mission");
  for (const step of today.body.mission.steps) expectKeys(step, ["kind", "target", "completed", "status", "sessionId"], "today.mission.steps[]");
  expectKeys(today.body.xp, ["total", "level", "levelName", "xpIntoLevel", "xpForNext"], "today.xp");
  expect(today.body.xp.total).toBeGreaterThan(0);
  for (const quest of today.body.quests) expectKeys(quest, ["key", "title", "description", "target", "progress", "completed"], "today.quests[]");
  expectKeys(today.body.streak, ["current", "best", "state"], "today.streak");

  const honors = await request(`/api/v1/progress/me/honors?seasonId=${season}`);
  expect(honors.status).toBe(200);
  expect(Array.isArray(honors.body)).toBe(true);
  expect((honors.body as unknown[]).length).toBeGreaterThan(0);
  for (const badge of honors.body as Record<string, unknown>[]) expectKeys(badge, ["key", "ruleVersion", "title", "completed", "target", "earnedAtUtc", "scopeLabel", "evidenceSessionId"], "honors[]");

  const journey = await request(`/api/v1/progress/me/journey?seasonId=${season}`);
  expect(journey.status).toBe(200);
  expectKeys(journey.body, ["seasonId", "scopeVersion", "after", "chapters"], "journey");
  expect(journey.body.chapters.length).toBeGreaterThan(0);
  for (const chapter of journey.body.chapters) {
    expectKeys(chapter, ["bookKey", "chapter", "scopeLabel", "eligibleCount", "seenCount", "strongCount", "passages"], "journey.chapters[]");
    for (const passage of chapter.passages) {
      expectKeys(passage, ["knowledgeUnitId", "title", "level", "algorithmVersion", "skills", "dueAtUtc"], "journey.chapters[].passages[]");
      expectKeys(passage.skills, ["exactWording", "recognition", "reference", "sequence", "factualRecall"], "journey passage skills");
    }
  }

  const chapters = await request(`/api/v1/progress/me/chapters?seasonId=${pbeSeason}`);
  expect(chapters.status).toBe(200);
  // ChapterPage (pbeTypes).
  expectKeys(chapters.body, ["seasonId", "ruleVersion", "scopeVersion", "snapshotId", "chapterKey", "work", "currentAvailable", "historyAvailable", "asOfUtc", "dueRefreshAtUtc", "nextCursor", "view", "items"], "chapters");
  expectKeys(chapters.body.work, ["id", "state", "stage", "reason"], "chapters.work");
  expect(chapters.body.view).toBe("Chapters");

  const cooperation = await request(`/api/v1/progress/me/pbe-cooperation?seasonId=${pbeSeason}`);
  expect(cooperation.status).toBe(200);
  // CooperationSnapshot (pbeTypes).
  expectKeys(cooperation.body, ["seasonId", "ruleVersion", "scopeVersion", "snapshotId", "state", "reason", "checkedAtUtc", "dueRefreshAtUtc", "rosterStudents", "unknownStudents", "scripture", "introduction", "own", "work"], "cooperation");
  expectKeys(cooperation.body.work, ["id", "next"], "cooperation.work");

  // The Honors page reads the Stamps view for the student's season (here the
  // Memory season — the PBE projection reports itself blocked, by design).
  const chapterStamps = await request(`/api/v1/progress/me/chapters?seasonId=${season}&view=Stamps`);
  expect(chapterStamps.status).toBe(200);
  expectKeys(chapterStamps.body, ["seasonId", "ruleVersion", "scopeVersion", "snapshotId", "chapterKey", "work", "currentAvailable", "historyAvailable", "asOfUtc", "dueRefreshAtUtc", "nextCursor", "view", "items"], "chapterStamps");
  expect(chapterStamps.body.view).toBe("Stamps");
  expect(chapterStamps.body.items).toEqual([]);

  const teamActivity = await request("/api/v1/progress/me/team-activity");
  expect(teamActivity.status).toBe(200);
  expectKeys(teamActivity.body, ["practicedToday", "practicedThisWeek", "memberCount"], "team-activity");

  const preferences = await request("/api/v1/progress/me/preferences", "PUT", { weeklyTarget: 4, timeZone: "America/New_York" });
  expect(preferences.status).toBe(200);
  // TrainingPreferences.
  expectKeys(preferences.body, ["timeZone", "weeklyTarget", "pending"], "preferences");
  // A mid-week change is deferred by design: the response reports the
  // still-effective values and carries the requested change in `pending`.
  expect(preferences.body.pending).toMatchObject({ weeklyTarget: 4, timeZone: "America/New_York" });
  expectKeys(preferences.body.pending, ["timeZone", "weeklyTarget", "effectiveAtUtc"], "preferences.pending");

  const out = {
    today: { status: today.status, body: today.body },
    honors: { status: honors.status, body: honors.body },
    journey: { status: journey.status, body: journey.body },
    chapters: { status: chapters.status, body: chapters.body },
    chapterStamps: { status: chapterStamps.status, body: chapterStamps.body },
    cooperation: { status: cooperation.status, body: cooperation.body },
    teamActivity: { status: teamActivity.status, body: teamActivity.body },
    preferences: { status: preferences.status, body: preferences.body },
  };
  writeFileSync(new URL("../../src/features/student/__fixtures__/training-payloads.json", import.meta.url), JSON.stringify(out, null, 2));
}, 60000);
