// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG, TEST_USER } from '../test-runtime';
import { Store } from '../store';
import type { Env, RequestContext } from '../types';
import { startPbeSession } from './sessions';
import type { PbeQuestion, PbeTarget } from './types';
import { sourceProof } from './bank';
const season = 'cccccccc-0000-0000-0000-000000000001', student = 'dddddddd-0000-0000-0000-000000000001', pack = 'aaaaaaaa-0000-0000-0000-000000000001', source = 'aaaaaaaa-0000-0000-0000-000000000002';
const tid = (n: number) => `bbbbbbbb-0000-0000-0000-${String(n).padStart(12, '0')}`;
let app: Awaited<ReturnType<typeof createNativeTestApp>>;
afterEach(async () => { await app?.runtime.dispose(); });
async function setup(count = 2, beforeD1Statement?: (sql: string) => Promise<void>) {
    app = await createNativeTestApp({ measureD1: true, beforeD1Statement });
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
    const targets: PbeTarget[] = [1, 2].map(n => ({ id: tid(n), sourceUnitIds: [source], skill: 'FactualRecall', label: `Label ${n}` }));
    for (const t of targets)
        await store.insert('pbe-target', t.id, TEST_ORG, t, { seasonId: season, ownerId: source });
    for (let n = 0; n < count; n++) {
        const q: PbeQuestion = { schemaVersion: 2, id: tid(100 + n), version: 1, contentPackId: pack, sourceUnitId: source, sourceUnitIds: [source], sourceKind: 'Scripture', reference: 'GEN 1:1', evidence: 'Alpha and Beta', kind: 'List', prompt: 'Name the two labels.', ordered: false, parts: targets.map((t, i) => ({ targetId: t.id, acceptedAnswers: [i ? 'Beta' : 'Alpha'], points: 1 })) };
        await store.insert('pbe-question-head', q.id, TEST_ORG, { id: q.id, seasonId: season, published: true, sourceFingerprint: await sourceProof(q, new Map([[source, unit]])), question: q }, { seasonId: season, ownerId: source });
    }
    const login = await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'pbe-student', password: 'Testing!123' }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const send = async (path: string, value?: unknown, empty = false) => { const r = await app.fetch('/api/v1' + path, { method: value === undefined && !empty ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, body: value === undefined || empty ? undefined : JSON.stringify(value) }); const meter = JSON.parse(r.headers.get('x-test-d1-meter')!) as {
        bindingCalls: number;
        statements: number;
    }; expect(meter.statements, `${path}: ${JSON.stringify(meter)}`).toBeLessThanOrEqual(50); return r; };
    return { store, send };
}
it('delivers immutable private PBE cards, persists partial target grades and original retries through actual HTTP', async () => {
    const { send, store } = await setup();
    const started = await send('/study/sessions', { seasonId: season, format: 'Pbe', mode: 'Practice' });
    expect(started.status).toBe(200);
    const session = await started.json() as {
        id: string;
        format: string;
        targetCardCount: number;
    };
    expect(session).toMatchObject({ format: 'Pbe', targetCardCount: 2 });
    const next = await send(`/study/sessions/${session.id}/next`);
    const card = await next.json() as {
        id: string;
        question: {
            partPoints: number[];
        };
    };
    expect(next.status).toBe(200);
    expect(card.question.partPoints).toEqual([1, 1]);
    expect(JSON.stringify(card)).not.toMatch(/acceptedAnswers|Alpha|Beta|evidence/);
    const input = { clientSubmissionId: crypto.randomUUID(), challengeCardId: card.id, answers: ['Alpha', 'wrong'], hintsUsed: false };
    const accepted = await send(`/study/sessions/${session.id}/attempts`, input);
    expect(accepted.status).toBe(200);
    const grade = await accepted.json();
    expect(grade).toMatchObject({ earnedPoints: 1, availablePoints: 2, alreadyProcessed: false });
    const refreshed = await send(`/study/sessions/${session.id}`);
    expect(await refreshed.json()).toMatchObject({ attempt: { ...grade, alreadyProcessed: true } });
    const replay = await send(`/study/sessions/${session.id}/attempts`, input);
    expect(await replay.json()).toEqual({ ...grade as object, alreadyProcessed: true });
    expect((await send(`/study/sessions/${session.id}/attempts`, { ...input, answers: ['Beta', 'Alpha'] })).status).toBe(409);
    const card2 = await (await send(`/study/sessions/${session.id}/next`)).json() as {
        id: string;
    };
    expect((await send(`/study/sessions/${session.id}/attempts`, { ...input, clientSubmissionId: crypto.randomUUID(), challengeCardId: card2.id })).status).toBe(200);
    const done = await send(`/study/sessions/${session.id}/complete`, undefined, true);
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ format: 'Pbe', attempted: 2, recap: { fullTargetReached: true, newlyCreditedDay: true, missionSteps: [{ target: 2, completed: 2, status: 'Complete' }] } });
    const reviews = await store.list<{
        targetId: string;
        review: {
            unresolved: boolean;
        };
    }>('pbe-target-review', TEST_ORG, { seasonId: season, ownerId: student });
    expect(reviews).toHaveLength(2);
    expect(reviews.find(r => r.targetId === tid(1))?.review.unresolved).toBe(false);
    expect(reviews.find(r => r.targetId === tid(2))?.review.unresolved).toBe(true);
    expect(await store.list('mastery', TEST_ORG, { ownerId: student })).toEqual([]);
    expect(await store.list('training-day', TEST_ORG, { ownerId: student })).toHaveLength(1);
});
it('records assistance before revealing sources and keeps aided evidence across refresh, false flags and retries', async () => {
    const { send, store } = await setup(1);
    const s = await (await send('/study/sessions', { seasonId: season, format: 'Pbe' })).json() as {
        id: string;
    };
    const card = await (await send(`/study/sessions/${s.id}/next`)).json() as {
        id: string;
    };
    const aid = await send(`/study/sessions/${s.id}/source`, { challengeCardId: card.id });
    expect(aid.status).toBe(200);
    expect(await aid.json()).toMatchObject({ assisted: true, sources: [{ canonicalText: 'Alpha and Beta' }] });
    expect(await (await send(`/study/sessions/${s.id}`)).json()).toMatchObject({ card: { assisted: true } });
    const input = { clientSubmissionId: crypto.randomUUID(), challengeCardId: card.id, answers: ['Alpha', 'Beta'], hintsUsed: false };
    const accepted = await (await send(`/study/sessions/${s.id}/attempts`, input)).json();
    expect(accepted).toMatchObject({ unaided: false, earnedPoints: 2 });
    expect(await (await send(`/study/sessions/${s.id}/attempts`, input)).json()).toEqual({ ...accepted as object, alreadyProcessed: true });
    const rows = await store.list<{
        evidence: {
            unaided: boolean;
        }[];
    }>('pbe-recall-event', TEST_ORG, { ownerId: student });
    expect(rows).toHaveLength(1);
    expect(rows[0].evidence.every(e => !e.unaided)).toBe(true);
    const services = await store.list<{
        servedCount: number;
    }>('pbe-question-service', TEST_ORG, { ownerId: student });
    expect(services.map(s => s.servedCount)).toEqual([1]);
});
it('freezes complete rubrics across publication, allows saved continuation after admission disable, and rejects actual assignment revocation', async () => {
    const { send, store } = await setup(2);
    const s = await (await send('/study/sessions', { seasonId: season, format: 'Pbe' })).json() as {
        id: string;
    };
    const saved = await store.require<{
        questionIds: string[];
    }>('pbe-session', s.id, TEST_ORG);
    for (const qid of saved.value.questionIds) {
        const q = await store.require<{
            question: PbeQuestion;
        }>('pbe-question-head', qid, TEST_ORG);
        await store.put('pbe-question-head', qid, TEST_ORG, { ...q.value, question: { ...q.value.question, version: 2, prompt: 'Changed prompt', parts: q.value.question.parts.map(p => ({ ...p, acceptedAnswers: ['Changed'] })) } }, q.revision);
    }
    const seasonRow = await store.require<Record<string, unknown>>('season', season, TEST_ORG);
    await store.put('season', season, TEST_ORG, { ...seasonRow.value, pbeEnabled: false }, seasonRow.revision);
    expect((await send('/study/sessions', { seasonId: season, format: 'Pbe' })).status).toBe(403);
    expect((await send(`/organizations/${TEST_ORG}/practice/pbe/seasons/${season}/bank`)).status).toBe(403);
    const card = await (await send(`/study/sessions/${s.id}/next`)).json() as {
        id: string;
        question: {
            version: number;
            prompt: string;
        };
    };
    expect(card.question).toMatchObject({ version: 1, prompt: 'Name the two labels.' });
    expect(await (await send(`/study/sessions/${s.id}/attempts`, { clientSubmissionId: crypto.randomUUID(), challengeCardId: card.id, answers: ['Alpha', 'Beta'], hintsUsed: false })).json()).toMatchObject({ earnedPoints: 2 });
    await store.remove('assignment', 'assignment', TEST_ORG);
    expect((await send(`/study/sessions/${s.id}/next`)).status).toBe(409);
    expect((await send(`/study/sessions/${s.id}/complete`, {})).status).toBe(409);
    expect(await store.list('pbe-recall-event', TEST_ORG, { ownerId: student })).toHaveLength(1);
});
it('distinguishes nothing due from unavailable content and rejects untimed Simulation', async () => {
    const { send } = await setup();
    const review = await send('/study/sessions', { seasonId: season, format: 'Pbe', mode: 'Review' });
    expect(review.status).toBe(409);
    expect(await review.json()).toMatchObject({ code: 'PBE_NOTHING_DUE' });
    const simulation = await send('/study/sessions', { seasonId: season, format: 'Pbe', mode: 'Simulation' });
    expect(simulation.status).toBe(400);
    expect(await simulation.text()).toContain('Timed rehearsal is not enabled');
    const missing = await send('/study/sessions', { seasonId: season, format: 'Pbe', chapter: { contentPackId: pack, chapter: 2 } });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({ code: 'PBE_COVERAGE_UNAVAILABLE' });
});
it('short completed sessions credit the same daily effort only once across replay', async () => {
    const { send, store } = await setup(1);
    for (let i = 0; i < 2; i++) {
        const s = await (await send('/study/sessions', { seasonId: season, format: 'Pbe' })).json() as {
            id: string;
        };
        const card = await (await send(`/study/sessions/${s.id}/next`)).json() as {
            id: string;
        };
        expect((await send(`/study/sessions/${s.id}/attempts`, { clientSubmissionId: crypto.randomUUID(), challengeCardId: card.id, answers: ['Alpha', 'Beta'], hintsUsed: false })).status).toBe(200);
        const recap = await (await send(`/study/sessions/${s.id}/complete`, {})).json();
        expect(recap).toMatchObject({ recap: { fullTargetReached: true, newlyCreditedDay: i === 0 } });
    }
    expect(await store.list('training-day', TEST_ORG, { ownerId: student })).toHaveLength(1);
});
it('keeps complete start/serve/aid/submit/retry/recap requests within the query ceiling for a large in-scope bank', async () => {
    const { send, store } = await setup(1);
    const base = await store.require<{
        question: PbeQuestion;
    }>('pbe-question-head', tid(100), TEST_ORG);
    const copies = Array.from({ length: 5100 }, (_, n) => ({ ...base.value, id: tid(1000 + n), question: { ...base.value.question, id: tid(1000 + n) } }));
    for (let offset = 0; offset < copies.length; offset += 200)
        await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) SELECT 'pbe-question-head',json_extract(value,'$.id'),?,?,?,value FROM json_each(?)").bind(TEST_ORG, season, source, JSON.stringify(copies.slice(offset, offset + 200))).run();
    const s = await (await send('/study/sessions', { seasonId: season, format: 'Pbe' })).json() as {
        id: string;
        targetCardCount: number;
    };
    expect(s.targetCardCount).toBe(8);
    for (let i = 0; i < 8; i++) {
        const next = await send(`/study/sessions/${s.id}/next`);
        const card = await next.json() as {
            id: string;
        };
        expect(next.status).toBe(200);
        expect((await send(`/study/sessions/${s.id}`)).status).toBe(200);
        if (!i)
            expect((await send(`/study/sessions/${s.id}/source`, { challengeCardId: card.id })).status).toBe(200);
        const input = { clientSubmissionId: crypto.randomUUID(), challengeCardId: card.id, answers: ['Alpha', 'Beta'], hintsUsed: false };
        expect((await send(`/study/sessions/${s.id}/attempts`, input)).status).toBe(200);
        expect((await send(`/study/sessions/${s.id}/attempts`, input)).status).toBe(200);
    }
    expect((await send(`/study/sessions/${s.id}/complete`, {})).status).toBe(200);
});
it('makes the PBE daily mission and saved recap available on existing training routes', async () => {
    const { send } = await setup(1);
    const today = await send(`/progress/me/today?seasonId=${season}`);
    expect(today.status).toBe(200);
    expect(await today.json()).toMatchObject({ format: 'Pbe', mission: { status: 'Suggested', steps: [{ kind: 'Practice', target: 1 }] } });
    const s = await (await send('/study/sessions', { seasonId: season, format: 'Pbe' })).json() as {
        id: string;
    };
    const card = await (await send(`/study/sessions/${s.id}/next`)).json() as {
        id: string;
    };
    await send(`/study/sessions/${s.id}/attempts`, { clientSubmissionId: crypto.randomUUID(), challengeCardId: card.id, answers: ['Alpha', 'Beta'], hintsUsed: false });
    await send(`/study/sessions/${s.id}/complete`, {});
    const recap = await send(`/study/sessions/${s.id}/recap`);
    expect(recap.status).toBe(200);
    expect(await recap.json()).toMatchObject({ version: 'pbe-daily-v2', targetCardCount: 1 });
    expect(await (await send(`/progress/me/today?seasonId=${season}`)).json()).toMatchObject({ format: 'Pbe', mission: { status: 'Complete' }, week: { completedDays: 1 } });
});
it('rejects explicit malformed formats and modes while preserving omitted legacy format', async () => {
    const { send } = await setup();
    for (const format of ['pbe', 2, null, 'Unknown'])
        expect((await send('/study/sessions', { seasonId: season, format, mode: 'Practice' })).status).toBe(400);
    for (const mode of ['practice', 2, null, 'Unknown'])
        expect((await send('/study/sessions', { seasonId: season, format: 'Pbe', mode })).status).toBe(400);
    expect(await (await send('/study/sessions', { seasonId: season, mode: 'Practice' })).json()).toMatchObject({ targetCardCount: 8 });
});
it('returns one saved start for identical retry and 409 for a contradictory client start ID', async () => {
    const { send, store } = await setup(1);
    const input = { seasonId: season, format: 'Pbe', mode: 'Practice', training: { clientStartId: crypto.randomUUID() } };
    const first = await (await send('/study/sessions', input)).json();
    expect(await (await send('/study/sessions', input)).json()).toEqual(first);
    expect((await send('/study/sessions', { ...input, mode: 'Review' })).status).toBe(409);
    expect(await store.list('pbe-session', TEST_ORG, { ownerId: student })).toHaveLength(1);
});
it('rolls back admission when an assignment is revoked after its material read but before guard capture', async () => {
    const { store } = await setup(1);
    let revoked = false;
    const database = app.db as unknown as Env['DB'];
    const wrap = (statement: ReturnType<Env['DB']['prepare']>, sql: string, args: unknown[] = []): ReturnType<Env['DB']['prepare']> => new Proxy(statement, { get(object, key) {
            if (key === 'bind')
                return (...values: unknown[]) => wrap(object.bind(...values), sql, values);
            if (key === 'all')
                return async () => { const result = await object.all(); if (!revoked && (args.includes('assignment') || sql.includes("kind IN ('assignment','pbe-introduction-assignment')"))) {
                    revoked = true;
                    await store.remove('assignment', 'assignment', TEST_ORG);
                } return result; };
            const value = Reflect.get(object, key);
            return typeof value === 'function' ? value.bind(object) : value;
        } });
    const interleaved = new Proxy(database, { get(object, key) { if (key === 'prepare')
            return (sql: string) => wrap(object.prepare(sql), sql); const value = Reflect.get(object, key); return typeof value === 'function' ? value.bind(object) : value; } });
    const ctx = { store: new Store(interleaved), env: { DB: interleaved }, orgId: TEST_ORG, actor: { userId: student, organizationId: TEST_ORG, kind: 'Student', role: 'Student' }, request: new Request('https://erudoza.test'), path: '/api/v1/study/sessions' } as unknown as RequestContext;
    await expect(startPbeSession(ctx, { seasonId: season, format: 'Pbe' })).rejects.toMatchObject({ status: 409 });
    expect(revoked).toBe(true);
    expect(await store.list('pbe-session', TEST_ORG, { ownerId: student })).toEqual([]);
    expect(await store.list('pbe-daily-mission', TEST_ORG, { ownerId: student })).toEqual([]);
});
it('never uses an assignment inserted only during material loading and removed again before commit', async () => {
    const { store } = await setup(1), second = tid(10000), target = tid(10001), qid = tid(10002);
    const oldScope = await store.require<Record<string, unknown>>('scope', season, TEST_ORG);
    await store.put('scope', season, TEST_ORG, { ...oldScope.value, includes: [{ bookKey: 'GEN', startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 2 }] }, oldScope.revision);
    const unit = { id: second, contentPackId: pack, bookKey: 'GEN', chapter: 1, verse: 2, ordinal: 2, citation: 'GEN 1:2', canonicalText: 'Excluded material', isActive: true };
    await store.insert('source', second, TEST_ORG, unit, { ownerId: pack });
    const q: PbeQuestion = { schemaVersion: 2, id: qid, version: 1, contentPackId: pack, sourceUnitId: second, sourceUnitIds: [second], sourceKind: 'Scripture', reference: unit.citation, evidence: unit.canonicalText, kind: 'ShortAnswer', prompt: 'Excluded prompt', ordered: false, parts: [{ targetId: target, acceptedAnswers: ['Excluded'], points: 1 }] };
    await store.insert('pbe-target', target, TEST_ORG, { id: target, sourceUnitIds: [second], skill: 'FactualRecall', label: 'Excluded target' }, { seasonId: season, ownerId: second });
    await store.insert('pbe-question-head', qid, TEST_ORG, { id: qid, seasonId: season, published: true, sourceFingerprint: await sourceProof(q, new Map([[second, unit]])), question: q }, { seasonId: season, ownerId: second });
    let inserted = false, removed = false;
    const database = app.db as unknown as Env['DB'];
    const wrap = (statement: ReturnType<Env['DB']['prepare']>, sql: string): ReturnType<Env['DB']['prepare']> => new Proxy(statement, { get(object, key) { if (key === 'bind')
            return (...values: unknown[]) => wrap(object.bind(...values), sql); if (key === 'all')
            return async () => { const result = await object.all(); if (!inserted && sql.includes("kind IN ('assignment','pbe-introduction-assignment')")) {
                inserted = true;
                await store.insert('assignment', 'transient', TEST_ORG, { id: 'transient', seasonId: season, studentUserId: student, contentPackId: pack, bookKey: 'GEN', startChapter: 1, startVerse: 2, endChapter: 1, endVerse: 2 }, { seasonId: season, ownerId: student });
            } return result; }; const value = Reflect.get(object, key); return typeof value === 'function' ? value.bind(object) : value; } });
    const interleaved = new Proxy(database, { get(object, key) { if (key === 'prepare')
            return (sql: string) => wrap(object.prepare(sql), sql); if (key === 'batch')
            return async (statements: Parameters<Env['DB']['batch']>[0]) => { await store.remove('assignment', 'transient', TEST_ORG); removed = true; return object.batch(statements); }; const value = Reflect.get(object, key); return typeof value === 'function' ? value.bind(object) : value; } });
    const ctx = { store: new Store(interleaved), env: { DB: interleaved }, orgId: TEST_ORG, actor: { userId: student, organizationId: TEST_ORG, kind: 'Student', role: 'Student' }, request: new Request('https://erudoza.test'), path: '/api/v1/study/sessions' } as unknown as RequestContext;
    const response = await startPbeSession(ctx, { seasonId: season, format: 'Pbe' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ targetCardCount: 1 });
    expect(inserted && removed).toBe(true);
    const saved = await store.list<{
        questionIds: string[];
    }>('pbe-session', TEST_ORG, { ownerId: student });
    expect(saved[0].questionIds).not.toContain(qid);
});
it('atomically accepts one competing card submission without duplicate target evidence or effort', async () => {
    const { send, store } = await setup(1);
    const s = await (await send('/study/sessions', { seasonId: season, format: 'Pbe' })).json() as {
        id: string;
    };
    const card = await (await send(`/study/sessions/${s.id}/next`)).json() as {
        id: string;
    };
    const responses = await Promise.all([1, 2].map(() => send(`/study/sessions/${s.id}/attempts`, { clientSubmissionId: crypto.randomUUID(), challengeCardId: card.id, answers: ['Alpha', 'Beta'], hintsUsed: false })));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await store.list('pbe-attempt', TEST_ORG, { ownerId: student })).toHaveLength(1);
    expect(await store.list('pbe-recall-event', TEST_ORG, { ownerId: student })).toHaveLength(1);
    expect(await store.list('training-day', TEST_ORG, { ownerId: student })).toHaveLength(1);
    expect((await store.list<{
        completed: number;
    }>('pbe-daily-mission', TEST_ORG, { ownerId: student }))[0].completed).toBe(1);
});
it.each(['Memory', 'Pbe'] as const)('deduplicates the actual HTTP daily credit when %s completes first', async (first) => {
    const { send, store } = await setup(1);
    for (const format of [first, first === 'Memory' ? 'Pbe' : 'Memory']) {
        const s = await (await send('/study/sessions', { seasonId: season, format })).json() as {
            id: string;
            targetCardCount: number;
        };
        for (let i = 0; i < s.targetCardCount; i++) {
            const card = await (await send(`/study/sessions/${s.id}/next`)).json() as {
                id: string;
            };
            expect((await send(`/study/sessions/${s.id}/attempts`, { clientSubmissionId: crypto.randomUUID(), challengeCardId: card.id, ...(format === 'Pbe' ? { answers: ['Alpha', 'Beta'] } : { submittedAnswer: 'A saved practice attempt', responseTimeMs: 100 }), hintsUsed: false })).status).toBe(200);
        }
        expect((await send(`/study/sessions/${s.id}/complete`, undefined, true)).status).toBe(200);
    }
    expect(await store.list('training-day', TEST_ORG, { ownerId: student })).toHaveLength(1);
    expect((await store.list<{
        creditedDates: string[];
    }>('training-week', TEST_ORG, { ownerId: student }))[0].creditedDates).toHaveLength(1);
});
it('discovers intro-only assignment, tolerates unrelated pack CAS changes, and hides revoked introduction discovery', async () => {
    const { send, store } = await setup(0);
    await store.remove('assignment', 'assignment', TEST_ORG);
    const intro = tid(8000), unit = tid(8001), questionId = tid(8002);
    const introduction = { id: intro, organizationId: TEST_ORG, seasonId: season, bookKey: 'GEN', sourceEdition: 'Fixture', title: 'Introduction', citation: 'Introduction', licensingStatus: 'approved', reviewed: true, units: [{ id: unit, citation: 'Intro §1', canonicalText: 'Alpha and Beta' }] };
    await store.insert('pbe-introduction', intro, TEST_ORG, introduction, { seasonId: season });
    await store.insert('pbe-introduction-assignment', 'intro-assignment', TEST_ORG, { id: 'intro-assignment', seasonId: season, contentPackId: intro, studentUserId: student }, { seasonId: season, ownerId: student });
    for (const n of [1, 2]) {
        await store.remove('pbe-target', tid(n), TEST_ORG);
        await store.insert('pbe-target', tid(n), TEST_ORG, { id: tid(n), sourceUnitIds: [unit], skill: 'FactualRecall', label: `Word ${n}` }, { seasonId: season, ownerId: unit });
    }
    const question: PbeQuestion = { schemaVersion: 2, id: questionId, version: 1, contentPackId: intro, sourceUnitId: unit, sourceUnitIds: [unit], sourceKind: 'Commentary', reference: 'Intro §1', evidence: 'Alpha and Beta', kind: 'List', prompt: 'Name the labels.', ordered: false, parts: [1, 2].map(n => ({ targetId: tid(n), acceptedAnswers: [n === 1 ? 'Alpha' : 'Beta'], points: 1 })) };
    await store.insert('pbe-question-head', questionId, TEST_ORG, { id: questionId, seasonId: season, published: true, sourceFingerprint: await sourceProof(question, new Map([[unit, { id: unit, canonicalText: 'Alpha and Beta', citation: 'Intro §1' }]])), question }, { seasonId: season, ownerId: unit });
    expect(await (await send('/progress/me/seasons')).json()).toEqual([{ id: season, name: 'Test season' }]);
    expect(await (await send(`/progress/me/today?seasonId=${season}`)).json()).toMatchObject({ format: 'Pbe', mission: { steps: [{ target: 1 }] } });
    const s = await (await send('/study/sessions', { seasonId: season, format: 'Pbe' })).json() as {
        id: string;
    };
    const stored = await store.require<typeof introduction>('pbe-introduction', intro, TEST_ORG);
    await store.put('pbe-introduction', intro, TEST_ORG, stored.value, stored.revision);
    const card = await (await send(`/study/sessions/${s.id}/next`)).json() as {
        id: string;
    };
    expect((await send(`/study/sessions/${s.id}/attempts`, { clientSubmissionId: crypto.randomUUID(), challengeCardId: card.id, answers: ['Alpha', 'wrong'], hintsUsed: false })).status).toBe(200);
    expect((await send(`/study/sessions/${s.id}/complete`, undefined, true)).status).toBe(200);
    const before = await (await send(`/study/sessions/${s.id}/recap`)).json();
    const current = await store.require<typeof introduction>('pbe-introduction', intro, TEST_ORG);
    await store.put('pbe-introduction', intro, TEST_ORG, { ...current.value, reviewed: false }, current.revision);
    expect(await (await send('/progress/me/seasons')).json()).toEqual([]);
    expect((await send('/study/sessions', { seasonId: season, format: 'Pbe' })).status).toBe(409);
    expect(await (await send(`/study/sessions/${s.id}/recap`)).json()).toEqual(before);
});
it('rejects unfinished recaps before and after revocation and atomically rejects late revocation through HTTP', async () => {
    let armed = false;
    const { send, store } = await setup(2, async (sql) => { if (armed && sql.includes("INSERT INTO Records(kind,id,org_id,data) VALUES('audit'")) {
        armed = false;
        await revoke!();
    } });
    const s = await (await send('/study/sessions', { seasonId: season, format: 'Pbe' })).json() as {
        id: string;
    };
    const path = `/study/sessions/${s.id}`;
    expect((await send(path + '/recap')).status).toBe(409);
    const card = await (await send(path + '/next')).json() as {
        id: string;
    };
    const revoke = () => store.remove('assignment', 'assignment', TEST_ORG);
    armed = true;
    expect((await send(path + '/attempts', { clientSubmissionId: crypto.randomUUID(), challengeCardId: card.id, answers: ['Alpha', 'Beta'], hintsUsed: false })).status).toBe(409);
    expect(armed).toBe(false);
    expect((await send(path + '/recap')).status).toBe(409);
    for (const kind of ['pbe-attempt', 'pbe-recall-event', 'training-day'])
        expect((await app.db.prepare('SELECT COUNT(*) AS n FROM Records WHERE kind=?').bind(kind).first<{
            n: number;
        }>())?.n).toBe(0);
    const mission = await store.require<{
        completed: number;
    }>('pbe-daily-mission', s.id, TEST_ORG);
    expect(mission.value.completed).toBe(0);
});
it('keeps Review due-only and refuses source assistance', async () => {
    const { send } = await setup(1);
    expect(await (await send('/study/sessions', { seasonId: season, format: 'Pbe', mode: 'Review' })).json()).toMatchObject({ code: 'PBE_NOTHING_DUE' });
    const s = await (await send('/study/sessions', { seasonId: season, format: 'Pbe' })).json() as {
        id: string;
    };
    const card = await (await send(`/study/sessions/${s.id}/next`)).json() as {
        id: string;
    };
    await send(`/study/sessions/${s.id}/attempts`, { clientSubmissionId: crypto.randomUUID(), challengeCardId: card.id, answers: ['Alpha', 'wrong'], hintsUsed: false });
    const review = await (await send('/study/sessions', { seasonId: season, format: 'Pbe', mode: 'Review' })).json() as {
        id: string;
        mode: string;
    };
    expect(review.mode).toBe('Review');
    const next = await (await send(`/study/sessions/${review.id}/next`)).json() as {
        id: string;
    };
    expect((await send(`/study/sessions/${review.id}/source`, { challengeCardId: next.id })).status).toBe(400);
    expect((await send(`/study/sessions/${review.id}/attempts`, { clientSubmissionId: crypto.randomUUID(), challengeCardId: next.id, answers: ['Alpha', 'Beta'], hintsUsed: false })).status).toBe(200);
});
it('accepts a maximum length start nonce and rejects stale or malformed mission references', async () => {
    const { send } = await setup(1);
    const input = { seasonId: season, format: 'Pbe', mode: 'Practice', training: { clientStartId: 'x'.repeat(200) } };
    const first = await send('/study/sessions', input);
    expect(first.status).toBe(200);
    expect(await (await send('/study/sessions', input)).json()).toEqual(await first.json());
    const keys = await app.db.prepare("SELECT id FROM Records WHERE kind='pbe-session-start'").all<{
        id: string;
    }>();
    expect(keys.results[0].id.length).toBeLessThanOrEqual(200);
    expect((await send('/study/sessions', { ...input, training: { clientStartId: 'other', missionId: tid(999), missionRevision: 1, step: 'Practice' } })).status).toBe(409);
    expect((await send('/study/sessions', { ...input, training: { clientStartId: 'bad', missionRevision: 1 } })).status).toBe(400);
    expect((await app.db.prepare("SELECT COUNT(*) AS n FROM Records WHERE kind='pbe-session'").first<{
        n: number;
    }>())?.n).toBe(1);
});

