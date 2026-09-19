// @vitest-environment node
// Learner-parity write guards: an Adult Owner/Admin in learner mode must be able
// to complete the PBE cooperation continue write and the PBE chapter-progress
// continuation write; signed-out and non-learner actors must still be refused.
import {afterEach,expect,it} from 'vitest';
import {createNativeTestApp,TEST_ORG,TEST_USER} from '../test-runtime';
import {Store} from '../store';
import type {Env} from '../types';
import type {PbeQuestion,PbeTarget} from './types';
import {sourceProof} from './bank';
import type {ContinueChaptersResponse,CooperationSnapshot} from '../../../src/api/pbeTypes';
const season='ffffffff-0000-0000-0000-000000000001',student='ffffffff-0000-0000-0000-000000000002',adult='ffffffff-0000-0000-0000-000000000003',member='ffffffff-0000-0000-0000-000000000004',pack='ffffffff-0000-0000-0000-000000000005',source='ffffffff-0000-0000-0000-000000000006';
const tid=(n:number)=>`ffffffff-0000-0000-0000-${String(n).padStart(12,'0')}`;
let app:Awaited<ReturnType<typeof createNativeTestApp>>;
afterEach(async()=>{await app?.runtime.dispose();});
async function setup(){
 app=await createNativeTestApp();
 const store=new Store(app.db as unknown as Env['DB']);
 await store.insert('season',season,TEST_ORG,{id:season,name:'Test season',organizationId:TEST_ORG,status:'Active',pbeEnabled:true});
 await store.insert('pack',pack,TEST_ORG,{id:pack,isActive:true,licensingStatus:'approved',sourceType:'Scripture'});
 const unit={id:source,contentPackId:pack,bookKey:'GEN',chapter:1,verse:1,ordinal:1,citation:'GEN 1:1',canonicalText:'Alpha and Beta',isActive:true};
 await store.insert('source',source,TEST_ORG,unit,{ownerId:pack});
 const range={bookKey:'GEN',startChapter:1,startVerse:1,endChapter:1,endVerse:1};
 await store.insert('scope',season,TEST_ORG,{contentPackId:pack,includes:[range],excludes:[]});
 await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT ?,org_id,'pbe-student','Student','Student','Student',password_hash,credential_version FROM Users WHERE id=?").bind(student,TEST_USER).run();
 await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT ?,org_id,'pbe-adult-learner','Coach Learner','Adult','Owner',password_hash,credential_version FROM Users WHERE id=?").bind(adult,TEST_USER).run();
 await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT ?,org_id,'pbe-adult-nonlearner','Coach Nonlearner','Adult','Content Manager',password_hash,credential_version FROM Users WHERE id=?").bind(member,TEST_USER).run();
 for(const u of [student,adult]){
  await store.insert('assignment',`assignment-${u.slice(-4)}`,TEST_ORG,{id:`assignment-${u.slice(-4)}`,seasonId:season,studentUserId:u,contentPackId:pack,...range},{seasonId:season,ownerId:u});
  await store.insert('membership',`${season}:${u}`,TEST_ORG,{id:`${season}:${u}`,seasonId:season,userId:u,difficulty:'Standard'},{seasonId:season,ownerId:u});
 }
 const targets:PbeTarget[]=[1,2].map(n=>({id:tid(n),sourceUnitIds:[source],skill:'FactualRecall',label:`Label ${n}`}));
 for(const t of targets)await store.insert('pbe-target',t.id,TEST_ORG,t,{seasonId:season,ownerId:source});
 for(let n=0;n<2;n++){
  const q:PbeQuestion={schemaVersion:2,id:tid(100+n),version:1,contentPackId:pack,sourceUnitId:source,sourceUnitIds:[source],sourceKind:'Scripture',reference:'GEN 1:1',evidence:'Alpha and Beta',kind:'List',prompt:'Name the two labels.',ordered:false,parts:targets.map((t,i)=>({targetId:t.id,acceptedAnswers:[i?'Beta':'Alpha'],points:1}))};
  await store.insert('pbe-question-head',q.id,TEST_ORG,{id:q.id,seasonId:season,published:true,sourceFingerprint:await sourceProof(q,new Map([[source,unit]])),question:q},{seasonId:season,ownerId:source});
 }
}
async function login(userName:string){
 const r=await app.fetch('/api/v1/auth/login',{method:'POST',headers:{Origin:'https://erudoza.test','Content-Type':'application/json'},body:JSON.stringify({identifier:userName,password:'Testing!123'})});
 expect(r.status,await r.text()).toBe(200);
 return r.headers.get('set-cookie')!.split(';')[0];
}
async function send(cookie:string|undefined,path:string,value?:unknown){
 return app.fetch('/api/v1'+path,{method:value===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),Origin:'https://erudoza.test','Content-Type':'application/json'},body:value===undefined?undefined:JSON.stringify(value)});
}
async function finishCooperation(cookie:string){
 let workId:string|undefined,value:CooperationSnapshot|null=null;
 for(let n=0;n<150;n++){
  const response=await send(cookie,'/progress/me/pbe-cooperation/continue',{seasonId:season,...(workId?{workId}:{})});
  expect(response.status,await response.clone().text()).toBe(200);
  value=await response.json() as CooperationSnapshot;workId=value.work.id??undefined;
  if(value.work.next!=='Continue')break;
 }
 expect(['Snapshot','Provisional']).toContain(value?.state);
 return value!;
}
async function finishChapters(cookie:string){
 let work:ContinueChaptersResponse|null=null;
 for(let n=0;n<80;n++){
  const response=await send(cookie,'/progress/me/chapters/continue',{seasonId:season,...(work?.work.id?{workId:work.work.id}:{})});
  expect(response.status,await response.clone().text()).toBe(200);
  work=await response.json() as ContinueChaptersResponse;
  if(work.next!=='Continue')break;
 }
 expect(work?.work.state).toBe('Complete');
 return work!;
}
it('Adult Owner in learner mode completes the cooperation continue write',async()=>{
 await setup();
 await finishCooperation(await login('pbe-adult-learner'));
});
it('Adult Owner in learner mode completes the chapter continuation write',async()=>{
 await setup();
 await finishChapters(await login('pbe-adult-learner'));
});
it('Student learner still completes both continuation writes',async()=>{
 await setup();
 const cookie=await login('pbe-student');
 await finishCooperation(cookie);
 await finishChapters(cookie);
});
it('signed-out and non-learner actors cannot write either path',async()=>{
 await setup();
 for(const path of ['/progress/me/pbe-cooperation/continue','/progress/me/chapters/continue']){
  const anon=await send(undefined,path,{seasonId:season});
  expect([401,403]).toContain(anon.status);
 }
 const memberCookie=await login('pbe-adult-nonlearner');
 for(const path of ['/progress/me/pbe-cooperation/continue','/progress/me/chapters/continue']){
  const r=await send(memberCookie,path,{seasonId:season});
  expect(r.status,await r.clone().text()).toBe(403);
 }
});
