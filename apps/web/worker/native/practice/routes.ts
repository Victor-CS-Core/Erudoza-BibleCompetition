import {simulationMaterial} from './simulation';
import {honorId,type HonorUnlock} from '../mastery/catalog';
import {simulationAchievements,simulationCatalog} from './simulation-awards';
import {resolvePbeSources} from '../pbe/sources';
import type {Season} from '../application/model';
import {makeRoom} from './state';
import {selectPbeRoomBank} from './pbe-material';
import type {SimulationSettings} from './simulation';
import {pbeRoutes} from "../pbe/routes";
import type {RequestContext} from "../types";
import {body,HttpError,json} from "../types";
import {questionRoutes,setEnabled,enabled,isLegacyQuestion} from "./questions";
import type {QuestionRecord} from "./questions";
import {listRoomSummaries} from "./room-history";
import type {Invitation} from "./state";
import {overlayRooms} from "../pbe/result-overlays";
import {calculateAwards,trends} from "./reports";
import type {Award} from './awards';
interface Directory {id:string;seasonId:string;ownerId:string;coachId?:string;teamCount?:1|2;memberIds:string[];hasAppeals:boolean;invitations:Invitation[];status:string}
export async function handlePractice(ctx:RequestContext):Promise<Response|null>{
 if(!ctx.path.startsWith("/practice"))return null;
 const pbe=await pbeRoutes(ctx);if(pbe)return pbe;
 if(ctx.path==="/practice/enabled"&&ctx.request.method==="POST")return setEnabled(ctx);
 if(ctx.path==="/practice/bootstrap"&&ctx.request.method==="GET"){
  const flag=await ctx.store.get<{enabled:boolean}>("practice-setting",ctx.orgId,ctx.orgId);const admin=ctx.actor.kind==="Adult"&&ctx.actor.role!=="Student";
  if(flag?.value.enabled===false)return json({enabled:false,seasons:admin?(await ctx.store.list<{id:string;name:string;status:string}>("season",ctx.orgId)).filter(s=>s.status==="Active").map(s=>({id:s.id,name:s.name})):[],players:[],rooms:[],invitations:[],achievements:[],questions:[],trends:[]});
  const [seasons,players,rooms,questions,matches,memberships,simulationUnlocks]=await Promise.all([ctx.store.list<{id:string;name:string;status:string}>("season",ctx.orgId),ctx.env.DB.prepare("SELECT id,display_name AS displayName FROM Users WHERE org_id=? AND active=1 AND ((kind='Student' AND role='Student') OR (kind='Adult' AND role IN ('Owner','Admin'))) ORDER BY display_name").bind(ctx.orgId).all(),ctx.store.list<Directory>("room",ctx.orgId),admin?ctx.store.list<QuestionRecord>("question",ctx.orgId):Promise.resolve([]),listRoomSummaries(ctx.env.DB,ctx.orgId),ctx.store.list<{seasonId:string}>('membership',ctx.orgId,{ownerId:ctx.actor.userId}),ctx.store.getMany<HonorUnlock>('mastery-honor',simulationCatalog.map(a=>honorId(ctx.orgId,ctx.actor.userId,a.key)),ctx.orgId)]);
  const reviewed=await overlayRooms(ctx.store,ctx.orgId,matches),savedAwards=await ctx.store.list<Award>('award',ctx.orgId),awards=[...savedAwards.filter(a=>!a.key.startsWith('pbe-team-v1:')),...calculateAwards(reviewed).filter(a=>a.key.startsWith('pbe-team-v1:'))].filter(a=>a.userId===ctx.actor.userId);
  return json({simulationAchievements:simulationAchievements(reviewed,ctx.orgId,ctx.actor.userId,[...new Set(memberships.map(m=>m.seasonId))].filter(id=>!new URL(ctx.request.url).searchParams.has('seasonId')||new URL(ctx.request.url).searchParams.get('seasonId')===id)).map(a=>({...a,earnedAtUtc:a.earnedAtUtc?(simulationUnlocks.find(u=>u.value.key===a.key&&u.value.userId===ctx.actor.userId&&u.value.ruleVersion==='simulation-v1')?.value.earnedAtUtc??a.earnedAtUtc):null})),enabled:true,seasons:seasons.filter(s=>s.status==="Active"),players:players.results,rooms:rooms.filter(r=>r.ownerId===ctx.actor.userId||r.coachId===ctx.actor.userId||r.memberIds.includes(ctx.actor.userId)||admin&&r.hasAppeals).map(({invitations:_inv,memberIds:_ids,...summary})=>{void _inv;void _ids;return summary;}),invitations:rooms.flatMap(r=>r.invitations.filter(i=>i.userId===ctx.actor.userId&&!i.accepted&&Date.parse(i.expiresAt)>Date.now()).map(i=>({...i,teamCount:r.teamCount??2}))),achievements:awards,questions:questions.filter(r=>isLegacyQuestion(r.question)),trends:trends(reviewed,ctx.actor.userId)});
 }
 await enabled(ctx);
 if(ctx.path==='/practice/simulation/material'&&ctx.request.method==='GET'){
  const materialUrl=new URL(ctx.request.url),seasonId=materialUrl.searchParams.get('seasonId')??'',roomId=materialUrl.searchParams.get('roomId');
  if(roomId){if(!/^[a-f0-9-]{36}$/i.test(roomId))throw new HttpError(400,'Choose a valid room.');if(!ctx.env.ROOMS)throw new HttpError(503,'Room storage is not configured.');materialUrl.pathname=`/api/v1/organizations/${ctx.orgId}/practice/rooms/${roomId}/simulation-material`;return ctx.env.ROOMS.getByName(`${ctx.orgId}:${roomId}`).fetch(new Request(materialUrl,{headers:ctx.request.headers}) as never) as unknown as Promise<Response>;}
  const coach=ctx.actor.kind==='Adult'&&['Owner','Admin'].includes(ctx.actor.role);
  if(coach){
   const season=await ctx.store.require<Season>('season',seasonId,ctx.orgId);
   if(!season.value.pbeEnabled)throw new HttpError(403,'PBE training is not enabled for this season.');
  }else await ctx.store.require('membership',`${seasonId}:${ctx.actor.userId}`,ctx.orgId);
  const scope=await resolvePbeSources(ctx,coach?{organizationId:ctx.orgId,seasonId}:{organizationId:ctx.orgId,seasonId,studentId:ctx.actor.userId});
  return json(simulationMaterial(seasonId,scope.sources));
 }
 if(ctx.path==='/practice/simulation/availability'&&ctx.request.method==='POST'){
  const input=await body<{seasonId:string;questionCount:number;teamSize:number;simulation:SimulationSettings;roomId?:string}>(ctx.request,16384);
  if(input.roomId){if(!/^[a-f0-9-]{36}$/i.test(input.roomId))throw new HttpError(400,'Choose a valid room.');if(!ctx.env.ROOMS)throw new HttpError(503,'Room storage is not configured.');const url=new URL(ctx.request.url);url.pathname=`/api/v1/organizations/${ctx.orgId}/practice/rooms/${input.roomId}/simulation-availability`;return ctx.env.ROOMS.getByName(`${ctx.orgId}:${input.roomId}`).fetch(new Request(url,{method:'POST',headers:ctx.request.headers,body:JSON.stringify(input)}) as never) as unknown as Promise<Response>;}
  const room=makeRoom(crypto.randomUUID(),ctx.actor,{...input,format:'Pbe',teamCount:1},'estimate',Date.now());if(!room.simulation)throw new HttpError(400,'Provide simulation settings.');return json(await selectPbeRoomBank(ctx,room,true));
 }
 const questions=await questionRoutes(ctx);if(questions)return questions;
 if(!ctx.env.ROOMS)throw new HttpError(503,"Room storage is not configured.");
 if(ctx.path==="/practice/rooms"&&ctx.request.method==="POST"){
  const id=crypto.randomUUID(),url=new URL(ctx.request.url);url.pathname+=`/${id}`;return ctx.env.ROOMS.getByName(`${ctx.orgId}:${id}`).fetch(new Request(url,ctx.request) as never) as unknown as Promise<Response>;
 }
 const accept=ctx.path.match(/^\/practice\/invitations\/([^/]+)\/accept$/);
 if(accept&&ctx.request.method==="POST"){
  const rooms=await ctx.store.list<Directory>("room",ctx.orgId),room=rooms.find(r=>r.invitations.some(i=>i.id===accept[1]&&i.userId===ctx.actor.userId));if(!room)throw new HttpError(404,"Invitation not found.");
  const input=await body<{team?:number}>(ctx.request,1024);const url=new URL(ctx.request.url);url.pathname=`/api/v1/organizations/${ctx.orgId}/practice/rooms/${room.id}/accept`;return ctx.env.ROOMS.getByName(`${ctx.orgId}:${room.id}`).fetch(new Request(url,{method:"POST",headers:ctx.request.headers,body:JSON.stringify({...input,invitationId:accept[1]})}) as never) as unknown as Promise<Response>;
 }
 return null;
}