it('bounds an eight-target acceptance and excluded history growth through full HTTP',async()=>{
 const {send,store}=await setup(1);const row=await store.require<{question:PbeQuestion}>('pbe-question-head',tid(100),TEST_ORG);
 const targets:PbeTarget[]=Array.from({length:8},(_,i)=>({id:tid(20+i),sourceUnitIds:[source],skill:'FactualRecall',label:`Target ${i}`}));for(const t of targets)await store.insert('pbe-target',t.id,TEST_ORG,t,{seasonId:season,ownerId:source});
 const question={...row.value.question,ordered:true,parts:targets.map((t,i)=>({targetId:t.id,points:1,acceptedAnswers:[i%2?'Beta':'Alpha']}))};await store.put('pbe-question-head',tid(100),TEST_ORG,{...row.value,question},row.revision);
 const before=await send('/study/sessions',{seasonId:season,format:'Pbe'});expect(before.status).toBe(200);
 for(const kind of ['pbe-recall-event','pbe-question-head'])await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) SELECT ?, 'excluded-'||value,?,?,?,'{}' FROM json_each(?)").bind(kind,TEST_ORG,season,tid(999),JSON.stringify(Array.from({length:5000},(_,i)=>i))).run();
 const after=await send('/study/sessions',{seasonId:season,format:'Pbe'});expect(after.status).toBe(200);const meter=(r:Response)=>JSON.parse(r.headers.get('x-test-d1-meter')!);expect(meter(after).statements).toBe(meter(before).statements);
 const session=await after.json() as {id:string};const next=await send(`/study/sessions/${session.id}/next`);const card=await next.json() as {id:string};const result=await send(`/study/sessions/${session.id}/attempts`,{clientSubmissionId:crypto.randomUUID(),challengeCardId:card.id,answers:targets.map((_,i)=>i%2?'Beta':'Alpha'),hintsUsed:false});expect(result.status).toBe(200);expect(await result.json()).toMatchObject({earnedPoints:8});
 process.stdout.write('PBE full HTTP eight-target budgets '+JSON.stringify({startBefore:meter(before),startAfterExcluded10000:meter(after),next:meter(next),submitAndDayCredit:meter(result)})+'\n');
});
it('keeps licensed immutable built-in sources available through daily discovery and acceptance',async()=>{
 const {send,store}=await setup(1);const packRow=await store.require<Record<string,unknown>>('pack',pack,TEST_ORG);await store.put('pack',pack,TEST_ORG,{...packRow.value,isBuiltIn:true},packRow.revision);
 await app.db.prepare("INSERT INTO Organizations(id,name,slug) VALUES('00000000-0000-4000-8000-000000000066','Fixture library','fixture-library')").run();
 await app.db.prepare("UPDATE Records SET org_id='00000000-0000-4000-8000-000000000066' WHERE org_id=? AND ((kind='pack' AND id=?) OR (kind='source' AND id=?))").bind(TEST_ORG,pack,source).run();
 const today=await send(`/progress/me/today?seasonId=${season}`);expect(today.status).toBe(200);expect(await today.json()).toMatchObject({format:'Pbe'});
 const started=await send('/study/sessions',{seasonId:season,format:'Pbe'});expect(started.status).toBe(200);const s=await started.json() as {id:string};const card=await (await send(`/study/sessions/${s.id}/next`)).json() as {id:string};expect((await send(`/study/sessions/${s.id}/attempts`,{clientSubmissionId:crypto.randomUUID(),challengeCardId:card.id,answers:['Alpha','Beta'],hintsUsed:false})).status).toBe(200);
});

