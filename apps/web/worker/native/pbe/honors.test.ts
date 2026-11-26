// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { getSharedNativeTestApp, disposeSharedNativeTestApps, TEST_ORG, TEST_USER } from '../test-runtime';
import { Store } from '../store';
import type { Env, RequestContext } from '../types';
import type { PbeQuestion, PbeTarget } from './types';
import { sourceProof } from './bank';
import { awardPbeHonors } from './honors';
import type { PbeSession } from './sessions';
import type { PbeDispute } from './disputes';
const season = 'cccccccc-0000-0000-0000-000000000001', student = 'dddddddd-0000-0000-0000-000000000001', pack = 'aaaaaaaa-0000-0000-0000-000000000001', source = 'aaaaaaaa-0000-0000-0000-000000000002';
const tid = (n: number) => `bbbbbbbb-0000-0000-0000-${String(n).padStart(12, '0')}`;
let app: Awaited<ReturnType<typeof getSharedNativeTestApp>>;
afterAll(async () => { await disposeSharedNativeTestApps(); });
beforeAll(async () => { await getSharedNativeTestApp({ measureD1: true, soloTestClock: true, clearCachesOnReset: true }); }, 30000);

/** Bank of `count` one-target List questions (1 pt each): question n asks for "Label n". */
async function setup(count: number) {
    app = await getSharedNativeTestApp({ measureD1: true, soloTestClock: true, clearCachesOnReset: true });
    const store = new Store(app.db as unknown as Env['DB']);
    await store.insert('season', season, TEST_ORG, { id: season, name: 'Test season', organizationId: TEST_ORG, status: 'Active', pbeEnabled: true });
    await store.insert('pack', pack, TEST_ORG, { id: pack, isActive: true, licensingStatus: 'approved', sourceType: 'Scripture' });
    const unit = { id: source, contentPackId: pack, bookKey: 'GEN', chapter: 1, verse: 1, ordinal: 1, citation: 'GEN 1:1', canonicalText: 'Alpha and Beta', isActive: true };
    await store.insert('source', source, TEST_ORG, unit, { ownerId: pack });
    const range = { bookKey: 'GEN', startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1 };
    await store.insert('scope', season, TEST_ORG, { contentPackId: pack, includes: [range], excludes: [] });
    await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT ?,org_id,'pbe-student','Student','Student','Student',password_hash,credential_version FROM Users WHERE id=?").bind(student, TEST_USER).run();
    await store.insert('assignment', 'assignment', TEST_ORG, { id: 'assignment', seasonId: season, studentUserId: student, contentPackId: pack, ...range }, { seasonId: season, ownerId: student });
    await store.insert('membership', `${season}:${student}`, TEST_ORG, { id: `${season}:${student}`, seasonId: season, userId: student, difficulty: 'Standard' }, { seasonId: season, ownerId: student });
    const answerFor = new Map<string, string>();
    for (let n = 1; n <= count; n++) {
        const target: PbeTarget = { id: tid(n), sourceUnitIds: [source], skill: 'FactualRecall', label: `Label ${n}` };
        await store.insert('pbe-target', target.id, TEST_ORG, target, { seasonId: season, ownerId: source });
        const q: PbeQuestion = { schemaVersion: 2, id: tid(100 + n), version: 1, contentPackId: pack, sourceUnitId: source, sourceUnitIds: [source], sourceKind: 'Scripture', reference: 'GEN 1:1', evidence: 'Alpha and Beta', kind: 'List', prompt: `Name label ${n}.`, ordered: false, parts: [{ targetId: target.id, acceptedAnswers: [`Label ${n}`], points: 1 }] };
        answerFor.set(q.id, `Label ${n}`);
        await store.insert('pbe-question-head', q.id, TEST_ORG, { id: q.id, seasonId: season, published: true, sourceFingerprint: await sourceProof(q, new Map([[source, unit]])), question: q }, { seasonId: season, ownerId: source });
    }
    const login = await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'pbe-student', password: 'Testing!123' }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const send = async (path: string, value?: unknown, empty = false, extraHeaders: Record<string, string> = {}) => app.fetch('/api/v1' + path, { method: value === undefined && !empty ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: 'https://erudoza.test', 'Content-Type': 'application/json', ...extraHeaders }, body: value === undefined || empty ? undefined : JSON.stringify(value) });
    const honorKeys = async () => (await store.list<{ key: string }>('mastery-honor', TEST_ORG, { ownerId: student })).map(r => r.key);
    return { store, send, answerFor, honorKeys };
}

async function runTimed(send: Awaited<ReturnType<typeof setup>>['send'], answerFor: Map<string, string>, mode: string, wrongFirst = false) {
    const started = await send('/study/sessions', { seasonId: season, format: 'Pbe', mode });
    expect(started.status).toBe(200);
    const session = await started.json() as { id: string };
    let first = true;
    for (;;) {
        const next = await send(`/study/sessions/${session.id}/next`);
        const card = await next.json() as { id: string; question?: { id: string }; break?: unknown };
        if (!card.question) break;
        const present = await (await send(`/study/sessions/${session.id}/timed`, { action: 'present', delivery: 'TextFallback' })).json() as { revision: number };
        const armed = await (await send(`/study/sessions/${session.id}/timed`, { action: 'ack', questionId: card.id, revision: present.revision, delivery: 'TextFallback' })).json() as { responseStartsAtMs: number };
        await send(`/study/sessions/${session.id}/timed?questionId=${card.id}`, undefined, false, { 'x-test-solo-now': String(armed.responseStartsAtMs + 100) });
        const answers = [wrongFirst && first ? 'Not the label' : answerFor.get(card.question.id)!];
        first = false;
        const accepted = await send(`/study/sessions/${session.id}/timed`, { action: 'submit', questionId: card.id, revision: present.revision, answers, clientSubmissionId: crypto.randomUUID() });
        expect(accepted.status).toBe(200);
    }
    expect((await send(`/study/sessions/${session.id}/complete`, {})).status).toBe(200);
    return session.id;
}

