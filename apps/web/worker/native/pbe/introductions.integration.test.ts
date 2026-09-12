// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG, TEST_USER } from '../test-runtime';
import { Store } from '../store';
import type { Env, RequestContext } from '../types';
import { loadPbeBank, resolvePbeSources } from './bank';
import fixtures from './rubric-fixtures.json';
const season='cccccccc-0000-0000-0000-000000000001',student='dddddddd-0000-0000-0000-000000000001';
const pack='aaaaaaaa-0000-0000-0000-000000000001',source='aaaaaaaa-0000-0000-0000-000000000002';
const input={bookKey:'GEN',sourceEdition:'Test edition',title:'Genesis introduction',citation:'Test introduction',licensingStatus:'approved',units:[{citation:'Test introduction §1',canonicalText:'The opening introduces Alpha and Beta.'}]};
type Intro=typeof input & {id:string;organizationId:string;seasonId:string;reviewed:boolean;revision:number;assignedStudentIds:string[];units:{id:string;citation:string;canonicalText:string}[]};
let app:Awaited<ReturnType<typeof createNativeTestApp>>;
afterEach(async()=>{await app?.runtime.dispose();});
async function setup(measureD1=false,beforeD1Statement?:(sql:string)=>Promise<void>){
 app=await createNativeTestApp({measureD1,beforeD1Statement});const store=new Store(app.db as unknown as Env['DB']);const cookie=(await app.login()).headers.get('set-cookie')!.split(';')[0];
 const path=`/api/v1/organizations/${TEST_ORG}/practice/pbe/seasons/${season}`;
 const send=(suffix:string,value?:unknown,auth=cookie)=>app.fetch(path+suffix,{method:value===undefined?'GET':'POST',headers:{Cookie:auth,Origin:'https://erudoza.test','Content-Type':'application/json'},body:value===undefined?undefined:JSON.stringify(value)});
 await store.insert('season',season,TEST_ORG,{id:season,organizationId:TEST_ORG,status:'Active',pbeEnabled:true});
 await store.insert('pack',pack,TEST_ORG,{id:pack,isActive:true,licensingStatus:'approved',sourceType:'Scripture'});
 await store.insert('source',source,TEST_ORG,{id:source,contentPackId:pack,bookKey:'GEN',chapter:1,verse:1,ordinal:1,citation:'GEN 1:1',canonicalText:'Scripture.',isActive:true},{ownerId:pack});
 await store.insert('scope',season,TEST_ORG,{contentPackId:pack,includes:[{bookKey:'GEN',startChapter:1,startVerse:1,endChapter:1,endVerse:1}],excludes:[]});
 await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT ?,org_id,'intro-student','Student','Student','Student',password_hash,credential_version FROM Users WHERE id=?").bind(student,TEST_USER).run();
 await store.insert('membership',`${season}:${student}`,TEST_ORG,{id:`${season}:${student}`,seasonId:season,userId:student,studentUserId:student},{seasonId:season,ownerId:student});
 const login=await app.fetch('/api/v1/auth/login',{method:'POST',headers:{Origin:'https://erudoza.test','Content-Type':'application/json'},body:JSON.stringify({identifier:'intro-student',password:'Testing!123'})});const studentCookie=login.headers.get('set-cookie')!.split(';')[0];
 const ctx={store,env:{DB:app.db},orgId:TEST_ORG,actor:{userId:TEST_USER,organizationId:TEST_ORG,kind:'Adult',role:'Owner'},request:new Request('https://erudoza.test'),path:''} as unknown as RequestContext;
 const create=async(value:unknown=input)=>{const response=await send('/introductions',value);expect(response.status).toBe(200);return await response.json() as Intro;};
 return {store,send,ctx,create,studentCookie};
}
function declaration(intro:Intro,sourceKind='Commentary'){
 const tid=crypto.randomUUID();return {targets:[{id:tid,sourceUnitIds:[intro.units[0].id],skill:'FactualRecall',label:'Opening'}],questions:[{...fixtures.cases[0].question,id:crypto.randomUUID(),contentPackId:intro.id,sourceUnitId:intro.units[0].id,sourceUnitIds:[intro.units[0].id],sourceKind,reference:'Test introduction §1',evidence:'Alpha and Beta',kind:'ShortAnswer',parts:[{targetId:tid,acceptedAnswers:['Alpha and Beta'],points:1}]}]};
}
it('creates coordinate-free immutable introductions, reviews sources and deliberately assigns student access',async()=>{
 const {send,ctx,create,studentCookie}=await setup();let intro=await create();
 expect(intro.reviewed).toBe(false);expect(intro.revision).toBe(1);expect(intro.units[0].id).toMatch(/^[a-f0-9-]{36}$/);expect(JSON.stringify(intro)).not.toMatch(/chapter|verse/i);
 const draft=declaration(intro);expect((await send('/questions/import',draft)).status).toBe(400);
 intro=await (await send(`/introductions/${intro.id}/review`,{revision:1,reviewed:true})).json() as Intro;
 expect(intro.reviewed).toBe(true);expect(intro.revision).toBe(2);
 expect((await send('/questions/import',declaration(intro,'Scripture'))).status).toBe(400);
 expect((await send('/questions/import',{...draft,questions:[{...draft.questions[0],evidence:'Invented'}]})).status).toBe(400);
 expect((await send('/questions/import',draft)).status).toBe(204);expect((await send(`/questions/${draft.questions[0].id}/1/publish`,{})).status).toBe(204);
 const restricted={organizationId:TEST_ORG,seasonId:season,studentId:student,sourceUnitIds:[intro.units[0].id]};
 expect((await loadPbeBank(ctx,restricted)).questions).toHaveLength(0);
 expect((await send(`/introductions/${intro.id}/reader`,undefined,studentCookie)).status).toBe(403);
 expect((await send('/introductions',undefined,studentCookie)).status).toBe(403);
 intro=await (await send(`/introductions/${intro.id}/assignments`,{revision:2,studentIds:[student,student]})).json() as Intro;
 expect(intro.assignedStudentIds).toEqual([student]);expect(intro.revision).toBe(3);
 expect((await loadPbeBank(ctx,restricted)).questions).toHaveLength(1);
 const sources=(await resolvePbeSources(ctx,restricted)).sources;expect(sources).toEqual([expect.objectContaining({id:intro.units[0].id,sourceKind:'Commentary',chapter:null,verse:null})]);
 const read=await send(`/introductions/${intro.id}/reader`,undefined,studentCookie);expect(read.status).toBe(200);expect(await read.text()).toContain('Alpha and Beta');
 const metadata=await send('/bank',undefined,studentCookie);expect(await metadata.text()).not.toMatch(/Alpha|canonicalText|evidence|parts/);
 const retry=await send(`/introductions/${intro.id}/assignments`,{revision:2,studentIds:[student,student]});expect(retry.status).toBe(200);expect((await retry.json() as Intro).revision).toBe(3);
});
it('rejects foreign, inactive, nonmember, unselected, unlicensed and malformed preparation',async()=>{
 const {send,store,create,studentCookie}=await setup();
 for(const bad of [{...input,bookKey:'EXO'},{...input,units:[]},{...input,units:[{...input.units[0],canonicalText:'\ufeff'}]},{...input,chapter:1},{...input,units:[{...input.units[0],verse:1}]},{...input,units:[{...input.units[0],canonicalText:'x'.repeat(10001)}]}])expect((await send('/introductions',bad)).status).toBe(400);
 expect((await send('/introductions',input,studentCookie)).status).toBe(403);
 const coachCookie=(await app.login()).headers.get('set-cookie')!.split(';')[0];expect((await app.fetch(`/api/v1/organizations/${crypto.randomUUID()}/practice/pbe/seasons/${season}/introductions`,{headers:{Cookie:coachCookie}})).status).toBe(403);
 const intro=await create({...input,licensingStatus:'pending'});expect((await send(`/introductions/${intro.id}/review`,{revision:1,reviewed:true})).status).toBe(400);
 for(const ids of [[TEST_USER],[crypto.randomUUID()]])expect((await send(`/introductions/${intro.id}/assignments`,{revision:1,studentIds:ids})).status).toBe(400);
 await store.remove('membership',`${season}:${student}`,TEST_ORG);expect((await send(`/introductions/${intro.id}/assignments`,{revision:1,studentIds:[student]})).status).toBe(400);
 expect((await send(`/introductions/${crypto.randomUUID()}/review`,{revision:1,reviewed:true})).status).toBe(404);
});
it('revocation, assignment replacement and selected-book removal invalidate future reads without rewriting evidence',async()=>{
 const {send,ctx,store,create,studentCookie}=await setup();let intro=await create();intro=await (await send(`/introductions/${intro.id}/review`,{revision:1,reviewed:true})).json() as Intro;
 const declarationInput=declaration(intro);await send('/questions/import',declarationInput);await send(`/questions/${declarationInput.questions[0].id}/1/publish`,{});
 intro=await (await send(`/introductions/${intro.id}/assignments`,{revision:2,studentIds:[student]})).json() as Intro;
 const evidence=await store.list('pbe-question',TEST_ORG,{seasonId:season});const scope={organizationId:TEST_ORG,seasonId:season,studentId:student,sourceUnitIds:[intro.units[0].id]};
 await send(`/introductions/${intro.id}/assignments`,{revision:3,studentIds:[]});expect((await loadPbeBank(ctx,scope)).questions).toHaveLength(0);
 await send(`/introductions/${intro.id}/assignments`,{revision:4,studentIds:[student]});
 await app.db.prepare('UPDATE Users SET active=0 WHERE id=?').bind(student).run();await expect(loadPbeBank(ctx,scope)).rejects.toThrow();await app.db.prepare('UPDATE Users SET active=1 WHERE id=?').bind(student).run();
 await store.remove('membership',`${season}:${student}`,TEST_ORG);expect((await loadPbeBank(ctx,scope)).questions).toHaveLength(0);
 await store.insert('membership',`${season}:${student}`,TEST_ORG,{id:`${season}:${student}`,seasonId:season,userId:student,studentUserId:student},{seasonId:season,ownerId:student});
 await send(`/introductions/${intro.id}/review`,{revision:5,reviewed:false});expect((await loadPbeBank(ctx,{...scope,studentId:undefined})).questions).toHaveLength(0);expect((await send(`/introductions/${intro.id}/reader`,undefined,studentCookie)).status).toBe(403);
 await send(`/introductions/${intro.id}/review`,{revision:6,reviewed:true});const sc=await store.require('scope',season,TEST_ORG);await store.put('scope',season,TEST_ORG,{contentPackId:pack,includes:[],excludes:[]},sc.revision);
 expect((await send(`/introductions/${intro.id}/assignments`,{revision:7,studentIds:[student]})).status).toBe(400);
 expect((await loadPbeBank(ctx,{...scope,studentId:undefined})).questions).toHaveLength(0);expect((await store.list('pbe-question',TEST_ORG,{seasonId:season}))).toEqual(evidence);
 expect(await store.list('source',TEST_ORG,{ownerId:intro.id})).toEqual([]);expect(await store.get('pack',intro.id,TEST_ORG)).toBeNull();
});
it('serializes competing source review and assignment writes using one explicit revision',async()=>{
 const {send,create,store}=await setup();const intro=await create();
 const results=await Promise.all([send(`/introductions/${intro.id}/review`,{revision:1,reviewed:true}),send(`/introductions/${intro.id}/assignments`,{revision:1,studentIds:[student]})]);
 expect(results.map(r=>r.status).sort()).toEqual([200,409]);
 const row=await store.require('pbe-introduction',intro.id,TEST_ORG);expect(row.revision).toBe(2);
 const assignments=await store.list('pbe-introduction-assignment',TEST_ORG,{seasonId:season,ownerId:student});expect(assignments).toHaveLength(results[1].status===200?1:0);
 expect((await send(`/introductions/${intro.id}/review`,{revision:1,reviewed:false})).status).toBe(409);
});

