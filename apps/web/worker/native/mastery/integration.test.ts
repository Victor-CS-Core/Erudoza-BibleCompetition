// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG, TEST_USER } from '../test-runtime';
import { honorId } from './catalog';
import type { Session, Mastery } from '../study/routes';
import { makeRoom } from '../practice/state';
import type { Actor } from '../types';
let app: Awaited<ReturnType<typeof createNativeTestApp>>, cookie: string;
const season = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', pack = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const request = (path: string, method = 'GET', value?: unknown) => app.fetch(path, { method, headers: { Cookie: cookie, Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
const record = (kind: string, id: string, value: unknown, sid: string | null = null, owner: string | null = null) => app.db.prepare('INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) VALUES(?,?,?,?,?,?)').bind(kind, id, TEST_ORG, sid, owner, JSON.stringify(value)).run();
async function stored<T>(kind: string, id: string) { const row = await app.db.prepare('SELECT data FROM Records WHERE kind=? AND id=? AND org_id=?').bind(kind, id, TEST_ORG).first<{ data: string }>(); return row ? JSON.parse(row.data) as T : null; }
beforeAll(async () => {
  app = await createNativeTestApp(); await app.db.prepare("UPDATE Users SET kind='Student',role='Student' WHERE id=?").bind(TEST_USER).run(); cookie = (await app.login()).headers.get('set-cookie')!.split(';')[0];
  await record('season', season, { id: season, name: 'Mastery proof', status: 'Active', organizationId: TEST_ORG });
  await record('pack', pack, { id: pack, isActive: true, licensingStatus: 'development-sample' });
  const range = { bookKey: 'GEN', startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 30 };
  await record('scope', season, { contentPackId: pack, includes: [range], excludes: [] });
  await record('assignment', 'assigned-mastery', { id: 'assigned-mastery', seasonId: season, studentUserId: TEST_USER, contentPackId: pack, type: 'PrimarySpecialist', ...range }, season, TEST_USER);
  await record('membership', `${season}:${TEST_USER}`, { id: `${season}:${TEST_USER}`, seasonId: season, studentUserId: TEST_USER, difficulty: 'Advanced' }, season, TEST_USER);
  for (let i = 1; i <= 30; i++) {
    const id = `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, '0')}`;
    await record('source', id, { id, knowledgeUnitId: id, contentPackId: pack, citation: `Genesis 1:${i}`, bookKey: 'GEN', chapter: 1, verse: i, ordinal: i, canonicalText: `Synthetic verse ${i} has meaningful words for this fixture.`, isActive: true }, null, pack);
    await record('mastery', `${season}:${TEST_USER}:${id}`, { id: `${season}:${TEST_USER}:${id}`, knowledgeUnitId: id, sourceUnitId: id, studentUserId: TEST_USER, seasonId: season, algorithmVersion: 'v2-skill-evidence', exactWording: 90, reference: 90, recognition: 90, sequence: 80, factualRecall: 0, level: 'Mastered', lastSeenAt: '2026-09-01T00:00:00Z', reviewDueAt: '2026-09-01T00:00:00Z' } satisfies Mastery, season, TEST_USER);
  }
}, 30000);
afterAll(async () => { await app?.runtime.dispose(); });
it('accepted real study writes unlock evidence once; replay and reads do not reissue it', async () => {
  const before = await (await request('/api/v1/profile/me')).json() as { honors: { earnedAtUtc: string | null }[] }; expect(before.honors.every(x => x.earnedAtUtc === null)).toBe(true);
  const started = await request('/api/v1/study/sessions', 'POST', { seasonId: season, mode: 'Review' }); expect(started.status).toBe(200); const sid = (await started.json() as { id: string }).id;
  const next = await request(`/api/v1/study/sessions/${sid}/next`); expect(next.status).toBe(200); const cardId = (await next.json() as { id: string }).id;
  const session = (await stored<Session>('session', sid))!, card = session.cards.find(c => c.id === cardId)!; expect(card.payload.difficulty).toBe(5);
  const value = { clientSubmissionId: 'mastery-accepted', challengeCardId: cardId, submittedAnswer: card.answerKey.canonicalAnswer, responseTimeMs: 500, hintsUsed: false };
  expect((await request(`/api/v1/study/sessions/${sid}/attempts`, 'POST', value)).status).toBe(200);
  const id = honorId(TEST_ORG, TEST_USER, 'solo:full-coverage'), earned = await stored<{ evidence: { passageIds: string[] }; earnedAtUtc: string }>('mastery-honor', id);
  expect(earned?.evidence.passageIds).toHaveLength(30);
  expect((await request(`/api/v1/study/sessions/${sid}/attempts`, 'POST', value)).status).toBe(200);
  expect(await stored('mastery-honor', id)).toEqual(earned);
  const proof = await app.db.prepare("SELECT data FROM Records WHERE kind='mastery-proof' AND owner_id=?").bind(TEST_USER).first<{ data: string }>();
  expect(JSON.parse(proof!.data)).toMatchObject({ reviewAttemptId: expect.any(String), reviewEvidence: { difficulty: 5, exactWording: expect.any(Number), reference: 90 } });
  expect(await (await request('/api/v1/profile/me/avatar', 'PUT', { honorKey: 'solo:full-coverage' })).json()).toMatchObject({ avatarHonorKey: 'solo:full-coverage' });
});
it('finalized PVP report atomically adds mastery unlocks without deleting legacy awards or rewriting evidence', async () => {
  const actor: Actor = { userId: TEST_USER, organizationId: TEST_ORG, organizationName: 'Org', userName: 'a', displayName: 'A', email: null, kind: 'Student', role: 'Student', credentialVersion: 'v1' };
  const room = makeRoom('12345678-1234-4234-8234-123456789abc', actor, { seasonId: season, teamSize: 1, questionCount: 10, coached: false }, 'epoch', 1);
  room.members.push({ userId: 'other', displayName: 'Other', team: 2, ready: true, captain: true, scribe: true }); room.status = 'Completed'; room.completedAt = '2026-09-11T00:00:00Z'; room.revision = 100;
  room.questions = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, sourceUnitId: `s${i}`, contentPackId: pack, kind: 'ExactWords', reference: 'GEN1', evidence: 'Answer', prompt: 'Recall', version: 1, ordered: true, parts: [{ points: 1, acceptedAnswers: ['yes'] }] }));
  room.submissions = room.questions.flatMap(q => [1, 2].map(team => ({ questionId: q.id, team, scribeId: team === 1 ? TEST_USER : 'other', answers: ['yes'], elapsedMs: 1000, deadlineDraft: false, accuracyHundredths: 100, speedHundredths: 24, appealed: false, resolved: true })));
  const namespace = await app.runtime.getDurableObjectNamespace('REPORTS'), stub = namespace.get(namespace.idFromName(`${TEST_ORG}:${season}`));
  const project = () => stub.fetch('https://reports.internal', { method: 'POST', body: JSON.stringify(room) });
  expect((await project()).status).toBe(200); const id = honorId(TEST_ORG, TEST_USER, 'team:first-fellowship'), earned = await stored('mastery-honor', id); expect(earned).not.toBeNull();
  expect(await app.db.prepare("SELECT count(*) n FROM Records WHERE kind='award' AND owner_id=?").bind(TEST_USER).first<{ n: number }>()).toMatchObject({ n: 2 });
  room.revision++; room.submissions[0].resolved = false; room.submissions[0].appealed = true; expect((await project()).status).toBe(200);
  expect(await stored('mastery-honor', id)).toEqual(earned);
  room.revision++; room.submissions[0].resolved = true; room.submissions[0].accuracyHundredths = 0; expect((await project()).status).toBe(200);
  expect(await stored('mastery-honor', id)).toEqual(earned);
});
