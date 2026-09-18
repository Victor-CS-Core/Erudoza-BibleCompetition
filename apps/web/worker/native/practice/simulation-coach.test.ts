// @vitest-environment node
import {expect,it} from 'vitest';
import {probeFixture} from './pbe-room-source-fixture';
import {TEST_ORG} from '../test-runtime';
// The coach omits audioPresenterId so makeRoom defaults it to the organizer;
// a student member is designated as presenter before starting (InPerson).
const simulation={version:1,preset:'ShortPractice',bookKeys:['GEN'],chapters:[{bookKey:'GEN',chapter:1}],includeScripture:true,includeIntroductions:true,timeMultiplier:1,halfTime:false,discussion:'InPerson'};
type RoomView={id:string;revision:number;members:{userId:string}[];ownerId:string;status:string;phase:string};
it('lets a coach read season material and estimate a member-less simulation room',async()=>{
 const f=await probeFixture();try{const base=`/organizations/${TEST_ORG}/practice`;
  const material=await f.call(-1,`${base}/simulation/material?seasonId=${f.season}`);
  expect(material.status,await material.clone().text()).toBe(200);
  const m=await material.json() as {books:{key:string}[]};
  expect(m.books.map(b=>b.key)).toEqual(['GEN']);
  const available=await f.call(-1,`${base}/simulation/availability`,{seasonId:f.season,teamSize:2,questionCount:10,simulation});
  expect(available.status,await available.clone().text()).toBe(200);
  expect(await available.json()).toMatchObject({eligibleQuestions:91,requestedQuestions:10,canStart:true,reason:null});
 }finally{await f.app.runtime.dispose();}
},60000);
it('enforces the season PBE-training flag for coach material and estimates',async()=>{
 const f=await probeFixture();try{const base=`/organizations/${TEST_ORG}/practice`;
  const season=await f.store.require('season',f.season,TEST_ORG);
  await f.store.put('season',f.season,TEST_ORG,{...season.value,pbeEnabled:false},season.revision);
  const material=await f.call(-1,`${base}/simulation/material?seasonId=${f.season}`);
  expect(material.status).toBe(403);
  expect((await material.json() as {title:string}).title).toBe('PBE training is not enabled for this season.');
  const available=await f.call(-1,`${base}/simulation/availability`,{seasonId:f.season,teamSize:2,questionCount:10,simulation});
  expect(available.status).toBe(403);
  expect((await available.json() as {title:string}).title).toBe('PBE training is not enabled for this season.');
  // students keep their own 403 through the shared resolver
  const studentMaterial=await f.call(0,`${base}/simulation/material?seasonId=${f.season}`);
  expect(studentMaterial.status).toBe(403);
 }finally{await f.app.runtime.dispose();}
},60000);
it('lets a coach create a simulation room and start it once students join',async()=>{
 const f=await probeFixture();try{const base=`/organizations/${TEST_ORG}/practice`;
  const created=await f.call(-1,`${base}/rooms`,{seasonId:f.season,teamSize:2,questionCount:10,format:'Pbe',teamCount:1,simulation});
  expect(created.status,await created.clone().text()).toBe(200);
  let r=await created.json() as RoomView;
  expect(r.members).toEqual([]);expect(r.ownerId).toBeTruthy();
  const early=await f.call(-1,`${base}/rooms/${r.id}/commands`,{commandId:crypto.randomUUID(),revision:r.revision,action:'start'});
  expect(early.status).toBe(400);
  expect((await early.json() as {title:string}).title).toBe('A rehearsal with no team cannot start.');
  const command=async(action:string,extra:Record<string,unknown>={})=>{const response=await f.call(-1,`${base}/rooms/${r.id}/commands`,{commandId:crypto.randomUUID(),revision:r.revision,action,...extra});expect(response.status,await response.clone().text()).toBe(200);r=await response.json() as RoomView;};
  await command('invite',{targetUserId:f.players[0].id,team:1});
  await command('invite',{targetUserId:f.players[1].id,team:1});
  for(const n of [0,1]){
   const inbox=await (await f.call(n,`${base}/bootstrap`)).json() as {invitations:{id:string;roomId:string}[]};
   const invitation=inbox.invitations.find(i=>i.roomId===r.id);expect(invitation).toBeDefined();
   const accepted=await f.call(n,`${base}/invitations/${invitation!.id}/accept`,{team:1});
   expect(accepted.status,await accepted.clone().text()).toBe(200);r=await accepted.json() as RoomView;
  }
  expect(r.members.map(m=>m.userId).sort()).toEqual([f.players[0].id,f.players[1].id].sort());
  const ready=async(n:number)=>{const response=await f.call(n,`${base}/rooms/${r.id}/commands`,{commandId:crypto.randomUUID(),revision:r.revision,action:'ready'});expect(response.status,await response.clone().text()).toBe(200);r=await response.json() as RoomView;};
  await ready(0);await ready(1);
  // the default presenter is the organizing coach, who cannot play: designate a student first
  const noPresenter=await f.call(-1,`${base}/rooms/${r.id}/commands`,{commandId:crypto.randomUUID(),revision:r.revision,action:'start'});
  expect(noPresenter.status).toBe(400);
  await command('presenter',{targetUserId:f.players[0].id});
  await ready(0);await ready(1);
  await command('start');
  expect(r.status).toBe('Playing');expect(r.phase).toBe('Presentation');
 }finally{await f.app.runtime.dispose();}
},120000);