it('keeps a frozen daily mission discoverable when publication moves outside the personal scope', async () => {
    const { send, store } = await setup(1);
    const scope = await store.require<{ contentPackId: string; includes: unknown[]; excludes: unknown[] }>('scope', season, TEST_ORG);
    await store.put('scope', season, TEST_ORG, { ...scope.value, includes: [{ bookKey: 'GEN', startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 2 }] }, scope.revision);
    const outside = { id: tid(9000), contentPackId: pack, bookKey: 'GEN', chapter: 1, verse: 2, ordinal: 2, citation: 'GEN 1:2', canonicalText: 'Gamma', isActive: true };
    await store.insert('source', outside.id, TEST_ORG, outside, { ownerId: pack });
    const started = await send('/study/sessions', { seasonId: season, format: 'Pbe' });
    expect(started.status).toBe(200);
    const session = await started.json() as { id: string };
    const path = `/study/sessions/${session.id}`;
    const card = await (await send(path + '/next')).json() as { id: string };
    const todayPath = `/progress/me/today?seasonId=${season}`;
    const before = await (await send(todayPath)).json() as { mission: { scopeVersion: string } };
    const target: PbeTarget = { id: tid(9001), sourceUnitIds: [outside.id], skill: 'FactualRecall', label: 'Gamma' };
    await store.insert('pbe-target', target.id, TEST_ORG, target, { seasonId: season, ownerId: outside.id });
    const head = await store.require<{ question: PbeQuestion }>('pbe-question-head', tid(100), TEST_ORG);
    const question: PbeQuestion = { ...head.value.question, version: 2, sourceUnitId: outside.id, sourceUnitIds: [outside.id], reference: outside.citation, evidence: outside.canonicalText, kind: 'ShortAnswer', parts: [{ targetId: target.id, acceptedAnswers: ['Gamma'], points: 1 }] };
    await app.db.prepare("UPDATE Records SET owner_id=?,data=?,revision=revision+1 WHERE kind='pbe-question-head' AND id=? AND org_id=?").bind(outside.id, JSON.stringify({ ...head.value, question, sourceFingerprint: await sourceProof(question, new Map([[outside.id, outside]])) }), question.id, TEST_ORG).run();
    const today = await send(todayPath);
    expect(today.status).toBe(200);
    expect(await today.json()).toMatchObject({ format: 'Pbe', mission: { id: session.id, status: 'Active', scopeVersion: before.mission.scopeVersion, steps: [{ target: 1, completed: 0, sessionId: session.id }] }, nextAction: { sessionId: session.id, mode: 'Practice' } });
    const newStart = await send('/study/sessions', { seasonId: season, format: 'Pbe' });
    expect(newStart.status).toBe(409);
    expect(await newStart.json()).toMatchObject({ code: 'PBE_COVERAGE_UNAVAILABLE' });
    expect(await (await send(path + '/next')).json()).toMatchObject({ id: card.id });
    expect(await (await send(path + '/attempts', { clientSubmissionId: crypto.randomUUID(), challengeCardId: card.id, answers: ['Alpha', 'Beta'], hintsUsed: false })).json()).toMatchObject({ earnedPoints: 2 });
    await store.remove('membership', `${season}:${student}`, TEST_ORG);
    expect(await (await send(todayPath)).json()).toMatchObject({ mission: { status: 'Unavailable' }, nextAction: null });
    expect((await send(path + '/complete', {})).status).toBe(409);
});
