/** Shared original HTTP fixture setup. Tests retain their own gameplay and adversarial assertions. */
import {expect} from 'vitest';
import {createNativeTestApp,TEST_ORG,TEST_USER} from '../test-runtime';
import {Store} from '../store';
import type {Env} from '../types';
import type {PbeQuestion} from '../pbe/types';
import {sourceProof} from '../pbe/bank';
import type {Room} from './state';
import type {PracticeRoom,PracticeBootstrap} from '../../../src/api/practice';
type Persistence={d1Persist?:string;durableObjectsPersist?:string};
export async function probeFixture(persistence:Persistence={}){
 let now=Date.now(),realClock=false;
 const app=await createNativeTestApp({...persistence,measureD1:true,replaceRoomAuthority:true,roomTestClock:true,roomStorageDiagnostics:true});const store=new Store(app.db as unknown as Env['DB']),season=crypto.randomUUID(),pack=crypto.randomUUID(),source=crypto.randomUUID();
 await store.insert('practice-setting',TEST_ORG,TEST_ORG,{enabled:true});await store.insert('season',season,TEST_ORG,{id:season,organizationId:TEST_ORG,status:'Active',pbeEnabled:true});await store.insert('pack',pack,TEST_ORG,{id:pack,isActive:true,licensingStatus:'approved',sourceType:'Scripture'});
 const labels=['Alpha','Beta'];
 const unit={id:source,contentPackId:pack,bookKey:'GEN',chapter:1,verse:1,ordinal:1,citation:'Genesis 1:1',canonicalText:'Alpha and Beta',isActive:true};await store.insert('source',source,TEST_ORG,unit,{ownerId:pack});const range={bookKey:'GEN',startChapter:1,startVerse:1,endChapter:1,endVerse:1};await store.insert('scope',season,TEST_ORG,{contentPackId:pack,includes:[range],excludes:[]});
 const targets=labels.map((_,n)=>({id:crypto.randomUUID(),sourceUnitIds:[source],skill:'FactualRecall',label:`Label ${n}`}));for(const target of targets)await store.insert('pbe-target',target.id,TEST_ORG,target,{seasonId:season,ownerId:source});
 for(let n=0;n<91;n++){const q:PbeQuestion={schemaVersion:2,id:crypto.randomUUID(),version:1,contentPackId:pack,sourceUnitId:source,sourceUnitIds:[source],sourceKind:'Scripture',reference:unit.citation,evidence:unit.canonicalText,kind:'List',prompt:`Name the labels, variant ${n}.`,ordered:false,parts:targets.map((t,i)=>({targetId:t.id,acceptedAnswers:[labels[i]],points:1}))};await store.insert('pbe-question-head',q.id,TEST_ORG,{id:q.id,seasonId:season,published:true,sourceFingerprint:await sourceProof(q,new Map([[source,unit]])),question:q},{seasonId:season,ownerId:source});}
 const players:{id:string;cookie:string}[]=[];for(let n=0;n<6;n++){const id=crypto.randomUUID(),name=`dispute-player-${n}`;await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT ?,org_id,?,?,'Student','Student',password_hash,credential_version FROM Users WHERE id=?").bind(id,name,name,TEST_USER).run();await store.insert('membership',`${season}:${id}`,TEST_ORG,{seasonId:season,userId:id,difficulty:'Advanced'},{seasonId:season,ownerId:id});await store.insert('assignment',crypto.randomUUID(),TEST_ORG,{seasonId:season,studentUserId:id,contentPackId:pack,...range},{seasonId:season,ownerId:id});const login=await app.fetch('/api/v1/auth/login',{method:'POST',headers:{Origin:'https://erudoza.test'},body:JSON.stringify({identifier:name,password:'Testing!123'})});players.push({id,cookie:login.headers.get('set-cookie')!.split(';')[0]});}
 const coach=(await app.login()).headers.get('set-cookie')!.split(';')[0];
 const call=async(actor:number,path:string,data?:unknown,headers:Record<string,string>={})=>{const response=await app.fetch('/api/v1'+path,{method:data?'POST':'GET',headers:{Cookie:actor===-1?coach:players[actor].cookie,Origin:'https://erudoza.test',...(realClock?{}:{'x-test-room-now':String(now)}),...headers},...(data?{body:JSON.stringify(data)}:{})});return response;};
 return {app,store,season,players,call,advance:(ms:number)=>{now+=ms;},useRealClock:()=>{realClock=true;},get now(){return now;}};
}

/** Questions are admitted and published by the real coach HTTP handlers. Only account/source fixtures use SQL. */
export async function storageFixture(parts:number,aliases:number,aliasLength:number,teams:1|2=2,persistence:Persistence={}){
 const meters:{bindingCalls:number;statements:number}[]=[];
 const app=await createNativeTestApp({...persistence,measureD1:true,replaceRoomAuthority:true,roomTestClock:true,roomStorageDiagnostics:true,onD1Meter:m=>meters.push(m)});
 const store=new Store(app.db as unknown as Env['DB']),season=crypto.randomUUID(),pack=crypto.randomUUID(),sourceId=crypto.randomUUID(),targetId=crypto.randomUUID();
 await store.insert('practice-setting',TEST_ORG,TEST_ORG,{enabled:true});
 await store.insert('season',season,TEST_ORG,{id:season,organizationId:TEST_ORG,status:'Active',pbeEnabled:true});
 await store.insert('pack',pack,TEST_ORG,{id:pack,isActive:true,licensingStatus:'approved',sourceType:'Scripture'});
 const source={id:sourceId,contentPackId:pack,bookKey:'GEN',chapter:1,verse:1,ordinal:1,citation:'Genesis 1:1',canonicalText:'Alpha',isActive:true};
 await store.insert('source',sourceId,TEST_ORG,source,{ownerId:pack});
 const range={bookKey:'GEN',startChapter:1,startVerse:1,endChapter:1,endVerse:1};
 await store.insert('scope',season,TEST_ORG,{contentPackId:pack,includes:[range],excludes:[]});
 const coachCookie=(await app.login()).headers.get('set-cookie')!.split(';')[0];
 const base=`/api/v1/organizations/${TEST_ORG}/practice`;
 const author=async(path:string,value:unknown)=>app.fetch(`${base}/pbe/seasons/${season}${path}`,{method:'POST',headers:{Cookie:coachCookie,Origin:'https://erudoza.test'},body:JSON.stringify(value)});
 const target={id:targetId,sourceUnitIds:[sourceId],skill:'FactualRecall',label:'Synthetic storage rubric'};
 const questions:PbeQuestion[]=Array.from({length:91},()=>({schemaVersion:2,id:crypto.randomUUID(),version:1,contentPackId:pack,sourceUnitId:sourceId,sourceUnitIds:[sourceId],sourceKind:'Scripture',reference:source.citation,evidence:source.canonicalText,kind:'List',prompt:'Name the synthetic labels.',ordered:true,parts:Array.from({length:parts},()=>({targetId,acceptedAnswers:Array.from({length:aliases},(_,i)=>`${i}`.padEnd(aliasLength,'x')),points:1}))}));
 let maxAuthorBody=0;
 for(let offset=0;offset<questions.length;offset+=20){const input={questions:questions.slice(offset,offset+20),targets:[target]};maxAuthorBody=Math.max(maxAuthorBody,Buffer.byteLength(JSON.stringify(input)));expect(maxAuthorBody).toBeLessThanOrEqual(1048576);const response=await author('/questions/import',input);expect(response.status,await response.clone().text()).toBe(204);}
 for(const q of questions){const response=await author(`/questions/${q.id}/1/publish`,{});expect(response.status,await response.clone().text()).toBe(204);}
 const players:{userId:string;cookie:string}[]=[];
 for(let n=0;n<6*teams;n++){
  const userId=crypto.randomUUID(),name=`storage-student-${n}`;
  await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT ?,org_id,?,?,'Student','Student',password_hash,credential_version FROM Users WHERE id=?").bind(userId,name,name,TEST_USER).run();
  await store.insert('membership',`${season}:${userId}`,TEST_ORG,{seasonId:season,userId,difficulty:'Advanced'},{seasonId:season,ownerId:userId});
  await store.insert('assignment',crypto.randomUUID(),TEST_ORG,{seasonId:season,studentUserId:userId,contentPackId:pack,...range},{seasonId:season,ownerId:userId});
  const login=await app.fetch('/api/v1/auth/login',{method:'POST',headers:{Origin:'https://erudoza.test'},body:JSON.stringify({identifier:name,password:'Testing!123'})});expect(login.status).toBe(200);players.push({userId,cookie:login.headers.get('set-cookie')!.split(';')[0]});
 }
 const measurements:{path:string;operation:string;statements:number;bindingCalls:number;elapsedMs:number}[]=[];
 const call=async(n:number,path:string,data?:unknown,headers:Record<string,string>={})=>{meters.length=0;const start=performance.now();const response=await app.fetch(path.startsWith('/pbe/')?'/api/v1'+path:base+path,{method:data===undefined?'GET':'POST',headers:{Cookie:n===-1?coachCookie:players[n].cookie,Origin:'https://erudoza.test',...headers},body:data===undefined?undefined:JSON.stringify(data)});const sum=meters.reduce((a,b)=>({statements:a.statements+b.statements,bindingCalls:a.bindingCalls+b.bindingCalls}),{statements:0,bindingCalls:0});measurements.push({path,operation:(data as {action?:string}|undefined)?.action??(headers['x-test-room-alarm']?'alarm':path.includes('/pbe/')?'dispute':path.endsWith('/bootstrap')?'bootstrap':path.endsWith('/accept')?'accept':data?'create':'read'),...sum,elapsedMs:performance.now()-start});expect(sum.statements,path).toBeLessThanOrEqual(50);return response;};
 const created=await call(0,'/rooms',{seasonId:season,teamSize:6,teamCount:teams,questionCount:90,format:'Pbe'});expect(created.status,await created.clone().text()).toBe(200);let room=await created.json() as PracticeRoom;
 const command=async(n:number,action:string,extra:Record<string,unknown>={})=>{const input={commandId:crypto.randomUUID(),revision:room.revision,action,...extra};const response=await call(n,`/rooms/${room.id}/commands`,input);expect(response.status,`${action}: ${await response.clone().text()}`).toBe(200);room=await response.json() as PracticeRoom;return {response,input};};
 for(let n=1;n<players.length;n++){
  await command(0,'invite',{targetUserId:players[n].userId,team:Math.floor(n/6)+1});
  const inbox=await (await call(n,'/bootstrap')).json() as PracticeBootstrap;
  const invitation=inbox.invitations.find(i=>i.roomId===room.id);expect(invitation).toBeDefined();
  const response=await call(n,`/invitations/${invitation!.id}/accept`,{team:Math.floor(n/6)+1});expect(response.status,await response.clone().text()).toBe(200);room=await response.json() as PracticeRoom;
 }
 for(let n=0;n<players.length;n++)await command(n,'ready');
 meters.length=0;
 const refresh=async(headers:Record<string,string>={})=>{const response=await call(0,`/rooms/${room.id}`,undefined,headers);expect(response.status,await response.clone().text()).toBe(200);room=await response.json() as PracticeRoom;return room;};
 return {app,store,season,questions,players,call,command,refresh,meters,measurements,maxAuthorBody,get room(){return room;},snapshot:async()=>{const response=await call(0,`/rooms/${room.id}`,undefined,{'x-test-room-snapshot':'1'});expect(response.status,await response.clone().text()).toBe(200);return await response.json() as Room;}};
}
