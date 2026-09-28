// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {createNativeTestApp,TEST_ORG} from '../test-runtime';
import {Store} from '../store';
import type {Env} from '../types';
import {listSeasonRoomIds,wipeSeasonObjects} from './wipe';

let app:Awaited<ReturnType<typeof createNativeTestApp>>;
afterEach(async()=>{await app?.runtime.dispose();});

const insertRoomRow=(id:string,seasonId:string)=>app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,data) VALUES('room',?,?,?,?)").bind(id,TEST_ORG,seasonId,JSON.stringify({id})).run();
const wiped=()=>new Response(JSON.stringify({wiped:true}),{status:200});
function fakeNamespace(calls:string[],behavior:(name:string)=>Response|Promise<never>){
  return {getByName:(name:string)=>{calls.push(name);return{fetch:async()=>behavior(name)};}} as unknown as DurableObjectNamespace;
}

it('addresses each room object and the reports object by name',async()=>{
  app=await createNativeTestApp();
  const season=crypto.randomUUID();
  await insertRoomRow('room-1',season);
  await insertRoomRow('room-2',season);
  await insertRoomRow('other-room','other-season');
  const roomCalls:string[]=[],reportCalls:string[]=[];
  const result=await wipeSeasonObjects({DB:app.db,ROOMS:fakeNamespace(roomCalls,()=>wiped()),REPORTS:fakeNamespace(reportCalls,()=>wiped())},TEST_ORG,season);
  expect(roomCalls).toEqual([`${TEST_ORG}:room-1`,`${TEST_ORG}:room-2`]);
  expect(reportCalls).toEqual([`${TEST_ORG}:${season}`]);
  expect(result).toEqual({rooms:2,reports:1,failed:0});
});

it('tolerates wipe failures and missing bindings without throwing',async()=>{
  app=await createNativeTestApp();
  const season=crypto.randomUUID();
  await insertRoomRow('room-1',season);
  await insertRoomRow('room-2',season);
  const rejected=await wipeSeasonObjects({DB:app.db,ROOMS:fakeNamespace([],async()=>{throw new Error('boom');})},TEST_ORG,season);
  expect(rejected).toEqual({rooms:0,reports:0,failed:2});
  const badStatus=await wipeSeasonObjects({DB:app.db,ROOMS:fakeNamespace([],()=>new Response('err',{status:500}))},TEST_ORG,season);
  expect(badStatus).toEqual({rooms:0,reports:0,failed:2});
  const missing=await wipeSeasonObjects({DB:app.db},TEST_ORG,season);
  expect(missing).toEqual({rooms:0,reports:0,failed:0});
});

it('supports collecting room ids before the D1 delete wipes them',async()=>{
  app=await createNativeTestApp();
  const season=crypto.randomUUID();
  await insertRoomRow('Room-9',season);
  expect(await listSeasonRoomIds({DB:app.db},TEST_ORG,season)).toEqual(['room-9']);
  const roomCalls:string[]=[];
  const result=await wipeSeasonObjects({DB:app.db,ROOMS:fakeNamespace(roomCalls,()=>wiped()),REPORTS:fakeNamespace([],()=>wiped())},TEST_ORG,season,['room-9']);
  expect(roomCalls).toEqual([`${TEST_ORG}:room-9`]);
  expect(result.rooms).toBe(1);
});

it('season deletion wipes room Durable Object storage',async()=>{
  app=await createNativeTestApp();
  const store=new Store(app.db as unknown as Env['DB']);
  const season=crypto.randomUUID();
  await store.insert('season',season,TEST_ORG,{id:season,organizationId:TEST_ORG,status:'Active'});
  const cookie=(await app.login()).headers.get('set-cookie')!.split(';')[0];
  const call=(path:string,init?:RequestInit)=>app.fetch(`/api/v1/organizations/${TEST_ORG}${path}`,{...init,headers:{Cookie:cookie,Origin:'https://erudoza.test',...(init?.headers??{})}});
  const created=await call('/practice/rooms',{method:'POST',body:JSON.stringify({seasonId:season,teamSize:2,questionCount:10,format:'Arcade'})});
  expect(created.status,await created.clone().text()).toBe(200);
  const room=await created.json() as {id:string};
  // Wait for the room's D1 projection (written via waitUntil) so season
  // deletion can discover the room object name.
  for(let retry=0;retry<100;retry++){
    if(await store.get('room',room.id,TEST_ORG))break;
    await new Promise(r=>setTimeout(r,50));
  }
  expect(await store.get('room',room.id,TEST_ORG)).toBeTruthy();
  const before=await call(`/practice/rooms/${room.id}`);
  expect(before.status).toBe(200);
  const deleted=await call(`/seasons/${season}`,{method:'DELETE'});
  expect(deleted.status).toBe(204);
  // The room object no longer serves from Durable Object storage: without the
  // wipe this would still be 200 from the surviving object state.
  const after=await call(`/practice/rooms/${room.id}`);
  expect(after.status).toBe(404);
});
