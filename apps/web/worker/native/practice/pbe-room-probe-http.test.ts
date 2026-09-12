// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import type {PracticeRoom,PracticeBootstrap} from '../../../src/api/practice';
import type {Room} from './state';
import {readRoomHistory} from './room-history';
import {createNativeTestApp,TEST_ORG,TEST_USER} from '../test-runtime';
import {Store} from '../store';
import type {Env} from '../types';
import type {PbeQuestion} from '../pbe/types';
import {sourceProof} from '../pbe/bank';
async function probeFixture(){
 let now=Date.now(),realClock=false;
 const app=await createNativeTestApp({measureD1:true,replaceRoomAuthority:true,roomTestClock:true,roomStorageDiagnostics:true});const store=new Store(app.db as unknown as Env['DB']),season=crypto.randomUUID(),pack=crypto.randomUUID(),source=crypto.randomUUID();
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

let fixture:Awaited<ReturnType<typeof probeFixture>>;
afterEach(async()=>{await fixture?.app.runtime.dispose();});
it('publishes a connected full90 Completed room during real ten-second probes and keeps its outbox clear after publication',async()=>{
 fixture=await probeFixture();const f=fixture,base=`/organizations/${TEST_ORG}/practice`;
 const created=await f.call(0,base+'/rooms',{seasonId:f.season,format:'Pbe',teamCount:1,teamSize:6,questionCount:90});expect(created.status).toBe(200);let room=await created.json() as PracticeRoom;
 const path=()=>`${base}/rooms/${room.id}`;
 const command=async(actor:number,action:string,extra:Record<string,unknown>={})=>{const input={commandId:crypto.randomUUID(),revision:room.revision,action,...extra};const response=await f.call(actor,path()+'/commands',input);expect(response.status,await response.clone().text()).toBe(200);room=await response.json() as PracticeRoom;return input;};
 const refresh=async(headers:Record<string,string>={})=>{const response=await f.call(0,path(),undefined,headers);expect(response.status,await response.clone().text()).toBe(200);room=await response.json() as PracticeRoom;};
 const snapshot=async()=>await (await f.call(0,path(),undefined,{'x-test-room-snapshot':'1'})).json() as Room;
 const diagnostic=async()=>await (await f.call(0,path(),undefined,{'x-test-room-storage':'1'})).json() as {revision:number;outboxRevision:number|null;alarmAt:number|null;outbox:unknown;components:{rows:number};uploaded:{rows:number}};
 for(let n=1;n<6;n++){await command(0,'invite',{targetUserId:f.players[n].id});const inbox=await (await f.call(n,base+'/bootstrap')).json() as PracticeBootstrap;const response=await f.call(n,`${base}/invitations/${inbox.invitations[0].id}/accept`,{team:1});expect(response.status).toBe(200);room=await response.json() as PracticeRoom;}
 for(let n=0;n<6;n++)await command(n,'ready');await command(0,'start');
 const connected=await f.app.fetch('/api/v1'+path()+'/socket',{headers:{Cookie:f.players[0].cookie,Origin:'https://erudoza.test',Upgrade:'websocket','x-test-room-now':String(f.now)}});expect(connected.status).toBe(101);const socket=connected.webSocket!;socket.accept();let closed=false;socket.addEventListener('close',()=>{closed=true;});
 const exchange=(type:string,extra:Record<string,unknown>={})=>new Promise<Record<string,unknown>>((resolve,reject)=>{const id=crypto.randomUUID();const onMessage=(event:{data:unknown})=>{const message=JSON.parse(String(event.data));if(message.id===id){clearTimeout(timer);socket.removeEventListener('message',onMessage);resolve(message);}};const timer=setTimeout(()=>{socket.removeEventListener('message',onMessage);reject(new Error(`No ${type} acknowledgement`));},5000);socket.addEventListener('message',onMessage);socket.send(JSON.stringify({type,id,...extra}));});
 let samples=0;
 const probe=async()=>{const challenge=await exchange('Probe');const quality=await exchange('AckProbe',{nonce:challenge.nonce});expect(quality.type).toBe('AckProbe');expect(quality.samples).toBe(Math.min(++samples,20));expect(quality.rttMs).toBeGreaterThanOrEqual(0);expect(quality.jitterMs).toBeGreaterThanOrEqual(0);return quality;};
 // A diagnostic during play must retain the exact accepted authority and revision.
 const beforeProbe=await snapshot();await probe();expect.soft(await snapshot()).toEqual(beforeProbe);
 let lastInput:Record<string,unknown>|undefined;
 for(let q=0;q<90;q++){
  if(q){f.advance(10000);await refresh();if(room.phase==='Break'){expect(q).toBe(45);f.advance(300000);await refresh();}}
  expect(room.phase).toBe('Presentation');const questionId=room.question!.id;await command(0,'present',{questionId,delivery:'TextFallback'});f.advance(3000);lastInput=await command(0,'submit',{questionId,answers:['Alpha','Beta']});expect(room.phase).toBe('Review');
 }
 f.advance(10000);await refresh();expect(room.status).toBe('Completed');expect(room.results).toHaveLength(90);
 const authority=await snapshot();expect(authority.questions).toHaveLength(90);expect(authority.reserves).toHaveLength(1);expect(authority.submissions).toHaveLength(90);
 expect(await f.store.get('match',room.id,TEST_ORG)).toBeNull();expect((await diagnostic()).outbox).not.toBeNull();
 // Switch only the compilation-only clock adapter to real ticking time and actual alarms.
 // No authority/outbox bytes are rewritten, and this same socket remains open.
 f.useRealClock();await refresh({'x-test-room-real-clock':'1'});const started=performance.now();let nextProbe=0;
 const progress:{elapsedMs:number;revision:number;outboxRevision:number|null;alarmAt:number|null;outbox:unknown;components:{rows:number};uploaded:{rows:number}}[]=[];
 while(performance.now()-started<60000){
  const elapsed=performance.now()-started;if(elapsed>=nextProbe){await probe();nextProbe+=10000;}
  const state=await diagnostic();progress.push({elapsedMs:Math.round(elapsed),...state});expect(state.revision).toBe(authority.revision);
  if(state.outbox===null&&await f.store.get('match',room.id,TEST_ORG))break;
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 process.stdout.write(`C3 connected probe publication ${JSON.stringify({elapsedMs:performance.now()-started,samples,progress})}\n`);
 expect(closed).toBe(false);expect(samples).toBeGreaterThanOrEqual(3);expect((await diagnostic()).outbox).toBeNull();
 const history=await readRoomHistory(f.app.db as unknown as Env['DB'],TEST_ORG,room.id);expect(history!.value).toEqual({...authority,messages:[],drafts:{},applied:{}});
 const published=await f.app.db.prepare("SELECT data,revision FROM Records WHERE kind='match' AND id=? AND org_id=?").bind(room.id,TEST_ORG).first();
 const settled=await diagnostic();await new Promise(resolve=>setTimeout(resolve,Math.max(0,nextProbe-(performance.now()-started))));await probe();await new Promise(resolve=>setTimeout(resolve,10000));await probe();
 expect((await diagnostic()).outbox).toBeNull();expect((await diagnostic()).components).toEqual(settled.components);expect(await snapshot()).toEqual(authority);expect(await f.app.db.prepare("SELECT data,revision FROM Records WHERE kind='match' AND id=? AND org_id=?").bind(room.id,TEST_ORG).first()).toEqual(published);
 const retry=await f.call(0,path()+'/commands',lastInput);expect(retry.status).toBe(200);expect(await snapshot()).toEqual(authority);expect((await diagnostic()).outbox).toBeNull();expect(closed).toBe(false);socket.close(1000);
},150000);
