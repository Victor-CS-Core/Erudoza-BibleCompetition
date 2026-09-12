// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {createNativeTestApp,TEST_ORG,TEST_USER} from '../test-runtime';
import type {PbeSession} from './sessions';
import type {PracticeRoom,PracticeBootstrap} from '../../../src/api/practice';
import {disputeFixture} from './dispute-fixture';
let app:Awaited<ReturnType<typeof createNativeTestApp>>;
afterEach(async()=>{await app?.runtime.dispose();});
it.each(['Solo','Team','TeamInterrupted','TeamCoached'] as const)('flags and resolves an actual %s result with frozen bounds, role/control gates and exact retries',async scenario=>{
 const activity=scenario==='Solo'?'Solo':'Team';
 const fixture=await disputeFixture(scenario);app=fixture.app;const {store,season,players,call,flagControl}=fixture;let sessionId:string,attemptId:string,questionId:string,original:string;
 if(activity==='Solo'){
  const started=await call(0,'/study/sessions',{seasonId:season,format:'Pbe',mode:'Practice'});expect(started.status).toBe(200);sessionId=(await started.json() as {id:string}).id;
  const card=await (await call(0,`/study/sessions/${sessionId}/next`)).json() as {id:string;question:{id:string}};questionId=card.question.id;
  const accepted=await call(0,`/study/sessions/${sessionId}/attempts`,{clientSubmissionId:crypto.randomUUID(),challengeCardId:card.id,answers:['Alpha','wrong'],hintsUsed:false});expect(accepted.status).toBe(200);attemptId=(await accepted.json() as {attemptId:string}).attemptId;expect((await call(0,`/study/sessions/${sessionId}/complete`,{})).status).toBe(200);original=JSON.stringify((await store.require<PbeSession>('pbe-session',sessionId,TEST_ORG)).value.attempts);
 }else{
  const base=`/organizations/${TEST_ORG}/practice`;const coached=scenario==='TeamCoached',owner=coached?-1:0;const created=await call(owner,base+'/rooms',{seasonId:season,format:'Pbe',teamCount:2,teamSize:2,questionCount:10,coached});expect(created.status).toBe(200);let room=await created.json() as PracticeRoom;sessionId=room.id;
  const command=async(actor:number,action:string,extra:Record<string,unknown>={})=>{const r=await call(actor,`${base}/rooms/${room.id}/commands`,{commandId:crypto.randomUUID(),revision:room.revision,action,...extra});expect(r.status,await r.clone().text()).toBe(200);room=await r.json() as PracticeRoom;};
  for(let n=coached?0:1;n<4;n++){await command(owner,'invite',{targetUserId:players[n].id,team:Math.floor(n/2)+1});const inbox=await (await call(n,base+'/bootstrap')).json() as PracticeBootstrap;expect(inbox.invitations[0].teamCount).toBe(2);room=await (await call(n,`${base}/invitations/${inbox.invitations[0].id}/accept`,{team:Math.floor(n/2)+1})).json() as PracticeRoom;}
  for(let n=0;n<4;n++)await command(n,'ready');await command(owner,'start');questionId=room.question!.id;
  if(coached){await command(0,'present-ready',{questionId});await command(2,'present-ready',{questionId});await command(-1,'present',{questionId,delivery:'Coach'});}else{await command(0,'present',{questionId,delivery:'TextFallback'});await command(2,'present',{questionId,delivery:'Audio'});}await new Promise(r=>setTimeout(r,3100));
  await app.db.exec("CREATE TRIGGER dispute_fixture_failed_projection BEFORE UPDATE ON Records WHEN NEW.kind='room' BEGIN SELECT RAISE(ABORT,'fixture projection failure'); END");
  const finalCommand={commandId:crypto.randomUUID(),revision:room.revision,action:'submit',questionId,answers:['Alpha','wrong']};
  const final=await call(0,`${base}/rooms/${room.id}/commands`,finalCommand);expect(final.status).toBe(200);room=await final.json() as PracticeRoom;
  const snapshot=async()=>{const response=await app.fetch(`/api/v1/organizations/${TEST_ORG}/practice/rooms/${room.id}`,{headers:{Cookie:players[0].cookie,Origin:'https://erudoza.test','x-test-room-snapshot':'1'}});return response.json() as Promise<{submissions:{attemptId:string}[]}>;};
  const accepted=await snapshot();expect(accepted.submissions[0].attemptId).toMatch(/^[a-f0-9-]{36}$/);
  expect((await call(0,`${base}/rooms/${room.id}/commands`,finalCommand)).status).toBe(200);expect((await snapshot()).submissions).toEqual(accepted.submissions);
  if(scenario==='TeamInterrupted'){
   const replaced=await app.fetch(`/api/v1/organizations/${TEST_ORG}/practice/rooms/${room.id}`,{headers:{Cookie:players[0].cookie,Origin:'https://erudoza.test','x-test-authority-replaced':'1'}});expect(replaced.status).toBe(200);
   room=await (await call(0,`${base}/rooms/${room.id}`)).json() as PracticeRoom;expect(room.status).toBe('Interrupted');expect(room.results).toHaveLength(1);
   const other=await (await call(2,`${base}/rooms/${room.id}`)).json() as PracticeRoom;expect(other.results).toEqual([]);expect(JSON.stringify(other)).not.toContain('acceptedAnswers');expect((await snapshot()).submissions).toEqual(accepted.submissions);
  }else await command(2,'submit',{questionId,answers:['wrong','wrong']});
  for(const action of ['appeal','judge']){const before=await snapshot();const rejected=await call(action==='judge'?-1:0,`${base}/rooms/${room.id}/commands`,{commandId:crypto.randomUUID(),revision:room.revision,action,questionId,team:1,points:2,text:'Legacy mutation must not bypass the rubric review'});expect(coached?[400]:[400,403,409]).toContain(rejected.status);expect({...await snapshot(),lastObserved:0}).toEqual({...before,lastObserved:0});}
  const own=room.results.find(r=>r.team===1) as typeof room.results[number]&{attemptId:string};attemptId=own.attemptId;expect(attemptId).toMatch(/^[a-f0-9-]{36}$/);original=JSON.stringify(room.results);
 }
 await app.db.prepare("UPDATE Records SET data=json_set(data,'$.question.version',2,'$.question.parts[0].points',8,'$.question.evidence','Changed head'),revision=revision+1 WHERE kind='pbe-question-head' AND id=?").bind(questionId).run();
 const input={activity,sessionId,attemptId,reason:'Please check the second part.'};const flag=await call(0,'/pbe/disputes',input);expect(flag.status,await flag.clone().text()).toBe(201);const dispute=await flag.json() as {id:string;revision:number;status:string;questionVersion:number;partPoints:number[];sourceEvidence:string};expect(dispute).toMatchObject({revision:1,status:'Pending',questionVersion:1,partPoints:[1,1],sourceEvidence:'Alpha and Beta'});
 if(activity==='Team'){const pending=await (await call(0,`/organizations/${TEST_ORG}/practice/rooms/${sessionId}`)).json() as PracticeRoom;expect(pending.provisional).toBe(true);expect(pending.results.find(r=>r.team===1)?.accuracyHundredths).toBe(100);}
 const duplicate=await call(0,'/pbe/disputes',input);expect(duplicate.status).toBe(200);expect(await duplicate.json()).toEqual(dispute);expect((await call(0,'/pbe/disputes',{...input,reason:'Contradictory request'})).status).toBe(409);expect((await call(2,'/pbe/disputes',input)).status).toBe(403);expect((await call(-1,'/pbe/disputes',input)).status).toBe(403);
 expect((await call(0,'/pbe/disputes')).status).toBe(403);const queue=await call(-1,'/pbe/disputes');expect(queue.status).toBe(200);expect((await queue.json() as {items:unknown[]}).items).toContainEqual(expect.objectContaining({id:dispute.id,questionVersion:1,partPoints:[1,1]}));
 const path='/pbe/disputes/'+encodeURIComponent(dispute.id);expect((await call(2,path)).status).toBe(403);const resolution={expectedRevision:1,pointsByPart:[1,1],reason:'Both labels are supported by the frozen source.'};expect((await call(0,path+'/resolve',resolution)).status).toBe(403);expect((await call(-1,path+'/resolve',{...resolution,pointsByPart:[2,0]})).status).toBe(400);expect((await call(-1,path+'/resolve',{...resolution,pointsByPart:[-1,1]})).status).toBe(400);
 await flagControl(false);const disabledQueue=await (await call(-1,'/pbe/disputes')).json() as {items:{id:string}[]};expect(disabledQueue.items.some(d=>d.id===dispute.id)).toBe(activity==='Solo');
 if(activity==='Team'){expect((await call(0,'/pbe/disputes',input)).status).toBe(403);expect((await call(0,path)).status).toBe(403);expect((await call(-1,path+'/resolve',resolution)).status).toBe(403);await flagControl(true);}
 await app.db.prepare("UPDATE Users SET kind='Adult',role='Admin' WHERE id=?").bind(players[0].id).run();
 expect((await call(0,path+'/resolve',resolution)).status).toBe(403);expect((await (await call(0,'/pbe/disputes')).json() as {items:unknown[]}).items).toEqual([]);
 await app.db.prepare("UPDATE Users SET kind='Student',role='Student' WHERE id=?").bind(players[0].id).run();
 const foreign=crypto.randomUUID();await app.db.prepare('INSERT INTO Organizations(id,name,slug) VALUES(?,?,?)').bind(foreign,'Other Club',foreign).run();await app.db.prepare('UPDATE Users SET org_id=? WHERE id=?').bind(foreign,players[3].id).run();
 expect((await call(3,path)).status).toBe(404);expect((await call(3,path+'/resolve',resolution)).status).toBe(404);expect([403,404]).toContain((await call(3,'/pbe/disputes',input)).status);
 await app.db.prepare('UPDATE Users SET org_id=? WHERE id=?').bind(TEST_ORG,players[3].id).run();
 const resolved=await call(-1,path+'/resolve',resolution);expect(resolved.status,await resolved.clone().text()).toBe(200);const final=await resolved.json();expect(final).toMatchObject({status:'Resolved',revision:2,resolution:{pointsByPart:[1,1],resolvedBy:TEST_USER}});expect(await (await call(-1,path+'/resolve',resolution)).json()).toEqual(final);expect((await call(-1,path+'/resolve',{...resolution,reason:'Different ruling'})).status).toBe(409);expect((await call(-1,path+'/resolve',{...resolution,expectedRevision:2})).status).toBe(409);
 if(activity==='Solo'){
  const recap=await (await call(0,`/study/sessions/${sessionId}/recap`)).json() as {results:{earnedPoints:number;originalEarnedPoints:number;dispute:{status:string}}[]};expect(recap.results[0]).toMatchObject({earnedPoints:2,originalEarnedPoints:1,dispute:{status:'Resolved'}});
  const before=await store.list('pbe-recall-event',TEST_ORG,{seasonId:season});let progress:{status:string}={status:'Provisional'};
  for(let page=0;page<12&&progress.status!=='Ready';page++){const replay=await call(-1,path+'/replay',{});expect(replay.status).toBe(200);progress=await replay.json() as {status:string};}
  expect(progress.status).toBe('Ready');expect(await store.list('pbe-recall-event',TEST_ORG,{seasonId:season})).toEqual(before);
  const reviews=await store.list<{review:{unresolved:boolean};provisional?:boolean}>('pbe-target-review',TEST_ORG,{seasonId:season});expect(reviews).toHaveLength(2);expect(reviews.every(r=>!r.review.unresolved&&!r.provisional)).toBe(true);
 }
 const adjustments=await store.list('pbe-grade-adjustment',TEST_ORG,{seasonId:season});expect(adjustments).toHaveLength(1);expect(adjustments[0]).toMatchObject({id:dispute.id+':2',questionVersion:1,pointsByPart:[1,1]});
 if(activity==='Solo')expect(JSON.stringify((await store.require<PbeSession>('pbe-session',sessionId,TEST_ORG)).value.attempts)).toBe(original);else{await app.db.exec('DROP TRIGGER dispute_fixture_failed_projection');const room=await (await call(0,`/organizations/${TEST_ORG}/practice/rooms/${sessionId}`)).json() as PracticeRoom;expect(room.provisional).toBe(false);expect(room.results.find(r=>r.team===1)?.accuracyHundredths).toBe(200);expect(room.results.map(r=>r.answers)).toEqual(JSON.parse(original).map((r:{answers:string[]})=>r.answers));}
},30000);
