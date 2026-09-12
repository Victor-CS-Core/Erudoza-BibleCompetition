// @vitest-environment node
import { readFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from 'vitest';
import { createNativeTestApp, TEST_ORG, TEST_USER } from '../test-runtime';
import { Store } from '../store';
import type { Env, RequestContext } from '../types';
import { HttpError } from '../types';
import { pbeRoutes } from './routes';
import { loadPbeBank, sourceProof } from './bank';
import fixtures from './rubric-fixtures.json';
const season='cccccccc-0000-0000-0000-000000000001', student='dddddddd-0000-0000-0000-000000000001';
const a='aaaaaaaa-0000-0000-0000-000000000003',b='bbbbbbbb-0000-0000-0000-000000000006',pack='00000000-0000-0000-0000-000000000002';
const target={id:'00000000-0000-0000-0000-000000000004',sourceUnitIds:[a,b],skill:'FactualRecall',label:'Both labels'};
const question={...fixtures.cases[0].question,id:'00000000-0000-0000-0000-000000000001',contentPackId:pack,sourceUnitId:a,sourceUnitIds:[a,b],kind:'ShortAnswer',reference:'GEN 1:1; GEN 1:2',evidence:'Alpha and Beta',parts:[{targetId:target.id,acceptedAnswers:['Alpha and Beta'],points:1}]};
let app:Awaited<ReturnType<typeof createNativeTestApp>>;
afterEach(async()=>{await app?.runtime.dispose();});
async function setup(){
 app=await createNativeTestApp();const store=new Store(app.db as unknown as Env['DB']);
 const cookie=(await app.login()).headers.get('set-cookie')!.split(';')[0];
 const base=`/api/v1/organizations/${TEST_ORG}/practice/pbe/seasons/${season}`;
 const send=(path:string,value?:unknown)=>app.fetch(base+path,{method:value===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:'https://erudoza.test','Content-Type':'application/json'},body:value===undefined?undefined:JSON.stringify(value)});
 await store.insert('season',season,TEST_ORG,{id:season,organizationId:TEST_ORG,status:'Active',pbeEnabled:true});
 await store.insert('pack',pack,TEST_ORG,{id:pack,isActive:true,licensingStatus:'approved',sourceType:'Scripture'});
 for(const [id,verse] of [[a,1],[b,2]] as const)await store.insert('source',id,TEST_ORG,{id,contentPackId:pack,bookKey:'GEN',chapter:1,verse,ordinal:verse,citation:`GEN 1:${verse}`,canonicalText:'Alpha and Beta',isActive:true},{ownerId:pack});
 const range={bookKey:'GEN',startChapter:1,startVerse:1,endChapter:1,endVerse:2};
 await store.insert('scope',season,TEST_ORG,{contentPackId:pack,includes:[range],excludes:[]});
 await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT ?,org_id,'pbe-student','Student','Student','Student',password_hash,credential_version FROM Users WHERE id=?").bind(student,TEST_USER).run();
 await store.insert('assignment','assignment',TEST_ORG,{id:'assignment',seasonId:season,studentUserId:student,contentPackId:pack,...range,endVerse:1},{seasonId:season,ownerId:student});
 const ctx={store,env:{DB:app.db},orgId:TEST_ORG,actor:{userId:TEST_USER,organizationId:TEST_ORG,kind:'Adult',role:'Owner'},request:new Request('https://erudoza.test'),path:''} as unknown as RequestContext;
 return {store,send,ctx,scope:{organizationId:TEST_ORG,seasonId:season,studentId:student,sourceUnitIds:[a,b]}};
}
it('imports and publishes through HTTP without legacy Team Practice, respects all sources and hides keys',async()=>{
 const {send,ctx,scope}=await setup();
 expect((await send('/questions/import',{questions:[question],targets:[target]})).status).toBe(204);
 expect((await loadPbeBank(ctx,{...scope,studentId:undefined})).questions).toHaveLength(0);
 expect((await send(`/questions/${question.id}/1/publish`,{})).status).toBe(204);
 expect((await loadPbeBank(ctx,{...scope,studentId:undefined})).questions).toHaveLength(1);
 expect((await loadPbeBank(ctx,scope)).questions).toHaveLength(0);
 const response=await send('/bank');expect(response.status).toBe(200);const text=await response.text();expect(text).toContain('questionCount');expect(text).not.toMatch(/acceptedAnswers|evidence|Alpha|parts/);
});
it('rejects untrusted JSON and casing duplicates and requires current licensed active scope',async()=>{
 const {send,ctx,scope,store}=await setup();
 expect((await send('/questions/import',{questions:[{...question,sourceUnitIds:null}],targets:[target]})).status).toBe(400);
 expect((await send('/questions/import',{questions:[{...question,sourceUnitId:a.toUpperCase(),sourceUnitIds:[a.toUpperCase(),b]}],targets:[target]})).status).toBe(204);
 expect((await send(`/questions/${question.id}/1/publish`,{})).status).toBe(204);
 await expect(loadPbeBank(ctx,{...scope,organizationId:crypto.randomUUID()})).rejects.toThrow();
 const assignment=await store.require<Record<string,unknown>>('assignment','assignment',TEST_ORG);await store.put('assignment','assignment',TEST_ORG,{...assignment.value,endVerse:2},assignment.revision);
 expect((await loadPbeBank(ctx,scope)).questions).toHaveLength(1);
 await store.remove('assignment','assignment',TEST_ORG);expect((await loadPbeBank(ctx,scope)).questions).toHaveLength(0);
 const p=await store.require<Record<string,unknown>>('pack',pack,TEST_ORG);await store.put('pack',pack,TEST_ORG,{...p.value,licensingStatus:'pending'},p.revision);expect((await loadPbeBank(ctx,{...scope,studentId:undefined})).questions).toHaveLength(0);
 const s=await store.require<Record<string,unknown>>('season',season,TEST_ORG);await store.put('season',season,TEST_ORG,{...s.value,status:'Archived'},s.revision);await expect(loadPbeBank(ctx,scope)).rejects.toThrow();
});
it('paginates 5,101 questions and targets with reads independent of unrelated student history',async()=>{
 const {ctx,scope}=await setup();
 const proof=await sourceProof({...question,sourceUnitIds:[a],reference:'GEN 1:1'} as never,new Map([[a,{id:a,canonicalText:'Alpha and Beta',citation:'GEN 1:1'} as never]]));
 const rows=Array.from({length:5101},(_,i)=>{const id=`00000000-0000-0000-0001-${String(i+1).padStart(12,'0')}`,tid=`00000000-0000-0000-0002-${String(i+1).padStart(12,'0')}`;return {id:`${id}:1`,seasonId:season,published:true,sourceFingerprint:proof,question:{...question,id,reference:'GEN 1:1',sourceUnitIds:[a],parts:[{targetId:tid,acceptedAnswers:['Alpha'],points:1}]},target:{...target,id:tid,sourceUnitIds:[a]}};});
 for(let i=0;i<rows.length;i+=200){const page=rows.slice(i,i+200);await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) SELECT 'pbe-question-head',json_extract(value,'$.question.id'),?,?,json_extract(value,'$.question.sourceUnitId'),json_remove(value,'$.target') FROM json_each(?)").bind(TEST_ORG,season,JSON.stringify(page)).run();await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) SELECT 'pbe-target',json_extract(value,'$.target.id'),?,?,json_extract(value,'$.target.sourceUnitIds[0]'),json_extract(value,'$.target') FROM json_each(?)").bind(TEST_ORG,season,JSON.stringify(page)).run();}
 const measure=async()=>{let reads=0,pages=0;const database=ctx.env.DB;
  const wrap=(statement:ReturnType<Env['DB']['prepare']>):ReturnType<Env['DB']['prepare']>=>new Proxy(statement,{get(object,key){if(key==='bind')return (...values:unknown[])=>wrap(object.bind(...values));if(key==='first')return async(column?:string)=>{const result=await object.all<Record<string,unknown>>();reads+=result.meta.rows_read??0;pages++;return column?result.results[0]?.[column]??null:result.results[0]??null;};if(key==='all')return async()=>{const result=await object.all();reads+=result.meta.rows_read??0;pages++;return result;};const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;}});
  const measured=new Proxy(database,{get(object,key){if(key==='prepare')return (sql:string)=>wrap(object.prepare(sql));const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;}});
  const bank=await loadPbeBank({...ctx,env:{...ctx.env,DB:measured},store:new Store(measured)},scope);expect(bank.questions).toHaveLength(5101);expect(bank.targets).toHaveLength(5101);expect(pages).toBeGreaterThan(12);return {reads,pages};};
 const before=await measure();
 await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) SELECT 'pbe-progress',CAST(value AS TEXT),?,?,?,'{}' FROM json_each(?)").bind(TEST_ORG,season,student,JSON.stringify(Array.from({length:10000},(_,i)=>i))).run();
 // Same-season questions and targets anchored in excluded source B cannot dominate the one-source bank.
 await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) SELECT kind,'excluded-'||id,org_id,season_id,?,data FROM Records WHERE kind IN ('pbe-question-head','pbe-target') AND owner_id=?").bind(b,a).run();
 const after=await measure();expect(after.reads).toBeLessThanOrEqual(before.reads+4);expect(after.reads).toBeLessThan(22000);expect(after.pages).toBeLessThan(50);
 process.stdout.write('PBE read budget '+JSON.stringify({before,after})+'\n');
});
it('rejects scope changes between pages and rechecks active students and season opt-in',async()=>{
 const {ctx,scope,store}=await setup();const original=store.require.bind(store);let calls=0;
 const spy=vi.spyOn(store,'require').mockImplementation(async(kind,id,org)=>{if(kind==='season'&&++calls===3){const sc=await original('scope',season,TEST_ORG);await store.put('scope',season,TEST_ORG,{...(sc.value as object),excludes:[{bookKey:'GEN',startChapter:1,startVerse:1,endChapter:1,endVerse:1}]},sc.revision);}return await original(kind,id,org) as never;});
 await expect(loadPbeBank(ctx,scope)).rejects.toThrow(/changed/);spy.mockRestore();
 await app.db.prepare('UPDATE Users SET active=0 WHERE id=?').bind(student).run();await expect(loadPbeBank(ctx,scope)).rejects.toThrow(/Active student/);
 await app.db.prepare('UPDATE Users SET active=1 WHERE id=?').bind(student).run();const s=await store.require<Record<string,unknown>>('season',season,TEST_ORG);await store.put('season',season,TEST_ORG,{...s.value,pbeEnabled:false},s.revision);await expect(loadPbeBank(ctx,scope)).rejects.toThrow(/not enabled/);
});
it('keeps the latest published head across primary-source moves and out-of-order publication',async()=>{
 const {send,ctx,scope}=await setup();
 const ta={...target,sourceUnitIds:[a]},tb={...target,id:crypto.randomUUID(),sourceUnitIds:[b]};
 const first={...question,sourceUnitIds:[a],reference:'GEN 1:1'};
 const second={...question,version:2,sourceUnitId:b,sourceUnitIds:[b],reference:'GEN 1:2',parts:[{...question.parts[0],targetId:tb.id}]};
 expect((await send('/questions/import',{questions:[first],targets:[ta]})).status).toBe(204);
 expect((await send('/questions/import',{questions:[second],targets:[tb]})).status).toBe(204);
 expect((await send(`/questions/${question.id}/1/publish`,{})).status).toBe(204);
 expect((await loadPbeBank(ctx,scope)).questions).toHaveLength(1);
 const concurrent=await Promise.all([send(`/questions/${question.id}/2/publish`,{}),send(`/questions/${question.id}/1/publish`,{})]);expect(concurrent.every(r=>[204,409].includes(r.status))).toBe(true);
 expect((await send(`/questions/${question.id}/2/publish`,{})).status).toBe(204);
 expect((await loadPbeBank(ctx,scope)).questions).toHaveLength(0);
 expect((await send(`/questions/${question.id}/1/publish`,{})).status).toBe(204);
 expect((await loadPbeBank(ctx,scope)).questions).toHaveLength(0);
 const all=await loadPbeBank(ctx,{...scope,studentId:undefined});expect(all.questions.map(q=>q.version)).toEqual([2]);
 const head=await app.db.prepare("SELECT owner_id FROM Records WHERE kind='pbe-question-head' AND id=?").bind(question.id).first<{owner_id:string}>();expect(head?.owner_id).toBe(b);
});
it('rejects fabricated evidence and invalidates even still-present excerpts after source edits',async()=>{
 const {send,ctx,scope,store}=await setup();
 expect((await send('/questions/import',{questions:[{...question,evidence:'Invented evidence'}],targets:[target]})).status).toBe(400);
 expect((await send('/questions/import',{questions:[question],targets:[target]})).status).toBe(204);
 expect((await send(`/questions/${question.id}/1/publish`,{})).status).toBe(204);
 expect((await loadPbeBank(ctx,{...scope,studentId:undefined})).questions).toHaveLength(1);
 const s=await store.require<Record<string,unknown>>('source',a,TEST_ORG);await store.put('source',a,TEST_ORG,{...s.value,canonicalText:'Alpha and Beta additional words'},s.revision);
 expect((await loadPbeBank(ctx,{...scope,studentId:undefined})).questions).toHaveLength(0);
 expect((await send(`/questions/${question.id}/1/publish`,{})).status).toBe(409);
});
it('student HTTP exposes assigned metadata only, default-disabled and foreign-student scope are denied',async()=>{
 const {send,ctx,scope,store}=await setup();
 const login=await app.fetch('/api/v1/auth/login',{method:'POST',headers:{Origin:'https://erudoza.test','Content-Type':'application/json'},body:JSON.stringify({identifier:'pbe-student',password:'Testing!123'})});const cookie=login.headers.get('set-cookie')!.split(';')[0];
 const path=`/api/v1/organizations/${TEST_ORG}/practice/pbe/seasons/${season}`;
 const get=()=>app.fetch(path+'/bank',{headers:{Cookie:cookie}});
 expect((await send('/questions/import',{questions:[question],targets:[target]})).status).toBe(204);expect((await send(`/questions/${question.id}/1/publish`,{})).status).toBe(204);
 const response=await get();expect(response.status).toBe(200);expect(await response.json()).toEqual({questionCount:0,targetCount:0,sourceUnitCount:1,missingSourceUnitIds:[a]});
 const studentCtx={...ctx,actor:{...ctx.actor,userId:student,kind:'Student',role:'Student'}} as RequestContext;
 await expect(loadPbeBank(studentCtx,{...scope,studentId:TEST_USER})).rejects.toThrow(/own assigned/);
 const s=await store.require<Record<string,unknown>>('season',season,TEST_ORG);const {pbeEnabled:_flag,...legacy}=s.value;void _flag;await store.put('season',season,TEST_ORG,legacy,s.revision);expect((await get()).status).toBe(403);
});
it('keeps legacy import isolated and additive native migration idempotent without rewriting history',async()=>{
 const {ctx,store}=await setup();
 const prefix=`/api/v1/organizations/${TEST_ORG}/practice`,cookie=(await app.login()).headers.get('set-cookie')!.split(';')[0];const headers={Cookie:cookie,Origin:'https://erudoza.test','Content-Type':'application/json'};
 expect((await app.fetch(prefix+'/enabled',{method:'POST',headers,body:JSON.stringify({enabled:true})})).status).toBe(200);
 expect((await app.fetch(prefix+'/questions/import',{method:'POST',headers,body:JSON.stringify({seasonId:season,questions:[question]})})).status).toBe(400);
 const snapshots=[{kind:'study',id:'historical-session',data:{score:9,answers:['historical']}},{kind:'honor-unlock',id:'permanent',data:{evidence:'permanent'}}];
 for(const row of snapshots)await store.insert(row.kind,row.id,TEST_ORG,row.data);
 const before=await ctx.env.DB.prepare("SELECT kind,id,data,revision FROM Records WHERE id IN ('historical-session','permanent') ORDER BY id").all();
 await ctx.env.DB.prepare('DROP INDEX Records_training_scope').run();
 const migration=await readFile(new URL('../../../migrations/0005_pbe_training.sql',import.meta.url),'utf8');
 await ctx.env.DB.prepare(migration).run();await ctx.env.DB.prepare(migration).run();
 const after=await ctx.env.DB.prepare("SELECT kind,id,data,revision FROM Records WHERE id IN ('historical-session','permanent') ORDER BY id").all();expect(after.results).toEqual(before.results);
});

