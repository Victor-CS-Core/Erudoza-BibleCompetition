// @vitest-environment node
import {expect,it} from 'vitest';
import {probeFixture} from './pbe-room-source-fixture';
import {TEST_ORG,TEST_USER} from '../test-runtime';
import type {TeamPracticeNotification} from '../application/notifications';

type EventDto={id:string;status:string;roomId:string|null;roster:{userId:string;team:number}[];myTeam:number|null;captainStartUserId:string|null;room:{id:string;status:string;memberCount:number;members:{userId:string;team:number;captain:boolean;ready:boolean}[]}|null};
const simulation={version:1,preset:'ShortPractice',bookKeys:['GEN'],chapters:[{bookKey:'GEN',chapter:1}],includeScripture:true,includeIntroductions:true,timeMultiplier:1,halfTime:false,discussion:'InPerson'};
const arcade=(f:{season:string;players:{id:string}[]})=>({seasonId:f.season,activity:'HeadToHead',format:'Arcade',teamSize:2,questionCount:10,roster:[{userId:f.players[0].id,team:1},{userId:f.players[1].id,team:1},{userId:f.players[2].id,team:2},{userId:f.players[3].id,team:2}]});
async function notices(f:{store:{list:<T>(kind:string,org:string,filter?:Record<string,unknown>)=>Promise<T[]>}},userId:string){const all=await f.store.list<TeamPracticeNotification>('notification',TEST_ORG,{ownerId:userId});return all.filter(n=>n.type==='team-practice');}

it('forbids students from creating events, rooms or creation estimates',async()=>{
 const f=await probeFixture();try{const base=`/organizations/${TEST_ORG}/practice`;
  expect((await f.call(0,`${base}/events`,arcade(f))).status).toBe(403);
  expect((await f.call(0,`${base}/rooms`,{seasonId:f.season,format:'Arcade',teamCount:2,teamSize:2,questionCount:10})).status).toBe(403);
  expect((await f.call(0,`${base}/rooms`,{seasonId:f.season,format:'Pbe',teamCount:1,teamSize:2,questionCount:10})).status).toBe(403);
  expect((await f.call(0,`${base}/simulation/availability`,{seasonId:f.season,teamSize:2,questionCount:10,simulation:{...simulation,audioPresenterId:f.players[0].id}})).status).toBe(403);
  const roster=await f.call(0,`${base}/events/roster?seasonId=${f.season}`);expect(roster.status).toBe(403);
 }finally{await f.app.runtime.dispose();}
},60000);

it('opens an event now with the roster pre-seeded and writes assigned notifications',async()=>{
 const f=await probeFixture();try{const base=`/organizations/${TEST_ORG}/practice`;
  const created=await f.call(-1,`${base}/events`,arcade(f));expect(created.status,await created.clone().text()).toBe(201);
  const event=await created.json() as EventDto;
  expect(event.status).toBe('Open');expect(event.roomId).toBeTruthy();expect(event.room?.memberCount).toBe(4);
  expect(event.room?.members.filter(m=>m.team===1).map(m=>m.userId).sort()).toEqual([f.players[0].id,f.players[1].id].sort());
  const room=await (await f.call(-1,`${base}/rooms/${event.roomId}`)).json() as {ownerId:string;members:{userId:string}[];eventId:string};
  expect(room.ownerId).toBe(TEST_USER);expect(room.eventId).toBe(event.id);expect(room.members).toHaveLength(4);
  for(const n of [0,1,2,3]){const mine=await notices(f,f.players[n].id);expect(mine).toHaveLength(1);expect(mine[0]).toMatchObject({action:'assigned',eventId:event.id});}
  expect(await notices(f,f.players[4].id)).toHaveLength(0);
  // the bell shows the assigned summary with a deep link target
  const bell=await f.app.fetch('/api/v1/profile/me/notifications',{headers:{Cookie:f.players[0].cookie,Origin:'https://erudoza.test'}});
  const items=(await bell.json() as {notifications:{summary:string;type?:string;eventId?:string}[]}).notifications;
  expect(items[0]).toMatchObject({type:'team-practice',eventId:event.id});expect(items[0].summary).toContain('Head-to-head practice');
  // assignee scoping: roster members see it, non-assignees do not
  const mine=await (await f.call(0,`${base}/events`)).json() as {events:EventDto[]};
  expect(mine.events).toHaveLength(1);expect(mine.events[0].myTeam).toBe(1);
  const theirs=await (await f.call(4,`${base}/events`)).json() as {events:EventDto[]};
  expect(theirs.events).toHaveLength(0);
  expect((await f.call(4,`${base}/events/${event.id}`)).status).toBe(404);
  expect((await f.call(2,`${base}/events/${event.id}`)).status).toBe(200);
 }finally{await f.app.runtime.dispose();}
},60000);

