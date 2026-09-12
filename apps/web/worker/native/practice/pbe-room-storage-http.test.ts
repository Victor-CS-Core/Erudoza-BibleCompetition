// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {createNativeTestApp,TEST_ORG} from '../test-runtime';
import {storageFixture} from './pbe-room-source-fixture';
import {Store} from '../store';
import type {Env} from '../types';
import {readRoomHistory,listRoomSummaries,type RoomHistoryEnvelope} from './room-history';

let app:Awaited<ReturnType<typeof createNativeTestApp>>;
afterEach(async()=>{await app?.runtime.dispose();});

function budgetSummary(measurements:{operation:string;statements:number;bindingCalls:number}[]){return Object.fromEntries([...new Set(measurements.map(m=>m.operation))].map(operation=>{const rows=measurements.filter(m=>m.operation===operation);return [operation,{requests:rows.length,maxStatements:Math.max(...rows.map(m=>m.statements)),maxBindingCalls:Math.max(...rows.map(m=>m.bindingCalls))}];}));}

async function fixture(parts:number,aliases:number,aliasLength:number,teams:1|2=2){
 const result=await storageFixture(parts,aliases,aliasLength,teams);app=result.app;return result;
}

it('persists an actually authored 90-question rubric bank beyond a single SQLite row and reloads its exact frozen versions',async()=>{
 const f=await fixture(4,10,600);
 await f.command(0,'start');
 const stored=await f.snapshot(),bytes=Buffer.byteLength(JSON.stringify(stored));
 expect(bytes).toBeGreaterThan(2_000_000);
 expect(stored.questions).toHaveLength(90);expect(stored.reserves).toHaveLength(1);
 const byId=new Map(f.questions.map(q=>[q.id,q]));for(const q of [...stored.questions,...stored.reserves])expect(q).toEqual(byId.get(q.id));
 expect(await f.snapshot()).toEqual(stored);
 const diagnostic=await (await f.call(0,`/rooms/${f.room.id}`,undefined,{'x-test-room-storage':'1'})).json();
 process.stdout.write(`C3 authored large-rubric storage ${JSON.stringify({maxAuthorBody:f.maxAuthorBody,authorityBytes:bytes,diagnostic,budgets:budgetSummary(f.measurements),maxStatements:Math.max(...f.measurements.map(m=>m.statements)),maxBindingCalls:Math.max(...f.measurements.map(m=>m.bindingCalls))})}\n`);
},60000);

