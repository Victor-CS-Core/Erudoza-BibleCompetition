// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG, TEST_USER } from '../test-runtime';
let app: Awaited<ReturnType<typeof createNativeTestApp>>;
let cookie: string;
const season = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', pack = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sourceIds = [1, 2, 3, 4, 5, 6].map(n => `eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12, '0')}`);
async function record(kind: string, id: string, value: unknown, seasonId: string | null = null, owner: string | null = null) {
  await app.db.prepare('INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) VALUES(?,?,?,?,?,?)').bind(kind, id, TEST_ORG, seasonId, owner, JSON.stringify(value)).run();
}
async function request(path: string, method = 'GET', value?: unknown) {
  return app.fetch(path, { method, headers: { Cookie: cookie, Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
type SavedCard = { id: string; activityType: string; blankShuffles?: number; payload: { tokens: { text: string; hidden: boolean; index: number }[] }; answerKey: { canonicalAnswer: string; hiddenWords?: string[] } };
type SavedSession = { deckOrder?: string[]; readerAssistedCardIds?: string[]; cards: SavedCard[]; attempts: { cardId: string; hintsUsed: boolean }[] };
async function savedSession(id: string) {
  const row = await app.db.prepare("SELECT data FROM Records WHERE kind='session' AND id=?").bind(id).first<{ data: string }>();
  return JSON.parse(row!.data) as SavedSession;
}
const hiddenOf = (card: SavedCard) => card.payload.tokens.filter(t => t.hidden).map(t => t.index).sort((a, b) => a - b);
async function startSession(mode: string) {
  const start = await request('/api/v1/study/sessions', 'POST', { seasonId: season, mode });
  expect(start.status).toBe(200);
  const session = await start.json() as { id: string };
  const card = await (await request(`/api/v1/study/sessions/${session.id}/next`)).json() as { id: string; activityType: string };
  expect(card.activityType).toBe('MissingWords');
  return { sessionId: session.id, cardId: card.id, base: `/api/v1/study/sessions/${session.id}` };
}
beforeAll(async () => {
  app = await createNativeTestApp();
  await app.db.prepare("UPDATE Users SET kind='Student',role='Student' WHERE id=?").bind(TEST_USER).run();
  cookie = (await app.login()).headers.get('set-cookie')!.split(';')[0];
  await record('season', season, { id: season, name: 'Reblank season', status: 'Active', organizationId: TEST_ORG, ruleProfileKey: 'PBE_STYLE_V1', ruleProfileVersion: 1 });
  await record('pack', pack, { id: pack, isActive: true, licensingStatus: 'development-sample' });
  const range = { bookKey: 'GEN', startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 6 };
  await record('scope', season, { contentPackId: pack, includes: [range], excludes: [] });
  await record('assignment', 'assignment', { id: 'assignment', seasonId: season, studentUserId: TEST_USER, contentPackId: pack, type: 'PrimarySpecialist', ...range }, season, TEST_USER);
  await record('membership', `${season}:${TEST_USER}`, { id: `${season}:${TEST_USER}`, seasonId: season, userId: TEST_USER, studentUserId: TEST_USER, difficulty: 'Standard' }, season, TEST_USER);
  for (const [i, id] of sourceIds.entries()) await record('source', id, { id, knowledgeUnitId: id, contentPackId: pack, citation: `Genesis 1:${i + 1}`, bookKey: 'GEN', chapter: 1, verse: i + 1, ordinal: i + 1, canonicalText: `Synthetic verse ${i + 1} has enough words for this exercise today friend.`, isActive: true }, null, pack);
}, 30000);
afterAll(async () => { await app?.runtime.dispose(); });

it('re-deals a different blank pattern on the same card and verse, without leaking the hidden words', async () => {
  const { sessionId, cardId, base } = await startSession('Practice');
  const before = (await savedSession(sessionId)).cards.find(c => c.id === cardId)!;
  const beforeHidden = hiddenOf(before);
  expect(beforeHidden.length).toBeGreaterThan(1);

  const response = await request(`${base}/reblank`, 'POST', { challengeCardId: cardId });
  expect(response.status).toBe(200);
  const dto = await response.json() as { id: string; blankShuffles: number; blankShuffleLimit: number; tokens: { display: string; hidden: boolean; index: number }[] };
  expect(dto.id).toBe(cardId);
  expect(dto.blankShuffles).toBe(1);
  expect(dto.blankShuffleLimit).toBe(3);
  // The DTO never carries a hidden word's text.
  for (const token of dto.tokens) if (token.hidden) expect(token.display).toBe('____');

  const after = (await savedSession(sessionId)).cards.find(c => c.id === cardId)!;
  const afterHidden = hiddenOf(after);
  expect(afterHidden).not.toEqual(beforeHidden);
  expect(afterHidden.length).toBe(beforeHidden.length);
  expect(after.blankShuffles).toBe(1);
  expect(after.answerKey.hiddenWords).toEqual(after.payload.tokens.filter(t => t.hidden).map(t => t.text));
  expect(after.answerKey.canonicalAnswer).toBe(after.answerKey.hiddenWords!.join(' '));
  expect(dto.tokens.filter(t => t.hidden).map(t => t.index)).toEqual(afterHidden);
});

it('grades against the new pattern, rejects old-pattern answers, and never marks the card assisted', async () => {
  const { sessionId, cardId, base } = await startSession('Practice');
  const before = (await savedSession(sessionId)).cards.find(c => c.id === cardId)!;
  const beforeHidden = hiddenOf(before);
  expect((await request(`${base}/reblank`, 'POST', { challengeCardId: cardId })).status).toBe(200);
  const after = (await savedSession(sessionId)).cards.find(c => c.id === cardId)!;
  const afterHidden = hiddenOf(after);
  const staleIndex = beforeHidden.find(index => !afterHidden.includes(index));
  expect(staleIndex).toBeDefined();

  // Answers keyed to the old pattern (one slot that is no longer blank) are invalid.
  const staleAnswers = [...after.payload.tokens.filter(t => t.hidden).map(t => ({ index: t.index, text: t.text })), { index: staleIndex!, text: 'stale' }];
  expect((await request(`${base}/attempts`, 'POST', { clientSubmissionId: 'reblank-stale', challengeCardId: cardId, missingWordAnswers: staleAnswers, responseTimeMs: 25, hintsUsed: false })).status).toBe(400);
  expect((await savedSession(sessionId)).attempts).toHaveLength(0);

  // The new pattern's exact answers grade fully correct and unaided.
  const answers = after.payload.tokens.filter(t => t.hidden).map(t => ({ index: t.index, text: t.text }));
  const graded = await request(`${base}/attempts`, 'POST', { clientSubmissionId: 'reblank-new', challengeCardId: cardId, missingWordAnswers: answers, responseTimeMs: 25, hintsUsed: false });
  expect(graded.status).toBe(200);
  expect(await graded.json()).toMatchObject({ isCorrect: true, score: 100 });
  const saved = await savedSession(sessionId);
  expect(saved.attempts).toHaveLength(1);
  expect(saved.attempts[0].hintsUsed).toBe(false);
  expect(saved.readerAssistedCardIds ?? []).not.toContain(cardId);
});

it('caps re-deals per card and refuses answered cards', async () => {
  const { sessionId, cardId, base } = await startSession('Practice');
  for (let n = 0; n < 3; n++) expect((await request(`${base}/reblank`, 'POST', { challengeCardId: cardId })).status).toBe(200);
  expect((await request(`${base}/reblank`, 'POST', { challengeCardId: cardId })).status).toBe(400);

  const saved = await savedSession(sessionId);
  const card = saved.cards.find(c => c.id === cardId)!;
  const answers = card.payload.tokens.filter(t => t.hidden).map(t => ({ index: t.index, text: t.text }));
  expect((await request(`${base}/attempts`, 'POST', { clientSubmissionId: 'reblank-cap-answer', challengeCardId: cardId, missingWordAnswers: answers, responseTimeMs: 25, hintsUsed: false })).status).toBe(200);
  expect((await request(`${base}/reblank`, 'POST', { challengeCardId: cardId })).status).toBe(400);
});

it('keeps the deck shuffle working after a reblank, and rejects reblank in Simulation', async () => {
  const { sessionId, cardId, base } = await startSession('Practice');
  expect((await request(`${base}/reblank`, 'POST', { challengeCardId: cardId })).status).toBe(200);
  const shuffled = await request(`${base}/shuffle`, 'POST');
  expect(shuffled.status).toBe(200);
  expect(await shuffled.json()).toMatchObject({ sessionId, remaining: sourceIds.length - 1 });

  const sim = await startSession('Simulation');
  expect((await request(`${sim.base}/reblank`, 'POST', { challengeCardId: sim.cardId })).status).toBe(400);
});