it('requires exact seat fill and season-roster membership',async()=>{
 const f=await probeFixture();try{const base=`/organizations/${TEST_ORG}/practice`;
  const short={...arcade(f),roster:arcade(f).roster.slice(0,3)};
  const denied=await f.call(-1,`${base}/events`,short);expect(denied.status).toBe(400);expect((await denied.json() as {title:string}).title).toContain('exactly 2 assigned players');
  const ghost={...arcade(f),roster:[...arcade(f).roster.slice(0,3),{userId:crypto.randomUUID(),team:2}]};
  expect((await f.call(-1,`${base}/events`,ghost)).status).toBe(400);
  const oversized={...arcade(f),teamSize:3};
  expect((await f.call(-1,`${base}/events`,oversized)).status).toBe(400);
 }finally{await f.app.runtime.dispose();}
},60000);

it('notifies on reschedule, roster removal and cancellation; duplicate clones the plan',async()=>{
 const f=await probeFixture();try{const base=`/organizations/${TEST_ORG}/practice`;
  const startsAt=new Date(Date.now()+2*3600_000).toISOString();
  const created=await f.call(-1,`${base}/events`,{...arcade(f),startsAtUtc:startsAt});expect(created.status,await created.clone().text()).toBe(201);
  const event=await created.json() as EventDto;expect(event.status).toBe('Scheduled');expect(event.roomId).toBeNull();
  const coachCookie=(await f.app.login()).headers.get('set-cookie')!.split(';')[0];
  const patch=async(path:string,body:unknown)=>f.app.fetch(`/api/v1${path}`,{method:'PATCH',headers:{Cookie:coachCookie,Origin:'https://erudoza.test'},body:JSON.stringify(body)});
  const moved=new Date(Date.now()+3*3600_000).toISOString();
  const edited=await patch(`${base}/events/${event.id}`,{...arcade(f),startsAtUtc:moved,roster:[{userId:f.players[0].id,team:1},{userId:f.players[1].id,team:1},{userId:f.players[2].id,team:2},{userId:f.players[4].id,team:2}]});
  expect(edited.status,await edited.clone().text()).toBe(200);
  expect((await notices(f,f.players[4].id)).map(n=>n.action)).toEqual(['assigned']);
  expect((await notices(f,f.players[3].id)).map(n=>n.action).sort()).toEqual(['assigned','removed']);
  expect((await notices(f,f.players[0].id)).map(n=>n.action).sort()).toEqual(['assigned','rescheduled']);
  const duplicate=await f.call(-1,`${base}/events/${event.id}/duplicate`,{});expect(duplicate.status,await duplicate.clone().text()).toBe(201);
  const copy=await duplicate.json() as EventDto;expect(copy.id).not.toBe(event.id);expect(copy.status).toBe('Scheduled');expect(copy.roster).toHaveLength(4);
  const cancelled=await f.call(-1,`${base}/events/${event.id}/cancel`,{});expect(cancelled.status,await cancelled.clone().text()).toBe(200);
  expect((await cancelled.json() as EventDto).status).toBe('Cancelled');
  expect((await notices(f,f.players[0].id)).map(n=>n.action).sort()).toEqual(['assigned','assigned','cancelled','rescheduled']);
  // a cancelled event can no longer be edited or opened
  expect((await patch(`${base}/events/${event.id}`,arcade(f))).status).toBe(409);
  expect((await f.call(-1,`${base}/events/${event.id}/open`,{})).status).toBe(409);
 }finally{await f.app.runtime.dispose();}
},60000);

