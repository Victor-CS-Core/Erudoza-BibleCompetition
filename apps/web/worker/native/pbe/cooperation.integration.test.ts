// @vitest-environment node
import {writeFile} from 'node:fs/promises';
import {afterEach,expect,it} from 'vitest';
import {createNativeTestApp,TEST_ORG,TEST_USER} from '../test-runtime';
import {Store} from '../store';
import type {Env} from '../types';
import type {PbeQuestion,PbeTarget} from './types';
import {sourceProof} from './bank';
import {prepareRecallEvidence} from './progress';
import {atomic} from '../application/model';
import type {RequestContext} from '../types';
import type {ChapterPage,ContinueChaptersResponse,CooperationSnapshot} from '../../../src/api/pbeTypes';
const season = 'cccccccc-0000-0000-0000-000000000001', student = 'dddddddd-0000-0000-0000-000000000001', pack = 'aaaaaaaa-0000-0000-0000-000000000001', source = 'aaaaaaaa-0000-0000-0000-000000000002';
const tid = (n: number) => `bbbbbbbb-0000-0000-0000-${String(n).padStart(12, '0')}`;
let app: Awaited<ReturnType<typeof createNativeTestApp>>;
const allMeters:Record<string,unknown>[]=[];
afterEach(async () => { await app?.runtime.dispose(); await writeFile('../../.local/d2-native-request-meters.json',JSON.stringify(allMeters,null,2)); });
async function setup(count = 2, beforeD1Statement?: (sql: string) => Promise<void>, options: {replaceSoloAuthority?:boolean} = {}) {
    app = await createNativeTestApp({ measureD1: true, beforeD1Statement, ...options });
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
    const meters:Record<string,unknown>[]=[];
    const send = async (path: string, value?: unknown, empty = false) => { const r = await app.fetch('/api/v1' + path, { method: value === undefined && !empty ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, body: value === undefined || empty ? undefined : JSON.stringify(value) }); const meter = JSON.parse(r.headers.get('x-test-d1-meter')!) as {
        bindingCalls: number;
        statements: number;
    }; const responseText=await r.clone().text(),responseBody=JSON.parse(responseText) as {scopeVersion?:string|null};const sample={path,meterHeaderBytes:new TextEncoder().encode(r.headers.get('x-test-d1-meter')??'').byteLength,...meter,scopeVersion:responseBody.scopeVersion??null,responseBytes:new TextEncoder().encode(responseText).byteLength};meters.push(sample);allMeters.push(sample);if(r.status===503)process.stderr.write(JSON.stringify(sample)+'\n');expect((meter as {maxBoundUtf8Bytes?:number}).maxBoundUtf8Bytes??0).toBeLessThanOrEqual(65536); expect(meter.statements, `${path}: ${JSON.stringify(meter)}`).toBeLessThanOrEqual(50); return r; };
    return { store, send, cookie, meters };
}
async function finish(send:Awaited<ReturnType<typeof setup>>['send'],maxSteps=80){
 let work:ContinueChaptersResponse|null=null;
 for(let n=0;n<maxSteps;n++){const response=await send('/progress/me/chapters/continue',{seasonId:season,...(work?.work.id?{workId:work.work.id}:{})});expect(response.status,await response.clone().text()).toBe(200);work=await response.json() as ContinueChaptersResponse;if(work.next!=='Continue')break;}
 expect(work?.work.state).toBe('Complete');
 const response=await send(`/progress/me/chapters?seasonId=${season}`);expect(response.status,await response.clone().text()).toBe(200);return await response.json() as ChapterPage;
}

it('D2 discovers shared cooperation without creating work and preserves a missing generation denominator',async()=>{
 const {send,store}=await setup();
 const response=await send(`/progress/me/pbe-cooperation?seasonId=${season}`);
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({state:'NotStarted',scripture:null,own:null,work:{id:null}});
 expect(await store.list('pbe-cooperation-work',TEST_ORG,{seasonId:season})).toHaveLength(0);
});
it('D2 rejects a stale guarded chapter selector instead of silently starting unrestricted practice',async()=>{
 const {send}=await setup();
 const response=await send('/study/sessions',{seasonId:season,format:'Pbe',progressScope:{key:'foreign',scopeVersion:'stale'},training:{clientStartId:'stale'}});
 expect(response.status).toBe(409);
 expect(await response.json()).toMatchObject({detail:'PBE_CHAPTER_SCOPE_STALE'});
});
it('D2 rejects progressScope in Memory before creating a session',async()=>{
 const {send}=await setup();
 expect((await send('/study/sessions',{seasonId:season,format:'Memory',progressScope:{key:'foreign',scopeVersion:'stale'}})).status).toBe(400);
});

