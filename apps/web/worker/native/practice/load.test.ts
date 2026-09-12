// @vitest-environment node
import {expect,it} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {createNativeTestApp,TEST_ORG} from '../test-runtime';
import {Store} from '../store';
import {sourceProof} from '../pbe/bank';
import type {PbeQuestion} from '../pbe/types';
import type {D1Database} from '@cloudflare/workers-types';
import type {PracticeRoom} from '../../../src/api/practice';
it.skipIf(!process.env.ERUDOZA_NATIVE_LOAD).each([1,2] as const)('measures ten PBE rooms with %i six-student teams over real commands and sockets',async(teamCount)=>{
 const roomCount=10,rosterSize=teamCount*6,playerCount=roomCount*rosterSize;
 const app=await createNativeTestApp(),sockets:WebSocket[]=[];
 try{
  const store=new Store(app.db as unknown as D1Database),season=randomUUID(),pack=randomUUID();
  await store.insert('season',season,TEST_ORG,{id:season,organizationId:TEST_ORG,status:'Active',pbeEnabled:true,name:'PBE load fixture'});await store.insert('pack',pack,TEST_ORG,{id:pack,isActive:true,licensingStatus:'approved',sourceType:'Scripture'});await store.insert('scope',season,TEST_ORG,{contentPackId:pack,includes:[{bookKey:'DAN',startChapter:1,startVerse:1,endChapter:1,endVerse:12}],excludes:[]});await store.insert('practice-setting',TEST_ORG,TEST_ORG,{enabled:true});
  for(let i=1;i<=12;i++){const id=randomUUID(),target=randomUUID(),unit={id,contentPackId:pack,bookKey:'DAN',chapter:1,verse:i,ordinal:i,canonicalText:'Daniel',citation:`Daniel 1:${i}`,isActive:true};await store.insert('source',id,TEST_ORG,unit,{ownerId:pack});await store.insert('pbe-target',target,TEST_ORG,{id:target,sourceUnitIds:[id],skill:'FactualRecall',label:'Person'},{seasonId:season,ownerId:id});const question:PbeQuestion={schemaVersion:2,id:randomUUID(),version:1,contentPackId:pack,sourceUnitId:id,sourceUnitIds:[id],sourceKind:'Scripture',prompt:'Name the person',kind:'ShortAnswer',parts:[{targetId:target,acceptedAnswers:['Daniel'],points:1}],ordered:false,evidence:'Daniel',reference:unit.citation};await store.insert('pbe-question-head',question.id,TEST_ORG,{id:question.id,seasonId:season,published:true,sourceFingerprint:await sourceProof(question,new Map([[id,unit]])),question},{seasonId:season,ownerId:id});}
  const users=Array.from({length:playerCount},()=>({id:randomUUID(),token:randomUUID()}));
  await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.id'),'Load player','Student','Student','unused-test-hash','test' FROM json_each(?)").bind(TEST_ORG,JSON.stringify(users)).run();
  await app.db.prepare("INSERT INTO Sessions(token_hash,user_id,credential_version,expires_at) SELECT json_extract(value,'$.hash'),json_extract(value,'$.id'),'test',? FROM json_each(?)").bind(Date.now()+3600000,JSON.stringify(users.map(u=>({...u,hash:createHash('sha256').update(u.token).digest('base64')})))).run();
  for(const user of users){await store.insert('membership',`${season}:${user.id}`,TEST_ORG,{seasonId:season,userId:user.id,difficulty:'Advanced'},{seasonId:season,ownerId:user.id});await store.insert('assignment',randomUUID(),TEST_ORG,{seasonId:season,studentUserId:user.id,contentPackId:pack,bookKey:'DAN',startChapter:1,startVerse:1,endChapter:1,endVerse:12},{seasonId:season,ownerId:user.id});}
  const call=async(user:typeof users[number],path:string,data?:unknown)=>{const res=await app.fetch(`/api/v1/organizations/${TEST_ORG}/practice${path}`,{method:data?'POST':'GET',headers:{Cookie:`__Host-erudoza.session=${user.token}`,Origin:'https://erudoza.test'},...(data?{body:JSON.stringify(data)}:{})});expect(res.status,await res.clone().text()).toBe(200);return res.json();};
  const groups=await Promise.all(Array.from({length:roomCount},async(_,i)=>{
   const team=users.slice(i*rosterSize,i*rosterSize+rosterSize);let room=await call(team[0],'/rooms',{seasonId:season,teamSize:6,teamCount,format:'Pbe',questionCount:10,coached:false}) as PracticeRoom;
   const command=async(user:typeof users[number],action:string,extra={})=>room=await call(user,`/rooms/${room.id}/commands`,{commandId:randomUUID(),revision:room.revision,action,...extra}) as PracticeRoom;
   for(let j=1;j<rosterSize;j++){await command(team[0],'invite',{targetUserId:team[j].id,team:j<6?1:2});let inv:string|undefined;for(let n=0;n<30&&!inv;n++){const b=await call(team[j],'/bootstrap') as {invitations:{id:string}[]};inv=b.invitations[0]?.id;if(!inv)await new Promise(r=>setTimeout(r,10));}expect(inv).toBeTruthy();room=await call(team[j],`/invitations/${inv}/accept`,{team:j<6?1:2}) as PracticeRoom;}
   for(const user of team){const res=await app.fetch(`/api/v1/organizations/${TEST_ORG}/practice/rooms/${room.id}/socket`,{headers:{Cookie:`__Host-erudoza.session=${user.token}`,Origin:'https://erudoza.test',Upgrade:'websocket'}});expect(res.status).toBe(101);res.webSocket!.accept();sockets.push(res.webSocket! as unknown as WebSocket);await command(user,'ready');}
   await command(team[0],'start');return{team,command,get room(){return room;}};
  }));
  for(const g of groups)for(let t=0;t<teamCount;t++)await g.command(g.team[t*6],'present',{questionId:g.room.question!.id,delivery:t===0?'TextFallback':'Audio'});
  await new Promise(r=>setTimeout(r,3500));
  const durations=await Promise.all(groups.flatMap(g=>g.team.map(async user=>{const start=performance.now();await g.command(user,'chat',{text:'Team suggestion'});return performance.now()-start;})));
  await Promise.all(groups.flatMap(g=>Array.from({length:teamCount},(_,t)=>g.team[t*6]).map(user=>g.command(user,'submit',{questionId:g.room.question!.id,answers:['Daniel']}))));
  const sorted=durations.sort((a,b)=>a-b),report={format:'Pbe',environment:'local workerd authenticated HTTP and sockets; not deployment-region latency',rooms:roomCount,teamCount,teamSize:6,players:playerCount,webSockets:sockets.length,chatCommands:durations.length,finalCommands:roomCount*teamCount,p50Ms:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:sorted.at(-1),targetP95Ms:500,targetMet:sorted[Math.ceil(sorted.length*.95)-1]<500};
  await mkdir('test-results',{recursive:true});await writeFile(`test-results/native-pbe-load-${teamCount}.json`,JSON.stringify(report,null,2));console.info(JSON.stringify(report));
  for(const g of groups){const saved=await call(g.team[0],`/rooms/${g.room.id}`) as PracticeRoom;expect(saved.members).toHaveLength(rosterSize);expect(saved.results).toHaveLength(teamCount);expect(saved.results.every(r=>r.accuracyHundredths===100&&r.speedHundredths===0&&r.attemptId)).toBe(true);expect(saved.messages).toHaveLength(6);}
  for(const g of groups)await g.command(g.team[0],'abandon');
 }finally{for(const socket of sockets)socket.close(1000);await app.runtime.dispose();}
},240000);
