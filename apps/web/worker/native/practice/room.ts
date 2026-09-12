import {maintenanceOffline,dispatchMaintenance,MAINTENANCE_PREFIX} from '../maintenance/protocol';
import {DurableObject} from "cloudflare:workers";
import type {Env,RequestContext} from "../types";
import {body,HttpError,json} from "../types";
import {authenticate,checkOrigin} from "../auth";
import {Store} from "../store";
import {summarizeRoom} from "./room-history";
import {RoomCodec,isRoomManifest,ROOM_STAGE_BYTES,ROOM_STAGE_NODES,utf8Bytes} from "./room-storage";
import {overlayRooms} from "../pbe/result-overlays";
import {eligibleQuestions} from './questions';
import {authorizePbeRoom,selectPbeRoomBank,roomExposureStatements} from './pbe-material';
import {advance,applyCommand,isTerminatedPbePlay,canCoach,teamAttemptId,reviewedQuestion,join,makeRoom,participant,recover,view} from "./state";
import type {Room,Command} from "./state";
/** Room ingress owns the clock. Edge Worker timestamps are never accepted. */
export class PracticeRoom extends DurableObject<Env> {
 private codec=new RoomCodec();
 private epoch=crypto.randomUUID();private pending=0;private tail:Promise<unknown>=Promise.resolve();private keepAlive:ReturnType<typeof setInterval>|undefined;
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);if(maintenanceOffline(env))return;ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL)");ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL)");ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS room_components(hash TEXT PRIMARY KEY,data TEXT NOT NULL)");ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS room_uploaded(hash TEXT PRIMARY KEY)");}
 private readNode=(hash:string):string|null=>this.ctx.storage.sql.exec<{data:string}>("SELECT data FROM room_components WHERE hash=?",hash).toArray()[0]?.data??null;
 private async load():Promise<Room|null>{const row=this.ctx.storage.sql.exec<{data:string}>("SELECT data FROM state WHERE id=1").toArray()[0];if(!row)return null;const data=JSON.parse(row.data);if(!isRoomManifest(data)&&data.format!==undefined&&data.format!=='Pbe'&&data.format!=='Arcade')throw new Error('Unsupported stored room format.');return isRoomManifest(data)?this.codec.decode(data,this.readNode):data as Room;}
 private async save(r:Room){
  if(maintenanceOffline(this.env))return;
  const encoded=r.format==='Pbe'?await this.codec.encode(r):null,data=JSON.stringify(encoded?.manifest??r);
  this.ctx.storage.transactionSync(()=>{
   for(const [hash,value] of encoded?.nodes??[]){const old=this.readNode(hash);if(old!==null&&old!==value)throw new Error('Immutable room component conflict.');if(old===null)this.ctx.storage.sql.exec("INSERT INTO room_components(hash,data) VALUES(?,?)",hash,value);}
   this.ctx.storage.sql.exec("INSERT INTO state(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",data);
   this.ctx.storage.sql.exec("INSERT INTO outbox(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",data);
  });
 }
 private async serialize<T>(fn:()=>Promise<T>):Promise<T>{const previous=this.tail;let release!:()=>void;this.tail=new Promise<void>(resolve=>release=resolve);await previous;try{return await fn();}finally{release();}}
 private async arm(r:Room){
  if(maintenanceOffline(this.env))return;
  // A live round's epoch must survive ordinary hibernation. This consumes DO duration quota.
  if(r.status==="Playing"&&!this.keepAlive)this.keepAlive=setInterval(()=>{},30000);
  if(r.status!=="Playing"&&this.keepAlive){clearInterval(this.keepAlive);this.keepAlive=undefined;}
  const cleanup=r.messages.length?Date.parse(r.messages[0].createdAt)+30*86400000:null;const next=[r.phaseEndsAt,cleanup].filter((x):x is number=>x!==null);if(next.length)await this.ctx.storage.setAlarm(Math.max(Date.now()+50,Math.min(...next)));else await this.ctx.storage.deleteAlarm();
 }
 private async continueProjection(){if(maintenanceOffline(this.env))return;const alarm=await this.ctx.storage.getAlarm();await this.ctx.storage.setAlarm(Math.min(alarm??Infinity,Date.now()+1000));}
 private async project(){
  if(maintenanceOffline(this.env))return;
  const row=this.ctx.storage.sql.exec<{data:string}>("SELECT data FROM outbox WHERE id=1").toArray()[0];if(!row)return;
  const stored=JSON.parse(row.data),r=isRoomManifest(stored)?await this.codec.decode(stored,this.readNode):stored as Room,summary={id:r.id,seasonId:r.seasonId,ownerId:r.ownerId,coachId:r.coachId,format:r.format??'Arcade',teamCount:r.teamCount??2,teamSize:r.teamSize,questionCount:r.questionCount,coached:r.coached,status:r.status,memberCount:r.members.length,memberIds:r.members.map(m=>m.userId),hasAppeals:r.submissions.some(s=>s.appealed),invitations:r.invitations};
  const projection={...r,messages:[],drafts:{},applied:{}};
  const upsert=(kind:string,data:unknown)=>this.env.DB.prepare("INSERT INTO Records(kind,id,org_id,season_id,data,revision) VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id,org_id) DO UPDATE SET data=excluded.data,revision=excluded.revision WHERE excluded.revision>Records.revision").bind(kind,r.id,r.orgId,r.seasonId,JSON.stringify(data),r.revision);
  const writes=[upsert('room',summary),...(r.format==='Pbe'?roomExposureStatements(this.env.DB,r):[])];
  await this.env.DB.batch(writes);
  const terminal=r.status==="Completed"||r.status==='Interrupted';
  if(r.format==='Pbe'){
   if(!this.env.REPORTS)throw new Error("Report projection is not configured.");
   const target=this.env.REPORTS.getByName(`${r.orgId}:${r.seasonId}`);
   const encoded=terminal?await this.codec.encode(projection):null;
   if(encoded)this.ctx.storage.transactionSync(()=>{for(const [hash,data] of encoded.nodes){const old=this.readNode(hash);if(old!==null&&old!==data)throw new Error('Immutable room component conflict.');if(old===null)this.ctx.storage.sql.exec('INSERT INTO room_components(hash,data) VALUES(?,?)',hash,data);}});
   const candidates=this.ctx.storage.sql.exec<{hash:string;data:string}>('SELECT c.hash,c.data FROM room_components c LEFT JOIN room_uploaded u ON u.hash=c.hash WHERE u.hash IS NULL ORDER BY c.hash LIMIT ?',ROOM_STAGE_NODES).toArray(),nodes:typeof candidates=[];
   for(const node of candidates){const next={id:r.id,orgId:r.orgId,seasonId:r.seasonId,nodes:[...nodes,node]};if(utf8Bytes(JSON.stringify(next))>ROOM_STAGE_BYTES)break;nodes.push(node);}
   if(candidates.length&&!nodes.length)throw new Error('Room component exceeds stage body bound.');
   if(nodes.length){
    const response=await target.fetch(new Request('https://internal/stage',{method:'POST',body:JSON.stringify({id:r.id,orgId:r.orgId,seasonId:r.seasonId,nodes})}) as never);
    if(!response.ok)throw new Error('Room component staging failed.');const result=await response.json() as {acknowledged:string[]};if(JSON.stringify(result.acknowledged)!==JSON.stringify(nodes.map(n=>n.hash)))throw new Error('Room component acknowledgement mismatch.');
    this.ctx.storage.transactionSync(()=>{for(const n of nodes)this.ctx.storage.sql.exec('INSERT OR IGNORE INTO room_uploaded(hash) VALUES(?)',n.hash);});
    await this.continueProjection();return;
   }
   if(terminal){
    const payload=JSON.stringify({manifest:encoded!.manifest,summary:summarizeRoom(projection)});if(utf8Bytes(payload)>ROOM_STAGE_BYTES)throw new Error('Room publication exceeds body bound.');
    const response=await target.fetch(new Request('https://internal/project-components',{method:'POST',body:payload}) as never),result=await response.json() as {projected:boolean;error?:string};
    if(!response.ok){const missing=result.error?.match(/^History components missing: ([0-9a-f,]+)$/)?.[1];if(missing)for(const hash of missing.split(','))this.ctx.storage.sql.exec('DELETE FROM room_uploaded WHERE hash=?',hash);throw new Error('Room history publication failed.');}
    if(!result.projected){await this.continueProjection();return;}
   }
  }else if(terminal){
   if(!this.env.REPORTS)throw new Error("Report projection is not configured.");
   const response=await this.env.REPORTS.getByName(`${r.orgId}:${r.seasonId}`).fetch(new Request("https://internal/project",{method:"POST",body:JSON.stringify(projection)}) as never);
   if(!response.ok)throw new Error("Report projection failed.");
  }
  this.ctx.storage.sql.exec("DELETE FROM outbox WHERE id=1 AND data=?",row.data);
 }
 private async projectSafely(){if(maintenanceOffline(this.env))return;try{await this.project();}catch{const existing=await this.ctx.storage.getAlarm();await this.ctx.storage.setAlarm(Math.min(existing??Infinity,Date.now()+5000));}}
 private async publicView(r:Room,actor:RequestContext["actor"],now:number,materialUnavailable=false){return view(materialUnavailable?r:(await overlayRooms(new Store(this.env.DB),r.orgId,[r]))[0],actor,now,materialUnavailable);}
 private broadcast(){if(maintenanceOffline(this.env))return;for(const socket of this.ctx.getWebSockets()){try{socket.send(JSON.stringify({type:"Changed"}));}catch{socket.close(1011,"Reconnect");}}}
 async fetch(request:Request):Promise<Response>{
  if(maintenanceOffline(this.env))return dispatchMaintenance(request,this.ctx.storage,this.env,'room',this.ctx.id.toString());
  if(new URL(request.url).pathname.startsWith(MAINTENANCE_PREFIX))return new Response(null,{status:404});
  try{
   const url=new URL(request.url),match=url.pathname.match(/^\/api\/v1\/organizations\/([^/]+)\/practice\/rooms\/([^/]+)(.*)$/);if(!match)throw new HttpError(404,"Room route not found.");
   const isCommand=match[3]==="/commands"&&request.method==="POST";
   const input=request.method==="POST"?await body<Record<string,unknown>>(request,isCommand?32768:8192):null;
   // Captured after complete body ingress and before auth, application queue, or grading.
   const ingress=Date.now();const sensitive=isCommand&&["submit","ack","draft","present","present-ready"].includes(String(input?.action));
   if(sensitive&&this.pending>=16)throw new HttpError(429,"Too many pending submissions.");if(sensitive)this.pending++;
   try{
    const response=await this.serialize(async()=>{
    checkOrigin(request,this.env);const actor=await authenticate(request,this.env,match[1]);
    const context:RequestContext={request,env:this.env,actor,orgId:actor.organizationId,path:url.pathname,store:new Store(this.env.DB)};
     const now=Date.now();let r=await this.load();
     if(!r){if(request.method!=="POST"||match[3]!=="")throw new HttpError(404,"Room not found.");const creation=input as unknown as Parameters<typeof makeRoom>[2];const season=await context.store.require<{status:string}>("season",creation.seasonId,context.orgId);if(season.value.status!=="Active")throw new HttpError(400,"Choose an active season.");r=makeRoom(match[2],actor,creation,this.epoch,now);if(r.format==='Pbe')await authorizePbeRoom(context,r,true);await this.save(r);await this.arm(r);this.ctx.waitUntil(this.projectSafely());return json(await this.publicView(r,actor,now));}
     if(r.orgId!==actor.organizationId||r.id!==match[2])throw new HttpError(403,"Room access denied.");
     // Historical review reads the committed authority without advancing or recovering a clock.
     if(match[3]==='/review-attempt'&&request.method==='GET'){
      if(r.format!=='Pbe')throw new HttpError(400,'Choose a saved PBE result.');
      const member=r.members.find(m=>m.userId===actor.userId),coach=actor.kind==='Adult'&&['Owner','Admin'].includes(actor.role)&&!member;
      if(!member&&!coach)throw new HttpError(403,'Saved result access denied.');
      const submission=r.submissions.find(s=>teamAttemptId(r!,s)===(url.searchParams.get('attemptId')??'').toLowerCase());
      if(!submission)throw new HttpError(404,'Saved answer was not found.');
      if(!coach&&submission.team!==member?.team)throw new HttpError(403,'Only the saved team can review this answer.');
      if(['Lobby','Playing'].includes(r.status)){await authorizePbeRoom(context,r);if(!reviewedQuestion(r,submission.questionId))throw new HttpError(409,'Wait for answer review.');}
      const question=r.questions.find(q=>q.id===submission.questionId)!;
      return json({sessionId:r.id,seasonId:r.seasonId,attemptId:teamAttemptId(r,submission),team:submission.team,question,answers:submission.answers,acceptedAtUtc:new Date(submission.responseLockedAtMs??r.presentations?.[question.id]?.responseEndsAt??0).toISOString(),participantIds:r.members.filter(m=>m.team===submission.team).map(m=>m.userId),allParticipantIds:r.members.map(m=>m.userId)});
     }
     if(r.format==='Pbe'&&match[3]!=='/accept'&&!participant(r,actor)&&!canCoach(r,actor))throw new HttpError(403,'Room access denied.');
     if(isCommand&&isTerminatedPbePlay(r,String(input?.action))){applyCommand(r,actor,input as unknown as Command,ingress,now);return json(await this.publicView(r,actor,now));}
     const cleanup=r.format==='Pbe'&&isCommand&&['remove','leave','abandon'].includes(String(input?.action));
     let authorized:Awaited<ReturnType<typeof authorizePbeRoom>>|null=null;
     if(!cleanup&&r.format==='Pbe'&&['Lobby','Playing'].includes(r.status)&&match[3]!=='/accept'){
      try{authorized=await authorizePbeRoom(context,r);}catch(error){if(match[3]===''&&request.method==='GET'&&error instanceof HttpError&&[400,403,404].includes(error.status))return json(await this.publicView(r,actor,now,true));throw error;}
     }
     const previousRevision=r.revision;
     if(!cleanup&&r.epoch!==this.epoch){recover(r,this.epoch,now,"runtime-replacement",authorized?.eligibleReserveIds);r.revision++;await this.save(r);}
     if(!cleanup&&now<r.lastObserved){recover(r,this.epoch,now,"backwards-clock",authorized?.eligibleReserveIds);r.revision++;await this.save(r);await this.arm(r);this.broadcast();this.ctx.waitUntil(this.projectSafely());throw new HttpError(409,"Clock anomaly detected. Refresh the replaced question.");}
     if(match[3]==="/socket"&&request.headers.get("upgrade")?.toLowerCase()==="websocket"){
      if(!participant(r,actor)&&!canCoach(r,actor))throw new HttpError(403,"Room access denied.");const pair=new WebSocketPair();this.ctx.acceptWebSocket(pair[1]);pair[1].serializeAttachment({userId:actor.userId,credentialVersion:actor.credentialVersion});return new Response(null,{status:101,webSocket:pair[0]});
     }
     if(match[3]==="/accept"&&request.method==="POST"){
      const invitation=r.invitations.find(i=>i.id===input?.invitationId&&i.userId===actor.userId);if(!invitation||invitation.accepted||Date.parse(invitation.expiresAt)<=now)throw new HttpError(400,"Invitation expired or already accepted.");join(r,actor,invitation.team??Number(input?.team??1));if(r.format==='Pbe')await authorizePbeRoom(context,r,true);invitation.accepted=true;r.revision++;
     }else if(isCommand){
      const c=input as unknown as Command;if(!participant(r,actor)&&!(canCoach(r,actor)&&c.action==="judge"))throw new HttpError(403,"Room access denied.");
      const questions=c.action==="start"?(r.format==='Pbe'?await selectPbeRoomBank(context,r):await eligibleQuestions(context,r.seasonId,r.questionCount,r.bookKey)):undefined;
      const invitee=c.action==="invite"?await this.env.DB.prepare("SELECT id,display_name AS displayName FROM Users WHERE id=? AND org_id=? AND active=1 AND kind='Student'").bind(c.targetUserId??"",r.orgId).first<{id:string;displayName:string}>():undefined;
      applyCommand(r,actor,c,ingress,now,{questions,invitee:invitee??undefined,pending:this.pending>(sensitive?1:0)});
     }else if(match[3]===""&&request.method==="GET"){
      if(!participant(r,actor)&&!canCoach(r,actor))throw new HttpError(403,"Room access denied.");if(advance(r,now,this.pending>0))r.revision++;
     }else throw new HttpError(404,"Room route not found.");
     if(r.revision!==previousRevision){await this.save(r);await this.arm(r);this.broadcast();}
     // SQL projection is an outbox; failure cannot undo or retime a committed final answer.
     if(r.revision!==previousRevision){if(r.format==='Pbe')await this.projectSafely();else this.ctx.waitUntil(this.projectSafely());}
     return json(participant(r,actor)||canCoach(r,actor)?await this.publicView(r,actor,now,cleanup):{left:true});
    });return response;
   }finally{if(sensitive){this.pending--;if(this.pending===0&&(await this.load())?.format==='Pbe'){if((await this.load())?.status==='Playing')await this.ctx.storage.setAlarm(Date.now()+50);}else if(this.pending===0)this.ctx.waitUntil(this.serialize(async()=>{const r=await this.load();if(r&&await this.authorizeBackground(r)&&advance(r,Date.now(),false)){r.revision++;await this.save(r);await this.arm(r);this.broadcast();await this.projectSafely();}}));}}
  }catch(error){if(error instanceof HttpError)return json({title:error.message,detail:error.message},error.status);console.error("Practice command failed",error instanceof Error?error.name:"UnknownError");return json({title:"Practice temporarily unavailable"},503);}
 }
 private async authorizeBackground(r:Room):Promise<{reserveIds?:Set<string>}|null>{
  if(r.format!=='Pbe'||!['Lobby','Playing'].includes(r.status))return {};
  try{
   const user=await this.env.DB.prepare("SELECT id,display_name,user_name,kind,role,credential_version FROM Users WHERE id=? AND org_id=? AND active=1").bind(r.ownerId,r.orgId).first<{id:string;display_name:string;user_name:string;kind:'Student'|'Adult';role:'Student'|'Admin'|'Owner';credential_version:string}>();
   const store=new Store(this.env.DB),setting=await store.get<{enabled:boolean}>('practice-setting',r.orgId,r.orgId);
   if(!user||!setting?.value.enabled)return null;
   const scope=await authorizePbeRoom({env:this.env,store,orgId:r.orgId,path:'',request:new Request('https://internal/room-clock'),actor:{userId:user.id,organizationId:r.orgId,organizationName:'',displayName:user.display_name,userName:user.user_name,email:null,kind:user.kind,role:user.role,credentialVersion:user.credential_version}},r);return {reserveIds:scope.eligibleReserveIds};
  }catch{return null;}
 }
 async alarm(){if(maintenanceOffline(this.env))return;await this.serialize(async()=>{const r=await this.load();if(!r)return;const authorization=await this.authorizeBackground(r);if(!authorization){await this.ctx.storage.setAlarm(Date.now()+5000);await this.projectSafely();return;}const now=Date.now(),previousRevision=r.revision;if(r.epoch!==this.epoch){recover(r,this.epoch,now,"runtime-replacement",authorization.reserveIds);r.revision++;}if(advance(r,now,this.pending>0,authorization.reserveIds))r.revision++;if(r.format!=='Pbe'||r.revision!==previousRevision)await this.save(r);await this.arm(r);this.broadcast();await this.projectSafely();});}
 async webSocketMessage(socket:WebSocket,message:string|ArrayBuffer){
  if(maintenanceOffline(this.env)){socket.close(1001,"Offline maintenance");return;}
  const ingress=Date.now();
  if(typeof message!=="string"||message.length>1024){socket.close(1008,"Invalid message");return;}
  const stored=socket.deserializeAttachment() as {userId:string;credentialVersion:string};const user=await this.env.DB.prepare("SELECT credential_version,active FROM Users WHERE id=?").bind(stored.userId).first<{credential_version:string;active:number}>();if(!user||!user.active||user.credential_version!==stored.credentialVersion){socket.close(1008,"Sign in again");return;}
  let input:{type?:string;id?:string;nonce?:string};try{input=JSON.parse(message);}catch{socket.close(1008,"Invalid JSON");return;}
  const state=socket.deserializeAttachment() as {userId:string;credentialVersion:string;probe?:{nonce:string;at:number};samples?:number[]};
  if(input.type==="Ping")socket.send(JSON.stringify({type:"Pong",id:input.id,serverNow:new Date().toISOString()}));
  else if(input.type==="Probe") {const nonce=crypto.randomUUID();state.probe={nonce,at:Date.now()};socket.serializeAttachment(state);socket.send(JSON.stringify({type:"Probe",id:input.id,nonce,serverNow:new Date().toISOString()}));}
  // Diagnostics live in the socket attachment and acknowledgement, never immutable room/history publication.
  else if(input.type==="AckProbe") {if(!state.probe||state.probe.nonce!==input.nonce)return;const elapsed=ingress-state.probe.at;delete state.probe;if(elapsed<0||elapsed>10000){socket.serializeAttachment(state);return;}state.samples=[...(state.samples??[]),elapsed].slice(-20);socket.serializeAttachment(state);const jitter=state.samples.slice(1).reduce((n,x,i)=>n+Math.abs(x-state.samples![i]),0)/Math.max(1,state.samples.length-1);const quality={rttMs:elapsed,jitterMs:jitter,samples:state.samples.length,observedAt:ingress};socket.send(JSON.stringify({type:"AckProbe",id:input.id,...quality}));}
 }
 async webSocketClose(socket:WebSocket,code:number,reason:string){if(maintenanceOffline(this.env)){socket.close(1001,"Offline maintenance");return;}socket.close(code,reason);}
}