it('retains 180 large accepted finals through completion, history and exact retry with a bounded real command body',async()=>{
 const f=await fixture(8,1,20);
 await f.command(0,'start');let now=(await f.snapshot()).lastObserved;
 const answers=Array.from({length:8},()=> 'y'.repeat(2000));let lastRetry:{actor:number;input:Record<string,unknown>}|undefined,maxCommandBody=0;
 for(let q=0;q<90;q++){
  if(q%30===0)process.stdout.write(`C3 large-final progress question ${q+1}\n`);
  expect(f.room.phase).toBe('Presentation');const questionId=f.room.question!.id;
  const scribes=f.room.members.filter(m=>m.scribe).map(m=>f.players.findIndex(p=>p.userId===m.userId));
  for(const n of scribes)await f.command(n,'present',{questionId,delivery:'TextFallback'});
  now+=3000;await f.refresh({'x-test-room-now':String(now)});expect(f.room.phase).toBe('Response');
  if(q===89)await app.db.exec("CREATE TRIGGER fixture_projection_failure BEFORE INSERT ON PracticeRoomComponents BEGIN SELECT RAISE(ABORT,'fixture projection unavailable'); END");
  for(const n of scribes){const accepted=await f.command(n,'submit',{questionId,answers});maxCommandBody=Math.max(maxCommandBody,Buffer.byteLength(JSON.stringify(accepted.input)));lastRetry={actor:n,input:accepted.input};}
  expect(f.room.phase).toBe('Review');now+=10000;await f.refresh({'x-test-room-now':String(now)});
  if(f.room.phase==='Break'){expect(q).toBe(44);now+=300000;await f.refresh({'x-test-room-now':String(now)});}
 }
 expect(f.room.status).toBe('Completed');expect(maxCommandBody).toBeLessThan(32768);
 const authority=await f.snapshot(),bytes=Buffer.byteLength(JSON.stringify(authority));expect(bytes).toBeGreaterThan(2_000_000);expect(authority.submissions).toHaveLength(180);
 for(const s of authority.submissions){expect(s.answers).toEqual(answers);expect(s.attemptId).toBeTypeOf('string');expect(s.responseLockedAtMs).toBeTypeOf('number');}
 const retry=await f.call(lastRetry!.actor,`/rooms/${f.room.id}/commands`,lastRetry!.input);expect(retry.status,await retry.clone().text()).toBe(200);expect(await f.snapshot()).toEqual(authority);
 const failedDiagnostic=await (await f.call(0,`/rooms/${f.room.id}`,undefined,{'x-test-room-storage':'1'})).json() as {outbox:unknown};expect(failedDiagnostic.outbox).not.toBeNull();expect(await f.store.get('match',authority.id,TEST_ORG)).toBeNull();
 await app.db.exec('DROP TRIGGER fixture_projection_failure');
 // Simulate losing an acknowledged D1 component. Publication must discover and restage it.
 const missingNode=await app.db.prepare("SELECT hash,data FROM PracticeRoomComponents WHERE org_id=? AND room_id=? AND json_extract(data,'$.type')='leaf' AND CASE WHEN json_valid(json_extract(data,'$.data')) THEN json_extract(json_extract(data,'$.data'),'$.id') END=? LIMIT 1").bind(TEST_ORG,authority.id,authority.questions[0].id).first<{hash:string;data:string}>();expect(missingNode).not.toBeNull();await app.db.prepare('DELETE FROM PracticeRoomComponents WHERE org_id=? AND room_id=? AND hash=?').bind(TEST_ORG,authority.id,missingNode!.hash).run();
 process.stdout.write('C3 large-final closure starting\n');
 for(let i=0;i<150&&!await f.store.get('match',authority.id,TEST_ORG);i++){if(i%20===0)process.stdout.write(`C3 closure continuation ${i}\n`);now+=5000;const response=await f.call(0,`/rooms/${f.room.id}`,undefined,{'x-test-room-now':String(now),'x-test-room-alarm':'1'});expect(response.status,await response.clone().text()).toBe(200);}
 expect(await app.db.prepare('SELECT hash FROM PracticeRoomComponents WHERE org_id=? AND room_id=? AND hash=?').bind(TEST_ORG,authority.id,missingNode!.hash).first()).not.toBeNull();
 process.stdout.write('C3 large-final closure complete\n');
 const history=await readRoomHistory(app.db as unknown as Env['DB'],TEST_ORG,authority.id);expect(history?.value.submissions).toEqual(authority.submissions);
 const bootstrap=await f.call(0,'/bootstrap');expect(bootstrap.status).toBe(200);
 const own=authority.submissions[0],actor=f.players.findIndex(p=>p.userId===own.scribeId);expect((await f.call(actor,'/pbe/disputes',{activity:'Team',sessionId:authority.id,attemptId:own.attemptId,reason:'Check the persisted final'})).status).toBe(201);
 const diagnostic=await (await f.call(0,`/rooms/${f.room.id}`,undefined,{'x-test-room-storage':'1'})).json() as {outbox:unknown;wire:{name:string;value:number}[]};expect(diagnostic.outbox).toBeNull();expect(diagnostic.wire.map(item=>item.name)).toEqual(expect.arrayContaining(['/stage-wire-bytes','/stage-nodes','/project-components-wire-bytes']));for(const item of diagnostic.wire)expect(item.value).toBeLessThanOrEqual(item.name.endsWith('-nodes')?8:1048576);
 const d1Storage=await app.db.prepare('SELECT count(*) AS rows,max(length(CAST(data AS BLOB))) AS maxDataBytes,max(length(CAST(data AS BLOB))+length(org_id)+length(season_id)+length(room_id)+length(hash)) AS maxPayloadRowBytes,sum(length(CAST(data AS BLOB))) AS totalDataBytes FROM PracticeRoomComponents WHERE org_id=? AND room_id=?').bind(TEST_ORG,authority.id).first();
 process.stdout.write(`C3 full-final storage ${JSON.stringify({maxAuthorBody:f.maxAuthorBody,maxCommandBody,authorityBytes:bytes,finals:authority.submissions.length,diagnostic,d1Storage,budgets:budgetSummary(f.measurements),maxStatements:Math.max(...f.measurements.map(m=>m.statements)),maxBindingCalls:Math.max(...f.measurements.map(m=>m.bindingCalls)),slowestMs:Math.max(...f.measurements.map(m=>m.elapsedMs))})}\n`);
 // The internal projection authority rejects conflicting immutable bytes and revisions.
 const reports=await app.runtime.getDurableObjectNamespace('REPORTS'),target=reports.get(reports.idFromName(`${TEST_ORG}:${f.season}`));
 const envelope=(await f.store.get<RoomHistoryEnvelope>('match',authority.id,TEST_ORG))!.value;
 const publish=async(value:unknown)=>target.fetch('https://internal/project-components',{method:'POST',body:JSON.stringify(value)});
 const original={manifest:envelope.manifest,summary:envelope.summary};expect((await publish(original)).status).toBe(200);
 await app.db.prepare("UPDATE Records SET revision=revision+1 WHERE kind='match' AND org_id=? AND id=?").bind(TEST_ORG,authority.id).run();expect((await publish(original)).status).toBe(200);expect((await f.store.get('match',authority.id,TEST_ORG))!.revision).toBe(authority.revision+1);await app.db.prepare("UPDATE Records SET revision=revision-1 WHERE kind='match' AND org_id=? AND id=?").bind(TEST_ORG,authority.id).run();
 process.stdout.write('C3 large-final adversarial publication check\n');
 const conflict=structuredClone(original);conflict.summary.completedAt='2000-01-01T00:00:00.000Z';let conflicting;for(let i=0;i<100;i++){conflicting=await publish(conflict);if(conflicting.status!==200||(await conflicting.clone().json() as {projected:boolean}).projected)break;}expect(conflicting!.status).toBe(503);expect(await conflicting!.text()).toContain('Conflicting history');
 const node=await app.db.prepare('SELECT hash,data FROM PracticeRoomComponents WHERE org_id=? AND room_id=? LIMIT 1').bind(TEST_ORG,authority.id).first<{hash:string;data:string}>();await app.db.prepare('UPDATE PracticeRoomComponents SET data=? WHERE org_id=? AND room_id=? AND hash=?').bind('{}',TEST_ORG,authority.id,node!.hash).run();
 const stage=await target.fetch('https://internal/stage',{method:'POST',body:JSON.stringify({id:authority.id,orgId:TEST_ORG,seasonId:f.season,nodes:[node]})});expect(stage.status).toBe(503);await app.db.prepare('UPDATE PracticeRoomComponents SET data=? WHERE org_id=? AND room_id=? AND hash=?').bind(node!.data,TEST_ORG,authority.id,node!.hash).run();

},300000);

