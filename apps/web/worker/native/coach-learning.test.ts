// @vitest-environment node
import {afterAll,beforeAll,expect,it} from 'vitest';
import {atomic} from './application/model';
import {Store} from './store';
import type {Env,RequestContext} from './types';
import {createNativeTestApp,TEST_ORG,TEST_USER} from './test-runtime';
let app:Awaited<ReturnType<typeof createNativeTestApp>>,cookie:string;
const season='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',pack='coach-pack',range={bookKey:'GEN',startChapter:1,startVerse:1,endChapter:1,endVerse:3};
const base=`/api/v1/organizations/${TEST_ORG}/seasons/${season}`;
async function req(path:string,method='GET',data?:unknown){return app.fetch(path,{method,headers:{Cookie:cookie,Origin:'https://erudoza.test','Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});}
async function record(kind:string,id:string,data:unknown,owner:string|null=null){await app.db.prepare('INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) VALUES(?,?,?,?,?,?)').bind(kind,id,TEST_ORG,season,owner,JSON.stringify(data)).run();}
beforeAll(async()=>{app=await createNativeTestApp();cookie=(await app.login()).headers.get('set-cookie')!.split(';')[0];await record('season',season,{id:season,name:'Coach learning',status:'ContentReady',ruleProfileKey:'PBE_STYLE_V1'});await record('pack',pack,{id:pack,isActive:true,licensingStatus:'development-sample'});await record('scope',season,{contentPackId:pack,includes:[range],excludes:[]});for(let n=1;n<=3;n++)await record('source',`dddddddd-dddd-4ddd-8ddd-00000000000${n}`,{id:`dddddddd-dddd-4ddd-8ddd-00000000000${n}`,contentPackId:pack,bookKey:'GEN',chapter:1,verse:n,ordinal:n,citation:`Genesis 1:${n}`,canonicalText:`Synthetic verse ${n} contains useful words for learning.`,isActive:true},pack);},30000);
afterAll(async()=>app?.runtime.dispose());
it('self assigns without changing readiness or student reporting, studies and preserves history',async()=>{
 const payload={contentPackId:pack,range,type:'PrimarySpecialist',difficulty:'Foundation'};
 const response=await req(`${base}/my-assignments`,'POST',payload);expect(response.status).toBe(200);let assignment=await response.json() as {id:string;studentUserId:string};expect(assignment.studentUserId).toBe(TEST_USER);
 expect(await(await req(base)).json()).toMatchObject({status:'ContentReady',assignmentCount:0});expect(await(await req(`${base}/assignments`)).json()).toEqual([]);expect(await(await req(`${base}/coverage`)).json()).toMatchObject({students:[]});
 expect(await(await req(`${base}/my-assignments`)).json()).toMatchObject([{id:assignment.id,difficulty:'Foundation'}]);
 const extra=await(await req(`${base}/my-assignments`,'POST',payload)).json() as {id:string};
 expect((await req(`${base}/my-assignments/${extra.id}`,'DELETE')).status).toBe(204);
 expect(await(await req(`/api/v1/organizations/${TEST_ORG}/seasons`)).json()).toMatchObject([{id:season,status:'ContentReady',assignmentCount:0}]);
 await record('assignment','foreign-assignment',{...assignment,id:'foreign-assignment',studentUserId:'foreign-user'},'foreign-user');
 expect((await req(`${base}/my-assignments/foreign-assignment`,'DELETE')).status).toBe(404);
 expect((await req('/api/v1/study/sessions','POST',{seasonId:season})).status).toBe(400);
 expect((await req(`${base}/activate`,'POST')).status).toBe(200);
 const reader=await req(`/api/v1/study/seasons/${season}/scripture`);expect(reader.status).toBe(200);expect((await reader.json() as {verses:unknown[]}).verses).toHaveLength(3);
 const start=await req('/api/v1/study/sessions','POST',{seasonId:season});expect(start.status).toBe(200);const session=await start.json() as {id:string};const study=`/api/v1/study/sessions/${session.id}`;
 const card=await(await req(`${study}/next`)).json() as {id:string};expect(card.id).toBeTruthy();expect((await req(`${study}/attempts`,'POST',{clientSubmissionId:'coach-attempt',challengeCardId:card.id,submittedAnswer:'wrong',responseTimeMs:10,hintsUsed:false})).status).toBe(200);
 expect((await req(`${study}/complete`,'POST')).status).toBe(200);expect(await(await req(`/api/v1/progress/me?seasonId=${season}`)).json()).toMatchObject({attemptCount:1});
 expect((await req(`${base}/my-assignments`,'POST',{...payload,studentUserId:'another-user'})).status).toBe(400);
 expect((await req(`${base}/assignments/${assignment.id}`,'DELETE')).status).toBe(404);
 const recap=await(await req(`${study}/recap`)).json();
 expect((await req(`${base}/my-assignments/${assignment.id}`,'DELETE')).status).toBe(204);
 expect(await(await req(`${base}/my-assignments`)).json()).toEqual([]);
 expect(await(await req(`${study}/recap`)).json()).toEqual(recap);
 expect(await(await req(study)).json()).toMatchObject({summary:{attempted:1,status:'Completed'}});
 assignment=await(await req(`${base}/my-assignments`,'POST',payload)).json() as typeof assignment;

 expect((await req(`/api/v1/progress/me/today?seasonId=${season}`)).status).toBe(200);
 expect((await req(`/api/v1/progress/me/honors?seasonId=${season}`)).status).toBe(200);
 expect((await req(`${base}/close`,'POST')).status).toBe(204);expect((await req(`${base}/my-assignments/${assignment.id}`,'DELETE')).status).toBe(400);expect(await(await req(`/api/v1/progress/me?seasonId=${season}`)).json()).toMatchObject({attemptCount:1});
});

it('keeps student-only guards strict and atomically rejects inactive or ineligible learners',async()=>{
 const env={DB:app.db} as unknown as Env;
 const ctx={env,orgId:TEST_ORG,actor:{userId:TEST_USER},store:new Store(env.DB)} as RequestContext;
 const guard=(kind:string)=>atomic(ctx,'test.guard',[],[{kind,id:TEST_USER,revision:0}]);
 await expect(guard('@active-user')).rejects.toMatchObject({status:409});
 await expect(guard('@active-learner')).resolves.toBeUndefined();
 await app.db.prepare('UPDATE Users SET active=0 WHERE id=?').bind(TEST_USER).run();
 await expect(guard('@active-learner')).rejects.toMatchObject({status:409});
 expect((await req(`${base}/my-assignments`)).status).toBe(401);
 await app.db.prepare("UPDATE Users SET active=1,role='Student' WHERE id=?").bind(TEST_USER).run();
 await expect(guard('@active-learner')).rejects.toMatchObject({status:409});
 await app.db.prepare("UPDATE Users SET kind='Student' WHERE id=?").bind(TEST_USER).run();
 expect((await req(`${base}/my-assignments`)).status).toBe(403);
 await expect(guard('@active-user')).resolves.toBeUndefined();
 await app.db.prepare("UPDATE Users SET kind='Adult',role='Owner' WHERE id=?").bind(TEST_USER).run();
});
