import type {RequestContext} from '../types';
import type {Store} from '../store';
import type {PbeDispute} from './disputes';
import type {PbeWriteBatch} from './progress';
import type {RoomStats} from '../practice/room-history';
export interface PbeResultReview {id:string;status:'Pending'|'Resolved';revision:number;questionId:string;questionVersion:number;pointsByPart:number[]|null}
export interface PbeResultOverlay {id:string;activity:'Solo'|'Team';sessionId:string;entries:Record<string,PbeResultReview>}
/** One indexed row per frozen session; append/update in the same transaction as the dispute. */
export async function prepareResultOverlay(ctx:RequestContext,d:PbeDispute):Promise<PbeWriteBatch>{
 const id=`${d.activity}:${d.sessionId}`,prior=await ctx.store.get<PbeResultOverlay>('pbe-result-overlay',id,ctx.orgId);
 const value:PbeResultOverlay={id,activity:d.activity,sessionId:d.sessionId,entries:{...prior?.value.entries,[d.attemptId]:{id:d.id,status:d.status,revision:d.revision,questionId:d.questionId,questionVersion:d.questionVersion,pointsByPart:d.resolution?.pointsByPart??null}}};
 return {statements:[prior?ctx.store.update('pbe-result-overlay',id,ctx.orgId,value,prior.revision):ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) VALUES('pbe-result-overlay',?,?,?,?,?,1) ON CONFLICT(kind,id,org_id) DO UPDATE SET data='invalid-json'").bind(id,ctx.orgId,d.seasonId,d.participantIds[0],JSON.stringify(value))],guards:prior?[{kind:'pbe-result-overlay',id,revision:prior.revision}]:[]};
}
export function overlayRoom<T extends RoomStats>(r:T,overlay:PbeResultOverlay|undefined):T{
 if(r.format!=='Pbe'||!overlay)return r;
 return {...r,submissions:r.submissions.map(s=>{const review=overlay.entries[s.attemptId?.toLowerCase()??`team:${r.id.toLowerCase()}:${s.questionId.toLowerCase()}:${s.team}`],q=r.questions.find(q=>q.id===s.questionId);if(!review||review.questionId!==q?.id||review.questionVersion!==q.version)return s;
  return {...s,dispute:review,originalAccuracyHundredths:s.accuracyHundredths,resolved:review.status==='Resolved',accuracyHundredths:review.pointsByPart?review.pointsByPart.reduce((n,p)=>n+p,0)*100:s.accuracyHundredths};})};
}
export async function overlayRooms<T extends RoomStats>(store:Store,org:string,rooms:T[]){
 const ids=rooms.filter(r=>r.format==='Pbe').map(r=>`Team:${r.id}`);if(!ids.length)return rooms;
 const records=await store.getMany<PbeResultOverlay>('pbe-result-overlay',ids,org),byId=new Map(records.map(r=>[r.value.id,r.value]));return rooms.map(r=>overlayRoom(r,byId.get(`Team:${r.id}`)));
}
