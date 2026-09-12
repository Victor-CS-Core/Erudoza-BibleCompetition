// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {writeFile} from 'node:fs/promises';
import type {PracticeRoom,PracticeBootstrap} from '../../../src/api/practice';
import {createNativeTestApp,TEST_ORG,TEST_USER} from '../test-runtime';
import {Store} from '../store';
import type {Env} from '../types';
import {sourceProof} from '../pbe/bank';
import type {PbeQuestion} from '../pbe/types';
import {resolvePbeRoomSources,resolvePbeSources,type PbeIntroduction} from '../pbe/sources';
import {makeRoom,join} from './state';
import type {RequestContext,Actor} from '../types';
let app:Awaited<ReturnType<typeof createNativeTestApp>>;
afterEach(async()=>{await app?.runtime.dispose();});
it.each([1,2] as const)('serves full-season material only inside a private %i-team six-seat room and meters composed D1 exposure',async(teams)=>{
 const meters:{bindingCalls:number;statements:number}[]=[];const measurements:Record<string,{bindingCalls:number;statements:number}>={};
 const measure=(name:string)=>{const value=meters.splice(0).reduce((a,b)=>({bindingCalls:a.bindingCalls+b.bindingCalls,statements:a.statements+b.statements}),{bindingCalls:0,statements:0});measurements[name]=value;expect(value.statements).toBeLessThanOrEqual(50);};
 app=await createNativeTestApp({measureD1:true,delayAuthentication:true,replaceRoomAuthority:true,onD1Meter:m=>meters.push(m)});const store=new Store(app.db as unknown as Env['DB']),season=crypto.randomUUID(),pack=crypto.randomUUID();
 await store.insert('practice-setting',TEST_ORG,TEST_ORG,{enabled:true});
 await store.insert('season',season,TEST_ORG,{id:season,organizationId:TEST_ORG,status:'Active',pbeEnabled:true});
 await store.insert('pack',pack,TEST_ORG,{id:pack,isActive:true,licensingStatus:'approved',sourceType:'Scripture'});
 const sources=[];for(let n=1;n<=2;n++){const s={id:crypto.randomUUID(),contentPackId:pack,bookKey:'GEN',chapter:1,verse:n,ordinal:n,citation:`Genesis 1:${n}`,canonicalText:'Alpha',isActive:true};sources.push(s);await store.insert('source',s.id,TEST_ORG,s,{ownerId:pack});}
 const range={bookKey:'GEN',startChapter:1,startVerse:1,endChapter:1,endVerse:2};await store.insert('scope',season,TEST_ORG,{contentPackId:pack,includes:[range],excludes:[]});
 const target=crypto.randomUUID();await store.insert('pbe-target',target,TEST_ORG,{id:target,sourceUnitIds:[sources[1].id],skill:'FactualRecall',label:'Who?'},{seasonId:season,ownerId:sources[1].id});
 for(let n=0;n<92;n++){const q:PbeQuestion={schemaVersion:2,id:crypto.randomUUID(),version:1,contentPackId:pack,sourceUnitId:sources[1].id,sourceUnitIds:[sources[1].id],sourceKind:'Scripture',reference:sources[1].citation,evidence:'Alpha',kind:'ShortAnswer',prompt:'Who?',ordered:false,parts:[{targetId:target,acceptedAnswers:['Alpha'],points:1}]};await store.insert('pbe-question-head',q.id,TEST_ORG,{id:q.id,seasonId:season,published:true,sourceFingerprint:await sourceProof(q,new Map(sources.map(s=>[s.id,s]))),question:q},{seasonId:season,ownerId:sources[1].id});}
 const players=[];for(let n=0;n<6*teams;n++){const userId=crypto.randomUUID(),name=`room-student-${n}`;await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT ?,org_id,?,?,'Student','Student',password_hash,credential_version FROM Users WHERE id=?").bind(userId,name,name,TEST_USER).run();await store.insert('membership',`${season}:${userId}`,TEST_ORG,{seasonId:season,userId,difficulty:'Advanced'},{seasonId:season,ownerId:userId});await store.insert('assignment',crypto.randomUUID(),TEST_ORG,{seasonId:season,studentUserId:userId,contentPackId:pack,...range,endVerse:1},{seasonId:season,ownerId:userId});const login=await app.fetch('/api/v1/auth/login',{method:'POST',headers:{Origin:'https://erudoza.test'},body:JSON.stringify({identifier:name,password:'Testing!123'})});players.push({userId,cookie:login.headers.get('set-cookie')!.split(';')[0]});}
 const actor:Actor={userId:players[0].userId,organizationId:TEST_ORG,organizationName:'Fixture',displayName:'Room student',userName:'room-student-0',email:null,kind:'Student',role:'Student',credentialVersion:'v1'};
 const trustedRoom=makeRoom(crypto.randomUUID(),actor,{seasonId:season,format:'Pbe',teamCount:teams,teamSize:6,questionCount:90},'fixture',Date.now());for(let n=1;n<players.length;n++)join(trustedRoom,{...actor,userId:players[n].userId},Math.floor(n/6)+1);
 const introIds:string[]=[];for(let n=0;n<5;n++){const id=crypto.randomUUID(),unit=crypto.randomUUID();introIds.push(unit);const intro:PbeIntroduction={id,organizationId:TEST_ORG,seasonId:n===4?crypto.randomUUID():season,bookKey:n===3?'EXO':'GEN',sourceEdition:'Synthetic',title:'Fixture',citation:'Fixture §1',licensingStatus:n===2?'unknown':'approved',reviewed:n!==1,units:[{id:unit,citation:'Fixture §1',canonicalText:'Introduction fact'}]};await store.insert('pbe-introduction',id,TEST_ORG,intro,{seasonId:intro.seasonId});}
 const ctx:RequestContext={actor,env:{DB:app.db} as unknown as Env,store,orgId:TEST_ORG,path:'',request:new Request('https://erudoza.test/fixture')};
 const allowed=await resolvePbeRoomSources(ctx,trustedRoom,false);expect(allowed.sources.filter(s=>s.sourceKind==='Commentary').map(s=>s.id)).toEqual([introIds[0]]);
 const personal=await resolvePbeSources(ctx,{organizationId:TEST_ORG,seasonId:season,studentId:actor.userId});expect(personal.sources.map(s=>s.id)).toEqual([sources[0].id]);
 const coachCookie=(await app.login()).headers.get('set-cookie')!.split(';')[0];
 const call=async(n:number,path:string,data?:unknown)=>app.fetch(`/api/v1/organizations/${TEST_ORG}/practice${path}`,{method:data?'POST':'GET',headers:{Cookie:n===-1?coachCookie:players[n].cookie,Origin:'https://erudoza.test'},...(data?{body:JSON.stringify(data)}:{})});
 let response=await call(teams===1?-1:0,'/rooms',{seasonId:season,teamSize:6,teamCount:teams,questionCount:90,format:'Pbe'});expect(response.status,await response.clone().text()).toBe(200);let room=await response.json() as PracticeRoom;
 const command=async(n:number,action:string,extra:Record<string,unknown>={})=>{const r=await call(n,`/rooms/${room.id}/commands`,{commandId:crypto.randomUUID(),revision:room.revision,action,...extra});expect(r.status,await r.clone().text()).toBe(200);room=await r.json() as PracticeRoom;return r;};
 for(let n=teams===1?0:1;n<players.length;n++){
 await command(teams===1?-1:0,'invite',{targetUserId:players[n].userId,team:Math.floor(n/6)+1});
 let invitations:PracticeBootstrap['invitations']=[];for(let i=0;i<30&&!invitations.length;i++){invitations=(await (await call(n,'/bootstrap')).json() as PracticeBootstrap).invitations;if(!invitations.length)await new Promise(r=>setTimeout(r,20));}
 response=await call(n,`/invitations/${invitations[0].id}/accept`,{team:Math.floor(n/6)+1});expect(response.status).toBe(200);room=await response.json() as PracticeRoom;
 }
 for(let n=0;n<players.length;n++)await command(n,'ready');meters.length=0;
 const started=await command(0,'start');expect(started.status).toBe(200);measure('start');expect(room.question!.reference).toBe('Genesis 1:2');expect(JSON.stringify(room)).not.toContain('acceptedAnswers');
 await app.db.prepare("UPDATE Records SET data=json_set(data,'$.question.version',2,'$.question.parts[0].acceptedAnswers',json('[\"Changed\"]')),revision=revision+1 WHERE kind='pbe-question-head' AND id=?").bind(room.question!.id).run();
 await call(0,`/rooms/${room.id}`);await new Promise(r=>setTimeout(r,100));
 const exposure=await store.list<{servedCount:number}>('pbe-question-service',TEST_ORG,{seasonId:season});expect(exposure).toHaveLength(6*teams);expect(exposure.every(e=>e.servedCount===1)).toBe(true);
 expect(await store.list('pbe-recall-event',TEST_ORG,{seasonId:season})).toHaveLength(0);
 await app.db.prepare("UPDATE Records SET data=json_set(data,'$.pbeEnabled',json('false')),revision=revision+1 WHERE kind='season' AND id=?").bind(season).run();
 if(teams===1){
  const original=room.question!.id;const replaced=await app.fetch(`/api/v1/organizations/${TEST_ORG}/practice/rooms/${room.id}`,{headers:{Cookie:players[0].cookie,Origin:'https://erudoza.test','x-test-authority-replaced':'1'}});expect(replaced.status).toBe(200);
  for(let retry=0;retry<40;retry++){await new Promise(r=>setTimeout(r,50));room=await (await call(0,`/rooms/${room.id}`)).json() as PracticeRoom;if(room.phase==='Paused')break;}
  expect(room.phase).toBe('Paused');expect(room.question).toBeNull();meters.length=0;await command(0,'next');measure('resume-unarmed');expect(room.phase).toBe('Presentation');expect(room.question!.id).not.toBe(original);
 }
 meters.length=0;for(let team=0;team<teams;team++)await command(team*6,'present',{questionId:room.question!.id,delivery:team===0?'TextFallback':'Audio'});measure('present-'+teams); expect(room.phase).toBe('Scheduled');await new Promise(r=>setTimeout(r,3100));response=await call(0,`/rooms/${room.id}`);room=await response.json() as PracticeRoom;expect(room.phase).toBe('Response');
 if(teams===1){
  await app.db.exec("CREATE TRIGGER fail_room_projection BEFORE UPDATE ON Records WHEN NEW.kind='room' BEGIN SELECT RAISE(ABORT,'fixture projection failure'); END");
  meters.length=0;
  const slowDraft=app.fetch(`/api/v1/organizations/${TEST_ORG}/practice/rooms/${room.id}/commands`,{method:'POST',headers:{Cookie:players[0].cookie,Origin:'https://erudoza.test','x-test-auth-delay':'1'},body:JSON.stringify({commandId:crypto.randomUUID(),revision:room.revision,action:'draft',questionId:room.question!.id,answers:['Wrong draft']})});
  await new Promise(r=>setTimeout(r,50));const final=call(0,`/rooms/${room.id}/commands`,{commandId:crypto.randomUUID(),revision:room.revision,action:'submit',questionId:room.question!.id,answers:['Alpha']});
  expect((await slowDraft).status).toBe(200);expect((await final).status).toBe(200);measure('ordered-draft-and-final');
  const beforeRetry=await (await call(0,`/rooms/${room.id}`)).json() as PracticeRoom;expect(beforeRetry.results[0].answers).toEqual(['Alpha']);
  expect((await store.get('room',room.id,TEST_ORG))?.revision).toBeLessThan(beforeRetry.revision);
  await app.db.exec('DROP TRIGGER fail_room_projection');
  for(let retry=0;retry<70;retry++){const saved=await store.get('room',room.id,TEST_ORG);if(saved?.revision===beforeRetry.revision)break;await new Promise(r=>setTimeout(r,100));}
  expect((await store.get('room',room.id,TEST_ORG))?.revision).toBe(beforeRetry.revision);
  expect((await (await call(0,`/rooms/${room.id}`)).json() as PracticeRoom).results).toEqual(beforeRetry.results);
  expect((await store.list<{servedCount:number}>('pbe-question-service',TEST_ORG,{seasonId:season})).every(row=>row.servedCount===1)).toBe(true);
  const rejected=app.fetch(`/api/v1/organizations/${TEST_ORG}/practice/rooms/${room.id}/commands`,{method:'POST',headers:{Origin:'https://erudoza.test','x-test-auth-delay':'1'},body:JSON.stringify({commandId:crypto.randomUUID(),revision:room.revision,action:'draft',questionId:room.question!.id,answers:['Wrong']})});
  await new Promise(r=>setTimeout(r,50));const following=call(0,`/rooms/${room.id}`);expect((await rejected).status).toBe(401);expect((await following).status).toBe(200);
 }
 meters.length=0;const accepted=await command(0,'submit',{questionId:room.question!.id,answers:['Alpha']});expect(accepted.status).toBe(200);measure('submit');if(teams===2)await command(6,'submit',{questionId:room.question!.id,answers:['Alpha']});room=await (await call(0,`/rooms/${room.id}`)).json() as PracticeRoom;expect(room.results[0]).toMatchObject({accuracyHundredths:100,speedHundredths:0});expect(room.scores).toHaveLength(teams);
 response=await call(0,'/rooms',{seasonId:season,teamSize:6,teamCount:teams,questionCount:90,format:'Pbe'});expect(response.status).toBe(403);
 if(teams===2){
  await new Promise(r=>setTimeout(r,10100));room=await (await call(0,`/rooms/${room.id}`)).json() as PracticeRoom;expect(room.phase).toBe('Presentation');
  for(let team=0;team<teams;team++)await command(team*6,'present',{questionId:room.question!.id,delivery:'TextFallback'});
  await new Promise(r=>setTimeout(r,3100));room=await (await call(0,`/rooms/${room.id}`)).json() as PracticeRoom;
  await command(0,'submit',{questionId:room.question!.id,answers:['Alpha']});const interruptedQuestion=room.question!.id;
  response=await app.fetch(`/api/v1/organizations/${TEST_ORG}/practice/rooms/${room.id}`,{headers:{Cookie:players[0].cookie,Origin:'https://erudoza.test','x-test-authority-replaced':'1'}});expect(response.status).toBe(200);await writeFile(new URL('../../../../../.local/c2-native-authority-size.json',import.meta.url),JSON.stringify(await response.json(),null,2));
  for(let retry=0;retry<40;retry++){await new Promise(r=>setTimeout(r,50));room=await (await call(0,`/rooms/${room.id}`)).json() as PracticeRoom;if(room.status==='Interrupted')break;}
  expect(room.status).toBe('Interrupted');expect(room.results).toHaveLength(3);expect(room.results.find(r=>r.questionId===interruptedQuestion)?.answers).toEqual(['Alpha']);
  const stored=await store.get<import('./state').Room>('match',room.id,TEST_ORG);expect(stored?.value.reserves).toHaveLength(1);expect(stored?.value.completedAt).toBeUndefined();expect(stored?.value.submissions.at(-1)?.responseLockedAtMs).toBeTypeOf('number');await writeFile(new URL('../../../../../.local/c2-native-room-size.json',import.meta.url),JSON.stringify({questions:stored!.value.questions.length,reserves:stored!.value.reserves.length,roster:stored!.value.members.length,utf8Bytes:new TextEncoder().encode(JSON.stringify(stored!.value)).length,kind:'match projection after two presented questions; authority also retains messages/drafts/applied commands'}));
 }
 await app.db.prepare("DELETE FROM Records WHERE kind='membership' AND id=?").bind(`${season}:${players[1].userId}`).run();response=await call(0,`/rooms/${room.id}`);expect(response.status).toBe(teams===2?200:403);
 await store.insert('membership',`${season}:${players[1].userId}`,TEST_ORG,{seasonId:season,userId:players[1].userId,difficulty:'Advanced'},{seasonId:season,ownerId:players[1].userId});
 await app.db.prepare("UPDATE Records SET data=json_set(data,'$.canonicalText','Revoked source revision'),revision=revision+1 WHERE kind='source' AND id=?").bind(sources[1].id).run();expect((await call(0,`/rooms/${room.id}`)).status).toBe(teams===2?200:400);
 await writeFile(new URL(`../../../../../.local/c2-native-meter-${teams}.json`,import.meta.url),JSON.stringify(measurements,null,2));
},45000);
