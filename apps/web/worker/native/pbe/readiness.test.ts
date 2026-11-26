// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { getSharedNativeTestApp, disposeSharedNativeTestApps, TEST_ORG, TEST_USER } from '../test-runtime';
import { Store } from '../store';
import type { Env } from '../types';
import type { PbeQuestion, PbeTarget } from './types';
import { sourceProof } from './bank';
const season = 'cccccccc-0000-0000-0000-000000000001', student = 'dddddddd-0000-0000-0000-000000000001', pack = 'aaaaaaaa-0000-0000-0000-000000000001', source = 'aaaaaaaa-0000-0000-0000-000000000002';
const tid = (n: number) => `bbbbbbbb-0000-0000-0000-${String(n).padStart(12, '0')}`;
let app: Awaited<ReturnType<typeof getSharedNativeTestApp>>;
afterAll(async () => { await disposeSharedNativeTestApps(); });
beforeAll(async () => { await getSharedNativeTestApp({ measureD1: true, soloTestClock: true, clearCachesOnReset: true }); }, 30000);

async function setup(bank: 'mixed' | 'list10') {
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
    const targets: PbeTarget[] = [
        { id: tid(1), sourceUnitIds: [source], skill: 'FactualRecall', label: 'Alpha' },
        { id: tid(2), sourceUnitIds: [source], skill: 'FactualRecall', label: 'Beta' },
        ...(bank === 'mixed' ? [{ id: tid(3), sourceUnitIds: [source], skill: 'ExactWords', label: 'Alpha and Beta' } as PbeTarget] : []),
    ];
    for (const t of targets) await store.insert('pbe-target', t.id, TEST_ORG, t, { seasonId: season, ownerId: source });
    const questions: PbeQuestion[] = bank === 'mixed' ? [
        { schemaVersion: 2, id: tid(100), version: 1, contentPackId: pack, sourceUnitId: source, sourceUnitIds: [source], sourceKind: 'Scripture', reference: 'GEN 1:1', evidence: 'Alpha and Beta', kind: 'List', prompt: 'Name the two labels.', ordered: false, parts: targets.slice(0, 2).map((t, i) => ({ targetId: t.id, acceptedAnswers: [i ? 'Beta' : 'Alpha'], points: 1 })) },
        { schemaVersion: 2, id: tid(101), version: 1, contentPackId: pack, sourceUnitId: source, sourceUnitIds: [source], sourceKind: 'Scripture', reference: 'GEN 1:1', evidence: 'Alpha and Beta', kind: 'ExactWords', prompt: 'Give the exact wording.', ordered: true, parts: [{ targetId: tid(3), acceptedAnswers: ['Alpha and Beta'], points: 2 }] },
    ] : Array.from({ length: 10 }, (_, n) => ({ schemaVersion: 2, id: tid(100 + n), version: 1, contentPackId: pack, sourceUnitId: source, sourceUnitIds: [source], sourceKind: 'Scripture', reference: 'GEN 1:1', evidence: 'Alpha and Beta', kind: 'List', prompt: 'Name the two labels.', ordered: false, parts: targets.map((t, i) => ({ targetId: t.id, acceptedAnswers: [i ? 'Beta' : 'Alpha'], points: 1 })) }) as PbeQuestion);
    for (const q of questions) await store.insert('pbe-question-head', q.id, TEST_ORG, { id: q.id, seasonId: season, published: true, sourceFingerprint: await sourceProof(q, new Map([[source, unit]])), question: q }, { seasonId: season, ownerId: source });
    const login = await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'pbe-student', password: 'Testing!123' }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const send = async (path: string, value?: unknown, empty = false, extraHeaders: Record<string, string> = {}) => { const r = await app.fetch('/api/v1' + path, { method: value === undefined && !empty ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: 'https://erudoza.test', 'Content-Type': 'application/json', ...extraHeaders }, body: value === undefined || empty ? undefined : JSON.stringify(value) }); const meter = JSON.parse(r.headers.get('x-test-d1-meter')!) as { statements: number }; expect(meter.statements, `${path}: ${JSON.stringify(meter)}`).toBeLessThanOrEqual(50); return r; };
    const readiness = async () => { const r = await send(`/progress/me/pbe-readiness?seasonId=${season}`); expect(r.status).toBe(200); return await r.json() as { version: string; dimensions: { key: string; percent: number | null }[] }; };
    const byKey = (d: { dimensions: { key: string; percent: number | null }[] }) => Object.fromEntries(d.dimensions.map(x => [x.key, x.percent]));
    return { send, readiness, byKey };
}

it('reports honest pending states before any evidence, then derives dimensions from stored attempts', async () => {
    const { send, readiness, byKey } = await setup('mixed');
    const fresh = await readiness();
    expect(fresh.version).toBe('pbe-readiness-v1');
    // Coverage is measured (0 of 3 targets practiced); everything else has
    // no stored evidence yet and must be pending, never a guessed number.
    expect(byKey(fresh)).toEqual({ Coverage: 0, Recall: null, Precision: null, Reference: null, Composure: null, Team: null });

    const started = await send('/study/sessions', { seasonId: season, format: 'Pbe', mode: 'Practice' });
    const session = await started.json() as { id: string };
    for (let n = 0; n < 2; n++) {
        const card = await (await send(`/study/sessions/${session.id}/next`)).json() as { id: string; question: { kind: string } };
        const answers = card.question.kind === 'ExactWords' ? ['Alpha and Beta'] : ['Alpha', 'wrong'];
        const accepted = await send(`/study/sessions/${session.id}/attempts`, { clientSubmissionId: crypto.randomUUID(), challengeCardId: card.id, answers, hintsUsed: false });
        expect(accepted.status).toBe(200);
    }
    const after = byKey(await readiness());
    // Both List targets + the ExactWords target were practiced (3/3).
    // Recall follows the retention fold's own rule (final, full-credit,
    // unaided recall evidence): Alpha and the exact wording earned it,
    // the missed Beta part did not — 2 of 3. Points 1/2 + 2/2 = 75;
    // ExactWords alone = 100; no timed run and no team match yet.
    expect(after).toEqual({ Coverage: 100, Recall: 67, Precision: 75, Reference: 100, Composure: null, Team: null });
});

it('derives Composure from timed-run attempts only', async () => {
    const { send, readiness, byKey } = await setup('list10');
    const started = await send('/study/sessions', { seasonId: season, format: 'Pbe', mode: 'Checkpoint' });
    const session = await started.json() as { id: string };
    const card = await (await send(`/study/sessions/${session.id}/next`)).json() as { id: string };
    const present = await (await send(`/study/sessions/${session.id}/timed`, { action: 'present', delivery: 'TextFallback' })).json() as { revision: number };
    const armed = await (await send(`/study/sessions/${session.id}/timed`, { action: 'ack', questionId: card.id, revision: present.revision, delivery: 'TextFallback' })).json() as { responseStartsAtMs: number };
    await send(`/study/sessions/${session.id}/timed?questionId=${card.id}`, undefined, false, { 'x-test-solo-now': String(armed.responseStartsAtMs + 100) });
    const accepted = await send(`/study/sessions/${session.id}/timed`, { action: 'submit', questionId: card.id, revision: present.revision, answers: ['Alpha', 'Beta'], clientSubmissionId: crypto.randomUUID() });
    expect(accepted.status).toBe(200);
    const after = byKey(await readiness());
    expect(after.Composure).toBe(100);
    expect(after.Precision).toBe(100);
    expect(after.Reference).toBeNull();
    expect(after.Team).toBeNull();
});
