// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG } from './test-runtime';
import { atomic } from './application/model';
import { Store } from './store';
import type { RequestContext } from './types';
import type { D1Database } from '@cloudflare/workers-types';
let app: Awaited<ReturnType<typeof createNativeTestApp>>, cookie: string;
beforeAll(async () => { app = await createNativeTestApp(); cookie = (await app.login()).headers.get('set-cookie')!.split(';')[0]; }, 30000);
afterAll(async () => { await app?.runtime.dispose(); });
const call = (path: string, method = 'GET', data?: unknown, auth = cookie) => path === '/content-packs/import' ? app.importFixture(data, auth) : app.fetch(`/api/v1/organizations/${TEST_ORG}${path}`, { method, headers: { Cookie: auth, Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
const passage = { bookKey: 'DAN', startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 2 };
const payload = (packKey: string) => ({ packKey, version: 1, locale: 'en', sourceType: 'Scripture', documents: [{ name: 'Daniel', units: [1, 2, 3].map(n => ({ citation: `Daniel 1:${n}`, bookKey: 'DAN', chapter: 1, verse: n, ordinal: n, text: `This is canonical verse number ${n} for ${packKey}.` })) }] });
it('excludes legacy mastery from current coverage without dropping review evidence',async()=>{
 const {season,pack,student}=await setup('legacy-mastery');await call(`/seasons/${season.id}/assignments`,'POST',{studentUserId:student.userId,contentPackId:pack.id,type:'PrimarySpecialist',range:passage});
 const sources=await (await call(`/content-packs/${pack.id}/source-units`)).json() as {id:string;verse:number}[];const source=sources.find(s=>s.verse===1)!;
 const store=new Store(app.db as unknown as D1Database),value={studentUserId:student.userId,sourceUnitId:source.id,level:'Mastered',algorithmVersion:'v1-scaffold',reviewDueAt:'2020-01-01T00:00:00Z'};
 await store.insert('mastery','legacy-test',TEST_ORG,value,{seasonId:season.id,ownerId:student.userId});
 let coverage=await (await call(`/seasons/${season.id}/coverage`)).json() as {students:{masteredCount:number;reviewDueCount:number}[]};expect(coverage.students[0]).toMatchObject({masteredCount:0,reviewDueCount:1});
 await store.put('mastery','legacy-test',TEST_ORG,{...value,algorithmVersion:'v2-skill-evidence'},1);
 coverage=await (await call(`/seasons/${season.id}/coverage`)).json() as typeof coverage;expect(coverage.students[0].masteredCount).toBe(1);
});
it('atomically rejects assignment writes after a student has become inactive',async()=>{
 const {student,season}=await setup('inactive-transaction');await app.db.prepare('UPDATE Users SET active=0 WHERE id=?').bind(student.userId).run();
 const db=app.db as unknown as D1Database,store=new Store(db),ctx={env:{DB:db},orgId:TEST_ORG,actor:{userId:'coach'},store} as unknown as RequestContext;
 await expect(atomic(ctx,'race-test',[store.insertion('assignment','must-not-exist',TEST_ORG,{studentUserId:student.userId},{seasonId:season.id})],[{kind:'@active-user',id:student.userId,revision:0}])).rejects.toThrow('record changed');
 expect(await store.get('assignment','must-not-exist',TEST_ORG)).toBeNull();
});
async function setup(key: string) {
    const packResponse = await call('/content-packs/import', 'POST', payload(key));
    expect(packResponse.status).toBe(200);
    const pack = await packResponse.json() as {
        id: string;
    };
    const seasonResponse = await call('/seasons', 'POST', { name: key, yearLabel: '2026', ruleProfileKey: 'PBE_STYLE_V1' });
    expect(seasonResponse.status).toBe(201);
    const season = await seasonResponse.json() as {
        id: string;
    };
    const studentResponse = await call('/students', 'POST', { userName: key, displayName: key, password: 'Testing!123' });
    expect(studentResponse.status).toBe(201);
    const student = await studentResponse.json() as {
        userId: string;
    };
    expect((await call(`/seasons/${season.id}/scope`, 'POST', { contentPackId: pack.id, includes: [passage], excludes: [{ ...passage, startVerse: 2 }] })).status).toBe(204);
    return { pack, season, student };
}
it('replays coach setup with exclusion-aware scope, assignments, difficulty, coverage and irreversible lifecycle', async () => {
    const { pack, season, student } = await setup('lifecycle');
    const prefix = `/seasons/${season.id}`;
    const assign = await call(`${prefix}/assignments`, 'POST', { studentUserId: student.userId, contentPackId: pack.id, type: 'PrimarySpecialist', range: passage, difficulty: 'Foundation' });
    expect(assign.status).toBe(200);
    const assignment = await assign.json() as {
        id: string;
    };
    expect((await (await call(prefix)).json() as {
        scopeUnitCount: number;
    }).scopeUnitCount).toBe(1);
    const summaries = await (await call('/seasons')).json() as {
        id: string;
        scopeUnitCount: number;
        assignmentCount: number;
    }[];
    expect(summaries.find(s => s.id === season.id)).toMatchObject({ scopeUnitCount: 1, assignmentCount: 1 });
    const coverage = await (await call(`${prefix}/coverage`)).json() as {
        students: {
            eligibleUnitCount: number;
        }[];
    };
    expect(coverage.students[0].eligibleUnitCount).toBe(1);
    expect((await call(`${prefix}/students/${student.userId}/difficulty`, 'PUT', { difficulty: 'Advanced' })).status).toBe(200);
    expect((await call(`${prefix}/activate`, 'POST')).status).toBe(200);
    expect((await call(`${prefix}/scope`, 'POST', { contentPackId: pack.id, includes: [passage], excludes: [] })).status).toBe(400);
    expect((await call(`${prefix}/assignments/${assignment.id}/passage`, 'PUT', { ...passage, startVerse: 2 })).status).toBe(400);
    expect((await call(`/content-packs/${pack.id}`, 'DELETE')).status).toBe(409);
    expect((await call(`${prefix}/close`, 'POST')).status).toBe(204);
    expect((await call(`${prefix}/assignments/${assignment.id}`, 'DELETE')).status).toBe(400);
    expect((await call(`${prefix}/activate`, 'POST')).status).toBe(400);
    expect((await call(`${prefix}/archive`, 'POST')).status).toBe(204);
    expect((await call(`${prefix}/close`, 'POST')).status).toBe(400);
}, 30000);
it('validates entire import before writes and requires a new version for changed text', async () => {
    const input = payload('rollback');
    input.documents[0].units[2].text = '';
    expect((await call('/content-packs/import', 'POST', input)).status).toBe(400);
    expect(await app.db.prepare("SELECT COUNT(*) AS count FROM Records WHERE kind='pack' AND json_extract(data,'$.packKey')='rollback'").first('count')).toBe(0);
    const first = await call('/content-packs/import', 'POST', payload('immutable'));
    expect(first.status).toBe(200);
    const saved = await first.json() as {
        id: string;
    };
    expect((await (await call('/content-packs/import', 'POST', payload('immutable'))).json() as {
        id: string;
    }).id).toBe(saved.id);
    const changed = payload('immutable');
    changed.documents[0].units[0].text = 'Changed wording';
    expect((await call('/content-packs/import', 'POST', changed)).status).toBe(400);
    expect((await call(`/content-packs/${saved.id}`, 'DELETE')).status).toBe(204);
    expect(await app.db.prepare("SELECT COUNT(*) AS count FROM Records WHERE kind='source' AND owner_id=?").bind(saved.id).first('count')).toBe(0);
});
it('rolls back a content pack and audit when D1 rejects a source in the transactional import', async () => {
    await app.db.prepare("CREATE TRIGGER RejectTestSource BEFORE INSERT ON Records WHEN NEW.kind='source' AND json_extract(NEW.data,'$.canonicalText')='REJECT-THIS-SOURCE' BEGIN SELECT RAISE(ABORT,'test source rejection'); END").run();
    try {
        const input = payload('database-rollback');
        input.documents[0].units[1].text = 'REJECT-THIS-SOURCE';
        expect((await call('/content-packs/import', 'POST', input)).status).toBe(503);
        expect(await app.db.prepare("SELECT count(*) AS count FROM Records WHERE kind='pack' AND json_extract(data,'$.packKey')='database-rollback'").first('count')).toBe(0);
    }
    finally {
        await app.db.prepare('DROP TRIGGER RejectTestSource').run();
    }
});
it('keeps immutable nested session card history from losing its source pack', async () => {
    const response = await call('/content-packs/import', 'POST', payload('session-history'));
    const pack = await response.json() as {
        id: string;
    };
    const sources = await (await call(`/content-packs/${pack.id}/source-units`)).json() as {
        id: string;
    }[];
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,data) VALUES('session','history-session',?,?)").bind(TEST_ORG, JSON.stringify({ cards: [{ sourceUnitId: sources[0].id }] })).run();
    expect((await call(`/content-packs/${pack.id}`, 'DELETE')).status).toBe(409);
});
it('rejects foreign content identifiers and student management while reset and deactivation revoke sessions', async () => {
    const { pack, season, student } = await setup('privacy');
    const foreign = '22222222-2222-4222-8222-222222222222';
    await app.db.prepare('INSERT INTO Organizations(id,name,slug) VALUES(?,?,?)').bind(foreign, 'Foreign', 'foreign').run();
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,data) VALUES('pack','foreign-pack',?,?)").bind(foreign, JSON.stringify({ id: 'foreign-pack', isActive: true })).run();
    expect((await call(`/seasons/${season.id}/scope`, 'POST', { contentPackId: 'foreign-pack', includes: [passage], excludes: [] })).status).toBe(404);
    const login = async (password: string) => (await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test' }, body: JSON.stringify({ identifier: 'privacy', password }) }));
    const studentCookie = (await login('Testing!123')).headers.get('set-cookie')!.split(';')[0];
    expect((await call('/students', 'GET', undefined, studentCookie)).status).toBe(403);
    expect((await call(`/content-packs/${pack.id}/source-units`, 'GET', undefined, studentCookie)).status).toBe(403);
    expect((await call(`/students/${student.userId}/password`, 'POST', { password: 'Changed!123' })).status).toBe(204);
    expect((await app.fetch('/api/v1/me', { headers: { Cookie: studentCookie } })).status).toBe(401);
    const freshCookie = (await login('Changed!123')).headers.get('set-cookie')!.split(';')[0];
    expect((await call(`/students/${student.userId}/state`, 'PUT', { isActive: false })).status).toBe(204);
    expect((await app.fetch('/api/v1/me', { headers: { Cookie: freshCookie } })).status).toBe(401);
    expect((await call(`/seasons/${season.id}/assignments`, 'POST', { studentUserId: student.userId, contentPackId: pack.id, type: 'PrimarySpecialist', range: passage })).status).toBe(400);
}, 30000);
it('retains membership and history after removing a student assignment', async () => {
    const { pack, season, student } = await setup('removal');
    const prefix = `/seasons/${season.id}`;
    const result = await call(`${prefix}/assignments`, 'POST', { studentUserId: student.userId, contentPackId: pack.id, type: 'RequiredCoverage', range: passage });
    const a = await result.json() as {
        id: string;
    };
    expect((await call(`${prefix}/assignments/${a.id}`, 'DELETE')).status).toBe(204);
    expect((await (await call(`${prefix}/assignments`)).json())).toEqual([]);
    expect(await app.db.prepare("SELECT COUNT(*) AS count FROM Records WHERE kind='membership' AND season_id=?").bind(season.id).first('count')).toBe(1);
    expect((await (await call(prefix)).json() as {
        status: string;
    }).status).toBe('ContentReady');
});
