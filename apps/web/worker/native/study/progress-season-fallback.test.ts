// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG, TEST_USER } from '../test-runtime';
let app: Awaited<ReturnType<typeof createNativeTestApp>>;
let cookie: string;
const season = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', pack = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
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
  // A season that has assignments but was never started: the direct
  // assignment flow leaves it at AssignmentsReady (application.ts moves
  // Draft/ContentReady -> AssignmentsReady on first assignment; only the
  // season planner's "Start season" activates it).
  await record('season', season, { id: season, name: 'Not started season', status: 'AssignmentsReady', organizationId: TEST_ORG, ruleProfileKey: 'PBE_STYLE_V1', ruleProfileVersion: 1, createdAtUtc: '2026-11-01T00:00:00.000Z' });
  await record('pack', pack, { id: pack, isActive: true, licensingStatus: 'development-sample' });
  const range = { bookKey: 'GEN', startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 3 };
  await record('scope', season, { contentPackId: pack, includes: [range], excludes: [] });
  await record('assignment', 'assignment', { id: 'assignment', seasonId: season, studentUserId: TEST_USER, contentPackId: pack, type: 'PrimarySpecialist', ...range }, season, TEST_USER);
  await record('membership', `${season}:${TEST_USER}`, { id: `${season}:${TEST_USER}`, seasonId: season, userId: TEST_USER, studentUserId: TEST_USER, difficulty: 'Standard' }, season, TEST_USER);
  for (const [i, id] of sourceIds.entries()) await record('source', id, { id, knowledgeUnitId: id, contentPackId: pack, citation: `Genesis 1:${i + 1}`, bookKey: 'GEN', chapter: 1, verse: i + 1, ordinal: i + 1, canonicalText: `Synthetic verse ${i + 1} has words for this exercise.`, isActive: true }, null, pack);
}, 30000);
afterAll(async () => { await app?.runtime.dispose(); });

it('progress surfaces the assigned-but-not-started season instead of "no season"', async () => {
  const progress = await (await request('/api/v1/progress/me')).json() as { seasonId: string; seasonName: string; seasonStatus: string; assignments: unknown[] };
  expect(progress.seasonId).toBe(season);
  expect(progress.seasonName).toBe('Not started season');
  expect(progress.seasonStatus).toBe('AssignmentsReady');
  expect(progress.assignments).toHaveLength(1);
});

it('today explains training opens when the season is Active, with the season named', async () => {
  const today = await (await request('/api/v1/progress/me/today')).json() as { seasonName: string; seasonStatus: string; mission: { status: string; explanation: string | null } };
  expect(today.seasonName).toBe('Not started season');
  expect(today.seasonStatus).toBe('AssignmentsReady');
  expect(today.mission.status).toBe('Unavailable');
  expect(today.mission.explanation).toBe('Training opens when this season is Active.');
});

it('study sessions still refuse a not-started season', async () => {
  expect((await request('/api/v1/study/sessions', 'POST', { seasonId: season, mode: 'Practice' })).status).toBe(400);
});

it('once the season is started the same reads report Active', async () => {
  await app.db.prepare("UPDATE Records SET data=json_set(data,'$.status','Active'),revision=revision+1 WHERE kind='season' AND id=?").bind(season).run();
  const progress = await (await request('/api/v1/progress/me')).json() as { seasonStatus: string; assignments: unknown[] };
  expect(progress.seasonStatus).toBe('Active');
  expect(progress.assignments).toHaveLength(1);
});
