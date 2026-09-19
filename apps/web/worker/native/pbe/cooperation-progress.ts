import type {RequestContext} from '../types';
import {HttpError} from '../types';
import {atomic} from '../application/model';
import type {Stored} from '../store';
import {trainingNow} from '../training/clock';
import {guid} from './bank';
import {chapterHash,utf8Bytes} from './chapter-manifest';
import {VerifiedCooperationScope,cooperationRoster,type CooperationOperation} from './cooperation-capability';
import {cooperationCaps,captureSubjectSources,captureSubjectAssignments,captureSubjectGeneration,captureSubjectCurrentGuards,captureSubjectD1Guards} from './cooperation-inputs';
import {readSubjectSourceFacts} from './cooperation-facts';
import {cooperationInputGuard,type CooperationGuardInputs} from './cooperation-guard';
import {COOPERATION_RULE,COOPERATION_STEP_ROWS,prepareCooperationPage,cooperationStale,cooperationPage,type CooperationWork,type SavedCooperationSnapshot} from './cooperation-storage';
import type {CooperationSnapshot,CooperationStudentSummary,CooperationStudentPage,ContinueCooperationRequest,MaterialSummary,OwnMaterialSummary} from '../../../src/api/pbeTypes';
type Snapshot=SavedCooperationSnapshot&{inputs:CooperationGuardInputs};
const key=(r:{sourceKind:string;contentPackId:string;sourceUnitId:string})=>JSON.stringify([r.sourceKind,r.contentPackId,r.sourceUnitId]);
const authGuard=(scope:VerifiedCooperationScope)=>({kind:scope.operation.startsWith('Coach')?'@active-admin':'@active-learner',id:scope.ctx.actor.userId,revision:0});
async function save(scope:VerifiedCooperationScope,w:CooperationWork,old:Stored<CooperationWork>|null,statements:import('@cloudflare/workers-types').D1PreparedStatement[]=[]){
 const {ctx}=scope;
 if(utf8Bytes(w)>65536)throw new HttpError(413,'PBE_COOPERATION_INPUT_TOO_LARGE');
 await atomic(ctx,'pbe.cooperation.step',[...statements,old?ctx.store.update('pbe-cooperation-work',w.seasonId,ctx.orgId,w,old.revision):ctx.store.insertion('pbe-cooperation-work',w.seasonId,ctx.orgId,w,{seasonId:w.seasonId})],[authGuard(scope),...(old?[{kind:'pbe-cooperation-work',id:w.seasonId,revision:old.revision}]:[])]);
}
function empty(scope:VerifiedCooperationScope,w:CooperationWork|null,state:CooperationSnapshot['state'],reason:CooperationSnapshot['reason']=null):CooperationSnapshot{return {seasonId:scope.seasonId,ruleVersion:COOPERATION_RULE,scopeVersion:null,snapshotId:null,state,reason,checkedAtUtc:null,dueRefreshAtUtc:null,rosterStudents:0,unknownStudents:0,scripture:null,introduction:null,own:null,work:{id:w?.workId??null,next:state==='Blocked'?'None':state==='NotStarted'?'Continue':w?.stage==='Complete'?'Reload':'Continue'}};}
async function load(scope:VerifiedCooperationScope){return scope.ctx.store.get<CooperationWork>('pbe-cooperation-work',scope.seasonId,scope.ctx.orgId);}
async function snapshot(scope:VerifiedCooperationScope,w:CooperationWork|null){return w?.publishedId?(await scope.ctx.store.get<Snapshot>('pbe-cooperation-snapshot',w.publishedId,scope.ctx.orgId))?.value??null:null;}
async function current(scope:VerifiedCooperationScope,s:Snapshot){return !!(await cooperationInputGuard(scope,s.inputs,true).first<{valid:number}>())?.valid;}
async function own(scope:VerifiedCooperationScope,s:Snapshot){
 if(scope.operation.startsWith('Coach'))return null;
 const row=await scope.ctx.env.DB.prepare("SELECT e.value FROM Records m INDEXED BY Records_training_scope JOIN json_each(m.data,'$.entries') e WHERE m.kind='pbe-cooperation-manifest' AND m.org_id=? AND m.season_id=? AND m.owner_id IS NULL AND json_extract(m.data,'$.generationId')=? AND json_extract(m.data,'$.family')='subjects' AND json_extract(e.value,'$.studentId')=? LIMIT 1").bind(scope.ctx.orgId,scope.seasonId,s.generationId,scope.ctx.actor.userId).first<{value:string}>();
 // Adult learners aren't on the student roster: show the team summary without a personal entry.
 if(!row&&scope.ctx.actor.kind!=='Student')return null;
 if(!row)throw cooperationStale();const item=JSON.parse(row.value) as CooperationStudentSummary;return {state:item.state,scripture:item.scripture,introduction:item.introduction};
}
async function view(scope:VerifiedCooperationScope,w:CooperationWork|null,validate=true):Promise<CooperationSnapshot>{
 if(scope.reason)return empty(scope,w,'Blocked',scope.reason);
 const published=await snapshot(scope,w);
 if(published&&(!validate||await current(scope,published)))return {seasonId:scope.seasonId,ruleVersion:COOPERATION_RULE,scopeVersion:published.scopeVersion,snapshotId:published.id,state:published.unknownStudents?'Provisional':'Snapshot',reason:null,checkedAtUtc:published.checkedAtUtc,dueRefreshAtUtc:published.dueRefreshAtUtc,rosterStudents:published.rosterStudents,unknownStudents:published.unknownStudents,scripture:published.scripture,introduction:published.introduction,own:await own(scope,published),work:{id:w!.workId,next:w!.stage==='Complete'?'Reload':'Continue'}};
 if(w?.stage==='Blocked')return w.reason?empty(scope,w,'Blocked',w.reason):{...empty(scope,w,'Updating'),work:{id:null,next:'Continue'}};
 return empty(scope,w,w?'Updating':'NotStarted');
}
export async function cooperation(ctx:RequestContext,seasonId:string,operation:CooperationOperation='StudentSummary'){const scope=await VerifiedCooperationScope.create(ctx,seasonId,operation);return view(scope,(await load(scope))?.value??null);}
async function cleanup(scope:VerifiedCooperationScope,w:CooperationWork,old:Stored<CooperationWork>){
 if(!w.abandonedId)return false;
 const rows=await scope.ctx.env.DB.prepare("SELECT kind,id FROM Records WHERE org_id=? AND season_id=? AND owner_id IS NULL AND kind IN ('pbe-cooperation-manifest','pbe-cooperation-snapshot') AND json_extract(data,'$.generationId')=? ORDER BY kind,id LIMIT ?").bind(scope.ctx.orgId,w.seasonId,w.abandonedId,COOPERATION_STEP_ROWS).all<{kind:string;id:string}>();
 if(!rows.results.length)w.abandonedId=null;
 await save(scope,w,old,rows.results.length?[scope.ctx.env.DB.prepare("DELETE FROM Records WHERE org_id=? AND season_id=? AND owner_id IS NULL AND (kind,id) IN (SELECT json_extract(value,'$.kind'),json_extract(value,'$.id') FROM json_each(?))").bind(scope.ctx.orgId,w.seasonId,JSON.stringify(rows.results))]:[]);return true;
}
function nextSubject(w:CooperationWork){w.subjectIndex++;w.after='';w.stage=w.subjectIndex<w.roster.length?'Sources':'Publishing';}
async function advance(scope:VerifiedCooperationScope,w:CooperationWork,old:Stored<CooperationWork>){
 if(await cleanup(scope,w,old))return;
 let rows:unknown[]=[],family='',guards=true;
 if(w.stage==='Sources'){
  const captured=await captureSubjectSources(scope,w);rows=captured;family='sources';w.after=captured.length?key(captured.at(-1)!):'';if(!captured.length)w.stage='Assignments';
 }else if(w.stage==='Assignments'){
  const captured=await captureSubjectAssignments(scope,w);rows=captured;family='assignments';w.after=captured.length?`${captured.at(-1)!.kind}:${captured.at(-1)!.id}`:'';if(!captured.length)w.stage='Generation';
 }else if(w.stage==='Generation'){
  w.descriptors.push(await captureSubjectGeneration(scope,w));w.stage='CurrentGuards';w.after='';
 }else if(w.stage==='CurrentGuards'){
  const captured=await captureSubjectCurrentGuards(scope,w);rows=captured;family='guards';w.after=captured.length?`${captured.at(-1)!.kind}:${captured.at(-1)!.id}`:'';if(!captured.length)w.stage='D1Guards';
 }else if(w.stage==='D1Guards'){
  const captured=await captureSubjectD1Guards(scope,w);rows=captured;family='d1guards';w.after=captured.at(-1)?.key??'';if(!captured.length)w.stage='Facts';
 }else if(w.stage==='Facts'){
  const captured=await readSubjectSourceFacts(scope,w);rows=captured;family='facts';guards=false;w.after=captured.length?key(captured.at(-1)!):'';if(!captured.length)nextSubject(w);
 }else if(w.stage==='Publishing'){await publish(scope,w,old);return;}
 await save(scope,w,old,rows.length?[await prepareCooperationPage(scope.ctx,w,family,rows,guards)]:[]);
}
const zero=():OwnMaterialSummary=>({assigned:0,practiced:{known:0,possible:0},retained:{known:0,possible:0},due:{known:0,possible:0}});
type Reduced={studentId?:string;sourceKind:string;assigned:number;questionKnown:number;questionPossible:number;practiceKnown:number;practicePossible:number;retainedKnown:number;retainedPossible:number;dueKnown:number;duePossible:number;unknown:number};
const counters=`count(*) AS assigned,coalesce(sum(questionCovered=1),0) AS questionKnown,sum(questionCovered IS NULL OR questionCovered=1) AS questionPossible,coalesce(sum(practiced=1),0) AS practiceKnown,sum(practiced IS NULL OR practiced=1) AS practicePossible,coalesce(sum(retained=1),0) AS retainedKnown,sum(retained IS NULL OR retained=1) AS retainedPossible,coalesce(sum(due=1),0) AS dueKnown,sum(due IS NULL OR due=1) AS duePossible,sum(questionCovered IS NULL OR practiced IS NULL OR retained IS NULL OR due IS NULL) AS unknown`;
function factsSql(){return `WITH raw AS (SELECT e.value FROM Records m INDEXED BY Records_training_scope JOIN json_each(m.data,'$.entries') e WHERE m.kind='pbe-cooperation-manifest' AND m.org_id=? AND m.season_id=? AND m.owner_id IS NULL AND json_extract(m.data,'$.generationId')=? AND json_extract(m.data,'$.family')='facts'),facts AS (SELECT json_extract(value,'$.studentId') AS studentId,json_extract(value,'$.sourceKind') AS sourceKind,json_extract(value,'$.contentPackId') AS packId,json_extract(value,'$.sourceUnitId') AS sourceId,json_extract(value,'$.questionCovered') AS questionCovered,json_extract(value,'$.practiced') AS practiced,json_extract(value,'$.retained') AS retained,CASE WHEN json_extract(value,'$.unresolved')=1 OR json_extract(value,'$.scheduledAtMs')<=? THEN 1 WHEN json_extract(value,'$.dueKnown')=0 OR json_type(value,'$.unresolved')='null' THEN NULL ELSE 0 END AS due FROM raw)`;}
function ownMaterial(r:Reduced|undefined):OwnMaterialSummary{return r?{assigned:r.assigned,practiced:{known:r.practiceKnown,possible:r.practicePossible},retained:{known:r.retainedKnown,possible:r.retainedPossible},due:{known:r.dueKnown,possible:r.duePossible}}:zero();}
async function publish(scope:VerifiedCooperationScope,w:CooperationWork,old:Stored<CooperationWork>){
 await cooperationCaps(scope,w.roster);
 const {ctx}=scope,now=trainingNow(),atMs=Date.parse(now),bound=[ctx.orgId,w.seasonId,w.workId,atMs];
 const individual=(await ctx.env.DB.prepare(`${factsSql()} SELECT studentId,sourceKind,${counters} FROM facts GROUP BY studentId,sourceKind ORDER BY studentId,sourceKind`).bind(...bound).all<Reduced>()).results;
 const union=(await ctx.env.DB.prepare(`${factsSql()},unions AS(SELECT sourceKind,packId,sourceId,CASE WHEN max(questionCovered)=1 THEN 1 WHEN sum(questionCovered IS NULL)>0 THEN NULL ELSE 0 END AS questionCovered,CASE WHEN max(practiced)=1 THEN 1 WHEN sum(practiced IS NULL)>0 THEN NULL ELSE 0 END AS practiced,CASE WHEN max(retained)=1 THEN 1 WHEN sum(retained IS NULL)>0 THEN NULL ELSE 0 END AS retained,CASE WHEN max(due)=1 THEN 1 WHEN sum(due IS NULL)>0 THEN NULL ELSE 0 END AS due FROM facts GROUP BY sourceKind,packId,sourceId) SELECT sourceKind,${counters} FROM unions GROUP BY sourceKind`).bind(...bound).all<Reduced>()).results;
 const material=(kind:string):MaterialSummary=>{const r=union.find(r=>r.sourceKind===kind),personal=individual.filter(r=>r.sourceKind===kind&&r.assigned>0),base=ownMaterial(r);return {...base,questionCovered:{known:r?.questionKnown??0,possible:r?.questionPossible??0},equalRetained:personal.length?{lower:personal.reduce((n,r)=>n+r.retainedKnown/r.assigned,0)/personal.length,upper:personal.reduce((n,r)=>n+r.retainedPossible/r.assigned,0)/personal.length,students:personal.length,unknownStudents:personal.filter(r=>r.retainedKnown!==r.retainedPossible).length,unassignedStudents:w.roster.length-personal.length}:null};};
 const subjects:CooperationStudentSummary[]=w.roster.map(member=>{const rows=individual.filter(r=>r.studentId===member.studentId),assigned=rows.reduce((n,r)=>n+r.assigned,0),unknown=rows.some(r=>r.unknown>0),descriptor=w.descriptors.find(d=>d.studentId===member.studentId)!;return {studentId:member.studentId,displayName:member.displayName,state:!assigned?'Unassigned':unknown?'Unknown':'Known',reason:unknown?descriptor.reason:null,scripture:ownMaterial(rows.find(r=>r.sourceKind==='Scripture')),introduction:ownMaterial(rows.find(r=>r.sourceKind==='Commentary'))};});
 const tuples=(await ctx.env.DB.prepare("SELECT json_extract(e.value,'$.studentId') AS studentId,json_extract(e.value,'$.sourceKind') AS kind,json_extract(e.value,'$.contentPackId') AS packId,json_extract(e.value,'$.sourceUnitId') AS sourceId FROM Records m INDEXED BY Records_training_scope JOIN json_each(m.data,'$.entries') e WHERE m.kind='pbe-cooperation-manifest' AND m.org_id=? AND m.season_id=? AND m.owner_id IS NULL AND json_extract(m.data,'$.generationId')=? AND json_extract(m.data,'$.family')='sources' ORDER BY studentId,kind,packId,sourceId").bind(ctx.orgId,w.seasonId,w.workId).all<{studentId:string;kind:string;packId:string;sourceId:string}>()).results.map(r=>[r.studentId,r.kind,r.packId,r.sourceId]);
 const scopeVersion=await chapterHash([COOPERATION_RULE,w.seasonId,w.roster.map(r=>r.studentId),tuples,w.descriptors.map(d=>[d.studentId,d.generationId,d.scopeVersion,d.availability,d.reason])]);
 const nextDue=await ctx.env.DB.prepare("SELECT min(json_extract(e.value,'$.scheduledAtMs')) AS atMs FROM Records m INDEXED BY Records_training_scope JOIN json_each(m.data,'$.entries') e WHERE m.kind='pbe-cooperation-manifest' AND m.org_id=? AND m.season_id=? AND m.owner_id IS NULL AND json_extract(m.data,'$.generationId')=? AND json_extract(m.data,'$.family')='facts' AND json_extract(e.value,'$.scheduledAtMs')>?").bind(ctx.orgId,w.seasonId,w.workId,atMs).first<{atMs:number|null}>();
 const guard=cooperationInputGuard(scope,w),subjectPage=await prepareCooperationPage(ctx,w,'subjects',subjects);
 const inputs:CooperationGuardInputs={workId:w.workId,seasonId:w.seasonId,pageCount:w.pageCount,roster:w.roster,descriptors:w.descriptors,baseGuards:w.baseGuards};
 const saved:Snapshot={id:w.workId,generationId:w.workId,pageCount:w.pageCount,scopeVersion,checkedAtUtc:now,dueRefreshAtUtc:new Date(Math.min(atMs+300000,nextDue?.atMs??Infinity)).toISOString(),rosterStudents:w.roster.length,unknownStudents:subjects.filter(s=>s.state==='Unknown').length,scripture:material('Scripture'),introduction:material('Commentary'),inputs};
 const snapshotBytes=utf8Bytes(saved);if(snapshotBytes>65536||w.bytes+snapshotBytes>32*1024*1024)throw new HttpError(413,'PBE_COOPERATION_INPUT_TOO_LARGE');w.bytes+=snapshotBytes;
 w.abandonedId=w.publishedId;w.publishedId=w.workId;w.stage='Complete';
 await save(scope,w,old,[guard,subjectPage,ctx.store.insertion('pbe-cooperation-snapshot',saved.id,ctx.orgId,saved,{seasonId:w.seasonId})]);
}
export async function continueCooperation(ctx:RequestContext,input:ContinueCooperationRequest,operation:CooperationOperation='StudentContinue'):Promise<CooperationSnapshot>{
 const scope=await VerifiedCooperationScope.create(ctx,input?.seasonId,operation);if(input.workId!==undefined)guid(input.workId);
 if(scope.reason)return empty(scope,null,'Blocked',scope.reason);
 const old=await load(scope);let w=old?structuredClone(old.value):null;
 if(input.workId&&(!w||input.workId!==w.workId||w.stage==='Blocked'))throw cooperationStale();
 try{
  if(!w||w.stage==='Complete'||w.stage==='Blocked'){
   if(w?.stage==='Complete'&&input.workId)return empty(scope,w,'Updating');
   if(w?.abandonedId&&old&&await cleanup(scope,w,old))return {...empty(scope,w,'Updating'),work:{id:null,next:'Continue'}};
   const roster=await cooperationRoster(scope);await cooperationCaps(scope,roster);
   const previous=w;w={schemaVersion:1,ruleVersion:COOPERATION_RULE,workId:crypto.randomUUID(),seasonId:scope.seasonId,stage:roster.length?'Sources':'Publishing',subjectIndex:0,after:'',pageCount:0,bytes:0,guardBytes:0,roster,descriptors:[],baseGuards:scope.guards,publishedId:previous?.publishedId??null,abandonedId:previous&&previous.workId!==previous.publishedId?previous.workId:null,reason:null};
   await save(scope,w,old);return empty(scope,w,'Updating');
  }
  await advance(scope,w,old!);
  return w.publishedId===w.workId?view(scope,w,false):empty(scope,w,'Updating');
 }catch(error){
  if(error instanceof HttpError&&error.status===413){
   if(w&&old){const blocked=structuredClone(old.value);blocked.stage='Blocked';blocked.reason=error.message.includes('INPUT')?'InputTooLarge':'ScopeTooLarge';await save(scope,blocked,old);return empty(scope,blocked,'Blocked',blocked.reason);}
   return empty(scope,null,'Blocked',error.message.includes('INPUT')?'InputTooLarge':'ScopeTooLarge');
  }
  if(error instanceof HttpError&&error.status===409||String(error).includes('UNIQUE constraint failed')){
   if(w&&old){const latest=await load(scope);if(latest?.revision===old.revision){const stale=structuredClone(old.value);stale.stage='Blocked';stale.reason=null;await save(scope,stale,old);}}
   if(!input.workId){const latest=await load(scope);if(latest&&latest.value.stage!=='Blocked')return empty(scope,latest.value,'Updating');}
   throw cooperationStale();
  }
  throw error;
 }
}
export async function cooperationStudents(ctx:RequestContext,seasonId:string,url:URL):Promise<CooperationStudentPage>{
 const scope=await VerifiedCooperationScope.create(ctx,seasonId,'CoachDetail'),w=(await load(scope))?.value??null,s=await snapshot(scope,w),limit=Number(url.searchParams.get('limit')??32),after=url.searchParams.get('after');
 if(!Number.isInteger(limit)||limit<1||limit>32)throw new HttpError(400,'Choose a page size from 1 to 32.');
 if(scope.reason||!s||!await current(scope,s))throw new HttpError(409,'PBE_COOPERATION_CURSOR_STALE');
 let last='';if(after){try{if(after.length>4000)throw new Error();const c=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(after),c=>c.charCodeAt(0))));if(c.v!==1||c.organizationId!==ctx.orgId||c.seasonId!==seasonId||c.snapshotId!==s.id||c.operation!=='CoachDetail'||typeof c.after!=='string')throw new Error();last=c.after;}catch{throw new HttpError(409,'PBE_COOPERATION_CURSOR_STALE');}}
 const rows=await cooperationPage<CooperationStudentSummary>(ctx,"SELECT json_extract(e.value,'$.studentId') AS key,e.value AS payload FROM Records m INDEXED BY Records_training_scope JOIN json_each(m.data,'$.entries') e WHERE m.kind='pbe-cooperation-manifest' AND m.org_id=? AND m.season_id=? AND m.owner_id IS NULL AND json_extract(m.data,'$.generationId')=? AND json_extract(m.data,'$.family')='subjects' AND json_extract(e.value,'$.studentId')>? ORDER BY key LIMIT ?",[ctx.orgId,seasonId,s.generationId,last,limit+1]);
 const items=rows.slice(0,limit),hasMore=items.length?await ctx.env.DB.prepare("SELECT EXISTS(SELECT 1 FROM Records m INDEXED BY Records_training_scope JOIN json_each(m.data,'$.entries') e WHERE m.kind='pbe-cooperation-manifest' AND m.org_id=? AND m.season_id=? AND m.owner_id IS NULL AND json_extract(m.data,'$.generationId')=? AND json_extract(m.data,'$.family')='subjects' AND json_extract(e.value,'$.studentId')>?) AS more").bind(ctx.orgId,seasonId,s.generationId,items.at(-1)!.studentId).first<{more:number}>():null,nextCursor=hasMore?.more?btoa(JSON.stringify({v:1,organizationId:ctx.orgId,seasonId,snapshotId:s.id,operation:'CoachDetail',after:items.at(-1)!.studentId})):null;return {seasonId,snapshotId:s.id,nextCursor,items};
}
