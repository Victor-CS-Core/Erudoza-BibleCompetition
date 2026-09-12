import {chapterBoundedPage} from './chapter-bounded-page';
import type {RequestContext} from '../types';
import {HttpError} from '../types';
import type {Stored} from '../store';
import {atomic,deletion} from '../application/model';
import type {PbeDispute} from './disputes';
import type {PbeWriteBatch,ReviewProjection,RecallEvent} from './progress';
import {advanceReview,initialReview,type RecallEvidence} from './review';
import {advanceRetention,initialRetentionState,RETENTION_RULE_VERSION,type TargetProof} from './chapters';
export interface EvidenceRef {questionVersion?:number;responseLockedAtMs?:number;id:string;eventId:string;attemptRecordId:string;acceptedSequence:number;questionKind:string|null;evidence:RecallEvidence}
interface EvidenceIndex {id:string;ready:boolean;after:string;coveredLegacyEvents:number}
interface Dirty {id:string;targetId:string;generation:number;completedGeneration:number}
interface AttemptReview {id:string;questionId:string;status:'Pending'|'Resolved';pointsByTarget:Record<string,number>}
interface ReplayJob {id:string;generation:number;after:string;projection:ReviewProjection;pendingCount:number}
const ownerKey=(owner:string,season:string)=>`${owner.toLowerCase()}:${season.toLowerCase()}`;
const targetKey=(d:PbeDispute,target:string)=>`${ownerKey(d.participantIds[0],d.seasonId)}:${target.toLowerCase()}`;
export function evidenceRefs(owner:string,season:string,event:RecallEvent):EvidenceRef[]{return event.evidence.map(e=>({id:`${ownerKey(owner,season)}:${e.targetId}:${String(event.acceptedSequence).padStart(16,'0')}:${e.attemptId}`,eventId:event.id,attemptRecordId:e.attemptId,acceptedSequence:event.acceptedSequence,questionKind:event.questionKind,questionVersion:event.questionVersion,responseLockedAtMs:event.responseLockedAtMs,evidence:e}));}
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
async function indexPage(ctx:RequestContext,owner:string,seasonId:string){
 const id=ownerKey(owner,seasonId),stored=await ctx.store.get<EvidenceIndex>('pbe-evidence-index',id,ctx.orgId);if(stored?.value.ready)return true;
 const after=stored?.value.after??'',events=await chapterBoundedPage<RecallEvent>(ctx,"SELECT id AS key,data AS payload FROM Records INDEXED BY Records_training_scope WHERE org_id=? AND season_id=? AND owner_id=? AND kind='pbe-recall-event' AND id>? ORDER BY id LIMIT 25",[ctx.orgId,seasonId,owner,after]);
 const page:RecallEvent[]=[],refs:EvidenceRef[]=[];for(const event of events){const next=evidenceRefs(owner,seasonId,event);if(new TextEncoder().encode(JSON.stringify([...refs,...next])).byteLength>64000){if(!page.length)throw new HttpError(413,'PBE_CHAPTER_INPUT_TOO_LARGE');break;}page.push(event);refs.push(...next);}
 const ready=events.length===0,w:PbeWriteBatch={statements:[],guards:[]};
 if(page.length)w.statements.push(bulkRefs(ctx,owner,seasonId,refs));
 write(ctx,w,'pbe-evidence-index',id,{id,ready,after:page.at(-1)?.id??after,coveredLegacyEvents:(stored?.value.coveredLegacyEvents??0)+page.length},stored,owner,seasonId);
 await atomic(ctx,'pbe-evidence.index',w.statements,w.guards);return false;
}
function initialProjection(id:string,targetId:string):ReviewProjection{return {id,targetId,review:initialReview(targetId),acceptedSequence:0,failedSequence:null,lastAnsweredQuestionId:'',lastAnsweredQuestionKind:null,provisional:true,retention:initialRetentionState()};}
/** Internal owned target traversal shared by chapter initialization and authorized disputes. */
export async function replayTargetEvidence(ctx:RequestContext,owner:string,seasonId:string,targets:string[],compact=false){
 if(!await indexPage(ctx,owner,seasonId))return {status:'Provisional',stage:'Indexing',indexReady:false};
 targets=[...new Set(targets.map(t=>t.toLowerCase()))];
 if(targets.length>128)throw new HttpError(413,'Choose at most 128 target projections.');
 const ids=targets.map(t=>`${ownerKey(owner,seasonId)}:${t}`);
 const dirty=await ctx.store.getMany<Dirty>('pbe-evidence-dirty',ids,ctx.orgId);
 const next=dirty.find(r=>r.value.completedGeneration!==r.value.generation);
 if(!next){
  const proofs=compact?(await ctx.env.DB.prepare("SELECT revision,json_object('id',id,'retention',json_object('ruleVersion',json_extract(data,'$.retention.ruleVersion'))) AS data FROM Records WHERE kind='pbe-target-review' AND org_id=? AND id IN (SELECT value FROM json_each(?))").bind(ctx.orgId,JSON.stringify(ids)).all<{revision:number;data:string}>()).results.map(r=>({revision:r.revision,value:JSON.parse(r.data) as ReviewProjection})):await ctx.store.getMany<ReviewProjection>('pbe-target-review',ids,ctx.orgId);
  const missing=ids.find(id=>proofs.find(p=>p.value.id===id)?.value.retention?.ruleVersion!==RETENTION_RULE_VERSION);
  if(!missing)return {status:'Ready',indexReady:true,proofs:proofs.map(p=>({revision:p.revision,...p.value}))};
  const absent=ids.filter(id=>!proofs.some(p=>p.value.id===id));
  if(absent.length){
   const empty=await ctx.env.DB.prepare("SELECT value AS id FROM json_each(?) candidate WHERE NOT EXISTS(SELECT 1 FROM Records r INDEXED BY Records_training_scope WHERE r.org_id=? AND r.season_id=? AND r.owner_id=? AND r.kind='pbe-evidence-ref' AND r.id>candidate.value||':' AND r.id<candidate.value||';')").bind(JSON.stringify(absent),ctx.orgId,seasonId,owner).all<{id:string}>();
   const values:ReviewProjection[]=[];for(const row of empty.results){const value={...initialProjection(row.id,targets[ids.indexOf(row.id)]),provisional:false};if(new TextEncoder().encode(JSON.stringify([...values,value])).byteLength>64000)break;values.push(value);}
   if(values.length){const insert=ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) SELECT 'pbe-target-review',json_extract(value,'$.id'),?,?,?,value,1 FROM json_each(?) WHERE true ON CONFLICT(kind,id,org_id) DO UPDATE SET data='invalid-json'").bind(ctx.orgId,seasonId,owner,JSON.stringify(values));await atomic(ctx,'pbe-evidence.untouched',[insert]);return {status:'Provisional',stage:'Replaying',indexReady:true};}
  }
  const target=targets[ids.indexOf(missing)],old=dirty.find(d=>d.value.id===missing)??null,projection=compact?await ctx.store.get<ReviewProjection>('pbe-target-review',missing,ctx.orgId):proofs.find(p=>p.value.id===missing)??null,w:PbeWriteBatch={statements:[],guards:[]};
  const value={id:missing,targetId:target,generation:(old?.value.generation??0)+1,completedGeneration:old?.value.completedGeneration??0};
  write(ctx,w,'pbe-evidence-dirty',missing,value,old,owner,seasonId);
  if(projection)write(ctx,w,'pbe-target-review',missing,{...projection.value,provisional:true},projection,owner,seasonId);
  await atomic(ctx,'pbe-evidence.initialize',w.statements,w.guards);
  return {status:'Provisional',stage:'Replaying',indexReady:true};
 }
 const id=next.value.id,oldJob=await ctx.store.get<ReplayJob>('pbe-evidence-replay',id,ctx.orgId),job=oldJob?.value.generation===next.value.generation&&oldJob.value.projection.retention?.ruleVersion===RETENTION_RULE_VERSION?oldJob.value:{id,generation:next.value.generation,after:id+':',projection:initialProjection(id,next.value.targetId),pendingCount:0};
 const sequenceId=ownerKey(owner,seasonId),sequence=await ctx.store.get('pbe-recall-sequence',sequenceId,ctx.orgId);
 const refs=await ctx.env.DB.prepare("SELECT data FROM Records INDEXED BY Records_training_scope WHERE org_id=? AND season_id=? AND owner_id=? AND kind='pbe-evidence-ref' AND id>? AND id<? ORDER BY id LIMIT 33").bind(ctx.orgId,seasonId,owner,job.after,id+';').all<{data:string}>();
 const priorProjection=await ctx.store.get<ReviewProjection>('pbe-target-review',id,ctx.orgId);
 if(!refs.results.length&&job.projection.acceptedSequence===0&&(priorProjection?.value.acceptedSequence??0)>0){
  const index=await ctx.store.require<EvidenceIndex>('pbe-evidence-index',sequenceId,ctx.orgId);
  await atomic(ctx,'pbe-evidence.reindex',[ctx.store.update('pbe-evidence-index',sequenceId,ctx.orgId,{id:sequenceId,ready:false,after:'',coveredLegacyEvents:0},index.revision)],[{kind:'pbe-evidence-index',id:sequenceId,revision:index.revision}]);
  return {status:'Provisional',stage:'Indexing',indexReady:false};
 }
 const page=refs.results.slice(0,32).map(r=>JSON.parse(r.data) as EvidenceRef);
 const normalized=await normalizedEvidencePage(ctx,owner,seasonId,page);
 for(const item of normalized){const {ref,schedulerEvidence:e,retentionProof}=item;
  if(!retentionProof.final)job.pendingCount++;
  job.projection.retention=advanceRetention(job.projection.retention??initialRetentionState(),retentionProof);
  if(item.dataGap)job.projection.retention.dataGap=true;
  job.projection.review=advanceReview(job.projection.review,e);job.projection.acceptedSequence=ref.acceptedSequence;job.projection.lastAnsweredQuestionId=e.questionId;job.projection.lastAnsweredQuestionKind=ref.questionKind;job.projection.failedSequence=e.recall&&e.earnedPoints<e.availablePoints?ref.acceptedSequence:job.projection.review.unresolved?job.projection.failedSequence:null;job.after=ref.id;
 }
 const complete=refs.results.length<=32,w:PbeWriteBatch={statements:[],guards:[{kind:'pbe-evidence-dirty',id,revision:next.revision},...(sequence?[{kind:'pbe-recall-sequence',id:sequenceId,revision:sequence.revision}]:[])]};
 write(ctx,w,'pbe-evidence-replay',id,job,oldJob,owner,seasonId);
 if(complete){const prior=await ctx.store.get<ReviewProjection>('pbe-target-review',id,ctx.orgId);write(ctx,w,'pbe-target-review',id,{...job.projection,provisional:job.pendingCount>0,pendingCount:job.pendingCount,evidenceGeneration:job.generation},prior,owner,seasonId);w.statements.push(ctx.store.update('pbe-evidence-dirty',id,ctx.orgId,{...next.value,completedGeneration:job.generation},next.revision));}
 await atomic(ctx,'pbe-evidence.replay',w.statements,w.guards);return {status:'Provisional',stage:'Replaying',indexReady:true,targetId:next.value.targetId,processed:page.length,targetComplete:complete};
}
export async function replayDisputeEvidence(ctx:RequestContext,d:PbeDispute){
 if(d.activity!=='Solo')return {status:'Ready',indexReady:true,proofs:[]};
 const result=await replayTargetEvidence(ctx,d.participantIds[0],d.seasonId,d.question.parts.map(p=>p.targetId));
 if(result.status==='Ready'){
  const correction=await ctx.store.get<PbeDispute>('pbe-dispute-correction',d.id,ctx.orgId);
  if(correction){const ids=[...new Set(d.question.parts.map(p=>targetKey(d,p.targetId)))],dirty=await ctx.store.getMany<Dirty>('pbe-evidence-dirty',ids,ctx.orgId);
   await atomic(ctx,'pbe-evidence.correction-complete',[deletion(ctx,'pbe-dispute-correction',d.id)],[{kind:'pbe-dispute-correction',id:d.id,revision:correction.revision},...dirty.map(row=>({kind:'pbe-evidence-dirty',id:row.value.id,revision:row.revision}))]);
  }
 }
 return {...result,revision:d.revision};
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

/** Compact SQL extracts legacy frozen card identity without hydrating saved sessions. */
export async function normalizedEvidencePage(ctx:RequestContext,owner:string,seasonId:string,refs:EvidenceRef[]){
 if(refs.length>32)throw new HttpError(413,'Evidence page is too large.');
 const sequenceId=ownerKey(owner,seasonId),reviews=await ctx.env.DB.prepare(`SELECT json_extract(input.value,'$.attemptRecordId') AS attemptId,json_extract(input.value,'$.targetId') AS targetId,json_extract(r.data,'$.questionId') AS questionId,json_extract(r.data,'$.status') AS status,json_extract(r.data,'$.pointsByTarget.'||json_extract(input.value,'$.targetId')) AS earnedPoints
 FROM json_each(?) input JOIN Records r ON r.kind='pbe-attempt-review' AND r.org_id=? AND r.id=?||':'||json_extract(input.value,'$.attemptRecordId')`).bind(JSON.stringify(refs.map(r=>({attemptRecordId:r.attemptRecordId,targetId:r.evidence.targetId}))),ctx.orgId,sequenceId).all<{attemptId:string;targetId:string;questionId:string;status:string;earnedPoints:number|null}>(),byAttempt=new Map(reviews.results.map(r=>[`${r.attemptId}:${r.targetId}`,r]));
 const legacy=refs.filter(r=>r.questionVersion===undefined||r.responseLockedAtMs===undefined);
 const metadata=legacy.length?await ctx.env.DB.prepare(`SELECT json_extract(input.value,'$.attemptRecordId') AS id,
 json_extract(a.data,'$.atMs') AS acceptedAtMs,coalesce(json_extract(a.data,'$.responseLockedAtMs'),json_extract(a.data,'$.atMs')) AS lockedAtMs,
 (SELECT json_extract(card.value,'$.question.version') FROM json_each(s.data,'$.cards') card WHERE json_extract(card.value,'$.id')=json_extract(a.data,'$.cardId') AND json_extract(card.value,'$.question.id')=json_extract(input.value,'$.questionId') LIMIT 1) AS questionVersion
 FROM json_each(?) input LEFT JOIN Records a ON a.org_id=? AND a.season_id=? AND a.owner_id=? AND a.kind='pbe-attempt' AND a.id=json_extract(input.value,'$.attemptRecordId')
 LEFT JOIN Records s ON s.org_id=a.org_id AND s.season_id=a.season_id AND s.owner_id=a.owner_id AND s.kind='pbe-session' AND s.id=json_extract(a.data,'$.sessionId')`).bind(JSON.stringify(legacy.map(r=>({attemptRecordId:r.attemptRecordId,questionId:r.evidence.questionId}))),ctx.orgId,seasonId,owner).all<{id:string;acceptedAtMs:number|null;lockedAtMs:number|null;questionVersion:number|null}>():{results:[]};
 const byId=new Map(metadata.results.map(r=>[r.id,r]));
 return refs.map(ref=>{const original=ref.evidence,grade=byAttempt.get(`${original.attemptId}:${original.targetId}`),saved=byId.get(ref.attemptRecordId);
  if(grade&&grade.questionId!==original.questionId)throw new HttpError(409,'Saved evidence membership changed.');
  const final=grade?.status!=='Pending',earnedPoints=grade?.status==='Resolved'?grade.earnedPoints??original.earnedPoints:original.earnedPoints;
  const questionVersion=ref.questionVersion??saved?.questionVersion,atMs=ref.responseLockedAtMs??saved?.lockedAtMs;
  const dataGap=!Number.isSafeInteger(questionVersion)||!questionVersion||questionVersion<1||questionVersion>2147483647||!Number.isSafeInteger(atMs)||atMs===null||atMs===undefined||atMs<0||!!saved&&saved.acceptedAtMs!==original.atMs;
  const retentionProof:TargetProof={targetId:original.targetId,questionId:original.questionId,questionVersion:questionVersion??0,attemptId:original.attemptId,atMs:atMs??original.atMs,acceptedSequence:ref.acceptedSequence,fullCredit:earnedPoints===original.availablePoints,unaided:original.unaided,final,recall:original.recall,activity:'Solo'};
  return {ref,schedulerEvidence:{...original,earnedPoints:final?earnedPoints:0},retentionProof,dataGap};
 });
}
