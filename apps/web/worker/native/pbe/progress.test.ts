// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG, TEST_USER } from '../test-runtime';
import { Store } from '../store';
import type { Env, RequestContext } from '../types';
import { atomic } from '../application/model';
import { prepareRecallEvidence, preparePbeService, loadPbeProjections } from './progress';
const season = 'cccccccc-0000-0000-0000-000000000001', target = 'aaaaaaaa-0000-0000-0000-000000000001', question = 'bbbbbbbb-0000-0000-0000-000000000001';
const attempt = (n: number) => `dddddddd-0000-0000-0000-${String(n).padStart(12, '0')}`;
const e = (n: number, points = 0, atMs = 1000) => ({ attemptId: attempt(n), targetId: target, questionId: question, atMs, earnedPoints: points, availablePoints: 1, unaided: true, recall: true });
let app: Awaited<ReturnType<typeof createNativeTestApp>>;
afterEach(async () => { await app?.runtime.dispose(); });
async function setup() { app = await createNativeTestApp(); const store = new Store(app.db as unknown as Env['DB']); const ctx = { store, env: { DB: store.db }, orgId: TEST_ORG, actor: { userId: TEST_USER, organizationId: TEST_ORG, kind: 'Adult', role: 'Owner' }, request: new Request('https://erudoza.test'), path: '' } as unknown as RequestContext; return { ctx, store }; }
it('commits caller attempt and evidence together; exact retry is inert and contradictory retry conflicts', async () => {
    const { ctx, store } = await setup();
    const w = await prepareRecallEvidence(ctx, season, 'scope-1', [e(1)]);
    expect(await store.list('pbe-recall-event', TEST_ORG)).toEqual([]);
    await atomic(ctx, 'test', [store.insertion('pbe-test-attempt', attempt(1), TEST_ORG, {}), ...w.statements], w.guards);
    expect((await prepareRecallEvidence(ctx, season, 'scope-2', [e(1)])).statements).toHaveLength(0);
    await expect(prepareRecallEvidence(ctx, season, 'scope-1', [e(1, 1)])).rejects.toThrow(/conflict/i);
    const good = await prepareRecallEvidence(ctx, season, 'scope-2', [e(2, 1)]);
    await atomic(ctx, 'test', good.statements, good.guards);
    const p = await loadPbeProjections(ctx, season, [target], [question]);
    expect(p.reviews[0].review.dueAtMs).toBe(86401000);
    const rows = await store.list<{
        acceptedSequence: number;
    }>('pbe-recall-event', TEST_ORG, { seasonId: season, ownerId: TEST_USER });
    expect(rows.map(r => r.acceptedSequence)).toEqual([1, 2]);
    await expect(prepareRecallEvidence(ctx, season, 's', [e(3, 1, 999)])).rejects.toThrow(/chronolog/i);
});
it('serializes concurrent preparations and rolls back the losing caller attempt', async () => {
    const { ctx, store } = await setup();
    const first = await prepareRecallEvidence(ctx, season, 's', [e(1)]);
    await atomic(ctx, 'test', first.statements, first.guards);
    const [a, b] = await Promise.all([prepareRecallEvidence(ctx, season, 's', [e(2, 1)]), prepareRecallEvidence(ctx, season, 's', [e(3)])]);
    await atomic(ctx, 'test', a.statements, a.guards);
    await expect(atomic(ctx, 'test', [store.insertion('pbe-test-attempt', attempt(3), TEST_ORG, {}), ...b.statements], b.guards)).rejects.toThrow();
    expect(await store.get('pbe-test-attempt', attempt(3), TEST_ORG)).toBeNull();
    expect((await loadPbeProjections(ctx, season, [target], [])).reviews[0].review.unresolved).toBe(false);
});
it('counts service separately once across resume and rejects contradictory service identity', async () => {
    const { ctx } = await setup();
    const event = { serviceId: attempt(1), questionId: question, targetIds: [target], questionKind: 'ShortAnswer', atMs: 1000 };
    const a = await preparePbeService(ctx, season, event);
    await atomic(ctx, 'test', a.statements, a.guards);
    expect((await preparePbeService(ctx, season, event)).statements).toHaveLength(0);
    await expect(preparePbeService(ctx, season, { ...event, atMs: 1001 })).rejects.toThrow(/conflict/i);
    const p = await loadPbeProjections(ctx, season, [target], [question]);
    expect(p.reviews).toEqual([]);
    expect(p.questions[0].servedCount).toBe(1);
    expect(p.targets[0].servedCount).toBe(1);
});
it('validates point domains and same attempt grouping before preparing any writes', async () => {
    const { ctx } = await setup();
    for (const bad of [{ ...e(1), availablePoints: 0 }, { ...e(1), earnedPoints: 2 }, { ...e(1), atMs: NaN }, { ...e(1), earnedPoints: .5 }])
        await expect(prepareRecallEvidence(ctx, season, 's', [bad])).rejects.toThrow();
    await expect(prepareRecallEvidence(ctx, season, 's', [e(1), e(2)])).rejects.toThrow();
});
it('bounded projection reads ignore unrelated history and excluded targets', async () => {
    const { ctx } = await setup();
    const w = await prepareRecallEvidence(ctx, season, 's', [e(1)]);
    await atomic(ctx, 'test', w.statements, w.guards);
    const measure = async () => { let reads = 0, queries = 0; const wrap = (s: ReturnType<Env['DB']['prepare']>): ReturnType<Env['DB']['prepare']> => new Proxy(s, { get(o, k) { if (k === 'bind')
            return (...args: unknown[]) => wrap(o.bind(...args)); if (k === 'all' || k === 'first')
            return async () => { const r = await o.all(); reads += r.meta.rows_read ?? 0; queries++; return k === 'all' ? r : r.results[0] ?? null; }; const v = Reflect.get(o, k); return typeof v === 'function' ? v.bind(o) : v; } }); const db = new Proxy(ctx.env.DB, { get(o, k) { if (k === 'prepare')
            return (sql: string) => wrap(o.prepare(sql)); const v = Reflect.get(o, k); return typeof v === 'function' ? v.bind(o) : v; } }); const p = await loadPbeProjections({ ...ctx, env: { ...ctx.env, DB: db }, store: new Store(db) }, season, [target], [question]); expect(p.reviews).toHaveLength(1); return { reads, queries }; };
    const before = await measure();
    for (const kind of ['pbe-recall-event', 'pbe-target-review', 'pbe-target-service', 'pbe-question-service'])
        await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) SELECT ?,?||value,?,?,?,'{}' FROM json_each(?)").bind(kind, 'excluded-', TEST_ORG, season, TEST_USER, JSON.stringify(Array.from({ length: 10000 }, (_, i) => i))).run();
    const after = await measure();
    expect(after.reads).toBeLessThanOrEqual(before.reads + 4);
    expect(after.queries).toBe(4);
    process.stdout.write('B1 adapter projection budget ' + JSON.stringify({ before, after }) + '\n');
});
it('same-millisecond multipart targets share ordering and repeated encounters never fabricate spacing', async () => {
    const { ctx } = await setup();
    const other = 'aaaaaaaa-0000-0000-0000-000000000002', third = 'aaaaaaaa-0000-0000-0000-000000000003';
    for (const evidence of [[e(1), { ...e(1, 1), targetId: other }], [{ ...e(2, 1), targetId: other }], [{ ...e(3, 1), targetId: other }, { ...e(3, 1), targetId: third }]]) {
        const w = await prepareRecallEvidence(ctx, season, 's', evidence);
        await atomic(ctx, 'test', w.statements, w.guards);
        const p = await loadPbeProjections(ctx, season, [target], []);
        const after = p.recentTargets.filter(t => t.acceptedSequence > p.reviews[0].failedSequence!);
        expect(after.length).toBe(evidence[0].attemptId === attempt(1) ? 0 : evidence[0].attemptId === attempt(2) ? 1 : 2);
    }
});
it('first-writer races and concurrent services retain only the atomic winner', async () => {
    const { ctx, store } = await setup();
    const [a, b] = await Promise.all([prepareRecallEvidence(ctx, season, 's', [e(1)]), prepareRecallEvidence(ctx, season, 's', [e(2, 1)])]);
    await atomic(ctx, 'test', a.statements, a.guards);
    await expect(atomic(ctx, 'test', [store.insertion('pbe-test-attempt', attempt(2), TEST_ORG, {}), ...b.statements], b.guards)).rejects.toThrow();
    expect(await store.get('pbe-test-attempt', attempt(2), TEST_ORG)).toBeNull();
    const event = { serviceId: attempt(3), questionId: question, targetIds: [target], questionKind: 'ShortAnswer', atMs: 1000 };
    const [x, y] = await Promise.all([preparePbeService(ctx, season, event), preparePbeService(ctx, season, { ...event, serviceId: attempt(4) })]);
    await atomic(ctx, 'test', x.statements, x.guards);
    await expect(atomic(ctx, 'test', y.statements, y.guards)).rejects.toThrow();
    expect((await loadPbeProjections(ctx, season, [target], [question])).questions[0].servedCount).toBe(1);
});
it('persists the shared literal 13-event chronology across recognition, aid, delays and recovery', async () => {
    const fixture = (await import('./replay-fixtures.json')).default;
    const { ctx } = await setup();
    for (const step of fixture.events) {
        const evidence = { ...e(step.number, step.earned, step.atMs), unaided: step.unaided, recall: step.recall };
        const w = await prepareRecallEvidence(ctx, season, 'scope-' + step.number, [evidence]);
        await atomic(ctx, 'test', w.statements, w.guards);
        const p = (await loadPbeProjections(ctx, season, [target], [])).reviews[0];
        expect([p.acceptedSequence, p.review.intervalIndex, p.review.dueAtMs, p.review.unresolved]).toEqual([step.number, step.index, step.due, step.unresolved]);
    }
});
it('stores accepted question kind independently of viewed prompts and includes it in retry identity', async () => {
    const { ctx } = await setup();
    const w = await prepareRecallEvidence(ctx, season, 's', [e(1)], 'ShortAnswer');
    await atomic(ctx, 'test', w.statements, w.guards);
    const recognition = { ...e(2, 1), recall: false };
    const next = await prepareRecallEvidence(ctx, season, 's', [recognition], 'TrueFalse');
    await atomic(ctx, 'test', next.statements, next.guards);
    const p = (await loadPbeProjections(ctx, season, [target], [])).reviews[0];
    expect(p.lastAnsweredQuestionKind).toBe('TrueFalse');
    expect(p.review.unresolved).toBe(true);
    expect(p.review.lastAttemptId).toBe(attempt(1));
    await expect(prepareRecallEvidence(ctx, season, 's', [recognition], 'ShortAnswer')).rejects.toThrow(/conflict/i);
});