async function finishCooperation(send:Awaited<ReturnType<typeof setup>>['send'],max=150){
 let workId:string|undefined;
 for(let n=0;n<max;n++){
  const response=await send('/progress/me/pbe-cooperation/continue',{seasonId:season,...(workId?{workId}:{})});
  expect(response.status,await response.clone().text()).toBe(200);
  const value=await response.json() as CooperationSnapshot;workId=value.work.id??undefined;
  if(value.work.next!=='Continue'){expect(['Snapshot','Provisional']).toContain(value.state);return value;}
 }
 throw new Error('Cooperation did not finish');
}
it('D2 publishes unknown source evidence without shrinking assignment counts',async()=>{
 const {send,store}=await setup();const result=await finishCooperation(send);
 expect(result).toMatchObject({state:'Provisional',rosterStudents:1,unknownStudents:1,scripture:{assigned:1,retained:{known:0,possible:1},equalRetained:{lower:0,upper:1,students:1}},own:{state:'Unknown',scripture:{assigned:1,practiced:{known:0,possible:1}}}});
 expect(JSON.stringify(result)).not.toMatch(/studentId|displayName|sourceUnitId|questionId|targetId|witness|acceptedAnswers/);
 expect(await store.list('pbe-chapter-work',TEST_ORG,{seasonId:season})).toEqual([]);
 const read=await send(`/progress/me/pbe-cooperation?seasonId=${season}`);expect(await read.json()).toEqual(result);
},30000);
it('D2 consumes complete D1 without replay and starts/retries an owned progress group',async()=>{
 const {send,store}=await setup();const chapters=await finish(send);
 const result=await finishCooperation(send);
 expect(result).toMatchObject({state:'Snapshot',scripture:{assigned:1,questionCovered:{known:1,possible:1},practiced:{known:0,possible:0},retained:{known:0,possible:0}}});
 const before=await store.require('pbe-chapter-work',`${student}:${season}`,TEST_ORG);
 const row=chapters.items[0] as {actions:{progressScope:{key:string;scopeVersion:string}}[]};
 const input={seasonId:season,format:'Pbe',training:{clientStartId:'chapter-action'},progressScope:row.actions[0].progressScope};
 const started=await send('/study/sessions',input);expect(started.status,await started.clone().text()).toBe(200);
 const session=await started.json();expect(await(await send('/study/sessions',input)).json()).toEqual(session);
 expect((await send('/study/sessions',{...input,progressScope:{...input.progressScope,key:'other'}})).status).toBe(409);
 expect(await store.require('pbe-chapter-work',`${student}:${season}`,TEST_ORG)).toEqual(before);
},30000);
it('D2 freezes captured absence and rejects a generation arriving before publication',async()=>{
 const {send,store}=await setup();
 let workId:string|undefined;
 for(let n=0;n<100;n++){const r=await send('/progress/me/pbe-cooperation/continue',{seasonId:season,...(workId?{workId}:{})});expect(r.status).toBe(200);workId=(await r.json() as CooperationSnapshot).work.id??undefined;const work=await store.require<{stage:string}>('pbe-cooperation-work',season,TEST_ORG);if(work.value.stage==='Publishing')break;}
 await finish(send);
 expect((await send('/progress/me/pbe-cooperation/continue',{seasonId:season,workId})).status).toBe(409);
 expect(await store.list('pbe-cooperation-snapshot',TEST_ORG,{seasonId:season})).toEqual([]);
 const result=await finishCooperation(send);expect(result.state).toBe('Snapshot');
},30000);

