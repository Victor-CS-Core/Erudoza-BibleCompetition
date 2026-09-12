// @vitest-environment node
import {expect,it} from 'vitest';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {TEST_ORG} from '../test-runtime';
import {probeFixture,storageFixture} from '../practice/pbe-room-source-fixture';
import {readRoomHistory} from '../practice/room-history';
import type {Env} from '../types';
import type {Room} from '../practice/state';
import type {PracticeRoom,PracticeBootstrap} from '../../../src/api/practice';
import {captureStoppedSource,classifySourceSchema,privateJson,sourceRun} from './restore-source-fixture';

it.each(['ordinary','large-answer'] as const)('retains a stopped native full90 %s source with complete bounded D1 and original DO inventories',async kind=>{
 const run=await sourceRun(kind);let disposed=false;const f=kind==='ordinary'?await ordinary(run):await large(run);
 try{
  const {app,room,actor,terminalInput,terminalResponse,authority,diagnostic,players}=f;
  expect(room.status).toBe('Completed');expect(authority.questions).toHaveLength(90);expect(authority.members).toHaveLength(kind==='ordinary'?6:12);expect(authority.submissions).toHaveLength(kind==='ordinary'?90:180);expect(diagnostic.outbox).toBeNull();
  const historyRow=await app.db.prepare("SELECT kind,id,org_id,season_id,owner_id,data,revision FROM Records WHERE kind='match' AND id=? AND org_id=?").bind(room.id,TEST_ORG).first<Record<string,string|number|null>>();expect(historyRow).not.toBeNull();
  const history=await readRoomHistory(app.db as unknown as Env['DB'],TEST_ORG,room.id);expect(history!.value).toEqual({...authority,messages:[],drafts:{},applied:{}});
  // Retain exact original commands, actors, answer bytes, locks and source response privately for target retry/readback.
  await privateJson(resolve(run.path,'source-expected.json'),{kind,sourceBuildHash:app.sourceBuildHash,room,authority,historyRow,terminalRetry:{actor:players[actor].id,cookie:players[actor].cookie,path:`/api/v1/organizations/${TEST_ORG}/practice/rooms/${room.id}/commands`,input:terminalInput,response:terminalResponse},diagnostic,namespaceProvenance:'This fresh owned source creates exactly one Room and its org:season Reports scope; it creates no Solo authority or replay Lobby. Account/source setup and test clock/diagnostics are synthetic.'});
  await app.runtime.dispose();disposed=true;
  await privateJson(resolve(run.path,'normal-disposed.json'),{disposed:true,at:new Date().toISOString(),sourceBuildHash:app.sourceBuildHash});
  const capture=await captureStoppedSource(run,[{kind:'room',id:room.id,orgId:TEST_ORG,seasonId:room.seasonId},{kind:'reports',orgId:TEST_ORG,seasonId:room.seasonId}],historyRow!,{kind,normalDisposed:true,sourceExpectedPath:resolve(run.path,'source-expected.json'),sourceBuildHash:app.sourceBuildHash,originalCheckpoint:{status:room.status,questions:authority.questions.length,members:authority.members.length,finals:authority.submissions.length,terminalCommandId:terminalInput.commandId,terminalActor:players[actor].id}});
  await privateJson(resolve(run.path,'source-capture-result.json'),capture);
  expect(JSON.parse(await readFile(resolve(run.path,'expected.json'),'utf8')).closedDisposed).toBe(true);
  process.stdout.write(`D3 native retained source ${JSON.stringify(capture)}\n`);
 }finally{if(!disposed)await f.app.runtime.dispose();}
},300000);

async function ordinary(run:Awaited<ReturnType<typeof sourceRun>>){
 const f=await probeFixture({d1Persist:run.d1Persist,durableObjectsPersist:run.durableObjectsPersist}),base=`/organizations/${TEST_ORG}/practice`;
 const created=await f.call(0,base+'/rooms',{seasonId:f.season,format:'Pbe',teamCount:1,teamSize:6,questionCount:90});expect(created.status).toBe(200);let room=await created.json() as PracticeRoom;
 const path=()=>`${base}/rooms/${room.id}`;
 const command=async(actor:number,action:string,extra:Record<string,unknown>={})=>{const input={commandId:crypto.randomUUID(),revision:room.revision,action,...extra};const response=await f.call(actor,path()+'/commands',input);expect(response.status,await response.clone().text()).toBe(200);room=await response.json() as PracticeRoom;return input;};
 const refresh=async()=>{const response=await f.call(0,path());expect(response.status,await response.clone().text()).toBe(200);room=await response.json() as PracticeRoom;};
 const snapshot=async()=>await(await f.call(0,path(),undefined,{'x-test-room-snapshot':'1'})).json() as Room;
 const diagnose=async()=>await(await f.call(0,path(),undefined,{'x-test-room-storage':'1'})).json() as {outbox:unknown};
 try{
  for(let n=1;n<6;n++){await command(0,'invite',{targetUserId:f.players[n].id});const inbox=await(await f.call(n,base+'/bootstrap')).json() as PracticeBootstrap;const response=await f.call(n,`${base}/invitations/${inbox.invitations[0].id}/accept`,{team:1});expect(response.status).toBe(200);room=await response.json() as PracticeRoom;}
  for(let n=0;n<6;n++)await command(n,'ready');await command(0,'start');let terminalInput:Record<string,unknown>={};
  for(let q=0;q<90;q++){
   if(q){f.advance(10000);await refresh();if(room.phase==='Break'){expect(q).toBe(45);f.advance(300000);await refresh();}}
   expect(room.phase).toBe('Presentation');const questionId=room.question!.id;await command(0,'present',{questionId,delivery:'TextFallback'});f.advance(3000);terminalInput=await command(0,'submit',{questionId,answers:['Alpha','Beta']});expect(room.phase).toBe('Review');
   if(q%30===0)process.stdout.write(`D3 ordinary gameplay question ${q+1}\n`);
  }
  f.advance(10000);await refresh();expect(room.status).toBe('Completed');const authority=await snapshot();
  for(let n=0;n<150&&(await diagnose()).outbox!==null;n++){f.advance(5000);const response=await f.call(0,path(),undefined,{'x-test-room-alarm':'1'});expect(response.status,await response.clone().text()).toBe(200);}
  const retry=await f.call(0,path()+'/commands',terminalInput);expect(retry.status).toBe(200);expect(await snapshot()).toEqual(authority);
  return {app:f.app,room,actor:0,players:f.players,terminalInput,terminalResponse:await retry.json(),authority,diagnostic:await diagnose()};
 }catch(error){await f.app.runtime.dispose();throw error;}
}

