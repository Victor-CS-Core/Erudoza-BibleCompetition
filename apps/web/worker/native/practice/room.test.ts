// @vitest-environment node
import {expect,it} from "vitest";
import {createNativeTestApp,TEST_ORG,TEST_USER} from "../test-runtime";
import {Store} from "../store";
import type {D1Database} from "@cloudflare/workers-types";
import type {PracticeRoom as RoomDto} from "../../../src/api/practice";
it("runs real durable room invitations, private WebSockets and scored submissions",async()=>{
 const app=await createNativeTestApp({delayAuthentication:true});try{
  const store=new Store(app.db as unknown as D1Database),season=crypto.randomUUID(),pack=crypto.randomUUID();
  await store.insert("season",season,TEST_ORG,{id:season,status:"Active",name:"Practice"});await store.insert("pack",pack,TEST_ORG,{id:pack,isActive:true,licensingStatus:"approved"});await store.insert("scope",season,TEST_ORG,{contentPackId:pack,includes:[{bookKey:"JHN",startChapter:1,startVerse:1,endChapter:1,endVerse:11}],excludes:[]});await store.insert("practice-setting",TEST_ORG,TEST_ORG,{enabled:true});
  for(let i=1;i<=11;i++){const id=crypto.randomUUID();await store.insert("source",id,TEST_ORG,{id,contentPackId:pack,bookKey:"JHN",chapter:1,verse:i,ordinal:i,canonicalText:"Word",citation:`John 1:${i}`,isActive:true},{ownerId:pack});const q={id,contentPackId:pack,sourceUnitId:id,prompt:`Question ${i}`,kind:"ShortAnswer",parts:[{acceptedAnswers:["Word"],points:1}],ordered:false,evidence:"Word",reference:`John 1:${i}`,version:1};await store.insert("question",`${id}:1`,TEST_ORG,{id:`${id}:1`,seasonId:season,published:true,question:q},{seasonId:season});}
  const coach=(await app.login()).headers.get("set-cookie")!.split(";")[0];
  const call=(path:string,who:string,method="GET",data?:unknown,extraHeaders:Record<string,string>={})=>app.fetch(`/api/v1/organizations/${TEST_ORG}/practice${path}`,{method,headers:{Cookie:who,Origin:"https://erudoza.test","Content-Type":"application/json",...extraHeaders},...(data?{body:JSON.stringify(data)}:{})});
  const students=[];for(const name of ["player-a","player-b"]){const response=await app.fetch(`/api/v1/organizations/${TEST_ORG}/students`,{method:"POST",headers:{Cookie:coach,Origin:"https://erudoza.test"},body:JSON.stringify({userName:name,displayName:name,password:"Testing!123"})});expect(response.status).toBe(201);const student=await response.json() as {userId:string};const login=await app.fetch("/api/v1/auth/login",{method:"POST",headers:{Origin:"https://erudoza.test"},body:JSON.stringify({identifier:name,password:"Testing!123"})});students.push({...student,cookie:login.headers.get("set-cookie")!.split(";")[0]});}
  let room=await (await call("/rooms",coach,"POST",{seasonId:season,teamSize:1,questionCount:10,coached:true})).json() as RoomDto;
  expect(room.id).toBeTruthy();
  const command=async(who:string,action:string,extra:Record<string,unknown>={})=>{const response=await call(`/rooms/${room.id}/commands`,who,"POST",{commandId:crypto.randomUUID(),revision:room.revision,action,...extra});expect(response.status,await response.clone().text()).toBe(200);room=await response.json() as RoomDto;return room;};
  for(let i=0;i<students.length;i++){const student=students[i];await command(coach,"invite",{targetUserId:student.userId,team:i+1});let bootstrap: {invitations:{id:string}[]}|undefined;for(let retry=0;retry<20;retry++){bootstrap=await (await call("/bootstrap",student.cookie)).json() as typeof bootstrap;if(bootstrap?.invitations.length)break;await new Promise(resolve=>setTimeout(resolve,25));}expect(bootstrap?.invitations.length).toBe(1);const accepted=await call(`/invitations/${bootstrap!.invitations[0].id}/accept`,student.cookie,"POST",{team:i+1});expect(accepted.status,await accepted.clone().text()).toBe(200);room=await accepted.json() as RoomDto;await command(student.cookie,"ready");}
  const socketResponse=await app.fetch(`/api/v1/organizations/${TEST_ORG}/practice/rooms/${room.id}/socket`,{headers:{Cookie:students[0].cookie,Origin:"https://erudoza.test",Upgrade:"websocket"}});expect(socketResponse.status).toBe(101);const socket=socketResponse.webSocket!;socket.accept();
  await command(students[0].cookie,"chat",{text:"Team A secret"});expect((await (await call(`/rooms/${room.id}`,students[1].cookie)).json() as RoomDto).messages).toHaveLength(0);
  await command(students[0].cookie,"ready");await command(coach,"start");expect(JSON.stringify(room)).not.toContain("acceptedAnswers");await command(coach,"next");
  const scheduleId=room.scheduleId;await command(students[0].cookie,"ack",{scheduleId});await command(students[1].cookie,"ack",{scheduleId});await new Promise(resolve=>setTimeout(resolve,3200));
  room=await (await call(`/rooms/${room.id}`,students[0].cookie)).json() as RoomDto;expect(room.phase).toBe("Response");const questionId=room.question!.id;
  const payload={commandId:crypto.randomUUID(),revision:room.revision,action:"submit",questionId,answers:["Word"],responseTimeMs:-999999};
  const delayedStarted=performance.now();
  const first=call(`/rooms/${room.id}/commands`,students[0].cookie,"POST",payload,{"x-test-auth-delay":"1"}).then(response=>{expect(performance.now()-delayedStarted).toBeGreaterThanOrEqual(1500);return response;});await new Promise(resolve=>setTimeout(resolve,100));
  const later=call(`/rooms/${room.id}/commands`,students[0].cookie,"POST",{...payload,commandId:crypto.randomUUID(),answers:["Wrong"]});
  const [accepted,retried]=await Promise.all([first,later]);expect(accepted.status).toBe(200);expect(retried.status).toBe(200);room=await accepted.json() as RoomDto;
  await command(students[1].cookie,"submit",{questionId,answers:["Word"]});expect(room.phase).toBe("Review");expect(room.results).toHaveLength(2);expect(room.results.find(s=>s.team===1)?.answers).toEqual(["Word"]);expect(room.results.find(s=>s.team===1)!.elapsedMs).toBeLessThan(1500);expect(room.results.every(s=>s.accuracyHundredths===100&&s.speedHundredths>0)).toBe(true);
  await command(coach,"judge",{questionId,team:1,points:1,text:"Correct"});await command(coach,"judge",{questionId,team:2,points:1,text:"Correct"});await command(coach,"abandon");socket.close(1000);
 }finally{await app.runtime.dispose();}
},30000);