async function addStudent(store:Store,n:number,assigned=true){
 const userId=`dddddddd-0000-0000-0000-${String(n).padStart(12,'0')}`;
 await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT ?,org_id,?,?,'Student','Student',password_hash,credential_version FROM Users WHERE id=?").bind(userId,`student-${n}`,`Student ${n}`,TEST_USER).run();
 await store.insert('membership',`${season}:${userId}`,TEST_ORG,{id:`${season}:${userId}`,seasonId:season,userId},{seasonId:season,ownerId:userId});
 if(assigned){const a=await store.require<Record<string,unknown>>('assignment','assignment',TEST_ORG);await store.insert('assignment',`assignment-${n}`,TEST_ORG,{...a.value,id:`assignment-${n}`,studentUserId:userId},{seasonId:season,ownerId:userId});}
 return userId;
}
async function seedRetained(store:Store){
 const ctx={store,env:{DB:store.db},orgId:TEST_ORG,actor:{userId:student,organizationId:TEST_ORG,kind:'Student',role:'Student'},request:new Request('https://erudoza.test'),path:''} as unknown as RequestContext;
 const start=Date.now()-5*86400000;
 for(let n=0;n<2;n++){const attemptId=crypto.randomUUID(),w=await prepareRecallEvidence(ctx,season,'saved',[1,2].map(t=>({attemptId,targetId:tid(t),questionId:tid(100+n),atMs:start+n*172800000,earnedPoints:1,availablePoints:1,unaided:true,recall:true})),'List',{questionVersion:1,responseLockedAtMs:start+n*172800000});await atomic(ctx,'test.accept',w.statements,w.guards);}
}
async function coach(){const cookie=(await app.login()).headers.get('set-cookie')!.split(';')[0];return async(suffix='',body?:unknown)=>app.fetch(`/api/v1/organizations/${TEST_ORG}/seasons/${season}/pbe-cooperation${suffix}`,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:'https://erudoza.test','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});}
it('D2 deduplicates overlap, keeps equal individual weighting, and restricts coach identity detail',async()=>{
 const {send,store,cookie}=await setup();await addStudent(store,2);await addStudent(store,3,false);
 await store.insert('membership',`${season}:${TEST_USER}`,TEST_ORG,{seasonId:season,userId:TEST_USER},{seasonId:season,ownerId:TEST_USER});
 await seedRetained(store);await finish(send);const result=await finishCooperation(send);
 expect(result).toMatchObject({state:'Provisional',rosterStudents:3,unknownStudents:1,scripture:{assigned:1,retained:{known:1,possible:1},equalRetained:{lower:0.5,upper:1,students:2,unknownStudents:1,unassignedStudents:1}},own:{state:'Known',scripture:{retained:{known:1,possible:1}}}});
 const call=await coach();expect((await(await call()).json() as CooperationSnapshot).own).toBeNull();
 const detail=await call('/students?limit=1');expect(detail.status).toBe(200);const page=await detail.json() as {items:{studentId:string}[];nextCursor:string};expect(page.items[0].studentId).toBe(student);expect(page.nextCursor).toBeTruthy();
 const second=await call(`/students?limit=2&after=${encodeURIComponent(page.nextCursor)}`);expect((await second.json() as {items:unknown[]}).items).toHaveLength(2);
 expect((await app.fetch(`/api/v1/organizations/${TEST_ORG}/seasons/${season}/pbe-cooperation/students`,{headers:{Cookie:cookie}})).status).toBe(403);
 expect((await call('/students?limit=33')).status).toBe(400);
},30000);
it('D2 converges concurrent bootstrap and recovers committed work after runtime restart',async()=>{
 const {send}=await setup();const call=await coach();
 const responses=await Promise.all([send('/progress/me/pbe-cooperation/continue',{seasonId:season}),call('/continue',{seasonId:season})]);
 expect(responses.map(r=>r.status)).toEqual([200,200]);const values=await Promise.all(responses.map(r=>r.json())) as CooperationSnapshot[];expect(values[0].work.id).toBe(values[1].work.id);
 await app.restart();const result=await finishCooperation(send);expect(result.snapshotId).toBe(values[0].work.id);expect(await new Store(app.db as unknown as Env['DB']).list('pbe-cooperation-work',TEST_ORG,{seasonId:season})).toHaveLength(1);
},30000);
it.each(['roster','source','bank','dirty'] as const)('D2 invalidates a current aggregate after %s changes, retaining no current counts',async(change)=>{
 const {send,store}=await setup();await finish(send);await finishCooperation(send);
 if(change==='roster')await addStudent(store,2,false);
 if(change==='source'){const row=await store.require<Record<string,unknown>>('source',source,TEST_ORG);await store.put('source',source,TEST_ORG,{...row.value,canonicalText:'Changed'},row.revision);}
 if(change==='bank')await store.insert('pbe-target',tid(3),TEST_ORG,{id:tid(3),sourceUnitIds:[source],skill:'FactualRecall',label:'New'}, {seasonId:season,ownerId:source});
 if(change==='dirty'){const id=`${student}:${season}:${tid(1)}`;await store.insert('pbe-evidence-dirty',id,TEST_ORG,{id,targetId:tid(1),generation:1,completedGeneration:0},{seasonId:season,ownerId:student});}
 const result=await(await send(`/progress/me/pbe-cooperation?seasonId=${season}`)).json() as CooperationSnapshot;
 expect(result).toMatchObject({state:'Updating',scripture:null,introduction:null,own:null,snapshotId:null});
},30000);
it('D2 recaptures a complete but stale personal generation as explicit unknown',async()=>{
 const {send,store}=await setup();await finish(send);
 await store.insert('pbe-target',tid(3),TEST_ORG,{id:tid(3),sourceUnitIds:[source],skill:'FactualRecall',label:'New'}, {seasonId:season,ownerId:source});
 const result=await finishCooperation(send);expect(result).toMatchObject({state:'Provisional',scripture:{assigned:1,retained:{known:0,possible:1}},own:{state:'Unknown'}});
},30000);
it('D2 blocks disabled scope without current detail or new work',async()=>{
 const {send,store}=await setup();await finishCooperation(send);const row=await store.require<Record<string,unknown>>('season',season,TEST_ORG);await store.put('season',season,TEST_ORG,{...row.value,pbeEnabled:false},row.revision);
 expect(await(await send(`/progress/me/pbe-cooperation?seasonId=${season}`)).json()).toMatchObject({state:'Blocked',reason:'PbeDisabled',scripture:null,own:null});
 expect(await(await send('/progress/me/pbe-cooperation/continue',{seasonId:season})).json()).toMatchObject({state:'Blocked',work:{next:'None'}});
 const call=await coach();expect((await call('/students')).status).toBe(409);
},30000);
it('D2 rejects the thirty-third strict roster member before staging any aggregate input',async()=>{
 const {send,store}=await setup();for(let n=2;n<=33;n++)await addStudent(store,n,false);
 expect(await(await send('/progress/me/pbe-cooperation/continue',{seasonId:season})).json()).toMatchObject({state:'Blocked',reason:'ScopeTooLarge'});
 expect(await store.list('pbe-cooperation-manifest',TEST_ORG,{seasonId:season})).toEqual([]);
},30000);
it('D2 resource pages keep 130 unknown source pairs bounded and charge every whole page and snapshot',async()=>{
 const {send,store,meters}=await setup();
 const unit=(await store.require<Record<string,unknown>>('source',source,TEST_ORG)).value;
 await app.db.batch(Array.from({length:129},(_,i)=>{const id=tid(6000+i);return store.insertion('source',id,TEST_ORG,{...unit,id,verse:i+2,ordinal:i+2,citation:`GEN 1:${i+2}`},{ownerId:pack});}));
 const assigned=await store.require<Record<string,unknown>>('assignment','assignment',TEST_ORG);await store.put('assignment','assignment',TEST_ORG,{...assigned.value,endVerse:130},assigned.revision);
 const scoped=await store.require<Record<string,unknown>>('scope',season,TEST_ORG);await store.put('scope',season,TEST_ORG,{contentPackId:pack,includes:[{bookKey:'GEN',startChapter:1,startVerse:1,endChapter:1,endVerse:130}],excludes:[]},scoped.revision);
 const result=await finishCooperation(send);expect(result.scripture).toMatchObject({assigned:130,retained:{known:0,possible:130}});
 const pages=await store.list<{bytes:number;entries:unknown[]}>('pbe-cooperation-manifest',TEST_ORG,{seasonId:season});
 expect(pages.length).toBeGreaterThan(3);for(const page of pages){expect(page.entries.length).toBeLessThanOrEqual(128);expect(new TextEncoder().encode(JSON.stringify(page)).byteLength).toBe(page.bytes);expect(page.bytes).toBeLessThanOrEqual(65536);}
 const work=(await store.require<{bytes:number;guardBytes:number}>('pbe-cooperation-work',season,TEST_ORG)).value,snapshot=(await store.require('pbe-cooperation-snapshot',result.snapshotId!,TEST_ORG)).value;
 expect(work.bytes).toBe(pages.reduce((n,p)=>n+p.bytes,0)+new TextEncoder().encode(JSON.stringify(snapshot)).byteLength);
 expect(work.guardBytes).toBeLessThanOrEqual(16*1024*1024);
 const ordinary=meters.filter(m=>m.path==='/progress/me/pbe-cooperation/continue'&&!m.scopeVersion);expect(Math.max(...ordinary.map(m=>Number(m.returnedRows)))).toBeLessThanOrEqual(128);expect(Math.max(...ordinary.map(m=>Number(m.returnedBytes)))).toBeLessThanOrEqual(65536);expect(Math.max(...ordinary.map(m=>Number(m.maxReturnedPayloadBytes)))).toBeLessThanOrEqual(65536);
},30000);
it.each(['bytes','guardBytes'] as const)('D2 resource %s overflow blocks before a new page or cursor is persisted',async(field)=>{
 const {send,store}=await setup();const first=await(await send('/progress/me/pbe-cooperation/continue',{seasonId:season})).json() as CooperationSnapshot;
 const old=await store.require<Record<string,unknown>>('pbe-cooperation-work',season,TEST_ORG);await store.put('pbe-cooperation-work',season,TEST_ORG,{...old.value,[field]:(field==='bytes'?32:16)*1024*1024},old.revision);
 const response=await send('/progress/me/pbe-cooperation/continue',{seasonId:season,workId:first.work.id});expect(await response.json()).toMatchObject({state:'Blocked',reason:'InputTooLarge'});
 const blocked=(await store.require<Record<string,unknown>>('pbe-cooperation-work',season,TEST_ORG)).value;expect(blocked.after).toBe('');expect(blocked.pageCount).toBe(0);expect(await store.list('pbe-cooperation-manifest',TEST_ORG,{seasonId:season})).toEqual([]);
},30000);

it('D2 reports atomic guarded-start changes as a stale chapter scope and writes no session',async()=>{
 let armed=false,changed=false;const {send,store}=await setup(2,async sql=>{if(armed&&!changed&&sql.includes("VALUES('pbe-session-start'")){changed=true;const row=await store.require<Record<string,unknown>>('pbe-chapter-work',`${student}:${season}`,TEST_ORG);await store.put('pbe-chapter-work',`${student}:${season}`,TEST_ORG,row.value,row.revision);}});
 const chapters=await finish(send),row=chapters.items[0] as {actions:{progressScope:{key:string;scopeVersion:string}}[]};armed=true;
 const response=await send('/study/sessions',{seasonId:season,format:'Pbe',progressScope:row.actions[0].progressScope,training:{clientStartId:'race'}});
 expect(changed).toBe(true);expect(response.status).toBe(409);expect(await response.json()).toMatchObject({detail:'PBE_CHAPTER_SCOPE_STALE'});expect(await store.list('pbe-session',TEST_ORG,{seasonId:season})).toEqual([]);expect(await store.list('pbe-session-start',TEST_ORG,{seasonId:season})).toEqual([]);
},30000);
it('D2 accepts the full 32-person roster with bounded long display names',async()=>{
 const {send,store}=await setup();for(let n=2;n<=32;n++)await addStudent(store,n,false);
 await app.db.prepare("UPDATE Users SET display_name=? WHERE kind='Student'").bind('漢'.repeat(200)).run();
 const first=await send('/progress/me/pbe-cooperation/continue',{seasonId:season});expect(first.status).toBe(200);expect(await first.json()).toMatchObject({state:'Updating',reason:null});
 expect((await store.require<{roster:unknown[]}>('pbe-cooperation-work',season,TEST_ORG)).value.roster).toHaveLength(32);
 const result=await finishCooperation(send,450);expect(result.rosterStudents).toBe(32);const call=await coach();const detail=await call('/students?limit=32');expect(detail.status).toBe(200);expect((await detail.json() as {items:unknown[]}).items).toHaveLength(32);
},60000);
it('D2 rechecks the assignment cap after bootstrap before publishing',async()=>{
 const {send,store}=await setup();let workId:string|undefined;
 for(let n=0;n<40;n++){const r=await send('/progress/me/pbe-cooperation/continue',{seasonId:season,...(workId?{workId}:{})});expect(r.status).toBe(200);workId=(await r.json() as CooperationSnapshot).work.id??undefined;if((await store.require<{stage:string}>('pbe-cooperation-work',season,TEST_ORG)).value.stage==='Publishing')break;}
 await app.db.prepare("WITH RECURSIVE n(i) AS(VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<10000) INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) SELECT 'assignment','extra-'||i,?,?,?,json_object('id','extra-'||i) FROM n").bind(TEST_ORG,season,student).run();
 const response=await send('/progress/me/pbe-cooperation/continue',{seasonId:season,workId});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({state:'Blocked',reason:'ScopeTooLarge'});expect(await store.list('pbe-cooperation-snapshot',TEST_ORG,{seasonId:season})).toEqual([]);
},30000);

async function manySources(store:Store,count:number){
 await app.db.prepare("WITH RECURSIVE n(i) AS(VALUES(2) UNION ALL SELECT i+1 FROM n WHERE i<?) INSERT INTO Records(kind,id,org_id,owner_id,data) SELECT 'source','large-source-'||i,org_id,owner_id,json_set(data,'$.id','large-source-'||i,'$.verse',i,'$.ordinal',i) FROM Records,n WHERE kind='source' AND id=?").bind(count,source).run();
 for(const [kind,id] of [['scope',season],['assignment','assignment']]){const row=await store.require<Record<string,unknown>>(kind,id,TEST_ORG),range={bookKey:'GEN',startChapter:1,startVerse:1,endChapter:1,endVerse:count};await store.put(kind,id,TEST_ORG,kind==='scope'?{...row.value,includes:[range]}:{...row.value,...range},row.revision);}
}
it.each(['sources','pairs','assignments','introductions'] as const)('D2 cardinality %s cap blocks before staging',async(field)=>{
 const {send,store}=await setup();
 if(field==='sources')await manySources(store,10001);
 if(field==='pairs'){await manySources(store,5001);for(let n=2;n<=10;n++)await addStudent(store,n);}
 if(field==='assignments'||field==='introductions')await app.db.prepare("WITH RECURSIVE n(i) AS(VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<=10000) INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) SELECT ?,'overflow-'||i,?,?,?,json_object('id','overflow-'||i) FROM n").bind(field==='assignments'?'assignment':'pbe-introduction-assignment',TEST_ORG,season,student).run();
 const response=await send('/progress/me/pbe-cooperation/continue',{seasonId:season});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({state:'Blocked',reason:'ScopeTooLarge'});expect(await store.list('pbe-cooperation-manifest',TEST_ORG,{seasonId:season})).toEqual([]);
},60000);
it('D2 keeps introduction-only denominators separate and invalidates removed pages and coach cursors',async()=>{
 const {send,store}=await setup();await store.remove('assignment','assignment',TEST_ORG);const intro=tid(8000);
 await store.insert('pbe-introduction',intro,TEST_ORG,{id:intro,organizationId:TEST_ORG,seasonId:season,bookKey:'GEN',reviewed:true,licensingStatus:'approved',units:[{id:tid(8001),citation:'Introduction',canonicalText:'Context'}]},{seasonId:season});
 await store.insert('pbe-introduction-assignment','intro',TEST_ORG,{id:'intro',contentPackId:intro},{seasonId:season,ownerId:student});
 const snapshot=await finishCooperation(send);expect(snapshot).toMatchObject({state:'Provisional',scripture:{assigned:0,equalRetained:null},introduction:{assigned:1,retained:{known:0,possible:1}},own:{scripture:{assigned:0},introduction:{assigned:1}}});
 const pages=await store.list<{id:string}>('pbe-cooperation-manifest',TEST_ORG,{seasonId:season});await store.remove('pbe-cooperation-manifest',pages[0].id,TEST_ORG);
 expect(await(await send(`/progress/me/pbe-cooperation?seasonId=${season}`)).json()).toMatchObject({state:'Updating',scripture:null});const call=await coach();expect((await call('/students')).status).toBe(409);
},30000);
it('D2 guarded chapter start includes wholly assigned cross-chapter questions and rejects excluded-source stale actions',async()=>{
 const {send,store}=await setup();const second=tid(8000),unit=(await store.require<{id:string;contentPackId:string;bookKey:string;chapter:number;verse:number;ordinal:number;citation:string;canonicalText:string;isActive:boolean}>('source',source,TEST_ORG)).value,other={...unit,id:second,chapter:2,ordinal:2,citation:'GEN 2:1'};
 await store.insert('source',second,TEST_ORG,other,{ownerId:pack});const range={bookKey:'GEN',startChapter:1,startVerse:1,endChapter:2,endVerse:1};
 for(const [kind,id] of [['scope',season],['assignment','assignment']]){const row=await store.require<Record<string,unknown>>(kind,id,TEST_ORG);await store.put(kind,id,TEST_ORG,kind==='scope'?{...row.value,includes:[range]}:{...row.value,...range},row.revision);}
 for(const id of [tid(1),tid(2)]){const row=await store.require<PbeTarget>('pbe-target',id,TEST_ORG);await store.put('pbe-target',id,TEST_ORG,{...row.value,sourceUnitIds:[source,second]},row.revision);}
 for(const id of [tid(100),tid(101)]){const row=await store.require<{question:PbeQuestion;sourceFingerprint:string}>('pbe-question-head',id,TEST_ORG),question={...row.value.question,sourceUnitIds:[source,second],reference:'GEN 1:1; GEN 2:1'};await store.put('pbe-question-head',id,TEST_ORG,{...row.value,question,sourceFingerprint:await sourceProof(question,new Map([[source,unit],[second,other]]))},row.revision);}
 const chapters=await finish(send),row=chapters.items[0] as {actions:{progressScope:{key:string;scopeVersion:string}}[]};
 const response=await send('/study/sessions',{seasonId:season,format:'Pbe',progressScope:row.actions[0].progressScope,training:{clientStartId:'span'}});expect(response.status,await response.clone().text()).toBe(200);
 const saved=(await store.list<{cards:{question:PbeQuestion}[]}>('pbe-session',TEST_ORG,{seasonId:season}))[0];expect(saved.cards.length).toBeGreaterThan(0);expect(saved.cards.every(c=>c.question.sourceUnitIds.includes(second))).toBe(true);
 const scoped=await store.require<Record<string,unknown>>('scope',season,TEST_ORG);await store.put('scope',season,TEST_ORG,{...scoped.value,excludes:[{bookKey:'GEN',startChapter:2,startVerse:1,endChapter:2,endVerse:1}]},scoped.revision);
 expect((await send('/study/sessions',{seasonId:season,format:'Pbe',progressScope:row.actions[0].progressScope,training:{clientStartId:'excluded'}})).status).toBe(409);expect(await store.list('pbe-session',TEST_ORG,{seasonId:season})).toHaveLength(1);
},30000);

it('D2 resource whole cleanup request includes authorization and work rows within its 128-row budget',async()=>{
 const {send,store,meters}=await setup();const first=await(await send('/progress/me/pbe-cooperation/continue',{seasonId:season})).json() as CooperationSnapshot,abandonedId=crypto.randomUUID();
 const old=await store.require<Record<string,unknown>>('pbe-cooperation-work',season,TEST_ORG);await store.put('pbe-cooperation-work',season,TEST_ORG,{...old.value,abandonedId},old.revision);
 await app.db.prepare("WITH RECURSIVE n(i) AS(VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<130) INSERT INTO Records(kind,id,org_id,season_id,data) SELECT 'pbe-cooperation-manifest',?||':sources:'||printf('%06d',i),?,?,json_object('generationId',?,'entries',json('[]')) FROM n").bind(abandonedId,TEST_ORG,season,abandonedId).run();
 for(let i=0;i<3;i++){const response=await send('/progress/me/pbe-cooperation/continue',{seasonId:season,workId:first.work.id});expect(response.status).toBe(200);}
 const cleanup=meters.slice(1);expect(Math.max(...cleanup.map(m=>Number(m.returnedRows)))).toBeLessThanOrEqual(128);expect(Math.max(...cleanup.map(m=>Number(m.returnedBytes)))).toBeLessThanOrEqual(65536);
 expect(await store.list('pbe-cooperation-manifest',TEST_ORG,{seasonId:season})).toEqual([]);expect((await store.require<{abandonedId:string|null}>('pbe-cooperation-work',season,TEST_ORG)).value.abandonedId).toBeNull();
},30000);
