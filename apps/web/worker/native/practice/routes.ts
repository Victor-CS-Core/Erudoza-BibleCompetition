import {pbeRoutes} from "../pbe/routes";
import type {RequestContext} from "../types";
import {body,HttpError,json} from "../types";
import {questionRoutes,setEnabled,enabled,isLegacyQuestion} from "./questions";
import type {QuestionRecord} from "./questions";
import type {Room,Invitation} from "./state";
import type {Award} from "./reports";
import {trends} from "./reports";
interface Directory {id:string;seasonId:string;ownerId:string;coachId?:string;memberIds:string[];hasAppeals:boolean;invitations:Invitation[];status:string}
export async function handlePractice(ctx:RequestContext):Promise<Response|null>{
 if(!ctx.path.startsWith("/practice"))return null;
 const pbe=await pbeRoutes(ctx);if(pbe)return pbe;
 if(ctx.path==="/practice/enabled"&&ctx.request.method==="POST")return setEnabled(ctx);
 if(ctx.path==="/practice/bootstrap"&&ctx.request.method==="GET"){
  const flag=await ctx.store.get<{enabled:boolean}>("practice-setting",ctx.orgId,ctx.orgId);const admin=ctx.actor.kind==="Adult"&&ctx.actor.role!=="Student";
  if(!flag?.value.enabled)return json({enabled:false,seasons:admin?(await ctx.store.list<{id:string;name:string;status:string}>("season",ctx.orgId)).filter(s=>s.status==="Active").map(s=>({id:s.id,name:s.name})):[],players:[],rooms:[],invitations:[],achievements:[],questions:[],trends:[]});
  const [seasons,players,rooms,awards,questions,matches]=await Promise.all([ctx.store.list<{id:string;name:string;status:string}>("season",ctx.orgId),ctx.env.DB.prepare("SELECT id,display_name AS displayName FROM Users WHERE org_id=? AND active=1 AND kind='Student' ORDER BY display_name").bind(ctx.orgId).all(),ctx.store.list<Directory>("room",ctx.orgId),ctx.store.list<Award>("award",ctx.orgId,{ownerId:ctx.actor.userId}),admin?ctx.store.list<QuestionRecord>("question",ctx.orgId):Promise.resolve([]),ctx.store.list<Room>("match",ctx.orgId)]);
  return json({enabled:true,seasons:seasons.filter(s=>s.status==="Active"),players:players.results,rooms:rooms.filter(r=>r.ownerId===ctx.actor.userId||r.coachId===ctx.actor.userId||r.memberIds.includes(ctx.actor.userId)||admin&&r.hasAppeals).map(({invitations:_inv,memberIds:_ids,...summary})=>{void _inv;void _ids;return summary;}),invitations:rooms.flatMap(r=>r.invitations.filter(i=>i.userId===ctx.actor.userId&&!i.accepted&&Date.parse(i.expiresAt)>Date.now())),achievements:awards,questions:questions.filter(r=>isLegacyQuestion(r.question)),trends:trends(matches,ctx.actor.userId)});
 }
 await enabled(ctx);const questions=await questionRoutes(ctx);if(questions)return questions;
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
