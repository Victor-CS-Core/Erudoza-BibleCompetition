import { handleStudy } from '../study/routes';
import { handleTraining } from './routes';
import { Store } from '../store';
import type { Env, RequestContext } from '../types';
import * as clock from './clock';
// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createNativeTestApp, TEST_ORG, TEST_USER } from '../test-runtime';
let app: Awaited<ReturnType<typeof createNativeTestApp>>, cookie: string;
const season = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', pack = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
async function record(kind: string, id: string, value: unknown, seasonId: string | null = null, owner: string | null = null) { await app.db.prepare('INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) VALUES(?,?,?,?,?,?)').bind(kind, id, TEST_ORG, seasonId, owner, JSON.stringify(value)).run(); }
async function request(path: string, method = 'GET', value?: unknown) { return app.fetch(path, { method, headers: { Cookie: cookie, Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) }); }
async function saved(id: string) {
    return JSON.parse((await app.db.prepare("SELECT data FROM Records WHERE kind='session' AND id=?").bind(id).first<{
        data: string;
    }>())!.data);
}
async function start(training?: unknown) {
    const r = await request('/api/v1/study/sessions', 'POST', { seasonId: season, mode: 'Practice', training });
    expect(r.status).toBe(200);
    return (await r.json() as {
        id: string;
    }).id;
}
async function attempt(id: string, n: number) {
    const r = await request(`/api/v1/study/sessions/${id}/next`);
    expect(r.status).toBe(200);
    const card = await r.json() as {
        id: string;
    };
    const value = { clientSubmissionId: `a${n}`, challengeCardId: card.id, submittedAnswer: 'incorrect', responseTimeMs: 10, hintsUsed: false };
    const result = await request(`/api/v1/study/sessions/${id}/attempts`, 'POST', value);
    expect(result.status).toBe(200);
    return value;
}
async function count(kind: string) {
    return (await app.db.prepare('SELECT count(*) n FROM Records WHERE kind=?').bind(kind).first<{
        n: number;
    }>())!.n;
}
beforeAll(async () => {
    app = await createNativeTestApp();
    await app.db.prepare("UPDATE Users SET kind='Student',role='Student' WHERE id=?").bind(TEST_USER).run();
    cookie = (await app.login()).headers.get('set-cookie')!.split(';')[0];
    await record('season', season, { id: season, name: 'Training', status: 'Active', organizationId: TEST_ORG });
    await record('pack', pack, { id: pack, isActive: true, licensingStatus: 'development-sample' });
    const range = { bookKey: 'GEN', startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 3 };
    await record('scope', season, { contentPackId: pack, includes: [range], excludes: [] });
    await record('assignment', 'assignment', { id: 'assignment', seasonId: season, studentUserId: TEST_USER, contentPackId: pack, type: 'PrimarySpecialist', ...range }, season, TEST_USER);
    for (let i = 1; i <= 3; i++)
        await record('source', `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, '0')}`, { id: `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, '0')}`, knowledgeUnitId: `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, '0')}`, contentPackId: pack, citation: `Genesis 1:${i}`, bookKey: 'GEN', chapter: 1, verse: i, ordinal: i, canonicalText: `Synthetic verse ${i} has words for this exercise.`, isActive: true }, null, pack);
}, 30000);
afterAll(async () => await app?.runtime.dispose());
it('GET preview, honors and journey create no rows; validates student preferences', async () => {
    const before = await count('training-preferences');
    expect((await request('/api/v1/progress/me/today')).status).toBe(200);
    expect((await request(`/api/v1/progress/me/honors?seasonId=${season}`)).status).toBe(200);
    expect((await request(`/api/v1/progress/me/journey?seasonId=${season}`)).status).toBe(200);
    expect(await count('training-preferences')).toBe(before);
    for (const value of [{ weeklyTarget: 2, timeZone: 'UTC' }, { weeklyTarget: 5, timeZone: 'bad' }])
        expect((await request('/api/v1/progress/me/preferences', 'PUT', value)).status).toBe(400);
});
it('deduplicates concurrent start intents and rejects changed payload reuse', async () => { const training = { clientStartId: 'same', timeZone: 'America/New_York', step: 'Practice' }; const ids = await Promise.all([start(training), start(training)]); expect(ids[0]).toBe(ids[1]); expect(await count('daily-mission')).toBe(1); expect((await request('/api/v1/study/sessions', 'POST', { seasonId: season, mode: 'Simulation', training })).status).toBe(400); });
it('partial completion earns no day and recap remains immutable after later study', async () => { const id = await start(); await attempt(id, 0); const complete = await request(`/api/v1/study/sessions/${id}/complete`, 'POST'); expect(complete.status).toBe(200); const recap = await (await request(`/api/v1/study/sessions/${id}/recap`)).json(); expect(recap).toMatchObject({ version: 'training-v1', attempted: 1, fullTargetReached: false, newlyCreditedDay: false }); expect(await count('training-day')).toBe(0); const other = await start(); await attempt(other, 0); expect(await (await request(`/api/v1/study/sessions/${id}/recap`)).json()).toEqual(recap); expect(await (await request(`/api/v1/study/sessions/${id}/complete`, 'POST')).json()).toMatchObject({ status: 'Completed', recap }); });
it('credits exactly one day when two full drills qualify concurrently across seasons and replay is free', async () => {
    const otherSeason='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc';
    const range={bookKey:'GEN',startChapter:1,startVerse:1,endChapter:1,endVerse:3};
    await record('season',otherSeason,{id:otherSeason,name:'Second season',status:'Active',organizationId:TEST_ORG});
    await record('scope',otherSeason,{contentPackId:pack,includes:[range],excludes:[]});
    await record('assignment','assignment-other',{id:'assignment-other',seasonId:otherSeason,studentUserId:TEST_USER,contentPackId:pack,type:'PrimarySpecialist',...range},otherSeason,TEST_USER);
    const second=await request('/api/v1/study/sessions','POST',{seasonId:otherSeason,mode:'Practice'});expect(second.status).toBe(200);
    const ids = [await start(),(await second.json() as {id:string}).id];
    for (let n = 0; n < 7; n++)
        await Promise.all(ids.map(id => attempt(id, n)));
    const payloads = await Promise.all(ids.map(id => attempt(id, 7)));
    expect(await count('training-day')).toBe(1);
    const recaps = await Promise.all(ids.map(async (id) => {
        const r = await request(`/api/v1/study/sessions/${id}/complete`, 'POST');
        expect(r.status).toBe(200);
        return (await r.json() as {
            recap: {
                newlyCreditedDay: boolean;
            };
        }).recap;
    }));
    expect(recaps.filter(r => r.newlyCreditedDay)).toHaveLength(1);
    await request(`/api/v1/study/sessions/${ids[0]}/attempts`, 'POST', payloads[0]);
    const week = JSON.parse((await app.db.prepare("SELECT data FROM Records WHERE kind='training-week'").first<{
        data: string;
    }>())!.data);
    expect(week.creditedDates).toHaveLength(1);
}, 30000);
it('freezes a nonempty review set and counts wrong answers while leaving them due', async () => {
    await app.db.prepare("DELETE FROM Records WHERE kind='daily-mission'").run();
    const startResponse = await request('/api/v1/study/sessions', 'POST', { seasonId: season, mode: 'Review', training: { clientStartId: 'review', step: 'Review' } });
    expect(startResponse.status).toBe(200);
    const { id } = await startResponse.json() as {
        id: string;
    };
    const session = await saved(id);
    expect(session.training.reviewKnowledgeUnitIds.length).toBeGreaterThan(0);
    for (let i = 0; i < session.targetCardCount; i++)
        await attempt(id, i);
    const after = await saved(id);
    expect(new Set(after.attempts.map((a: {
        knowledgeUnitId: string;
    }) => a.knowledgeUnitId)).size).toBe(session.training.reviewKnowledgeUnitIds.length);
    expect(await count('solo-badge-award')).toBeGreaterThan(0);
}, 30000);
it('rolls back attempt and mastery if a training write aborts', async () => {
    const id = await start();
    const card = await (await request(`/api/v1/study/sessions/${id}/next`)).json() as {
        id: string;
    };
    const before = await saved(id), mastery = await app.db.prepare("SELECT data FROM Records WHERE kind='mastery' ORDER BY id").all();
    await app.db.prepare("CREATE TRIGGER training_fail BEFORE UPDATE ON Records WHEN NEW.kind='training-preferences' BEGIN SELECT RAISE(ABORT,'forced training rollback'); END").run();
    try {
        expect((await request(`/api/v1/study/sessions/${id}/attempts`, 'POST', { clientSubmissionId: 'rollback', challengeCardId: card.id, submittedAnswer: 'wrong', responseTimeMs: 0, hintsUsed: false })).status).toBe(503);
        expect(await saved(id)).toEqual(before);
        expect(await app.db.prepare("SELECT data FROM Records WHERE kind='mastery' ORDER BY id").all()).toMatchObject({ results: mastery.results });
    }
    finally {
        await app.db.prepare('DROP TRIGGER training_fail').run();
    }
});
it('preserves invalidated mission revisions and GET does not mint awards after scope shrink', async () => {
    await app.db.prepare("DELETE FROM Records WHERE kind IN ('daily-mission','daily-mission-head')").run();
    const id = await start({ clientStartId: 'scope-before', step: 'Practice' });
    const original = (await saved(id)).training.missionId;
    await app.db.prepare("UPDATE Records SET data=json_set(data,'$.includes[0].endVerse',2),revision=revision+1 WHERE kind='scope'").run();
    const before = await count('solo-badge-award');
    const hq = await (await request(`/api/v1/progress/me/today?seasonId=${season}`)).json() as {
        mission: {
            status: string;
        };
    };
    expect(hq.mission.status).toBe('Invalidated');
    expect(await count('solo-badge-award')).toBe(before);
    expect((await request(`/api/v1/study/sessions/${id}/next`)).status).toBe(409);
    const other = await start({ clientStartId: 'scope-after', step: 'Practice' });
    expect((await saved(other)).training.missionId).not.toBe(original);
    expect(await count('daily-mission')).toBe(2);
    expect(JSON.parse((await app.db.prepare("SELECT data FROM Records WHERE kind='daily-mission' AND id=?").bind(original).first<{
        data: string;
    }>())!.data).invalidated).toBe(true);
    await app.db.prepare("UPDATE Records SET data=json_set(data,'$.includes[0].endVerse',3),revision=revision+1 WHERE kind='scope'").run();
});
it('credits the qualifying Monday event while preserving the Sunday mission date', async () => {
    const mock = vi.spyOn(clock, 'trainingNow').mockReturnValue('2026-09-14T03:55:00.000Z');
    const db = app.db as unknown as Env['DB'];
    const ctx: RequestContext = { env: { DB: db } as Env, store: new Store(db), orgId: TEST_ORG, actor: { userId: TEST_USER, organizationId: TEST_ORG, displayName: 'Student', userName: 'coach', email: null, kind: 'Student', role: 'Student', credentialVersion: 'v1' }, path: '', request: new Request('https://erudoza.test') };
    const call = async (path: string, method = 'GET', value?: unknown) => handleStudy({ ...ctx, path, request: new Request('https://erudoza.test' + path, { method, ...(value === undefined ? {} : { body: JSON.stringify(value) }) }) });
    try {
        // Earlier tests share this database and credit the real current day in real time.
        // Clear the mocked Monday's rows so this test does not depend on what today is.
        await app.db.prepare("DELETE FROM Records WHERE kind IN ('training-day','training-week') AND id=?").bind(`${TEST_ORG}:${TEST_USER}:2026-09-14`).run();
        await app.db.prepare("UPDATE Records SET data=json_set(data,'$.timeZone','America/New_York','$.pending',null) WHERE kind='training-preferences'").run();
        const response = await call('/api/v1/study/sessions', 'POST', { seasonId: season, mode: 'Practice', training: { clientStartId: 'sunday', timeZone: 'America/New_York', step: 'Practice' } });
        const { id } = await response!.json() as {
            id: string;
        };
        for (let n = 0; n < 8; n++) {
            if (n === 7)
                mock.mockReturnValue('2026-09-14T04:01:00.000Z');
            const c = await (await call(`/api/v1/study/sessions/${id}/next`))!.json() as {
                id: string;
            };
            expect((await call(`/api/v1/study/sessions/${id}/attempts`, 'POST', { clientSubmissionId: `midnight-${n}`, challengeCardId: c.id, submittedAnswer: 'wrong', responseTimeMs: 0, hintsUsed: false }))?.status).toBe(200);
        }
        const complete = await (await call(`/api/v1/study/sessions/${id}/complete`, 'POST'))!.json();
        expect(complete).toMatchObject({ recap: { missionLocalDate: '2026-09-13', creditedLocalDate: '2026-09-14', newlyCreditedDay: true } });
        const week = JSON.parse((await app.db.prepare("SELECT data FROM Records WHERE kind='training-week' AND id=?").bind(`${TEST_ORG}:${TEST_USER}:2026-09-14`).first<{
            data: string;
        }>())!.data);
        expect(week.creditedDates).toEqual(['2026-09-14']);
    }
    finally {
        mock.mockRestore();
    }
}, 30000);
it('rejects foreign session ownership and leaves legacy count recaps read only', async () => { await record('session', 'foreign', { id: 'foreign', studentUserId: 'other', seasonId: season, status: 'Completed', mode: 'Practice', attempts: [], cards: [], targetCardCount: 8 }, season, 'other'); expect((await request('/api/v1/study/sessions/foreign/recap')).status).toBe(404); await record('session', 'legacy', { id: 'legacy', studentUserId: TEST_USER, seasonId: season, status: 'Completed', mode: 'Practice', attempts: [], cards: [], targetCardCount: 8 }, season, TEST_USER); const before = await saved('legacy'); expect(await (await request('/api/v1/study/sessions/legacy/recap')).json()).toMatchObject({ version: 'legacy-counts', passageChanges: [], earnedBadges: [], creditedLocalDate: null }); expect(await saved('legacy')).toEqual(before); });
it('rejects a stale mission final card even when that card remains assigned', async () => {
    const id = await start({ clientStartId: 'drawn-stale', step: 'Practice' });
    for (let i = 0; i < 7; i++)
        await attempt(id, i);
    const card = await (await request(`/api/v1/study/sessions/${id}/next`)).json() as {
        id: string;
    };
    const s = await saved(id), savedCard = s.cards.find((c: {
        id: string;
    }) => c.id === card.id), removed = [1, 2, 3].find(n => ![savedCard.sourceUnitId, savedCard.answerSourceUnitId].includes(`dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, '0')}`))!;
    const exclusion = [{ bookKey: 'GEN', startChapter: 1, startVerse: removed, endChapter: 1, endVerse: removed }];
    await app.db.prepare("UPDATE Records SET data=json_set(data,'$.excludes',json(?)),revision=revision+1 WHERE kind='scope'").bind(JSON.stringify(exclusion)).run();
    try {
        expect((await request(`/api/v1/study/sessions/${id}/attempts`, 'POST', { clientSubmissionId: 'stale-final', challengeCardId: card.id, submittedAnswer: 'wrong', responseTimeMs: 0, hintsUsed: false })).status).toBe(409);
        expect((await saved(id)).attempts).toHaveLength(7);
    }
    finally {
        await app.db.prepare("UPDATE Records SET data=json_set(data,'$.excludes',json('[]')),revision=revision+1 WHERE kind='scope'").run();
    }
}, 30000);
it('a drawn duplicate in another review session cannot create next-day credit after mission completion', async () => {
    const mock = vi.spyOn(clock, 'trainingNow').mockReturnValue('2026-09-21T03:50:00.000Z'), db = app.db as unknown as Env['DB'];
    const ctx: RequestContext = { env: { DB: db } as Env, store: new Store(db), orgId: TEST_ORG, actor: { userId: TEST_USER, organizationId: TEST_ORG, displayName: 'Student', userName: 'coach', email: null, kind: 'Student', role: 'Student', credentialVersion: 'v1' }, path: '', request: new Request('https://erudoza.test') };
    const call = async (path: string, method = 'GET', value?: unknown) => handleStudy({ ...ctx, path, request: new Request('https://erudoza.test' + path, { method, ...(value === undefined ? {} : { body: JSON.stringify(value) }) }) });
    const answer = async (id: string, cardId: string, submission: string) => call(`/api/v1/study/sessions/${id}/attempts`, 'POST', { clientSubmissionId: submission, challengeCardId: cardId, submittedAnswer: 'wrong', responseTimeMs: 0, hintsUsed: false });
    try {
        await app.db.prepare("UPDATE Records SET data=json_set(data,'$.timeZone','America/New_York','$.pending',null) WHERE kind='training-preferences'").run();
        const ids = [];
        for (const clientStartId of ['late-review-first', 'late-review-second'])
            ids.push((await (await call('/api/v1/study/sessions', 'POST', { seasonId: season, mode: 'Review', training: { clientStartId, step: 'Review' } }))!.json() as {
                id: string;
            }).id);
        const held = await (await call(`/api/v1/study/sessions/${ids[1]}/next`))!.json() as {
            id: string;
        };
        const target = (await saved(ids[0])).targetCardCount;
        for (let n = 0; n < target; n++) {
            const c = await (await call(`/api/v1/study/sessions/${ids[0]}/next`))!.json() as {
                id: string;
            };
            expect((await answer(ids[0], c.id, `review-${n}`))?.status).toBe(200);
        }
        expect((await saved(ids[0])).training.creditedLocalDate).toBe('2026-09-20');
        mock.mockReturnValue('2026-09-21T04:01:00.000Z');
        expect((await answer(ids[1], held.id, 'late'))?.status).toBe(200);
        expect((await saved(ids[1])).training.creditedLocalDate).toBeNull();
        expect(await app.db.prepare("SELECT data FROM Records WHERE kind='training-day' AND id=?").bind(`${TEST_ORG}:${TEST_USER}:2026-09-21`).first()).toBeNull();
    }
    finally {
        mock.mockRestore();
    }
}, 30000);
it('ordinary start replay metadata does not opt into daily missions',async()=>{const before=await count('daily-mission');const id=await start({clientStartId:'ordinary-replay',timeZone:'UTC'});expect((await saved(id)).training.missionId).toBeNull();expect(await count('daily-mission')).toBe(before);});
it('suggests retained due reviews after a mission scope changes without writing on GET', async () => {
    const changedSeason = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd';
    const range = { bookKey: 'GEN', startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 3 };
    await record('season', changedSeason, { id: changedSeason, name: 'Changed scope', status: 'Active', organizationId: TEST_ORG });
    await record('scope', changedSeason, { contentPackId: pack, includes: [range], excludes: [] });
    await record('assignment', 'assignment-changed', { id: 'assignment-changed', seasonId: changedSeason, studentUserId: TEST_USER, contentPackId: pack, type: 'PrimarySpecialist', ...range }, changedSeason, TEST_USER);
    for (const verse of [1, 3]) {
        const knowledgeUnitId = `dddddddd-dddd-4ddd-8ddd-${String(verse).padStart(12, '0')}`;
        await record('mastery', `changed-mastery-${verse}`, { id: `changed-mastery-${verse}`, knowledgeUnitId, reviewDueAt: '2020-01-01T00:00:00.000Z' }, changedSeason, TEST_USER);
    }
    expect((await request('/api/v1/study/sessions', 'POST', { seasonId: changedSeason, mode: 'Practice', training: { clientStartId: 'changed-due-original', step: 'Practice' } })).status).toBe(200);
    await app.db.prepare("UPDATE Records SET data=json_set(data,'$.includes[0].endVerse',2),revision=revision+1 WHERE kind='scope' AND id=?").bind(changedSeason).run();
    const before = await app.db.prepare('SELECT kind,id,data,revision FROM Records ORDER BY kind,id').all();
    const response = await request(`/api/v1/progress/me/today?seasonId=${changedSeason}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
        mission: { status: 'Invalidated', steps: [{ kind: 'Review', target: 1, completed: 0, status: 'Pending', sessionId: null }, { kind: 'Practice' }] },
        nextAction: { mode: 'Review', sessionId: null },
    });
    expect((await app.db.prepare('SELECT kind,id,data,revision FROM Records ORDER BY kind,id').all()).results).toEqual(before.results);
    const replacement = await request('/api/v1/study/sessions', 'POST', { seasonId: changedSeason, mode: 'Review', training: { clientStartId: 'changed-due-replacement', step: 'Review' } });
    expect(replacement.status).toBe(200);
    expect(await replacement.json()).toMatchObject({ targetCardCount: 1 });
});
it('follows the device timezone for the displayed calendar and heals a default UTC zone on session start', async () => {
    // 2026-09-14T03:55Z is Sunday 23:55 in New York but Monday 03:55 in UTC.
    const mock = vi.spyOn(clock, 'trainingNow').mockReturnValue('2026-09-14T03:55:00.000Z');
    const db = app.db as unknown as Env['DB'];
    const actor = { userId: TEST_USER, organizationId: TEST_ORG, displayName: 'Student', userName: 'coach', email: null, kind: 'Student', role: 'Student', credentialVersion: 'v1' } as const;
    const base = { env: { DB: db } as Env, store: new Store(db), orgId: TEST_ORG, actor } as unknown as RequestContext;
    const callTraining = async (fullPath: string, method = 'GET', value?: unknown) => handleTraining({ ...base, path: fullPath.split('?')[0], request: new Request('https://erudoza.test' + fullPath, { method, headers: { 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) }) });
    const callStudy = async (fullPath: string, method = 'GET', value?: unknown) => handleStudy({ ...base, path: fullPath.split('?')[0], request: new Request('https://erudoza.test' + fullPath, { method, headers: { 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) }) });
    try {
        await app.db.prepare("DELETE FROM Records WHERE kind='training-preferences'").run();
        const before = await (await callTraining('/api/v1/progress/me/today?deviceTimeZone=America%2FNew_York'))!.json() as {
            localDate: string;
            preferences: { timeZone: string };
        };
        expect(before.localDate).toBe('2026-09-13');
        expect(before.preferences.timeZone).toBe('America/New_York');
        // The display read stays side-effect free; nothing is persisted yet.
        expect(await count('training-preferences')).toBe(0);
        const started = await (await callStudy('/api/v1/study/sessions', 'POST', { seasonId: season, mode: 'Practice', training: { clientStartId: 'heal', timeZone: 'America/New_York', step: 'Practice' } }))!.json() as {
            id: string;
        };
        const stored = JSON.parse((await app.db.prepare("SELECT data FROM Records WHERE kind='training-preferences'").first<{
            data: string;
        }>())!.data);
        expect(stored.timeZone).toBe('America/New_York');
        expect(stored.timeZoneSource).toBe('device');
        expect((await saved(started.id)).training.timeZone).toBe('America/New_York');
    }
    finally {
        mock.mockRestore();
    }
}, 30000);
it('does not let the device zone override an explicitly chosen calendar zone', async () => {
    // 2026-09-14T23:30Z is Tuesday in London but still Monday in New York.
    const mock = vi.spyOn(clock, 'trainingNow').mockReturnValue('2026-09-14T23:30:00.000Z');
    const db = app.db as unknown as Env['DB'];
    const actor = { userId: TEST_USER, organizationId: TEST_ORG, displayName: 'Student', userName: 'coach', email: null, kind: 'Student', role: 'Student', credentialVersion: 'v1' } as const;
    const base = { env: { DB: db } as Env, store: new Store(db), orgId: TEST_ORG, actor } as unknown as RequestContext;
    const callTraining = async (fullPath: string, method = 'GET', value?: unknown) => handleTraining({ ...base, path: fullPath.split('?')[0], request: new Request('https://erudoza.test' + fullPath, { method, headers: { 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) }) });
    try {
        await app.db.prepare("DELETE FROM Records WHERE kind='training-preferences'").run();
        expect((await callTraining('/api/v1/progress/me/preferences', 'PUT', { weeklyTarget: 5, timeZone: 'Europe/London' }))!.status).toBe(200);
        const res = await (await callTraining('/api/v1/progress/me/today?deviceTimeZone=America%2FNew_York'))!.json() as {
            localDate: string;
            preferences: { timeZone: string };
        };
        expect(res.preferences.timeZone).toBe('Europe/London');
        expect(res.localDate).toBe('2026-09-15');
    }
    finally {
        mock.mockRestore();
    }
}, 30000);