async function large(run:Awaited<ReturnType<typeof sourceRun>>){
 const f=await storageFixture(8,1,20,2,{d1Persist:run.d1Persist,durableObjectsPersist:run.durableObjectsPersist});
 try{
  await f.command(0,'start');let now=(await f.snapshot()).lastObserved;
  const answers=Array.from({length:8},()=> 'y'.repeat(2000));let actor=0,terminalInput:Record<string,unknown>={},maxCommandBody=0;
  for(let q=0;q<90;q++){
   expect(f.room.phase).toBe('Presentation');const questionId=f.room.question!.id;const scribes=f.room.members.filter(m=>m.scribe).map(m=>f.players.findIndex(p=>p.userId===m.userId));
   for(const n of scribes)await f.command(n,'present',{questionId,delivery:'TextFallback'});
   now+=3000;await f.refresh({'x-test-room-now':String(now)});expect(f.room.phase).toBe('Response');
   for(const n of scribes){const accepted=await f.command(n,'submit',{questionId,answers});maxCommandBody=Math.max(maxCommandBody,Buffer.byteLength(JSON.stringify(accepted.input)));actor=n;terminalInput=accepted.input;}
   expect(f.room.phase).toBe('Review');now+=10000;await f.refresh({'x-test-room-now':String(now)});if(f.room.phase==='Break'){expect(q).toBe(44);now+=300000;await f.refresh({'x-test-room-now':String(now)});}
   if(q%30===0)process.stdout.write(`D3 large-answer gameplay question ${q+1}\n`);
  }
  expect(f.room.status).toBe('Completed');expect(maxCommandBody).toBeLessThan(32768);const authority=await f.snapshot();expect(Buffer.byteLength(JSON.stringify(authority))).toBeGreaterThan(2_000_000);expect(authority.submissions).toHaveLength(180);
  for(const submission of authority.submissions){expect(submission.answers).toEqual(answers);expect(submission.attemptId).toBeTypeOf('string');expect(submission.responseLockedAtMs).toBeTypeOf('number');}
  const diagnose=async()=>await(await f.call(0,`/rooms/${f.room.id}`,undefined,{'x-test-room-storage':'1'})).json() as {outbox:unknown};
  for(let n=0;n<150&&(await diagnose()).outbox!==null;n++){now+=5000;const response=await f.call(0,`/rooms/${f.room.id}`,undefined,{'x-test-room-now':String(now),'x-test-room-alarm':'1'});expect(response.status,await response.clone().text()).toBe(200);}
  const retry=await f.call(actor,`/rooms/${f.room.id}/commands`,terminalInput);expect(retry.status,await retry.clone().text()).toBe(200);expect(await f.snapshot()).toEqual(authority);
  return {app:f.app,room:f.room,actor,players:f.players.map(player=>({id:player.userId,cookie:player.cookie})),terminalInput,terminalResponse:await retry.json(),authority,diagnostic:await diagnose()};
 }catch(error){await f.app.runtime.dispose();throw error;}
}


it('recognizes only the exact protected provider metadata schema without reading or claiming its rows',()=>{
 const entry={type:'table',name:'_cf_METADATA',tbl_name:'_cf_METADATA',sql:'CREATE TABLE _cf_METADATA (\n        key INTEGER PRIMARY KEY,\n        value BLOB\n      )'};
 const result=classifySourceSchema([entry]);expect(result.application).toEqual([]);expect(result.providerMetadata).toHaveLength(1);expect(result.providerMetadata[0]).toMatchObject({entry,columns:{readable:false},rowCount:{readable:false}});
});
it('rejects altered protected provider metadata SQL and case',()=>{
 const entry={type:'table',name:'_cf_METADATA',tbl_name:'_cf_METADATA',sql:'CREATE TABLE _cf_METADATA (key INTEGER PRIMARY KEY,value BLOB)'};
 expect(()=>classifySourceSchema([entry])).toThrow('altered protected provider schema');expect(()=>classifySourceSchema([{...entry,name:'_CF_METADATA'}])).toThrow('unknown protected provider schema');
});
it('rejects extra protected provider entries instead of allowing a prefix',()=>{
 expect(()=>classifySourceSchema([{type:'table',name:'_cf_OTHER',tbl_name:'_cf_OTHER',sql:'CREATE TABLE _cf_OTHER (id INTEGER)'}])).toThrow('unknown protected provider schema');
});