it.each([
 {change:"revoked credentials",status:401,sql:"UPDATE Users SET credential_version='revoked' WHERE id=?"},
 {change:"an inactive account",status:401,sql:"UPDATE Users SET active=0 WHERE id=?"},
 {change:"an expired session",status:401,sql:"UPDATE Sessions SET expires_at=0 WHERE user_id=?"},
 {change:"logout",status:401,sql:null},
 {change:"disabled Team Practice",status:403,sql:"UPDATE Records SET data='{\"enabled\":false}' WHERE kind='practice-setting' AND id=?"},
])("rejects the next room command after $change without mutating the room",async({change,status,sql})=>{
 const app=await createNativeTestApp();try{
  const store=new Store(app.db as unknown as D1Database),season=crypto.randomUUID();
  await store.insert("season",season,TEST_ORG,{id:season,status:"Active"});
  await store.insert("practice-setting",TEST_ORG,TEST_ORG,{enabled:true});
  let cookie=(await app.login()).headers.get("set-cookie")!.split(";")[0];
  const call=(path:string,data?:unknown)=>app.fetch(`/api/v1/organizations/${TEST_ORG}/practice${path}`,{method:data?"POST":"GET",headers:{Cookie:cookie,Origin:"https://erudoza.test"},...(data?{body:JSON.stringify(data)}:{})});
  const created=await call("/rooms",{seasonId:season,teamSize:1,questionCount:10,coached:false});
  expect(created.status).toBe(200);let room=await created.json() as RoomDto;
  const ready=await call(`/rooms/${room.id}/commands`,{commandId:crypto.randomUUID(),revision:room.revision,action:"ready"});
  expect(ready.status).toBe(200);room=await ready.json() as RoomDto;expect(room.members[0].ready).toBe(true);
  if(sql)await app.db.prepare(sql).bind(change==="disabled Team Practice"?TEST_ORG:TEST_USER).run();
  else expect((await app.fetch("/api/v1/auth/logout",{method:"POST",headers:{Cookie:cookie,Origin:"https://erudoza.test"}})).status).toBe(204);
  const rejected=await call(`/rooms/${room.id}/commands`,{commandId:crypto.randomUUID(),revision:room.revision,action:"chat",text:"This must not be stored"});
  expect(rejected.status).toBe(status);
  await app.db.prepare("UPDATE Users SET credential_version='v1',active=1 WHERE id=?").bind(TEST_USER).run();
  await app.db.prepare("UPDATE Records SET data='{\"enabled\":true}' WHERE kind='practice-setting' AND id=?").bind(TEST_ORG).run();
  cookie=(await app.login()).headers.get("set-cookie")!.split(";")[0];
  const response=await call(`/rooms/${room.id}`);expect(response.status).toBe(200);
  const unchanged=await response.json() as RoomDto;expect(unchanged.revision).toBe(room.revision);expect(unchanged.messages).toEqual([]);
 }finally{await app.runtime.dispose();}
},30000);