it('recovers a persisted partial final with own-team privacy and reads legacy histories before failing closed on a missing authority node',async()=>{
 const f=await fixture(1,1,20);await f.command(0,'start');let now=(await f.snapshot()).lastObserved;
 const questionId=f.room.question!.id,scribes=f.room.members.filter(m=>m.scribe).map(m=>f.players.findIndex(p=>p.userId===m.userId));
 for(const n of scribes)await f.command(n,'present',{questionId,delivery:'TextFallback'});
 now+=3000;await f.refresh({'x-test-room-now':String(now)});const accepted=await f.command(scribes[0],'submit',{questionId,answers:['saved exact final']});const before=await f.snapshot();
 await app.restart();await f.refresh();const recovered=await f.snapshot();expect(recovered.status).toBe('Interrupted');expect(recovered.submissions).toEqual(before.submissions);expect(recovered.applied).toEqual(before.applied);
 const retry=await f.call(scribes[0],`/rooms/${f.room.id}/commands`,accepted.input);expect(retry.status).toBe(200);expect((await f.snapshot()).submissions).toEqual(before.submissions);
 const attemptId=before.submissions[0].attemptId;expect((await f.call(scribes[0],'/pbe/disputes',{activity:'Team',sessionId:f.room.id,attemptId,reason:'Check the persisted final'})).status).toBe(201);expect((await f.call(scribes[1],'/pbe/disputes',{activity:'Team',sessionId:f.room.id,attemptId,reason:'Check the other team'})).status).toBe(403);
 // Read both raw historical formats, including a final predating attempt IDs.
 for(const format of ['Pbe','Arcade'] as const){const legacy=structuredClone(recovered);legacy.id=crypto.randomUUID();legacy.format=format;delete legacy.submissions[0].attemptId;await new Store(app.db as unknown as Env['DB']).insert('match',legacy.id,TEST_ORG,legacy,{seasonId:f.season});expect((await readRoomHistory(app.db as unknown as Env['DB'],TEST_ORG,legacy.id))!.value).toEqual(legacy);const summary=(await listRoomSummaries(app.db as unknown as Env['DB'],TEST_ORG,f.season)).find(s=>s.id===legacy.id)!;expect(summary.submissions[0].unanswered).toBe(0);expect(summary.submissions[0].accuracyHundredths).toBe(legacy.submissions[0].accuracyHundredths);}
 expect((await f.call(0,`/rooms/${f.room.id}`,undefined,{'x-test-remove-room-component':'1'})).status).toBe(200);expect((await f.call(0,`/rooms/${f.room.id}`)).status).toBe(503);
},60000);
