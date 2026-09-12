import type {RequestContext} from '../types';
import {HttpError} from '../types';
import type {Stored} from '../store';
import {atomic,deletion} from '../application/model';
import type {PbeDispute} from './disputes';
import type {PbeWriteBatch,ReviewProjection,RecallEvent} from './progress';
import {advanceReview,initialReview,type RecallEvidence} from './review';
export interface EvidenceRef {id:string;eventId:string;attemptRecordId:string;acceptedSequence:number;questionKind:string|null;evidence:RecallEvidence}
interface EvidenceIndex {id:string;ready:boolean;after:string;coveredLegacyEvents:number}
interface Dirty {id:string;targetId:string;generation:number;completedGeneration:number}
interface AttemptReview {id:string;questionId:string;status:'Pending'|'Resolved';pointsByTarget:Record<string,number>}
interface ReplayJob {id:string;generation:number;after:string;projection:ReviewProjection;pendingCount:number}
const ownerKey=(owner:string,season:string)=>`${owner.toLowerCase()}:${season.toLowerCase()}`;
const targetKey=(d:PbeDispute,target:string)=>`${ownerKey(d.participantIds[0],d.seasonId)}:${target.toLowerCase()}`;
export function evidenceRefs(owner:string,season:string,event:RecallEvent):EvidenceRef[]{return event.evidence.map(e=>({id:`${ownerKey(owner,season)}:${e.targetId}:${String(event.acceptedSequence).padStart(16,'0')}:${e.attemptId}`,eventId:event.id,attemptRecordId:e.attemptId,acceptedSequence:event.acceptedSequence,questionKind:event.questionKind,evidence:e}));}
export function bulkRefs(ctx:RequestContext,owner:string,season:string,refs:EvidenceRef[]){return ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) SELECT 'pbe-evidence-ref',json_extract(value,'$.id'),?,?,?,value,1 FROM json_each(?) WHERE true ON CONFLICT(kind,id,org_id) DO NOTHING").bind(ctx.orgId,season,owner,JSON.stringify(refs));}
function write(ctx:RequestContext,w:PbeWriteBatch,kind:string,id:string,value:unknown,prior:Stored<unknown>|null,owner:string,season:string){
 if(prior){w.guards.push({kind,id,revision:prior.revision});w.statements.push(ctx.store.update(kind,id,ctx.orgId,value,prior.revision));}
 else w.statements.push(ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) VALUES(?,?,?,?,?,?,1) ON CONFLICT(kind,id,org_id) DO UPDATE SET data='invalid-json'").bind(kind,id,ctx.orgId,season,owner,JSON.stringify(value)));
}
export async function prepareEvidenceDispute(ctx:RequestContext,d:PbeDispute):Promise<PbeWriteBatch>{
 const w:PbeWriteBatch={statements:[],guards:[]};if(d.activity!=='Solo')return w;
 const targets=[...new Set(d.question.parts.map(p=>p.targetId.toLowerCase()))],ids=targets.map(t=>targetKey(d,t)),owner=d.participantIds[0];
 const dirty=await ctx.store.getMany<Dirty>('pbe-evidence-dirty',ids,ctx.orgId),projections=await ctx.store.getMany<ReviewProjection>('pbe-target-review',ids,ctx.orgId);
 for(const target of targets){const id=targetKey(d,target),old=dirty.find(r=>r.value.id===id)??null,projection=projections.find(r=>r.value.id===id)??null;
  if(!projection)throw new HttpError(409,'Saved target evidence is unavailable.');
  write(ctx,w,'pbe-evidence-dirty',id,{id,targetId:target,generation:(old?.value.generation??0)+1,completedGeneration:old?.value.completedGeneration??0},old,owner,d.seasonId);
  write(ctx,w,'pbe-target-review',id,{...projection.value,provisional:true},projection,owner,d.seasonId);
 }
 const id=`${ownerKey(owner,d.seasonId)}:${d.attemptId}`,prior=await ctx.store.get<AttemptReview>('pbe-attempt-review',id,ctx.orgId),pointsByTarget:Record<string,number>={};
 if(d.resolution)d.question.parts.forEach((p,i)=>pointsByTarget[p.targetId]=(pointsByTarget[p.targetId]??0)+d.resolution!.pointsByPart[i]);
 write(ctx,w,'pbe-attempt-review',id,{id,questionId:d.questionId,status:d.status,pointsByTarget},prior,owner,d.seasonId);return w;
}
async function indexPage(ctx:RequestContext,d:PbeDispute){
 const owner=d.participantIds[0],id=ownerKey(owner,d.seasonId),stored=await ctx.store.get<EvidenceIndex>('pbe-evidence-index',id,ctx.orgId);if(stored?.value.ready)return true;
 const after=stored?.value.after??'',events=await ctx.store.list<RecallEvent>('pbe-recall-event',ctx.orgId,{seasonId:d.seasonId,ownerId:owner,after,limit:26});
 const page=events.slice(0,25),ready=events.length<=25,w:PbeWriteBatch={statements:[],guards:[]};
 if(page.length)w.statements.push(bulkRefs(ctx,owner,d.seasonId,page.flatMap(e=>evidenceRefs(owner,d.seasonId,e))));
 write(ctx,w,'pbe-evidence-index',id,{id,ready,after:page.at(-1)?.id??after,coveredLegacyEvents:(stored?.value.coveredLegacyEvents??0)+page.length},stored,owner,d.seasonId);
 await atomic(ctx,'pbe-evidence.index',w.statements,w.guards);return false;
}
function initialProjection(id:string,targetId:string):ReviewProjection{return {id,targetId,review:initialReview(targetId),acceptedSequence:0,failedSequence:null,lastAnsweredQuestionId:'',lastAnsweredQuestionKind:null,provisional:true};}
/** At most25 legacy events or32 references for one affected target in each authenticated continuation. */
export async function replayDisputeEvidence(ctx:RequestContext,d:PbeDispute){
 if(d.activity!=='Solo')return {status:'Ready',indexReady:true,proofs:[]};
 if(!await indexPage(ctx,d))return {status:'Provisional',stage:'Indexing',indexReady:false,revision:d.revision};
 const owner=d.participantIds[0],targets=[...new Set(d.question.parts.map(p=>p.targetId.toLowerCase()))],ids=targets.map(t=>targetKey(d,t));
 const dirty=await ctx.store.getMany<Dirty>('pbe-evidence-dirty',ids,ctx.orgId),next=dirty.find(r=>r.value.completedGeneration!==r.value.generation);
 if(!next){
  const correction=await ctx.store.get<PbeDispute>('pbe-dispute-correction',d.id,ctx.orgId);
  if(correction)await atomic(ctx,'pbe-evidence.correction-complete',[deletion(ctx,'pbe-dispute-correction',d.id)],[{kind:'pbe-dispute-correction',id:d.id,revision:correction.revision},...dirty.map(row=>({kind:'pbe-evidence-dirty',id:row.value.id,revision:row.revision}))]);
  const proofs=await ctx.store.getMany<ReviewProjection>('pbe-target-review',ids,ctx.orgId);return {status:'Ready',indexReady:true,revision:d.revision,proofs:proofs.map(p=>({revision:p.revision,...p.value}))};}
 const id=next.value.id,oldJob=await ctx.store.get<ReplayJob>('pbe-evidence-replay',id,ctx.orgId),job=oldJob?.value.generation===next.value.generation?oldJob.value:{id,generation:next.value.generation,after:id+':',projection:initialProjection(id,next.value.targetId),pendingCount:0};
 const sequenceId=ownerKey(owner,d.seasonId),sequence=await ctx.store.get('pbe-recall-sequence',sequenceId,ctx.orgId);
 const refs=await ctx.env.DB.prepare("SELECT data FROM Records INDEXED BY Records_training_scope WHERE org_id=? AND season_id=? AND owner_id=? AND kind='pbe-evidence-ref' AND id>? AND id<? ORDER BY id LIMIT 33").bind(ctx.orgId,d.seasonId,owner,job.after,id+';').all<{data:string}>();
 if(!refs.results.length&&job.projection.acceptedSequence===0){
  const index=await ctx.store.require<EvidenceIndex>('pbe-evidence-index',sequenceId,ctx.orgId);
  await atomic(ctx,'pbe-evidence.reindex',[ctx.store.update('pbe-evidence-index',sequenceId,ctx.orgId,{id:sequenceId,ready:false,after:'',coveredLegacyEvents:0},index.revision)],[{kind:'pbe-evidence-index',id:sequenceId,revision:index.revision}]);
  return {status:'Provisional',stage:'Indexing',indexReady:false,revision:d.revision};
 }
 const page=refs.results.slice(0,32).map(r=>JSON.parse(r.data) as EvidenceRef),reviews=await ctx.store.getMany<AttemptReview>('pbe-attempt-review',page.map(r=>`${sequenceId}:${r.attemptRecordId}`),ctx.orgId),byAttempt=new Map(reviews.map(r=>[r.value.id,r.value]));
 for(const ref of page){let e=ref.evidence;const review=byAttempt.get(`${sequenceId}:${e.attemptId}`);if(review){if(review.questionId!==e.questionId)throw new HttpError(409,'Saved evidence membership changed.');if(review.status==='Pending'){job.pendingCount++;e={...e,earnedPoints:0};}else e={...e,earnedPoints:review.pointsByTarget[e.targetId]??e.earnedPoints};}
  job.projection.review=advanceReview(job.projection.review,e);job.projection.acceptedSequence=ref.acceptedSequence;job.projection.lastAnsweredQuestionId=e.questionId;job.projection.lastAnsweredQuestionKind=ref.questionKind;job.projection.failedSequence=e.recall&&e.earnedPoints<e.availablePoints?ref.acceptedSequence:job.projection.review.unresolved?job.projection.failedSequence:null;job.after=ref.id;
 }
 const complete=refs.results.length<=32,w:PbeWriteBatch={statements:[],guards:[{kind:'pbe-evidence-dirty',id,revision:next.revision},...(sequence?[{kind:'pbe-recall-sequence',id:sequenceId,revision:sequence.revision}]:[])]};
 write(ctx,w,'pbe-evidence-replay',id,job,oldJob,owner,d.seasonId);
 if(complete){const prior=await ctx.store.get<ReviewProjection>('pbe-target-review',id,ctx.orgId);write(ctx,w,'pbe-target-review',id,{...job.projection,provisional:job.pendingCount>0,pendingCount:job.pendingCount,evidenceGeneration:job.generation},prior,owner,d.seasonId);w.statements.push(ctx.store.update('pbe-evidence-dirty',id,ctx.orgId,{...next.value,completedGeneration:job.generation},next.revision));}
 await atomic(ctx,'pbe-evidence.replay',w.statements,w.guards);return {status:'Provisional',stage:'Replaying',indexReady:true,revision:d.revision,targetId:next.value.targetId,processed:page.length,targetComplete:complete};
}
/** Affected targets only. The indexed attempt join preserves original response locks; absent legacy timing stays unknown. */
export async function disputeEvidencePage(ctx:RequestContext,d:PbeDispute,targetId:string,after:string){
 if(d.activity!=='Solo'||!d.question.parts.some(p=>p.targetId===targetId))throw new HttpError(403,'Choose an affected target.');
 const id=targetKey(d,targetId);if(after&&!after.startsWith(id+':'))throw new HttpError(400,'Invalid evidence cursor.');
 const index=await ctx.store.get<EvidenceIndex>('pbe-evidence-index',ownerKey(d.participantIds[0],d.seasonId),ctx.orgId),dirty=await ctx.store.get<Dirty>('pbe-evidence-dirty',id,ctx.orgId),proof=await ctx.store.get<ReviewProjection>('pbe-target-review',id,ctx.orgId);
 const rows=await ctx.env.DB.prepare("SELECT data FROM Records INDEXED BY Records_training_scope WHERE org_id=? AND season_id=? AND owner_id=? AND kind='pbe-evidence-ref' AND id>? AND id<? ORDER BY id LIMIT 33").bind(ctx.orgId,d.seasonId,d.participantIds[0],after||id+':',id+';').all<{data:string}>();
 const refs=rows.results.slice(0,32).map(r=>JSON.parse(r.data) as EvidenceRef),attempts=await ctx.store.getMany<{id:string;atMs:number;responseLockedAtMs?:number}>('pbe-attempt',refs.map(r=>r.attemptRecordId),ctx.orgId),byId=new Map(attempts.map(r=>[r.value.id,r.value]));
 const gradeReviews=await ctx.store.getMany<AttemptReview>('pbe-attempt-review',refs.map(ref=>`${ownerKey(d.participantIds[0],d.seasonId)}:${ref.attemptRecordId}`),ctx.orgId),grades=new Map(gradeReviews.map(r=>[r.value.id,r.value]));
 const ready=index?.value.ready&&dirty?.value.completedGeneration===dirty?.value.generation;
 return {indexReady:index?.value.ready??false,status:ready?'Ready':'Provisional',provisional:!ready||proof?.value.provisional!==false,revision:proof?.revision??null,evidenceGeneration:dirty?.value.generation??null,proof:proof?.value??null,items:refs.map(ref=>{const grade=grades.get(`${ownerKey(d.participantIds[0],d.seasonId)}:${ref.attemptRecordId}`);return {...ref,gradeStatus:grade?.status??'Final',finalEvidence:grade?.status==='Pending'?null:{...ref.evidence,earnedPoints:grade?.pointsByTarget[ref.evidence.targetId]??ref.evidence.earnedPoints},responseLockedAtMs:byId.get(ref.attemptRecordId)?.responseLockedAtMs??null,originalAcceptedAtMs:byId.get(ref.attemptRecordId)?.atMs??null};}),nextCursor:rows.results.length>32?refs[31].id:null};
}