it('materializes a scheduled event once its start time arrives',async()=>{
 const f=await probeFixture();try{const base=`/organizations/${TEST_ORG}/practice`;
  const created=await f.call(-1,`${base}/events`,{...arcade(f),startsAtUtc:new Date(Date.now()+3600_000).toISOString()});
  const event=await created.json() as EventDto;expect(event.status).toBe('Scheduled');
  const stored=await f.store.require<{startsAtUtc:string}>('practice-event',event.id,TEST_ORG);
  await f.store.put('practice-event',event.id,TEST_ORG,{...stored.value,startsAtUtc:new Date(Date.now()-1000).toISOString()},stored.revision);
  const list=await (await f.call(0,`${base}/events`)).json() as {events:EventDto[]};
  expect(list.events).toHaveLength(1);expect(list.events[0].status).toBe('Open');expect(list.events[0].roomId).toBeTruthy();
  expect(list.events[0].room?.memberCount).toBe(4);
 }finally{await f.app.runtime.dispose();}
},60000);

it('enforces the captain-start opt-in and locks the room at start',async()=>{
 const f=await probeFixture();try{const base=`/organizations/${TEST_ORG}/practice`;
  const simEvent=async(captainStart:boolean)=>{
   const created=await f.call(-1,`${base}/events`,{seasonId:f.season,activity:'Simulation',teamSize:2,questionCount:10,simulation:{...simulation,audioPresenterId:f.players[0].id},roster:[{userId:f.players[0].id,team:1},{userId:f.players[1].id,team:1}],...(captainStart?{captainStartUserId:f.players[0].id}:{})});
   expect(created.status,await created.clone().text()).toBe(201);return await created.json() as EventDto;
  };
  const roomCall=async(actor:number,event:EventDto,action:string,extra:Record<string,unknown>={})=>{
   const room=await (await f.call(actor,`${base}/rooms/${event.roomId}`)).json() as {revision:number};
   return f.call(actor,`${base}/rooms/${event.roomId}/commands`,{commandId:crypto.randomUUID(),revision:room.revision,action,...extra});
  };
  // Opt-in ON: the designated captain starts; another player cannot.
  const on=await simEvent(true);
  expect(on.captainStartUserId).toBe(f.players[0].id);
  await roomCall(0,on,'ready');await roomCall(1,on,'ready');
  expect((await roomCall(1,on,'start')).status).toBe(403);
  const started=await roomCall(0,on,'start');expect(started.status,await started.clone().text()).toBe(200);
  expect((await started.json() as {status:string}).status).toBe('Playing');
  // Locked at start: no late invites into the playing room.
  const late=await roomCall(-1,on,'invite',{targetUserId:f.players[2].id});expect(late.status).toBe(400);
  expect((await f.call(2,`${base}/rooms/${on.roomId}`)).status).toBe(403);
  // Opt-in OFF: even the team captain cannot start; the coach can.
  const off=await simEvent(false);
  await roomCall(0,off,'ready');await roomCall(1,off,'ready');
  const denied=await roomCall(0,off,'start');expect(denied.status).toBe(403);
  expect((await denied.json() as {title:string}).title).toBe('Only the coach or the designated captain can start this event.');
  const coachStart=await roomCall(-1,off,'start');expect(coachStart.status,await coachStart.clone().text()).toBe(200);
 }finally{await f.app.runtime.dispose();}
},120000);