it('atomically rejects concurrent cross-season question identity reuse without partial imports',async()=>{
 const {ctx,store}=await setup();const otherSeason='cccccccc-0000-0000-0000-000000000002';
 const originalSeason=await store.require<Record<string,unknown>>('season',season,TEST_ORG),originalScope=await store.require('scope',season,TEST_ORG);
 await store.insert('season',otherSeason,TEST_ORG,{...originalSeason.value,id:otherSeason});await store.insert('scope',otherSeason,TEST_ORG,originalScope.value);
 let arrived=0,releaseBoth=()=>{},releaseFirst=()=>{};
 const bothReady=new Promise<void>(resolve=>{releaseBoth=resolve;}),firstCommitted=new Promise<void>(resolve=>{releaseFirst=resolve;});
 const database=ctx.env.DB;
 // Hold both real D1 transactions after every preflight read, then commit them in order.
 const interleaved=new Proxy(database,{get(object,key){if(key==='batch')return async(statements:Parameters<Env['DB']['batch']>[0])=>{const order=++arrived;if(order===2)releaseBoth();await bothReady;if(order===1){try{return await object.batch(statements);}finally{releaseFirst();}}await firstCommitted;return object.batch(statements);};const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;}});
 const secondTarget={...target,id:'00000000-0000-0000-0000-000000000005'};
 const invoke=async(seasonId:string,version:number,t:typeof target)=>{const path=`/practice/pbe/seasons/${seasonId}/questions/import`;const request=new Request(`https://erudoza.test${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({questions:[{...question,version,parts:[{...question.parts[0],targetId:t.id}]}],targets:[t]})});try{return (await pbeRoutes({...ctx,path,request,env:{...ctx.env,DB:interleaved},store:new Store(interleaved)}))!.status;}catch(error){if(error instanceof HttpError)return error.status;throw error;}};
 const results=await Promise.all([invoke(season,1,target),invoke(otherSeason,2,secondTarget)]);
 expect(arrived).toBe(2);expect(results.filter(status=>status===204)).toHaveLength(1);expect(results.filter(status=>status===409)).toHaveLength(1);
 const winningSeason=results[0]===204?season:otherSeason,losingSeason=results[0]===204?otherSeason:season;
 const rows=await database.prepare("SELECT kind,season_id FROM Records WHERE kind IN ('pbe-question','pbe-target') ORDER BY kind").all<{kind:string;season_id:string}>();
 expect(rows.results).toEqual([{kind:'pbe-question',season_id:winningSeason},{kind:'pbe-target',season_id:winningSeason}]);
 expect((await store.list('pbe-question',TEST_ORG,{seasonId:losingSeason}))).toEqual([]);expect((await store.list('pbe-target',TEST_ORG,{seasonId:losingSeason}))).toEqual([]);
});
it('imports Int32 maximum versions but rejects max-plus-one through HTTP',async()=>{
 const {send,store}=await setup();
 expect((await send('/questions/import',{questions:[{...question,version:2147483647}],targets:[target]})).status).toBe(204);
 expect((await send('/questions/import',{questions:[{...question,version:2147483648}],targets:[target]})).status).toBe(400);
 const records=await store.list<{question:{version:number}}>('pbe-question',TEST_ORG,{seasonId:season});expect(records.map(r=>r.question.version)).toEqual([2147483647]);
});