it('guards authorization and source revisions inside the real D1 mutation transaction',async()=>{
 const {ctx,store,create,send}=await setup();const intro=await create();
 const invoke=async(suffix:string,input:unknown,edit:()=>Promise<unknown>)=>{
  const database=ctx.env.DB;const guarded=new Proxy(database,{get(object,key){if(key==='batch')return async(statements:Parameters<Env['DB']['batch']>[0])=>{await edit();return object.batch(statements);};const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;}});
  const path=`/practice/pbe/seasons/${season}${suffix}`;const request=new Request(`https://erudoza.test${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  const {pbeRoutes}=await import('./routes');const {HttpError}=await import('../types');
  try{return (await pbeRoutes({...ctx,path,request,env:{...ctx.env,DB:guarded},store:new Store(guarded)}))!.status;}catch(error){if(error instanceof HttpError)return error.status;throw error;}
 };
 expect(await invoke(`/introductions/${intro.id}/assignments`,{revision:1,studentIds:[student]},()=>store.remove('membership',`${season}:${student}`,TEST_ORG))).toBe(409);
 expect(await store.list('pbe-introduction-assignment',TEST_ORG,{seasonId:season})).toEqual([]);expect((await store.require('pbe-introduction',intro.id,TEST_ORG)).revision).toBe(1);
 await send(`/introductions/${intro.id}/review`,{revision:1,reviewed:true});const draft=declaration(intro);await send('/questions/import',draft);
 expect(await invoke(`/questions/${draft.questions[0].id}/1/publish`,{},()=>store.put('pbe-introduction',intro.id,TEST_ORG,{...intro,reviewed:false},2))).toBe(409);
 expect(await store.list('pbe-question-head',TEST_ORG,{seasonId:season})).toEqual([]);
 const sc=await store.require('scope',season,TEST_ORG);
 expect(await invoke('/introductions',input,()=>store.put('scope',season,TEST_ORG,{contentPackId:pack,includes:[],excludes:[]},sc.revision))).toBe(409);
 await store.put('scope',season,TEST_ORG,sc.value,sc.revision+1);
 expect(await invoke('/introductions',input,()=>app.db.prepare('UPDATE Users SET active=0 WHERE id=?').bind(TEST_USER).run())).toBe(409);
 expect(await store.list('pbe-introduction',TEST_ORG,{seasonId:season})).toHaveLength(1);
});

it('detects introduction assignment changes during a private bank load',async()=>{
 const {ctx,create,send}=await setup();const intro=await create();await send(`/introductions/${intro.id}/review`,{revision:1,reviewed:true});await send(`/introductions/${intro.id}/assignments`,{revision:2,studentIds:[student]});
 const database=ctx.env.DB;let reads=0;
 const wrap=(statement:ReturnType<Env['DB']['prepare']>):ReturnType<Env['DB']['prepare']>=>new Proxy(statement,{get(object,key){if(key==='bind')return (...args:unknown[])=>wrap(object.bind(...args));if(key==='all')return async()=>{if(++reads===2)expect((await send(`/introductions/${intro.id}/assignments`,{revision:3,studentIds:[]})).status).toBe(200);return object.all();};const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;}});
 const interleaved=new Proxy(database,{get(object,key){if(key==='prepare')return (sql:string)=>sql.includes("owner_id IS NULL AND kind='pbe-introduction'")?wrap(object.prepare(sql)):object.prepare(sql);const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;}});
 await expect(loadPbeBank({...ctx,env:{...ctx.env,DB:interleaved},store:new Store(interleaved)},{organizationId:TEST_ORG,seasonId:season,studentId:student,sourceUnitIds:[intro.units[0].id]})).rejects.toThrow(/changed/);
});

interface Meter {bindingCalls:number;statements:number;methods:Record<string,number>}
function measured(response:{headers:Headers}){const meter=JSON.parse(response.headers.get('x-test-d1-meter')!) as Meter;expect(meter.bindingCalls).toBeGreaterThan(0);return meter;}
async function addStudents(count:number){
 const ids=Array.from({length:count},(_,i)=>`dddddddd-0000-0000-0001-${String(i+1).padStart(12,'0')}`);
 await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT j.value,u.org_id,'budget-'||j.value,'Budget Student','Student','Student',u.password_hash,u.credential_version FROM json_each(?) j CROSS JOIN Users u WHERE u.id=?").bind(JSON.stringify(ids),TEST_USER).run();
 await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) SELECT 'membership',?||':'||value,?,?,value,json_object('id',?||':'||value,'seasonId',?,'userId',value,'studentUserId',value) FROM json_each(?)").bind(season,TEST_ORG,season,season,season,JSON.stringify(ids)).run();return ids;
}
it.each([26,500])('keeps %i-student HTTP replacement and exact lost-response retry within the request query budget',async(count)=>{
 const {send,create,store}=await setup(true),intro=await create(),ids=await addStudents(count);
 // Start with a different real selection so replacement must both delete and insert.
 expect((await send(`/introductions/${intro.id}/assignments`,{revision:1,studentIds:[student]})).status).toBe(200);
 const input={revision:2,studentIds:ids},response=await send(`/introductions/${intro.id}/assignments`,input);expect(response.status).toBe(200);
 const result=await response.json() as Intro;expect(result.revision).toBe(3);expect(result.assignedStudentIds).toEqual(ids);
 const retry=await send(`/introductions/${intro.id}/assignments`,input);expect(retry.status).toBe(200);expect((await retry.json() as Intro).revision).toBe(3);
 const rows=await store.list<{studentUserId:string}>('pbe-introduction-assignment',TEST_ORG,{seasonId:season});expect(rows.map(r=>r.studentUserId).sort()).toEqual(ids);
 const mutation=measured(response),repeated=measured(retry);process.stdout.write(`Introduction HTTP ${count} assignment budget `+JSON.stringify({mutation,repeated})+'\n');
 expect(mutation.statements).toBeLessThanOrEqual(50);expect(repeated.statements).toBeLessThanOrEqual(50);
});
it('bulk-loads assignments for 51 introductions within the complete HTTP query budget',async()=>{
 const {send,create}=await setup(true),intro=await create();
 const rows=Array.from({length:50},()=>({...intro,id:crypto.randomUUID(),units:[{...intro.units[0],id:crypto.randomUUID()}],revision:undefined,assignedStudentIds:undefined}));
 await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,data) SELECT 'pbe-introduction',json_extract(value,'$.id'),?,?,value FROM json_each(?)").bind(TEST_ORG,season,JSON.stringify(rows)).run();
 const all=[intro,...rows];await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) SELECT 'pbe-introduction-assignment',?||':'||json_extract(value,'$.id')||':'||?,?,?,?,json_object('id',?||':'||json_extract(value,'$.id')||':'||?,'seasonId',?,'contentPackId',json_extract(value,'$.id'),'studentUserId',?) FROM json_each(?)").bind(season,student,TEST_ORG,season,student,season,student,season,student,JSON.stringify(all)).run();
 const response=await send('/introductions');expect(response.status).toBe(200);const list=await response.json() as Intro[];expect(list).toHaveLength(51);expect(list.every(p=>p.assignedStudentIds.length===1&&p.assignedStudentIds[0]===student)).toBe(true);
 const budget=measured(response);process.stdout.write('Introduction HTTP 51-pack list budget '+JSON.stringify(budget)+'\n');expect(budget.statements).toBeLessThanOrEqual(50);
});
it('measures coach and student bank metadata over the complete HTTP path',async()=>{
 const {send,create,studentCookie}=await setup(true);const intro=await create();await send(`/introductions/${intro.id}/review`,{revision:1,reviewed:true});await send(`/introductions/${intro.id}/assignments`,{revision:2,studentIds:[student]});
 const q=declaration(intro);expect((await send('/questions/import',q)).status).toBe(204);expect((await send(`/questions/${q.questions[0].id}/1/publish`,{})).status).toBe(204);
 const coach=await send('/bank'),solo=await send('/bank',undefined,studentCookie);expect(coach.status).toBe(200);expect(solo.status).toBe(200);expect((await solo.json() as {questionCount:number}).questionCount).toBe(1);
 process.stdout.write('PBE bank public HTTP budget '+JSON.stringify({coach:measured(coach),student:measured(solo)})+'\n');
 expect(measured(coach).statements).toBeLessThanOrEqual(50);expect(measured(solo).statements).toBeLessThanOrEqual(50);
});

it('rejects mid-request source revocation in public metadata and preserves empty private restrictions',async()=>{
 let edit:(()=>Promise<void>)|undefined;
 const {ctx,store,create,send,studentCookie}=await setup(true,async sql=>{if(edit&&sql.includes('owner_id IN (SELECT value FROM json_each(?)) AND kind=?')){const action=edit;edit=undefined;await action();}});
 const intro=await create();await send(`/introductions/${intro.id}/review`,{revision:1,reviewed:true});await send(`/introductions/${intro.id}/assignments`,{revision:2,studentIds:[student]});const q=declaration(intro);await send('/questions/import',q);await send(`/questions/${q.questions[0].id}/1/publish`,{});
 expect((await loadPbeBank(ctx,{organizationId:TEST_ORG,seasonId:season,studentId:student,sourceUnitIds:[]})).questions).toEqual([]);
 const initial=await send('/bank',undefined,studentCookie);expect(initial.status).toBe(200);expect(await initial.json()).toEqual({questionCount:1,targetCount:1,sourceUnitCount:1,missingSourceUnitIds:[]});
 edit=async()=>{const row=await store.require<Record<string,unknown>>('pbe-introduction',intro.id,TEST_ORG);await store.put('pbe-introduction',intro.id,TEST_ORG,{...row.value,reviewed:false},row.revision);};
 const stale=await send('/bank',undefined,studentCookie);expect(stale.status).toBe(409);expect(edit).toBeUndefined();expect(await stale.text()).not.toMatch(/canonicalText|acceptedAnswers|Alpha|evidence/);
 const fresh=await send('/bank',undefined,studentCookie);expect(fresh.status).toBe(200);expect(await fresh.json()).toEqual({questionCount:0,targetCount:0,sourceUnitCount:0,missingSourceUnitIds:[]});
 expect(measured(initial).statements).toBeLessThanOrEqual(50);expect(measured(stale).statements).toBeLessThanOrEqual(50);expect(measured(fresh).statements).toBeLessThanOrEqual(50);
});

it('rolls back a 500-student HTTP replacement when the final student loses active status or membership before the transaction',async()=>{
 let edit:(()=>Promise<void>)|undefined;
 const {send,create,store}=await setup(true,async sql=>{if(edit&&sql.startsWith("INSERT INTO Records(kind,id,org_id,data) VALUES('audit'")){const action=edit;edit=undefined;await action();}});
 const intro=await create(),ids=await addStudents(500),last=ids.at(-1)!;expect((await send(`/introductions/${intro.id}/assignments`,{revision:1,studentIds:[student]})).status).toBe(200);
 for(const removal of ['active','membership']){
  edit=async()=>{if(removal==='active')await app.db.prepare('UPDATE Users SET active=0 WHERE id=?').bind(last).run();else await store.remove('membership',`${season}:${last}`,TEST_ORG);};
  const response=await send(`/introductions/${intro.id}/assignments`,{revision:2,studentIds:ids});expect(response.status).toBe(409);expect(edit).toBeUndefined();expect(measured(response).statements).toBeLessThanOrEqual(50);
  const rows=await store.list<{studentUserId:string}>('pbe-introduction-assignment',TEST_ORG,{seasonId:season});expect(rows.map(r=>r.studentUserId)).toEqual([student]);expect((await store.require('pbe-introduction',intro.id,TEST_ORG)).revision).toBe(2);
  await app.db.prepare('UPDATE Users SET active=1 WHERE id=?').bind(last).run();
 }
});