it('awards Coverage Starter, Steady Under Time, and Zero Extra Answers for a perfect Checkpoint', async () => {
    const { send, answerFor, honorKeys } = await setup(10);
    await runTimed(send, answerFor, 'Checkpoint');
    const keys = await honorKeys();
    expect(keys).toContain('pbe:coverage-starter');
    expect(keys).toContain('pbe:steady-under-time');
    expect(keys).toContain('pbe:zero-extra');
    expect(keys).not.toContain('pbe:first-45');
    expect(keys).not.toContain('pbe:captains-call');
    expect(keys).not.toContain('pbe:fair-challenge');
}, 30000);

it('withholds Zero Extra Answers when a timed answer adds words the question did not ask for, at the 90% Steady boundary', async () => {
    const { send, answerFor, honorKeys } = await setup(10);
    await runTimed(send, answerFor, 'Checkpoint', true);
    const keys = await honorKeys();
    // 9 of 10 points = exactly 90%: Steady still lands; the wrong extra
    // answer keeps Zero Extra locked.
    expect(keys).toContain('pbe:steady-under-time');
    expect(keys).not.toContain('pbe:zero-extra');
}, 30000);

it('awards First 45 for completing a half mock', async () => {
    const { send, answerFor, honorKeys } = await setup(45);
    await runTimed(send, answerFor, 'MockHalf');
    expect(await honorKeys()).toContain('pbe:first-45');
}, 60000);

it('folds a favorable ruling into Steady and awards both flag patches; a ruling against earns only Captain\u2019s Call', async () => {
    const { store } = await setup(2);
    const ctx = { store, env: { DB: app.db as unknown as Env['DB'] }, orgId: TEST_ORG, actor: { userId: student, kind: 'Student', role: 'Student', organizationId: TEST_ORG } } as unknown as RequestContext;
    const attempt = (id: string, earned: number) => ({ id, cardId: `card-${id}`, clientSubmissionId: id, answers: ['x'], hintsUsed: false, atMs: 1, result: { attemptId: id, earnedPoints: earned, availablePoints: 5, expectedParts: [], sourceEvidence: '', citation: 'GEN 1:1', unaided: true, acceptedAtUtc: '2026-11-25T00:00:00Z', acceptedSequence: 1, alreadyProcessed: false } });
    const session: PbeSession = { id: 'session-honors', format: 'Pbe', studentUserId: student, seasonId: season, mode: 'Checkpoint', status: 'Completed', scopeVersion: 'v', ruleVersion: 'r', scoringVersion: 's', selectionVersion: 'sel', questionIds: [], cards: [], attempts: [attempt('a1', 5), attempt('a2', 3)], createdAtUtc: '2026-11-25T00:00:00Z', completedAtUtc: '2026-11-25T01:00:00Z' } as PbeSession;
    await store.insert('pbe-session', session.id, TEST_ORG, session, { seasonId: season, ownerId: student });
    const dispute = (id: string, pointsByPart: number[], original: number[]): PbeDispute => ({ id, organizationId: TEST_ORG, seasonId: season, activity: 'Solo', sessionId: session.id, attemptId: 'a2', questionId: 'q', questionVersion: 1, team: null, status: 'Resolved', reason: 'check', revision: 2, partPoints: [5], sourceEvidence: '', question: null as never, answers: ['x'], originalPointsByPart: original, acceptedAtUtc: '2026-11-25T00:30:00Z', participantIds: [student], allParticipantIds: [student], resolution: { pointsByPart, reason: 'ruled', resolvedBy: 'coach', resolvedAtUtc: '2026-11-25T02:00:00Z' } });
    // Raw session ratio is 8/10 (80%): Steady must NOT land before the
    // correction is folded in; the favorable ruling raises a2 to 5/5.
    await store.insert('pbe-dispute', 'd-up', TEST_ORG, dispute('d-up', [5], [3]), { seasonId: season, ownerId: student });
    await awardPbeHonors(ctx, student, season);
    const keys = (await store.list<{ key: string }>('mastery-honor', TEST_ORG, { ownerId: student })).map(r => r.key);
    expect(keys).toContain('pbe:steady-under-time');
    expect(keys).toContain('pbe:captains-call');
    expect(keys).toContain('pbe:fair-challenge');

    // A different learner ruled AGAINST (points lowered): Captain's
    // Call only — Fair Challenge needs the ruling to raise the points.
    const student2 = 'dddddddd-0000-0000-0000-000000000002';
    const down = { ...dispute('d-down', [1], [3]), participantIds: [student2], allParticipantIds: [student2] };
    await store.insert('pbe-dispute', 'd-down', TEST_ORG, down, { seasonId: season, ownerId: student2 });
    const ctx2 = { ...ctx, actor: { userId: student2, kind: 'Student', role: 'Student', organizationId: TEST_ORG } } as unknown as RequestContext;
    await awardPbeHonors(ctx2, student2, season);
    const keys2 = (await store.list<{ key: string }>('mastery-honor', TEST_ORG, { ownerId: student2 })).map(r => r.key);
    expect(keys2).toContain('pbe:captains-call');
    expect(keys2).not.toContain('pbe:fair-challenge');
});
