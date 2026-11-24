// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG, TEST_USER } from '../test-runtime';

import type { Attempt, Session } from './routes';
import type { Mastery } from './routes';

let app: Awaited<ReturnType<typeof createNativeTestApp>>;
let cookie: string;
const season = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', pack = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sourceIds = [1, 2, 3].map(n => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, '0')}`);
async function record(kind: string, id: string, value: unknown, seasonId: string | null = null, owner: string | null = null) {
  await app.db.prepare('INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) VALUES(?,?,?,?,?,?)').bind(kind, id, TEST_ORG, seasonId, owner, JSON.stringify(value)).run();
}
async function request(path: string, method = 'GET', value?: unknown) {
  return app.fetch(path, { method, headers: { Cookie: cookie, Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
beforeAll(async () => {
  app = await createNativeTestApp();
  await app.db.prepare("UPDATE Users SET kind='Student',role='Student' WHERE id=?").bind(TEST_USER).run();
  cookie = (await app.login()).headers.get('set-cookie')!.split(';')[0];
  await record('season', season, { id: season, name: 'Synthetic study', status: 'Active', organizationId: TEST_ORG, ruleProfileKey: 'PBE_STYLE_V1', ruleProfileVersion: 1 });
  await record('pack', pack, { id: pack, isActive: true, licensingStatus: 'development-sample' });
  const range = { bookKey: 'GEN', startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 3 };
  await record('scope', season, { contentPackId: pack, includes: [range], excludes: [] });
  await record('assignment', 'assignment', { id: 'assignment', seasonId: season, studentUserId: TEST_USER, contentPackId: pack, type: 'PrimarySpecialist', ...range }, season, TEST_USER);
  await record('membership', `${season}:${TEST_USER}`, { id: `${season}:${TEST_USER}`, seasonId: season, userId: TEST_USER, studentUserId: TEST_USER, difficulty: 'Foundation' }, season, TEST_USER);
  for (const [i, id] of sourceIds.entries()) await record('source', id, { id, knowledgeUnitId: id, contentPackId: pack, citation: `Genesis 1:${i + 1}`, bookKey: 'GEN', chapter: 1, verse: i + 1, ordinal: i + 1, canonicalText: `Synthetic verse ${i + 1} has words for this exercise.`, isActive: true }, null, pack);
}, 30000);
afterAll(async () => { await app?.runtime.dispose(); });

/** Same fixture shape as missing-word-routes.test.ts: start a session,
 * draw the first card, then freeze its blanks to the expected words. */
async function fixture(expected: string[], mode: 'Practice' | 'Simulation' = 'Practice') {
  const session = await (await request('/api/v1/study/sessions', 'POST', { seasonId: season, mode })).json() as Session;
  const base = `/api/v1/study/sessions/${session.id}`;
  await request(`${base}/next`);
  const saved = JSON.parse((await app.db.prepare("SELECT data FROM Records WHERE kind='session' AND id=?").bind(session.id).first<{ data: string }>())!.data) as Session;
  const card = saved.cards[0];
  card.payload.tokens = [{ index: 0, text: 'Visible', hidden: false }, ...expected.map((text, i) => ({ index: i + 2, text, hidden: true }))];
  card.payload.prompt = 'Visible ' + expected.map(() => '____').join(' '); card.answerKey.canonicalAnswer = expected.join(' ');
  await app.db.prepare("UPDATE Records SET data=?,revision=revision+1 WHERE kind='session' AND id=?").bind(JSON.stringify(saved), session.id).run();
  return { base, session: saved, card, body: { clientSubmissionId: crypto.randomUUID(), challengeCardId: card.id, responseTimeMs: 42, hintsUsed: false } };
}
const slots = (texts: string[]) => texts.map((text, i) => ({ index: i + 2, text }));
async function submitSlots(base: string, body: object, texts: string[], extra: object = {}) {
  const response = await request(`${base}/attempts`, 'POST', { ...body, ...extra, missingWordAnswers: slots(texts) });
  expect(response.status).toBe(200);
  return response.json() as Promise<{ attemptId: string; isCorrect: boolean; score: number; xpEarned?: number; spellingEligible?: number[]; missingWordResults: { index: number; isCorrect: boolean; expected: string; spelling?: boolean }[] }>;
}
async function fix(base: string, cardId: string, answers: { index: number; text: string }[], clientSubmissionId = crypto.randomUUID()) {
  return request(`${base}/spelling-fix`, 'POST', { clientSubmissionId, challengeCardId: cardId, answers });
}
async function savedSession(id: string) {
  return JSON.parse((await app.db.prepare("SELECT data FROM Records WHERE kind='session' AND id=?").bind(id).first<{ data: string }>())!.data) as Session & { recap?: { spellingCorrected?: number } };
}
async function savedAttempt(id: string) {
  return JSON.parse((await app.db.prepare("SELECT data FROM Records WHERE kind='attempt' AND id=?").bind(id).first<{ data: string }>())!.data) as Attempt;
}
async function masteryFor(knowledgeUnitId: string) {
  const rows = (await app.db.prepare("SELECT data FROM Records WHERE kind='mastery'").all()).results as { data: string }[];
  return rows.map(r => JSON.parse(r.data) as Mastery).find(m => m.knowledgeUnitId === knowledgeUnitId);
}

it('stamps eligibility for spelling slips only — not wrong words, not empty blanks', async () => {
  const { base, session, card, body } = await fixture(['beginning', 'created', 'earth']);
  const result = await submitSlots(base, body, ['begining', 'banana', '']);
  expect(result.isCorrect).toBe(false);
  expect(result.missingWordResults.map(r => r.spelling ?? false)).toEqual([true, false, false]);
  expect(result.spellingEligible).toEqual([2]);
  // The incorrect attempt pays the flat 2 XP (the day's first attempt can
  // also carry a quest bonus, so the fix assertions below use deltas).
  expect(result.xpEarned).toBeGreaterThanOrEqual(2);
  const xpBeforeFix = (await savedSession(session.id)).training?.xpEarned;
  // A fix naming a non-eligible blank is refused before anything is written.
  expect((await fix(base, card.id, [{ index: 3, text: 'created' }])).status).toBe(400);
  expect((await fix(base, card.id, [{ index: 2, text: 'beginning' }, { index: 3, text: 'created' }])).status).toBe(400);
  // The eligible blank alone fixes: partial XP = floor(1 * 10 / (2 * 3)) = 1.
  const response = await fix(base, card.id, [{ index: 2, text: 'beginning' }]);
  expect(response.status).toBe(200);
  const fixed = await response.json() as { correctedCount: number; effectiveScore: number; xpEarned: number; alreadyProcessed: boolean };
  expect(fixed).toMatchObject({ correctedCount: 1, effectiveScore: 17, xpEarned: 1, alreadyProcessed: false });
  // The first attempt stays exactly as graded; the fix is its own record.
  const attempt = await savedAttempt(result.attemptId);
  expect(attempt.isCorrect).toBe(false);
  expect(attempt.score).toBe(0);
  expect(attempt.result.xpEarned).toBe(result.xpEarned);
  expect(attempt.spellingFix).toMatchObject({ correctedCount: 1, xpEarned: 1 });
  expect((await savedSession(session.id)).training?.xpEarned).toBe((xpBeforeFix ?? 0) + 1);
});

it('pays half of each corrected blank’s share and re-derives mastery as partial evidence', async () => {
  const { base, session, card, body } = await fixture(['beginning', 'created']);
  const beforeMastery = await masteryFor(card.knowledgeUnitId);
  const beforeWording = beforeMastery?.exactWording ?? 0, beforeRecognition = beforeMastery?.recognition ?? 0;
  const result = await submitSlots(base, body, ['begining', 'creatde']);
  expect(result.spellingEligible).toEqual([2, 3]);
  expect(result.xpEarned).toBeGreaterThanOrEqual(2);
  const afterSubmit = await masteryFor(card.knowledgeUnitId);
  expect(afterSubmit?.exactWording).toBe(Math.max(0, beforeWording - 6));
  const response = await fix(base, card.id, slots(['beginning', 'created']));
  expect(response.status).toBe(200);
  const fixed = await response.json() as { correctedCount: number; effectiveScore: number; xpEarned: number; skillScore?: number; xpReward?: { earned: number } };
  // floor(2 * 10 / (2 * 2)) = 5; effective score (0 + 2/2) / 2 = 50.
  expect(fixed).toMatchObject({ correctedCount: 2, effectiveScore: 50, xpEarned: 5 });
  expect(fixed.xpReward?.earned).toBe(5);
  expect(fixed.skillScore).toBe(Math.min(100, beforeWording + 6));
  const afterFix = await masteryFor(card.knowledgeUnitId);
  // Recomputed from the attempt's own before snapshot: +6 from score 50,
  // replacing the -6 — not stacked on top of it. Recognition likewise
  // reflects ONE incorrect attempt (-2), not two.
  expect(afterFix?.exactWording).toBe(Math.min(100, beforeWording + 6));
  expect(afterFix?.recognition).toBe(Math.max(0, beforeRecognition - 2));
  expect(afterFix?.lastAttemptId).toBe(result.attemptId);
  // The recap counts the card once as spelling-corrected.
  expect((await request(`${base}/complete`, 'POST')).status).toBe(200);
  expect((await savedSession(session.id)).recap?.spellingCorrected).toBe(1);
  // A restored attempt renders the post-fix state.
  const resumed = await (await request(base)).json() as { attempt: { spellingFix?: { correctedCount: number } } };
  expect(resumed.attempt.spellingFix?.correctedCount).toBe(2);
});

it('enforces one fix per card and replays the same fix idempotently', async () => {
  const { base, session, card, body } = await fixture(['beginning', 'created']);
  const result = await submitSlots(base, body, ['begining', 'creatde']);
  const fixId = crypto.randomUUID();
  const first = await fix(base, card.id, slots(['beginning', 'created']), fixId);
  expect(first.status).toBe(200);
  const fixed = await first.json() as { xpEarned: number };
  expect(fixed.xpEarned).toBe(5);
  const sessionXp = (await savedSession(session.id)).training?.xpEarned;
  // Same submission id + same answers: the stored fix comes back, no double XP.
  const replayed = await fix(base, card.id, slots(['beginning', 'created']), fixId);
  expect(replayed.status).toBe(200);
  expect(await replayed.json()).toMatchObject({ alreadyProcessed: true, xpEarned: 5, correctedCount: 2 });
  expect((await savedSession(session.id)).training?.xpEarned).toBe(sessionXp);
  // A new submission, or the same id with different answers, is a second fix: refused.
  expect((await fix(base, card.id, slots(['beginning', 'created']))).status).toBe(409);
  expect((await fix(base, card.id, slots(['beginning', 'created ']), fixId)).status).toBe(409);
  expect(result.attemptId).toBeTruthy();
});

it('prices the fix at the assisted rate when the first attempt used help', async () => {
  const { base, card, body } = await fixture(['beginning', 'created']);
  const result = await submitSlots(base, body, ['begining', 'creatde'], { hintsUsed: true });
  expect(result.spellingEligible).toEqual([2, 3]);
  const response = await fix(base, card.id, slots(['beginning', 'created']));
  expect(response.status).toBe(200);
  // Assisted full value is 6, not 10: floor(2 * 6 / (2 * 2)) = 3.
  expect(await response.json()).toMatchObject({ correctedCount: 2, xpEarned: 3 });
});

it('excludes Simulation: no eligibility stamp and the endpoint refuses', async () => {
  const { base, card, body } = await fixture(['beginning', 'created'], 'Simulation');
  const result = await submitSlots(base, body, ['begining', 'creatde']);
  expect(result.isCorrect).toBe(false);
  expect(result.spellingEligible).toBeUndefined();
  expect((await fix(base, card.id, slots(['beginning', 'created']))).status).toBe(400);
});

it('a failed fix keeps the blank incorrect, names the verse spelling, and allows no third chance', async () => {
  const { base, card, body } = await fixture(['beginning', 'created']);
  const result = await submitSlots(base, body, ['begining', 'created']);
  expect(result.spellingEligible).toEqual([2]);
  const wordingBefore = (await masteryFor(card.knowledgeUnitId))?.exactWording;
  const response = await fix(base, card.id, [{ index: 2, text: 'begining' }]);
  expect(response.status).toBe(200);
  const fixed = await response.json() as { correctedCount: number; xpEarned: number; results: { index: number; isCorrect: boolean; expected: string }[] };
  expect(fixed).toMatchObject({ correctedCount: 0, xpEarned: 0 });
  expect(fixed.results).toEqual([{ index: 2, isCorrect: false, expected: 'beginning', spelling: true }]);
  // No mastery movement and no second fix.
  expect((await masteryFor(card.knowledgeUnitId))?.exactWording).toBe(wordingBefore);
  expect((await fix(base, card.id, [{ index: 2, text: 'beginning' }])).status).toBe(409);
  const attempt = await savedAttempt(result.attemptId);
  expect(attempt.spellingFix).toMatchObject({ correctedCount: 0, xpEarned: 0 });
});

it('offers no fix when no blank was a spelling slip', async () => {
  const { base, card, body } = await fixture(['beginning', 'created']);
  const result = await submitSlots(base, body, ['banana', 'potato']);
  expect(result.spellingEligible).toBeUndefined();
  expect((await fix(base, card.id, slots(['beginning', 'created']))).status).toBe(400);
});
