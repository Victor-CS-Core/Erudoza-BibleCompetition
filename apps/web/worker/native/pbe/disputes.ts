import {body,HttpError,json,requiredString,type RequestContext} from '../types';
import {atomic,deletion} from '../application/model';
import type {PbeSession} from './sessions';
import type {PbeQuestion} from './types';
import {gradePbe} from './grading';
import {prepareResultOverlay} from './result-overlays';
import {prepareEvidenceDispute,replayDisputeEvidence,disputeEvidencePage} from './evidence-replay';
interface FrozenAttempt {sessionId:string;seasonId:string;attemptId:string;team:number|null;question:PbeQuestion;answers:string[];acceptedAtUtc:string;participantIds:string[];allParticipantIds:string[]}
export interface PbeDispute {
 id:string;organizationId:string;seasonId:string;activity:'Solo'|'Team';sessionId:string;attemptId:string;questionId:string;questionVersion:number;team:number|null;
 status:'Pending'|'Resolved';reason:string;revision:number;partPoints:number[];sourceEvidence:string;
 question:PbeQuestion;answers:string[];originalPointsByPart:number[];acceptedAtUtc:string;participantIds:string[];allParticipantIds:string[];
 resolution:{pointsByPart:number[];reason:string;resolvedBy:string;resolvedAtUtc:string}|null;
}
const admin=(ctx:RequestContext)=>ctx.actor.kind==='Adult'&&['Owner','Admin'].includes(ctx.actor.role);
const coach=(ctx:RequestContext,d:PbeDispute)=>admin(ctx)&&!d.allParticipantIds.includes(ctx.actor.userId);
const normalized=(s:unknown,label:string)=>requiredString(s,label,200).toLowerCase();
const publicDispute=(d:PbeDispute)=>({id:d.id,organizationId:d.organizationId,seasonId:d.seasonId,activity:d.activity,sessionId:d.sessionId,attemptId:d.attemptId,questionId:d.questionId,questionVersion:d.questionVersion,team:d.team,status:d.status,reason:d.reason,revision:d.revision,partPoints:d.partPoints,sourceEvidence:d.sourceEvidence,question:d.question,answers:d.answers,originalPointsByPart:d.originalPointsByPart,acceptedAtUtc:d.acceptedAtUtc,resolution:d.resolution});
async function teamGate(ctx:RequestContext){const setting=await ctx.store.get<{enabled:boolean}>('practice-setting',ctx.orgId,ctx.orgId);if(!setting?.value.enabled)throw new HttpError(403,'Team Practice is disabled.');return {kind:'practice-setting',id:ctx.orgId,revision:setting.revision};}
async function frozenAttempt(ctx:RequestContext,activity:'Solo'|'Team',sessionId:string,attemptId:string):Promise<FrozenAttempt>{
 if(activity==='Team'){
  await teamGate(ctx);if(!ctx.env.ROOMS)throw new HttpError(503,'Room storage is not configured.');
  const url=new URL(`/api/v1/organizations/${ctx.orgId}/practice/rooms/${sessionId}/review-attempt`,ctx.request.url);url.searchParams.set('attemptId',attemptId);
  const response=await ctx.env.ROOMS.getByName(`${ctx.orgId}:${sessionId}`).fetch(new Request(url,{headers:ctx.request.headers}) as never);
  if(!response.ok){const problem=await response.json() as {detail?:string};throw new HttpError(response.status,problem.detail??'Saved result is unavailable.');}
  return response.json() as Promise<FrozenAttempt>;
 }
 const session=(await ctx.store.require<PbeSession>('pbe-session',sessionId,ctx.orgId)).value;
 if(session.studentUserId!==ctx.actor.userId)throw new HttpError(403,'Only a participant can flag this answer.');
 const attempt=session.attempts.find(a=>a.result.attemptId.toLowerCase()===attemptId);if(!attempt)throw new HttpError(404,'Saved answer was not found.');
 if(session.mode==='Simulation'&&session.status!=='Completed'&&!await ctx.store.get('pbe-solo-interruption',sessionId,ctx.orgId))throw new HttpError(409,'Finish the rehearsal before reviewing answers.');
 const card=session.cards.find(c=>c.id===attempt.cardId);if(!card)throw new HttpError(409,'The saved rubric is unavailable.');
 return {sessionId:session.id,seasonId:session.seasonId,attemptId:attempt.result.attemptId,team:null,question:card.question,answers:attempt.answers,acceptedAtUtc:attempt.result.acceptedAtUtc,participantIds:[session.studentUserId],allParticipantIds:[session.studentUserId]};
}
async function reconcileTeamAwards(ctx:RequestContext,d:PbeDispute){
 if(d.activity!=='Team')return;if(!ctx.env.REPORTS)throw new HttpError(503,'Report projection is not configured.');
 const response=await ctx.env.REPORTS.getByName(`${ctx.orgId}:${d.seasonId}`).fetch(new Request('https://internal/review',{method:'POST',body:JSON.stringify({id:d.sessionId,orgId:ctx.orgId,seasonId:d.seasonId})}) as never);
 if(!response.ok)throw new HttpError(503,'The review is saved. Retry to refresh team milestones.');
}
function uniqueInsertion(ctx:RequestContext,kind:string,id:string,value:unknown,seasonId:string,ownerId:string){return ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) VALUES(?,?,?,?,?,?,1) ON CONFLICT(kind,id,org_id) DO UPDATE SET data='invalid-json'").bind(kind,id,ctx.orgId,seasonId,ownerId,JSON.stringify(value));}
export async function resolvePbeDispute(ctx:RequestContext,disputeId:string,expectedRevision:number,pointsByPart:number[],reason:string):Promise<PbeDispute>{
 const stored=await ctx.store.require<PbeDispute>('pbe-dispute',disputeId,ctx.orgId),d=stored.value;
 const gates=d.activity==='Team'?[await teamGate(ctx)]:[];
 if(!coach(ctx,d))throw new HttpError(403,'A non-playing coach is required.');
 if(!Array.isArray(pointsByPart)||pointsByPart.length!==d.partPoints.length||pointsByPart.some((p,i)=>!Number.isInteger(p)||p<0||p>d.partPoints[i]))throw new HttpError(400,'Use whole points within each frozen rubric part.');
 if(d.status==='Resolved'){
  if(expectedRevision===d.revision-1&&d.resolution?.resolvedBy===ctx.actor.userId&&d.resolution.reason===reason&&JSON.stringify(d.resolution.pointsByPart)===JSON.stringify(pointsByPart)){await reconcileTeamAwards(ctx,d);return d;}
  throw new HttpError(409,'This review already has another ruling.');
 }
 if(expectedRevision!==d.revision)throw new HttpError(409,'The review changed. Refresh and retry.');
 const resolved:PbeDispute={...d,status:'Resolved',revision:d.revision+1,resolution:{pointsByPart,reason,resolvedBy:ctx.actor.userId,resolvedAtUtc:new Date().toISOString()}};
 const adjustment={id:`${d.id}:${resolved.revision}`,disputeId:d.id,activity:d.activity,sessionId:d.sessionId,attemptId:d.attemptId,questionId:d.questionId,questionVersion:d.questionVersion,team:d.team,pointsByPart,...resolved.resolution,originalAcceptedAtUtc:d.acceptedAtUtc};
 const overlay=await prepareResultOverlay(ctx,resolved),evidence=await prepareEvidenceDispute(ctx,resolved);
 await atomic(ctx,'pbe-dispute.resolve',[...evidence.statements,...overlay.statements,ctx.store.update('pbe-dispute',d.id,ctx.orgId,resolved,stored.revision),uniqueInsertion(ctx,'pbe-grade-adjustment',adjustment.id,adjustment,d.seasonId,d.participantIds[0]),deletion(ctx,'pbe-dispute-pending',d.id)],[...evidence.guards,...overlay.guards,...gates,{kind:'@active-admin',id:ctx.actor.userId,revision:0},{kind:'pbe-dispute',id:d.id,revision:stored.revision}]);
 await reconcileTeamAwards(ctx,resolved);return resolved;
}
export async function disputeRoutes(ctx:RequestContext):Promise<Response|null>{
 const base='/api/v1/pbe/disputes';if(ctx.path!==base&&!ctx.path.startsWith(base+'/'))return null;
 if(ctx.path===base&&ctx.request.method==='POST'){
  const input=await body<{activity?:string;sessionId?:string;attemptId?:string;reason?:string}>(ctx.request,4096),reason=requiredString(input.reason,'Review reason',500);
  if(input.activity!=='Solo'&&input.activity!=='Team')throw new HttpError(400,'Choose a saved Solo or Team result.');
  if(ctx.actor.kind!=='Student'||ctx.actor.role!=='Student')throw new HttpError(403,'Only a participant can flag this answer.');
  const sessionId=normalized(input.sessionId,'Session ID'),attemptId=normalized(input.attemptId,'Attempt ID'),activity=input.activity;
  const frozen=await frozenAttempt(ctx,activity,sessionId,attemptId);
  if(!frozen.participantIds.includes(ctx.actor.userId))throw new HttpError(403,'Only the saved participant can flag this answer.');
  const id=`${activity}:${sessionId}:${attemptId}`,prior=await ctx.store.get<PbeDispute>('pbe-dispute',id,ctx.orgId);
  if(prior){if(prior.value.reason!==reason)throw new HttpError(409,'This answer already has another review request.');await reconcileTeamAwards(ctx,prior.value);return json(publicDispute(prior.value));}
  const dispute:PbeDispute={...frozen,id,organizationId:ctx.orgId,activity,sessionId,attemptId,questionId:frozen.question.id,questionVersion:frozen.question.version,status:'Pending',reason,revision:1,partPoints:frozen.question.parts.map(p=>p.points),sourceEvidence:frozen.question.evidence,originalPointsByPart:gradePbe(frozen.question,frozen.answers).parts.map(p=>p.earnedPoints),resolution:null};
  const gates=activity==='Team'?[await teamGate(ctx)]:[];
  const overlay=await prepareResultOverlay(ctx,dispute),evidence=await prepareEvidenceDispute(ctx,dispute);
  await atomic(ctx,'pbe-dispute.flag',[...evidence.statements,...overlay.statements,uniqueInsertion(ctx,'pbe-dispute',id,dispute,frozen.seasonId,frozen.participantIds[0]),uniqueInsertion(ctx,'pbe-dispute-pending',id,dispute,frozen.seasonId,activity)],[...evidence.guards,...overlay.guards,...gates,{kind:'@active-user',id:ctx.actor.userId,revision:0}]);
  await reconcileTeamAwards(ctx,dispute);return json(publicDispute(dispute),201);
 }
 if(ctx.path===base&&ctx.request.method==='GET'){
  if(!admin(ctx))throw new HttpError(403,'Coach access is required.');
  const after=new URL(ctx.request.url).searchParams.get('after')??'';if(after.length>450)throw new HttpError(400,'Invalid cursor.');
  const enabled=(await ctx.store.get<{enabled:boolean}>('practice-setting',ctx.orgId,ctx.orgId))?.value.enabled;
  const rows=await ctx.env.DB.prepare("SELECT data,id FROM Records INDEXED BY Records_owner WHERE org_id=? AND kind='pbe-dispute-pending' AND owner_id IN (SELECT value FROM json_each(?)) AND id>? ORDER BY id LIMIT 51").bind(ctx.orgId,JSON.stringify(enabled?['Solo','Team']:['Solo']),after).all<{data:string;id:string}>();
  const page=rows.results.slice(0,50),items=page.map(row=>JSON.parse(row.data) as PbeDispute).filter(d=>coach(ctx,d)).map(publicDispute);
  return json({items,nextCursor:rows.results.length>50?page[49].id:null});
 }
 const match=ctx.path.match(/^\/api\/v1\/pbe\/disputes\/([^/]+)(\/(?:resolve|replay|evidence))?$/);if(!match)return null;
 const id=decodeURIComponent(match[1]);
 if(match[2]==='/replay'&&ctx.request.method==='POST'||match[2]==='/evidence'&&ctx.request.method==='GET'){
  const d=(await ctx.store.require<PbeDispute>('pbe-dispute',id,ctx.orgId)).value;if(d.activity==='Team')await teamGate(ctx);if(!coach(ctx,d)&&!d.participantIds.includes(ctx.actor.userId))throw new HttpError(403,'Saved result access denied.');
  if(match[2]==='/replay')return json(await replayDisputeEvidence(ctx,d));
  const query=new URL(ctx.request.url).searchParams;return json(await disputeEvidencePage(ctx,d,query.get('targetId')??'',query.get('after')??''));
 }
 if(match[2]==='/resolve'&&ctx.request.method==='POST'){
  const input=await body<{expectedRevision:number;pointsByPart:number[];reason:string}>(ctx.request,4096);
  return json(publicDispute(await resolvePbeDispute(ctx,id,input.expectedRevision,input.pointsByPart,requiredString(input.reason,'Resolution reason',500))));
 }
 if(!match[2]&&ctx.request.method==='GET'){
  const d=(await ctx.store.require<PbeDispute>('pbe-dispute',id,ctx.orgId)).value;if(d.activity==='Team')await teamGate(ctx);
  if(!coach(ctx,d)&&!d.participantIds.includes(ctx.actor.userId))throw new HttpError(403,'Saved result access denied.');
  return json(publicDispute(d));
 }
 return null;
}
