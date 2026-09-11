// @vitest-environment node
import {expect,it} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {createNativeTestApp,TEST_ORG} from '../test-runtime';
import {Store} from '../store';
import type {D1Database} from '@cloudflare/workers-types';
import type {PracticeRoom} from '../../../src/api/practice';
it.skipIf(!process.env.ERUDOZA_NATIVE_LOAD)('measures 20 active rooms and 200 connected players in local workerd',async()=>{
 const app=await createNativeTestApp(),sockets:WebSocket[]=[];
 try{
  const store=new Store(app.db as unknown as D1Database),season=randomUUID(),pack=randomUUID();
  await store.insert('season',season,TEST_ORG,{id:season,status:'Active',name:'Load fixture'});await store.insert('pack',pack,TEST_ORG,{id:pack,isActive:true,licensingStatus:'approved'});await store.insert('scope',season,TEST_ORG,{contentPackId:pack,includes:[{bookKey:'DAN',startChapter:1,startVerse:1,endChapter:1,endVerse:12}],excludes:[]});await store.insert('practice-setting',TEST_ORG,TEST_ORG,{enabled:true});
  for(let i=1;i<=12;i++){const id=randomUUID();await store.insert('source',id,TEST_ORG,{id,contentPackId:pack,bookKey:'DAN',chapter:1,verse:i,ordinal:i,canonicalText:'Daniel',citation:`Daniel 1:${i}`,isActive:true},{ownerId:pack});await store.insert('question',`${id}:1`,TEST_ORG,{id:`${id}:1`,seasonId:season,published:true,question:{id,contentPackId:pack,sourceUnitId:id,prompt:'Name',kind:'ShortAnswer',parts:[{acceptedAnswers:['Daniel'],points:1}],ordered:false,evidence:'Daniel',reference:`Daniel 1:${i}`,version:1}},{seasonId:season});}
  const users=Array.from({length:200},()=>({id:randomUUID(),token:randomUUID()}));
  await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.id'),'Load player','Student','Student','unused-test-hash','test' FROM json_each(?)").bind(TEST_ORG,JSON.stringify(users)).run();
  await app.db.prepare("INSERT INTO Sessions(token_hash,user_id,credential_version,expires_at) SELECT json_extract(value,'$.hash'),json_extract(value,'$.id'),'test',? FROM json_each(?)").bind(Date.now()+3600000,JSON.stringify(users.map(u=>({...u,hash:createHash('sha256').update(u.token).digest('base64')})))).run();
  const call=async(user:typeof users[number],path:string,data?:unknown)=>{const res=await app.fetch(`/api/v1/organizations/${TEST_ORG}/practice${path}`,{method:data?'POST':'GET',headers:{Cookie:`__Host-erudoza.session=${user.token}`,Origin:'https://erudoza.test'},...(data?{body:JSON.stringify(data)}:{})});expect(res.status,await res.clone().text()).toBe(200);return res.json();};
  const groups=await Promise.all(Array.from({length:20},async(_,i)=>{
   const team=users.slice(i*10,i*10+10);let room=await call(team[0],'/rooms',{seasonId:season,teamSize:5,questionCount:10,coached:false}) as PracticeRoom;
   const command=async(user:typeof users[number],action:string,extra={})=>room=await call(user,`/rooms/${room.id}/commands`,{commandId:randomUUID(),revision:room.revision,action,...extra}) as PracticeRoom;
   for(let j=1;j<10;j++){await command(team[0],'invite',{targetUserId:team[j].id,team:j<5?1:2});let inv:string|undefined;for(let n=0;n<30&&!inv;n++){const b=await call(team[j],'/bootstrap') as {invitations:{id:string}[]};inv=b.invitations[0]?.id;if(!inv)await new Promise(r=>setTimeout(r,10));}expect(inv).toBeTruthy();room=await call(team[j],`/invitations/${inv}/accept`,{team:j<5?1:2}) as PracticeRoom;}
   for(const user of team){const res=await app.fetch(`/api/v1/organizations/${TEST_ORG}/practice/rooms/${room.id}/socket`,{headers:{Cookie:`__Host-erudoza.session=${user.token}`,Origin:'https://erudoza.test',Upgrade:'websocket'}});expect(res.status).toBe(101);res.webSocket!.accept();sockets.push(res.webSocket! as unknown as WebSocket);await command(user,'ready');}
   await command(team[0],'start');return{team,command,get room(){return room;}};
  }));
  await new Promise(r=>setTimeout(r,15500));
  for(const g of groups){const snapshot=await call(g.team[0],`/rooms/${g.room.id}`) as PracticeRoom;for(const user of [g.team[0],g.team[5]])await g.command(user,'ack',{scheduleId:snapshot.scheduleId});}
  await new Promise(r=>setTimeout(r,3500));
  const durations=await Promise.all(groups.flatMap(g=>g.team.map(async user=>{const start=performance.now();await g.command(user,'chat',{text:'Team suggestion'});return performance.now()-start;})));
  await Promise.all(groups.flatMap(g=>[g.team[0],g.team[5]].map(user=>g.command(user,'submit',{questionId:g.room.question!.id,answers:['Daniel']}))));
  const sorted=durations.sort((a,b)=>a-b),report={environment:'local workerd; not deployment-region latency',rooms:20,players:200,webSockets:200,commands:200,p50Ms:sorted[99],p95Ms:sorted[189],maxMs:sorted[199],targetP95Ms:500};
  await mkdir('test-results',{recursive:true});await writeFile('test-results/native-load.json',JSON.stringify(report,null,2));console.info(JSON.stringify(report));
  for(const g of groups)await g.command(g.team[0],'abandon');
 }finally{for(const socket of sockets)socket.close(1000);await app.runtime.dispose();}
},180000);
