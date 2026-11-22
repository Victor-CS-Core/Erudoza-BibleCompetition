// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG, TEST_USER } from '../test-runtime';
let app: Awaited<ReturnType<typeof createNativeTestApp>>;
let cookie: string;
const season = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pack = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sourceIds = [1, 2, 3, 4, 5, 6].map(n => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, '0')}`);
async function record(kind: string, id: string, value: unknown, seasonId: string | null = null, owner: string | null = null) {
  await app.db.prepare('INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) VALUES(?,?,?,?,?,?)').bind(kind, id, TEST_ORG, seasonId, owner, JSON.stringify(value)).run();
}
async function request(path: string, method = 'GET', value?: unknown) {
  return app.fetch(path, { method, headers: { Cookie: cookie, Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
async function savedSession(id: string) {
  const row = await app.db.prepare("SELECT data FROM Records WHERE kind='session' AND id=?").bind(id).first<{ data: string }>();
  return JSON.parse(row!.data) as { deckOrder?: string[]; cards: { id: string; sourceUnitId: string; answerKey: { canonicalAnswer: string } }[]; attempts: unknown[] };
}
beforeAll(async () => {
  app = await createNativeTestApp();
  await app.db.prepare("UPDATE Users SET kind='Student',role='Student' WHERE id=?").bind(TEST_USER).run();
  cookie = (await app.login()).headers.get('set-cookie')!.split(';')[0];
  await record('season', season, { id: season, name: 'Shuffle season', status: 'Active', organizationId: TEST_ORG, ruleProfileKey: 'PBE_STYLE_V1', ruleProfileVersion: 1 });
  await record('pack', pack, { id: pack, isActive: true, licensingStatus: 'development-sample' });
  const range = { bookKey: 'GEN', startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 6 };
  await record('scope', season, { contentPackId: pack, includes: [range], excludes: [] });
  await record('assignment', 'assignment', { id: 'assignment', seasonId: season, studentUserId: TEST_USER, contentPackId: pack, type: 'PrimarySpecialist', ...range }, season, TEST_USER);
  await record('membership', `${season}:${TEST_USER}`, { id: `${season}:${TEST_USER}`, seasonId: season, userId: TEST_USER, studentUserId: TEST_USER, difficulty: 'Foundation' }, season, TEST_USER);
  for (const [i, id] of sourceIds.entries()) await record('source', id, { id, knowledgeUnitId: id, contentPackId: pack, citation: `Genesis 1:${i + 1}`, bookKey: 'GEN', chapter: 1, verse: i + 1, ordinal: i + 1, canonicalText: `Synthetic verse ${i + 1} has enough words for this exercise today.`, isActive: true }, null, pack);
}, 30000);
afterAll(async () => { await app?.runtime.dispose(); });

it('persists a shuffled deck (a permutation of the scope) when a Practice session starts', async () => {
  const start = await request('/api/v1/study/sessions', 'POST', { seasonId: season, mode: 'Practice' });
  expect(start.status).toBe(200);
  const session = await start.json() as { id: string };
  const saved = await savedSession(session.id);
  expect(saved.deckOrder).toHaveLength(sourceIds.length);
  expect([...saved.deckOrder!].sort()).toEqual([...sourceIds].sort());
});

it('does not build a deck for Simulation sessions', async () => {
  const start = await request('/api/v1/study/sessions', 'POST', { seasonId: season, mode: 'Simulation' });
  expect(start.status).toBe(200);
  const session = await start.json() as { id: string };
  const saved = await savedSession(session.id);
  expect(saved.deckOrder).toBeUndefined();
});

it('practice decks are not simply verse order across sessions', async () => {
  const decks: string[][] = [];
  for (let n = 0; n < 4; n++) {
    const start = await request('/api/v1/study/sessions', 'POST', { seasonId: season, mode: 'Practice' });
    const session = await start.json() as { id: string };
    decks.push((await savedSession(session.id)).deckOrder!);
  }
  // One sequential deck has probability 1/720 per session; four in a row is
  // not a plausible random outcome, so at least one deck must break order.
  expect(decks.some(deck => deck.join(',') !== sourceIds.join(','))).toBe(true);
});

it('draws follow the persisted deck, and shuffle reorders only the undrawn remainder', async () => {
  const start = await request('/api/v1/study/sessions', 'POST', { seasonId: season, mode: 'Practice' });
  const session = await start.json() as { id: string };
  const base = `/api/v1/study/sessions/${session.id}`;
  const deckAtStart = (await savedSession(session.id)).deckOrder!;

  const card1 = await (await request(`${base}/next`)).json() as { id: string };
  let saved = await savedSession(session.id);
  expect(saved.cards).toHaveLength(1);
  expect(saved.cards[0].sourceUnitId).toBe(deckAtStart[0]);
  expect(saved.deckOrder).toEqual(deckAtStart.slice(1));

  const answer = { clientSubmissionId: 'shuffle-flow-1', challengeCardId: card1.id, submittedAnswer: saved.cards[0].answerKey.canonicalAnswer, responseTimeMs: 25, hintsUsed: false };
  expect((await request(`${base}/attempts`, 'POST', answer)).status).toBe(200);

  const shuffled = await request(`${base}/shuffle`, 'POST');
  expect(shuffled.status).toBe(200);
  expect(await shuffled.json()).toMatchObject({ sessionId: session.id, remaining: deckAtStart.length - 1 });
  saved = await savedSession(session.id);
  // Same undrawn set, attempts and answered card untouched.
  expect([...saved.deckOrder!].sort()).toEqual([...deckAtStart.slice(1)].sort());
  expect(saved.attempts).toHaveLength(1);
  expect(saved.cards).toHaveLength(1);

  // The next draw follows the reshuffled deck head.
  const deckAfterShuffle = saved.deckOrder!;
  const card2 = await (await request(`${base}/next`)).json() as { id: string };
  saved = await savedSession(session.id);
  expect(saved.cards.find(c => c.id === card2.id)?.sourceUnitId).toBe(deckAfterShuffle[0]);
  expect(saved.deckOrder).toEqual(deckAfterShuffle.slice(1));
});

it('shuffle rejects non-Practice sessions', async () => {
  const start = await request('/api/v1/study/sessions', 'POST', { seasonId: season, mode: 'Simulation' });
  const session = await start.json() as { id: string };
  expect((await request(`/api/v1/study/sessions/${session.id}/shuffle`, 'POST')).status).toBe(400);
});
