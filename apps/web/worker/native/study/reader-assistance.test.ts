// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG, TEST_USER } from '../test-runtime';
let app: Awaited<ReturnType<typeof createNativeTestApp>>;
let cookie: string;
const season = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pack = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sourceIds = [1, 2, 3].map(n => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, '0')}`);
async function record(kind: string, id: string, value: unknown, seasonId: string | null = null, owner: string | null = null) {
  await app.db.prepare('INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) VALUES(?,?,?,?,?,?)').bind(kind, id, TEST_ORG, seasonId, owner, JSON.stringify(value)).run();
}
async function request(path: string, method = 'GET', value?: unknown) {
  return app.fetch(path, { method, headers: { Cookie: cookie, Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
async function startSession(mode: string) {
  const start = await request('/api/v1/study/sessions', 'POST', { seasonId: season, mode });
  expect(start.status).toBe(200);
  return (await start.json()) as { id: string };
}
async function drawCard(sessionId: string) {
  const response = await request(`/api/v1/study/sessions/${sessionId}/next`);
  expect(response.status).toBe(200);
  return (await response.json()) as { id: string };
}
async function savedSession(id: string) {
  const row = await app.db.prepare("SELECT data FROM Records WHERE kind='session' AND id=?").bind(id).first<{ data: string }>();
  return JSON.parse(row!.data) as { readerAssistedCardIds?: string[]; cards: { id: string; answerKey: { canonicalAnswer: string } }[] };
}
async function submit(sessionId: string, cardId: string, submittedAnswer: string, clientSubmissionId: string) {
  return request(`/api/v1/study/sessions/${sessionId}/attempts`, 'POST', { clientSubmissionId, challengeCardId: cardId, submittedAnswer, responseTimeMs: 30, hintsUsed: false });
}
async function savedAttempt(sessionId: string) {
  const row = await app.db.prepare("SELECT data FROM Records WHERE kind='attempt' AND org_id=? AND json_extract(data,'$.sessionId')=?").bind(TEST_ORG, sessionId).first<{ data: string }>();
  return JSON.parse(row!.data) as { hintsUsed: boolean; clientHintsUsed?: boolean };
}
beforeAll(async () => {
  app = await createNativeTestApp();
  await app.db.prepare("UPDATE Users SET kind='Student',role='Student' WHERE id=?").bind(TEST_USER).run();
  cookie = (await app.login()).headers.get('set-cookie')!.split(';')[0];
  await record('season', season, { id: season, name: 'Assistance season', status: 'Active', organizationId: TEST_ORG, ruleProfileKey: 'PBE_STYLE_V1', ruleProfileVersion: 1 });
  await record('pack', pack, { id: pack, isActive: true, licensingStatus: 'development-sample' });
  const range = { bookKey: 'GEN', startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 3 };
  await record('scope', season, { contentPackId: pack, includes: [range], excludes: [] });
  await record('assignment', 'assignment', { id: 'assignment', seasonId: season, studentUserId: TEST_USER, contentPackId: pack, type: 'PrimarySpecialist', ...range }, season, TEST_USER);
  await record('membership', `${season}:${TEST_USER}`, { id: `${season}:${TEST_USER}`, seasonId: season, userId: TEST_USER, studentUserId: TEST_USER, difficulty: 'Foundation' }, season, TEST_USER);
  for (const [i, id] of sourceIds.entries()) await record('source', id, { id, knowledgeUnitId: id, contentPackId: pack, citation: `Genesis 1:${i + 1}`, bookKey: 'GEN', chapter: 1, verse: i + 1, ordinal: i + 1, canonicalText: `Synthetic verse ${i + 1} has enough words for this exercise today.`, isActive: true }, null, pack);
}, 30000);
afterAll(async () => { await app?.runtime.dispose(); });

it('server-stamps assistance when the assigned scripture is read during a card, even if the client claims no hints', async () => {
  const session = await startSession('Practice');
  const card = await drawCard(session.id);
  const read = await request(`/api/v1/study/seasons/${season}/scripture`);
  expect(read.status).toBe(200);
  // The read stamped the active unanswered card on the session record.
  expect((await savedSession(session.id)).readerAssistedCardIds).toEqual([card.id]);
  const saved = await savedSession(session.id);
  const canonical = saved.cards.find(c => c.id === card.id)!.answerKey.canonicalAnswer;
  const response = await submit(session.id, card.id, canonical, 'reader-stamp-1');
  expect(response.status).toBe(200);
  const attempt = await savedAttempt(session.id);
  expect(attempt.clientHintsUsed).toBe(false); // what the client claimed
  expect(attempt.hintsUsed).toBe(true); // what the server recorded
  // An identical retry replays the stored result instead of conflicting on
  // the server-corrected hints value.
  const retry = await submit(session.id, card.id, canonical, 'reader-stamp-1');
  expect(retry.status).toBe(200);
  expect(((await retry.json()) as { alreadyProcessed: boolean }).alreadyProcessed).toBe(true);
});

it('records no assistance when the scripture was never read during the card', async () => {
  const session = await startSession('Practice');
  const card = await drawCard(session.id);
  const saved = await savedSession(session.id);
  expect(saved.readerAssistedCardIds).toBeUndefined();
  const canonical = saved.cards.find(c => c.id === card.id)!.answerKey.canonicalAnswer;
  const response = await submit(session.id, card.id, canonical, 'reader-stamp-2');
  expect(response.status).toBe(200);
  const attempt = await savedAttempt(session.id);
  expect(attempt.hintsUsed).toBe(false);
});
