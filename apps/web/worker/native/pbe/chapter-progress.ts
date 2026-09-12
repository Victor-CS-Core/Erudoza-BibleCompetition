import {chapterBoundedPage} from './chapter-bounded-page';
import type {RequestContext} from '../types';
import {HttpError} from '../types';
import type {Stored} from '../store';
import {atomic} from '../application/model';
import {builtInContentSql} from '../application/library-access';
import type {Season} from '../application/model';
import {trainingNow} from '../training/clock';
import {guid,sourceProof,type PbeQuestionRecord} from './bank';
import {resolvePbeChapterSources,type PbeSourceScope,type PbeSource} from './sources';
import {validatePbeQuestion,validatePbeTarget} from './grading';
import {chapterBase,chapterSourcePage,chapterAssignmentPage,chapterSelectedSources,type ChapterBase} from './chapter-source-pages';
import {chapterGroupPage,savedGroup,groupCoveredPassages,groupTargetPage,targetVariantCounts,savedTargetIds,savedRetentions,chapterGroupCtes,type GroupMetadata} from './chapter-projection-pages';
import {CHAPTER_RULE_VERSION,RETENTION_RULE_VERSION,chapterTargetCounts,retentionReady,type RetentionState} from './chapters';
import {replayTargetEvidence} from './evidence-replay';
import type {ReviewProjection} from './progress';
import type {PbeTarget,PbeQuestion} from './types';
import {chapterHash,chapterTextHash,manifestPage,chapterInputGuard,chapterWitnessGuard,CHAPTER_STAGE_BYTES,CHAPTER_PAGE_BYTES,utf8Bytes,type InputGuard,type ManifestPage} from './chapter-manifest';
import type {ChapterPage,ChapterWork,ProgressRow,StampSummary,ContinueChaptersRequest,ContinueChaptersResponse} from '../../../src/api/pbeTypes';
const GROUP_RULE='pbe-passage-groups-v1';
type Stage='Sources'|'Guards'|'Targets'|'Heads'|'Groups'|'Replaying'|'Retentions'|'Projecting'|'Proofs'|'Complete'|'Cleanup';
interface Aggregate {group:GroupMetadata;targetAfter:string;counts:ProgressRow['counts'];updating:boolean;repair:boolean}
interface Work {baseGuards:InputGuard[];groupAfter:string;aggregate:Aggregate|null;id:string;workId:string;schemaVersion:1;seasonId:string;sourceHash:string;stage:Stage;offset:number;after:string;pageCount:number;bytes:number;proofBytes?:number;scopeVersion:string|null;asOfUtc:string;dueRefreshAtUtc:string;reason:ChapterWork['reason'];snapshotId:string|null;abandoned:string|null;rowIndex:number;proofOffset:number}
interface SourceInput extends Omit<PbeSource,'canonicalText'> {textHash:string;parentKey:string;groupKey:string|null;guards:InputGuard[]}
interface TargetInput {guard:InputGuard;target:Pick<PbeTarget,'id'|'skill'|'sourceUnitIds'>|null}
interface HeadInput {guard:InputGuard;question:(Pick<PbeQuestion,'id'|'version'|'sourceUnitIds'|'kind'|'ordered'>&{parts:{targetId:string;points:number}[]})|null}
interface RetentionInput {targetId:string;projection:ReviewProjection}
interface SavedRow {id:string;generationId:string;row:ProgressRow}
interface Stamp {id:string;summary:StampSummary;proofGenerationId:string;proofFamily:string;targetCount:number;qualifyingAttemptCount:number;proofPageCount:number;proofHash:string}
const ownerId=(ctx:RequestContext,seasonId:string)=>`${ctx.actor.userId.toLowerCase()}:${seasonId}`;
const workDto=(work:Work|null,reason:ChapterWork['reason']=null):ChapterWork=>reason?{id:work?.workId??null,state:'Blocked',stage:null,reason}:!work?{id:null,state:'NotStarted',stage:null,reason:null}:{id:work.workId,state:work.reason?'Blocked':work.stage==='Complete'?'Complete':'Working',stage:work.reason||work.stage==='Complete'?null:work.stage==='Cleanup'?'Cleanup':work.stage==='Replaying'?'Replaying':['Retentions','Projecting','Proofs'].includes(work.stage)?'Projecting':'Indexing',reason:work.reason};
const staleWork=()=>new HttpError(409,'PBE_CHAPTER_WORK_STALE');
const staleCursor=()=>new HttpError(409,'PBE_CHAPTER_CURSOR_STALE');
async function admission(ctx:RequestContext,seasonId:string){
 const season=await ctx.store.require<Season>('season',seasonId,ctx.orgId);
 if(season.value.organizationId!==ctx.orgId)throw new HttpError(403,'Organization access denied.');
 if(season.value.status!=='Active')return {reason:'SeasonClosed' as const,scope:null};
 if(!season.value.pbeEnabled)return {reason:'PbeDisabled' as const,scope:null};
 try{const scope=await resolvePbeChapterSources(ctx,seasonId);return {reason:scope.sources.length&&scope.guards.some(g=>g.kind==='membership')?null:'NoAssignment' as const,scope};}
 catch(error){if(error instanceof HttpError&&error.status===413)return {reason:'ScopeTooLarge' as const,scope:null};throw error;}
}
async function entries<T>(ctx:RequestContext,work:Work,family:string):Promise<T[]>{
 const result=await ctx.env.DB.prepare("SELECT data FROM Records INDEXED BY Records_training_scope WHERE org_id=? AND season_id=? AND owner_id=? AND kind='pbe-chapter-manifest' AND json_extract(data,'$.generationId')=? AND json_extract(data,'$.family')=? ORDER BY id").bind(ctx.orgId,work.seasonId,ctx.actor.userId,work.workId,family).all<{data:string}>();
 return result.results.flatMap(r=>(JSON.parse(r.data) as ManifestPage).entries as T[]);
}
function workWrite(ctx:RequestContext,work:Work,prior:Stored<Work>|null){return prior?ctx.store.update('pbe-chapter-work',work.id,ctx.orgId,work,prior.revision):ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) VALUES('pbe-chapter-work',?,?,?,?,?,1) ON CONFLICT(kind,id,org_id) DO UPDATE SET data='invalid-json'").bind(work.id,ctx.orgId,work.seasonId,ctx.actor.userId,JSON.stringify(work));}
async function save(ctx:RequestContext,work:Work,prior:Stored<Work>|null,statements:import('@cloudflare/workers-types').D1PreparedStatement[]=[],guards:InputGuard[]=[]){
 await atomic(ctx,'pbe.chapter.continue',[...statements,workWrite(ctx,work,prior)],[...(prior?[{kind:'pbe-chapter-work',id:work.id,revision:prior.revision}]:[]),...guards.filter((g):g is InputGuard&{revision:number}=>g.revision!==null)]);
}
async function savePage(ctx:RequestContext,work:Work,family:string,values:unknown[]){
 const chunks:unknown[]=[];for(const value of values){if(chunks.length>=128||utf8Bytes([...chunks,value])+1000>CHAPTER_PAGE_BYTES)break;chunks.push(value);}
 if(values.length&&!chunks.length)throw new HttpError(413,'PBE_CHAPTER_INPUT_TOO_LARGE');
 const prepared=await manifestPage(ctx,work.seasonId,work.workId,family,work.pageCount,chunks);work.pageCount++;work.bytes+=prepared.page.bytes;if(work.bytes>CHAPTER_STAGE_BYTES)throw new HttpError(413,'PBE_CHAPTER_INPUT_TOO_LARGE');return {...prepared,processed:chunks.length};
}
function newWork(ctx:RequestContext,seasonId:string,base:ChapterBase,previous:Work|null):Work{
 const now=trainingNow();return {baseGuards:base.guards,groupAfter:'',aggregate:null,id:ownerId(ctx,seasonId),workId:crypto.randomUUID(),schemaVersion:1,seasonId,sourceHash:base.signature,stage:'Sources',offset:0,after:'',pageCount:0,bytes:0,proofBytes:0,scopeVersion:null,asOfUtc:now,dueRefreshAtUtc:new Date(Date.parse(now)+300000).toISOString(),reason:null,snapshotId:null,abandoned:previous?.workId??null,rowIndex:0,proofOffset:0};
}
async function rawBankPage(ctx:RequestContext,work:Work,kind:string){
 if(work.offset===0){const count=await ctx.env.DB.prepare("SELECT count(*) AS n FROM (SELECT 1 FROM Records r INDEXED BY Records_training_scope WHERE r.org_id=? AND r.season_id=? AND r.kind=? AND r.owner_id IN (SELECT json_extract(e.value,'$.id') FROM Records m INDEXED BY Records_training_scope JOIN json_each(m.data,'$.entries') e WHERE m.org_id=r.org_id AND m.season_id=r.season_id AND m.owner_id=? AND m.kind='pbe-chapter-manifest' AND json_extract(m.data,'$.generationId')=? AND json_extract(m.data,'$.family')='sources') LIMIT 10001)").bind(ctx.orgId,work.seasonId,kind,ctx.actor.userId,work.workId).first<{n:number}>();if((count?.n??0)>10000)throw new HttpError(413,'PBE_CHAPTER_SCOPE_TOO_LARGE');}
 return chapterBoundedPage<{id:string;owner_id:string;revision:number;data:string;eligible:number}>(ctx,`WITH allowed AS (SELECT json_extract(e.value,'$.id') AS id FROM Records m INDEXED BY Records_training_scope JOIN json_each(m.data,'$.entries') e WHERE m.org_id=? AND m.season_id=? AND m.owner_id=? AND m.kind='pbe-chapter-manifest' AND json_extract(m.data,'$.generationId')=? AND json_extract(m.data,'$.family')='sources')
 SELECT r.id AS key,json_object('id',r.id,'owner_id',r.owner_id,'revision',r.revision,'data',r.data,'eligible',NOT EXISTS(SELECT 1 FROM json_each(r.data,'$.sourceUnitIds') unit WHERE unit.value NOT IN (SELECT id FROM allowed))) AS payload
 FROM Records r INDEXED BY Records_training_scope WHERE r.org_id=? AND r.season_id=? AND r.kind=? AND r.id>? AND r.owner_id IN (SELECT id FROM allowed) ORDER BY r.id LIMIT 128`,[ctx.orgId,work.seasonId,ctx.actor.userId,work.workId,ctx.orgId,work.seasonId,kind,work.after]);
}
async function semanticScope(ctx:RequestContext,work:Work,sources:SourceInput[],targets:TargetInput[],heads:HeadInput[]){
 const assignments=(await entries<InputGuard&{assignmentTuple?:(string|number|null)[]}>(ctx,work,'guards')).flatMap(g=>g.assignmentTuple?[g.assignmentTuple]:[]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return chapterHash([CHAPTER_RULE_VERSION,GROUP_RULE,work.seasonId,ctx.actor.userId,sources.slice().sort((a,b)=>a.id.localeCompare(b.id)).map(s=>[s.id,s.contentPackId,s.sourceKind,s.bookKey,s.chapter,s.verse,s.ordinal,s.citation,s.textHash]),targets.flatMap(x=>x.target?[x.target]:[]).sort((a,b)=>a.id.localeCompare(b.id)).map(t=>[t.id,[...t.sourceUnitIds].sort(),t.skill]),heads.flatMap(x=>x.question?[x.question]:[]).sort((a,b)=>a.id.localeCompare(b.id)||a.version-b.version).map(q=>[q.id,q.version,[...q.sourceUnitIds].sort(),q.kind,q.ordered,q.parts.map(p=>[p.targetId,p.points])]),assignments]);
}
async function projectionInputs(ctx:RequestContext,work:Work){
 const sources=await entries<SourceInput>(ctx,work,'sources'),targets=await entries<TargetInput>(ctx,work,'targets'),heads=await entries<HeadInput>(ctx,work,'heads');return {sources,targets,heads};
}
async function current(ctx:RequestContext,work:Work){return (await chapterInputGuard(ctx,work.seasonId,work.workId,work.pageCount,'evidence',true).first<{valid:number}>())?.valid===1;}
async function saveCapturedPages(ctx:RequestContext,work:Work,family:string,values:unknown[]){
 const statements:import('@cloudflare/workers-types').D1PreparedStatement[]=[];let offset=0;
 do {const page=await savePage(ctx,work,family,values.slice(offset));statements.push(page.statement);offset+=page.processed;}while(offset<values.length);
 return statements;
}
async function publishAggregate(ctx:RequestContext,work:Work,prior:Stored<Work>){
 // The only whole-input materialization in continuation occurs at the first actual guarded row/stamp publication.
 if(work.scopeVersion===null){const input=await projectionInputs(ctx,work);work.scopeVersion=await semanticScope(ctx,work,input.sources,input.targets,input.heads);}
 const aggregate=work.aggregate!,{group,counts}=aggregate;
 const qualified=counts.assignedPassages>0&&counts.totalTargets>0&&counts.questionCoveredPassages===counts.assignedPassages&&counts.retainedTargets===counts.totalTargets&&counts.missingVariantTargets===0&&!aggregate.updating;
 const stampId=`${ownerId(ctx,work.seasonId)}:${await chapterHash([group.key,work.scopeVersion,CHAPTER_RULE_VERSION])}`,existing=group.kind==='PassageGroup'?null:await ctx.store.get<Stamp>('pbe-chapter-stamp',stampId,ctx.orgId);
 const stamp:StampSummary|null=existing?{...existing.value.summary,matchesCurrentScope:true}:qualified&&group.kind!=='PassageGroup'?{stampId,chapterKey:group.key,kind:group.kind,label:group.label,scopeLabel:group.scopeLabel,scopeVersion:work.scopeVersion!,ruleVersion:CHAPTER_RULE_VERSION,earnedAtUtc:trainingNow(),matchesCurrentScope:true}:null;
 const history=group.kind==='PassageGroup'?false:!!await ctx.env.DB.prepare("SELECT 1 AS present FROM Records WHERE org_id=? AND season_id=? AND owner_id=? AND kind='pbe-chapter-stamp' AND json_extract(data,'$.summary.chapterKey')=? LIMIT 1").bind(ctx.orgId,work.seasonId,ctx.actor.userId,group.key).first();
 let whole:boolean|null=null;
 if(group.kind==='Chapter'){
  const inventory=await ctx.env.DB.prepare(`SELECT count(*) AS n FROM Records u INDEXED BY Records_owner WHERE u.kind='source' AND u.owner_id=? AND (u.org_id=? OR ${builtInContentSql('u')}) AND json_extract(u.data,'$.bookKey')=? AND json_extract(u.data,'$.chapter')=? AND json_extract(u.data,'$.isActive')=1 AND coalesce(json_extract(u.data,'$.isRetired'),0)=0`).bind(group.contentPackId,ctx.orgId,group.bookKey,group.chapter).first<{n:number}>();whole=!!inventory?.n&&inventory.n===counts.assignedPassages;
 }
 const row:ProgressRow={key:group.key,parentChapterKey:group.parentChapterKey,kind:group.kind,label:group.label,scopeLabel:group.scopeLabel,contentPackId:group.contentPackId,bookKey:group.bookKey,chapter:group.chapter,wholeChapterAssigned:whole,counts,currentReadiness:aggregate.updating?'Updating':qualified?'Retained':'Incomplete',stamp,hasHistoricalStamps:history,actions:[]};
 if(!aggregate.updating&&counts.questionCoveredPassages){row.actions.push({mode:'Practice',label:'Practice',progressScope:{key:group.key,scopeVersion:work.scopeVersion!}});if(counts.dueTargets)row.actions.push({mode:'Review',label:aggregate.repair?'Comeback practice':'Review',progressScope:{key:group.key,scopeVersion:work.scopeVersion!}});}
 const rowId=`${work.workId}:${String(work.rowIndex).padStart(6,'0')}`,family=`proof-${String(work.rowIndex).padStart(6,'0')}`,statements=[chapterInputGuard(ctx,work.seasonId,work.workId,work.pageCount,'evidence')];
 if(stamp&&!existing){
  const proofPages=await ctx.env.DB.prepare("SELECT id,json_extract(data,'$.hash') AS hash FROM Records WHERE org_id=? AND season_id=? AND owner_id=? AND kind='pbe-chapter-stamp-proof' AND json_extract(data,'$.generationId')=? AND json_extract(data,'$.family')=? ORDER BY id").bind(ctx.orgId,work.seasonId,ctx.actor.userId,work.workId,family).all<{id:string;hash:string}>();const proofPageCount=proofPages.results.length,proofHash=await chapterHash(proofPages.results.map(p=>[p.id,p.hash]));
  statements.push(chapterWitnessGuard(ctx,work.seasonId,work.workId,family,group.key,counts.totalTargets,proofPageCount));
  statements.push(ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) VALUES('pbe-chapter-stamp',?,?,?,?,?,1) ON CONFLICT(kind,id,org_id) DO NOTHING").bind(stampId,ctx.orgId,work.seasonId,ctx.actor.userId,JSON.stringify({id:stampId,summary:stamp,proofGenerationId:work.workId,proofFamily:family,targetCount:counts.totalTargets,qualifyingAttemptCount:counts.totalTargets*2,proofPageCount,proofHash} satisfies Stamp)));
 }
 statements.push(ctx.store.insertion('pbe-chapter-projection',rowId,ctx.orgId,{id:rowId,generationId:work.workId,row} satisfies SavedRow,{seasonId:work.seasonId,ownerId:ctx.actor.userId}));
 work.groupAfter=group.sortKey;work.rowIndex++;work.aggregate=null;work.proofOffset=0;await save(ctx,work,prior,statements);
}
async function aggregateStep(ctx:RequestContext,work:Work,prior:Stored<Work>){
 if(!work.aggregate){const group=await savedGroup(ctx,work,work.groupAfter);
  if(!group){work.stage='Complete';work.snapshotId=work.workId;await save(ctx,work,prior,[chapterInputGuard(ctx,work.seasonId,work.workId,work.pageCount,'evidence')]);return;}
  work.aggregate={group,targetAfter:'',counts:{assignedPassages:group.assignedPassages,questionCoveredPassages:await groupCoveredPassages(ctx,work,group.key),totalTargets:0,practicedTargets:0,recalledTargets:0,retainedTargets:0,dueTargets:0,missingVariantTargets:0},updating:false,repair:false};await save(ctx,work,prior);return;
 }
 const aggregate=structuredClone(work.aggregate);let targets=await groupTargetPage(ctx,work,aggregate.group.key,aggregate.targetAfter);
 if(!targets.length){await publishAggregate(ctx,work,prior);return;}
 const retentions=await savedRetentions<RetentionInput>(ctx,work,targets.map(t=>t.id));if(!retentions.length)throw staleWork();targets=targets.slice(0,retentions.length);if(targets.some(t=>!retentions.some(r=>r.targetId===t.id)))throw staleWork();const states=new Map(retentions.map(r=>[r.targetId,r.projection])),variants=await targetVariantCounts(ctx,work,targets);
 const witnesses:{targetId:string;witness:NonNullable<RetentionState['witness']>}[]=[];
 for(const target of targets){const projection=states.get(target.id),state=projection?.retention,variantCount=variants.get(target.id)??0;
  const witness=state&&retentionReady(state)&&variantCount>=2&&aggregate.group.kind!=='PassageGroup'?{targetId:target.id,witness:state.witness!}:null;
  if(witness&&(witnesses.length>=64||utf8Bytes([...witnesses,witness])+1000>CHAPTER_PAGE_BYTES))break;
  const counts=aggregate.counts;counts.totalTargets++;const facts=chapterTargetCounts(state,projection?.review,variantCount,Date.parse(work.asOfUtc));for(const key of Object.keys(facts) as (keyof typeof facts)[])counts[key]+=facts[key];
  aggregate.updating ||= !state||state.dataGap||projection?.provisional===true;aggregate.repair ||= projection?.review.unresolved===true;aggregate.targetAfter=target.id;if(witness)witnesses.push(witness);
 }
 const statements:import('@cloudflare/workers-types').D1PreparedStatement[]=[];
 if(witnesses.length){const family=`proof-${String(work.rowIndex).padStart(6,'0')}`,id=`${work.workId}:${family}:${String(work.proofOffset).padStart(6,'0')}`,value={id,generationId:work.workId,family,entries:witnesses,hash:await chapterHash(witnesses)},pageBytes=utf8Bytes(value);if(pageBytes>CHAPTER_PAGE_BYTES||work.bytes+pageBytes>CHAPTER_STAGE_BYTES)throw new HttpError(413,'PBE_CHAPTER_INPUT_TOO_LARGE');work.bytes+=pageBytes;work.proofBytes=(work.proofBytes??0)+pageBytes;statements.push(ctx.store.insertion('pbe-chapter-stamp-proof',id,ctx.orgId,value,{seasonId:work.seasonId,ownerId:ctx.actor.userId}));work.proofOffset+=witnesses.length;}
 work.aggregate=aggregate;await save(ctx,work,prior,statements);
}
async function step(ctx:RequestContext,work:Work,prior:Stored<Work>){
 if(work.abandoned){
  const rows=await ctx.env.DB.prepare("SELECT kind,id FROM Records WHERE org_id=? AND season_id=? AND owner_id=? AND kind IN ('pbe-chapter-manifest','pbe-chapter-projection','pbe-chapter-stamp-proof') AND coalesce(json_extract(data,'$.generationId'),'')=? AND (kind<>'pbe-chapter-stamp-proof' OR NOT EXISTS(SELECT 1 FROM Records stamp WHERE stamp.kind='pbe-chapter-stamp' AND stamp.org_id=? AND json_extract(stamp.data,'$.proofGenerationId')=? AND json_extract(stamp.data,'$.proofFamily')=json_extract(Records.data,'$.family'))) ORDER BY kind,id LIMIT 128").bind(ctx.orgId,work.seasonId,ctx.actor.userId,work.abandoned,ctx.orgId,work.abandoned).all<{kind:string;id:string}>();
  if(rows.results.length){await save(ctx,work,prior,[ctx.env.DB.prepare("DELETE FROM Records WHERE org_id=? AND (kind,id) IN (SELECT json_extract(value,'$.kind'),json_extract(value,'$.id') FROM json_each(?))").bind(ctx.orgId,JSON.stringify(rows.results))]);return;}
  work.abandoned=null;
 }
 if(work.stage==='Sources'){
  const captured=await chapterSourcePage(ctx,work.seasonId,work.after),sources:SourceInput[]=[];
  for(const {source,guards} of captured.items){const {canonicalText,...rest}=source;sources.push({...rest,textHash:await chapterTextHash(canonicalText),guards,parentKey:source.sourceKind!=='Scripture'||source.chapter===null?`intro:${source.contentPackId}`:`chapter:${source.contentPackId}:${source.bookKey}:${source.chapter}`,groupKey:null});}
  const statements=await saveCapturedPages(ctx,work,'sources',sources);work.offset+=sources.length;work.after=captured.after??'';
  if(captured.after===null){if(!work.offset)work.reason='NoAssignment';work.stage='Guards';work.offset=0;work.after='';}await save(ctx,work,prior,statements);return;
 }
 if(work.stage==='Guards'){
  if(work.offset===0){work.offset=1;await save(ctx,work,prior,await saveCapturedPages(ctx,work,'guards',work.baseGuards));return;}
  const captured=await chapterAssignmentPage(ctx,work.seasonId,work.after),values=captured.items.map(a=>({...a.guard,assignmentTuple:a.tuple,introductionGuard:a.introductionGuard}));const statements=await saveCapturedPages(ctx,work,'guards',values);work.after=captured.after??'';
  if(captured.after===null){work.stage='Targets';work.offset=0;work.after='';}await save(ctx,work,prior,statements);return;
 }
 if(work.stage==='Targets'||work.stage==='Heads'){
  const kind=work.stage==='Targets'?'pbe-target':'pbe-question-head',rows=await rawBankPage(ctx,work,kind);if(work.offset+rows.length>10000)throw new HttpError(413,'PBE_CHAPTER_SCOPE_TOO_LARGE');if(rows.some(r=>r.data===null))throw new HttpError(413,'PBE_CHAPTER_INPUT_TOO_LARGE');
  let chosen=rows.slice(0,128);const values:(TargetInput|HeadInput)[]=[];
  if(work.stage==='Targets'){
   for(const row of chosen){const target=JSON.parse(row.data!) as PbeTarget;try{validatePbeTarget(target);}catch{throw new HttpError(413,'PBE_CHAPTER_INPUT_TOO_LARGE');}values.push({guard:{kind,id:row.id,ownerId:row.owner_id,revision:row.revision},target:row.eligible?{id:target.id,skill:target.skill,sourceUnitIds:target.sourceUnitIds}:null});}
  }else{
   const sourceIds=new Set<string>(),targetIds=new Set<string>();let count=0;
   for(const row of chosen){const q=(JSON.parse(row.data!) as PbeQuestionRecord).question,nextSources=new Set([...sourceIds,...q.sourceUnitIds]),nextTargets=new Set([...targetIds,...q.parts.map(p=>p.targetId)]);if(nextSources.size>128||nextTargets.size>128)break;nextSources.forEach(id=>sourceIds.add(id));nextTargets.forEach(id=>targetIds.add(id));count++;}
   chosen=chosen.slice(0,count);if(rows.length&&!chosen.length)throw new HttpError(413,'PBE_CHAPTER_INPUT_TOO_LARGE');
   const referenced=await chapterBoundedPage<PbeTarget>(ctx,"SELECT id AS key,data AS payload FROM Records WHERE kind='pbe-target' AND org_id=? AND id IN (SELECT value FROM json_each(?)) ORDER BY id LIMIT 128",[ctx.orgId,JSON.stringify([...targetIds])]);if(referenced.length!==targetIds.size)throw new HttpError(413,'PBE_CHAPTER_INPUT_TOO_LARGE');const byId=new Map(referenced.map(r=>[r.id,r]));
   const sourceRows=await chapterSelectedSources(ctx,work.seasonId,[...sourceIds]),sourceMap=new Map(sourceRows.map(s=>[s.id,s]));
   for(const row of chosen){const head=JSON.parse(row.data!) as PbeQuestionRecord,q=head.question;let valid=false;
    if(head.published&&head.seasonId===work.seasonId&&q.sourceUnitIds.every(id=>sourceMap.has(id))){try{validatePbeQuestion(q,[...new Set(q.parts.map(p=>p.targetId))].flatMap(id=>byId.has(id)?[byId.get(id)!]:[]));valid=await sourceProof(q,sourceMap)===head.sourceFingerprint&&q.sourceUnitIds.every(id=>sourceMap.get(id)!.contentPackId===q.contentPackId&&sourceMap.get(id)!.sourceKind===q.sourceKind);}catch{/* Invalid published heads cannot contribute coverage. */}}
    values.push({guard:{kind,id:row.id,ownerId:row.owner_id,revision:row.revision},question:valid?{id:q.id,version:q.version,sourceUnitIds:q.sourceUnitIds,kind:q.kind,ordered:q.ordered,parts:q.parts.map(p=>({targetId:p.targetId,points:p.points}))}:null});
   }
  }
  const page=await savePage(ctx,work,work.stage==='Targets'?'targets':'heads',values);work.after=chosen[page.processed-1]?.id??work.after;work.offset+=page.processed;
  if(rows.length===0){work.stage=work.stage==='Targets'?'Heads':'Groups';work.after='';work.offset=0;}await save(ctx,work,prior,[page.statement]);return;
 }
 if(work.stage==='Groups'){
  const groups=await chapterGroupPage(ctx,work,work.after),page=await savePage(ctx,work,'groups',groups);work.after=groups[page.processed-1]?.sortKey??work.after;if(!groups.length){work.stage='Replaying';work.after='';}await save(ctx,work,prior,[page.statement]);return;
 }
 if(work.stage==='Replaying'){
  const batch=await savedTargetIds(ctx,work,work.after);if(!batch.length){work.stage='Retentions';work.after='';await save(ctx,work,prior);return;}
  const result=await replayTargetEvidence(ctx,ctx.actor.userId,work.seasonId,batch,true);if(result.status==='Ready')work.after=batch.at(-1)!;await save(ctx,work,prior);return;
 }
 if(work.stage==='Retentions'){
  const batch=await savedTargetIds(ctx,work,work.after);if(!batch.length){work.stage='Projecting';work.after='';await save(ctx,work,prior);return;}
  const rows=await chapterBoundedPage<{revision:number;value:ReviewProjection}>(ctx,"SELECT id AS key,json_object('revision',revision,'value',json(data)) AS payload FROM Records WHERE kind='pbe-target-review' AND org_id=? AND id IN (SELECT value FROM json_each(?)) ORDER BY id LIMIT 128",[ctx.orgId,JSON.stringify(batch.map(t=>`${ownerId(ctx,work.seasonId)}:${t}`))]);if(!rows.length||rows.some(r=>r.value.retention?.ruleVersion!==RETENTION_RULE_VERSION))throw staleWork();
  const selected=batch.slice(0,rows.length);if(selected.some(id=>!rows.some(r=>r.value.targetId===id)))throw staleWork();
  const values=selected.map(targetId=>({targetId,projection:rows.find(r=>r.value.targetId===targetId)!.value}));const page=await savePage(ctx,work,'retentions',values),chosen=new Set(batch.slice(0,page.processed)),guardPage=await savePage(ctx,work,'evidence',rows.filter(r=>chosen.has(r.value.targetId)).map(r=>({kind:'pbe-target-review',id:r.value.id,revision:r.revision})));
  for(const row of rows.filter(r=>chosen.has(r.value.targetId))){const due=row.value.review.dueAtMs;if(due>Date.parse(work.asOfUtc)&&due<Date.parse(work.dueRefreshAtUtc))work.dueRefreshAtUtc=new Date(due).toISOString();}work.after=batch[page.processed-1];await save(ctx,work,prior,[page.statement,guardPage.statement]);return;
 }
 if(work.stage==='Projecting'||work.stage==='Proofs'){await aggregateStep(ctx,work,prior);return;}
}
export async function continueChapters(ctx:RequestContext,input:ContinueChaptersRequest):Promise<ContinueChaptersResponse>{
 const seasonId=guid(input.seasonId);if(input.workId!==undefined)guid(input.workId);
 {
  const prior=await ctx.store.get<Work>('pbe-chapter-work',ownerId(ctx,seasonId),ctx.orgId),admitted=await chapterBase(ctx,seasonId);
  if(input.workId&&input.workId!==prior?.value.workId)throw staleWork();
  if(admitted.reason)return {seasonId,scopeVersion:null,work:workDto(prior?.value??null,admitted.reason),next:'None'};
  const hash=admitted.signature;let work=prior?structuredClone(prior.value):null;
  const changed=!work||!!work.reason||work.sourceHash!==hash||work.stage==='Complete'&&(!await current(ctx,work)||Date.parse(trainingNow())>=Date.parse(work.dueRefreshAtUtc));
  if(changed&&input.workId)throw staleWork();
  try{
   if(changed){
    if(work?.abandoned){await step(ctx,work,prior!);return {seasonId,scopeVersion:null,work:{...workDto(work),stage:'Cleanup'},next:'Continue'};}
    work=newWork(ctx,seasonId,admitted,work);await save(ctx,work,prior,[],admitted.guards.filter(g=>['season','membership','@active-user'].includes(g.kind)));
   }else if(work&&!work.reason&&work.stage!=='Complete')await step(ctx,work,prior!);
   return {seasonId,scopeVersion:work!.scopeVersion,work:workDto(work),next:work!.reason?'None':work!.stage==='Complete'?'Reload':'Continue'};
  }catch(error){
   if(error instanceof HttpError&&error.status===413){work!.reason=error.message.includes('SCOPE')?'ScopeTooLarge':'InputTooLarge';await save(ctx,work!,prior);return {seasonId,scopeVersion:work!.scopeVersion,work:workDto(work),next:'None'};}
   if(error instanceof HttpError&&error.status===409){
    const latest=await ctx.store.get<Work>('pbe-chapter-work',ownerId(ctx,seasonId),ctx.orgId);
    if(latest&&latest.revision!==prior?.revision){if(input.workId&&input.workId!==latest.value.workId)throw staleWork();return {seasonId,scopeVersion:latest.value.scopeVersion,work:workDto(latest.value),next:latest.value.reason?'None':latest.value.stage==='Complete'?'Reload':'Continue'};}
    if(prior&&work&&!input.workId&&!prior.value.abandoned){const replacement=newWork(ctx,seasonId,admitted,prior.value);await save(ctx,replacement,prior);return {seasonId,scopeVersion:null,work:workDto(replacement),next:'Continue'};}
    throw staleWork();
   }
   throw error;
  }
 }
}
interface Cursor {orgId:string;studentId:string;seasonId:string;view:string;chapterKey:string|null;snapshotId:string|null;after:string}
function decodeCursor(value:string):Cursor{try{if(value.length>4000)throw new Error();return JSON.parse(atob(value)) as Cursor;}catch{throw new HttpError(400,'Invalid chapter cursor.');}}
function encodeCursor(value:Cursor){return btoa(JSON.stringify(value));}
export async function chapters(ctx:RequestContext,url:URL):Promise<ChapterPage>{
 const seasonId=guid(url.searchParams.get('seasonId')),view=url.searchParams.get('view')??'Chapters',chapterKey=url.searchParams.get('chapterKey'),limit=Number(url.searchParams.get('limit')??32),after=url.searchParams.get('after');
 if(!['Chapters','Groups','Stamps'].includes(view)||!Number.isInteger(limit)||limit<1||limit>32||view==='Groups'&&!chapterKey)throw new HttpError(400,'Choose a chapter view and page size from 1 to 32.');
 const admitted=await admission(ctx,seasonId),baseAdmission=await chapterBase(ctx,seasonId),stored=await ctx.store.get<Work>('pbe-chapter-work',ownerId(ctx,seasonId),ctx.orgId),work=stored?.value??null;
 const baseMatches=!!admitted.scope&&!admitted.reason&&!!work&&work.sourceHash===baseAdmission.signature;
 const currentScope=baseMatches&&(!work!.scopeVersion||(await chapterInputGuard(ctx,seasonId,work!.workId,work!.pageCount,undefined,true).first<{valid:number}>())?.valid===1);
 const ready=currentScope&&work!.stage==='Complete'&&await current(ctx,work!);
 const historyAvailable=!!await ctx.env.DB.prepare("SELECT 1 AS present FROM Records WHERE org_id=? AND season_id=? AND owner_id=? AND kind='pbe-chapter-stamp' LIMIT 1").bind(ctx.orgId,seasonId,ctx.actor.userId).first();
 const base={seasonId,ruleVersion:CHAPTER_RULE_VERSION,scopeVersion:currentScope?work!.scopeVersion:null,snapshotId:ready?work!.snapshotId:null,chapterKey,work:workDto(work,admitted.reason),currentAvailable:!admitted.reason,historyAvailable,asOfUtc:ready?work!.asOfUtc:null,dueRefreshAtUtc:ready?work!.dueRefreshAtUtc:null,nextCursor:null as string|null};
 if(!admitted.reason&&work?.stage==='Complete'&&!ready)base.work={id:work.workId,state:'Working',stage:'Projecting',reason:null};
 const cursor=after?decodeCursor(after):null,binding={orgId:ctx.orgId,studentId:ctx.actor.userId,seasonId,view,chapterKey,snapshotId:view==='Stamps'?null:base.snapshotId};
 if(cursor&&(cursor.orgId!==binding.orgId||cursor.studentId!==binding.studentId||cursor.seasonId!==seasonId||cursor.view!==view||cursor.chapterKey!==chapterKey||cursor.snapshotId!==binding.snapshotId))throw staleCursor();
 if(view==='Stamps'){
  const rows=await ctx.env.DB.prepare("SELECT id,data FROM Records INDEXED BY Records_training_scope WHERE org_id=? AND season_id=? AND owner_id=? AND kind='pbe-chapter-stamp' AND id>? AND (? IS NULL OR json_extract(data,'$.summary.chapterKey')=?) ORDER BY id LIMIT ?").bind(ctx.orgId,seasonId,ctx.actor.userId,cursor?.after??'',chapterKey,chapterKey,limit+1).all<{id:string;data:string}>();
  const items:StampSummary[]=[];let last='';for(const row of rows.results.slice(0,limit)){const stamp=JSON.parse(row.data) as Stamp,item={...stamp.summary,matchesCurrentScope:currentScope&&work!.scopeVersion?stamp.summary.scopeVersion===work!.scopeVersion:null};if(utf8Bytes({...base,view,items:[...items,item]})>CHAPTER_PAGE_BYTES-2000)break;items.push(item);last=row.id;}
  if(rows.results.length>items.length&&items.length)base.nextCursor=encodeCursor({...binding,after:last});return {...base,view:'Stamps',items};
 }
 if(!ready)return {...base,view:view as 'Chapters'|'Groups',items:[]};
 if(view==='Groups'&&!admitted.scope!.sources.some(s=>`chapter:${s.contentPackId}:${s.bookKey}:${s.chapter}`===chapterKey))throw new HttpError(404,'Choose a current chapter.');
 const rows=await ctx.env.DB.prepare("SELECT id,data FROM Records INDEXED BY Records_training_scope WHERE org_id=? AND season_id=? AND owner_id=? AND kind='pbe-chapter-projection' AND json_extract(data,'$.generationId')=? AND id>? AND ((?='Chapters' AND json_extract(data,'$.row.kind')<>'PassageGroup') OR (?='Groups' AND json_extract(data,'$.row.parentChapterKey')=?)) ORDER BY id LIMIT ?").bind(ctx.orgId,seasonId,ctx.actor.userId,work!.workId,cursor?.after??'',view,view,chapterKey,limit+1).all<{id:string;data:string}>();
 const items:ProgressRow[]=[];let last='';for(const row of rows.results.slice(0,limit)){const item=(JSON.parse(row.data) as SavedRow).row;if(utf8Bytes({...base,view,items:[...items,item]})>CHAPTER_PAGE_BYTES-2000)break;items.push(item);last=row.id;}
 if(rows.results.length>items.length&&items.length)base.nextCursor=encodeCursor({...binding,after:last});return {...base,view:view as 'Chapters'|'Groups',items};
}
/** D2 uses this private owned manifest lookup before loading the complete current eligible assignment. */
export async function resolveChapterProgressScope(ctx:RequestContext,seasonId:string,selection:{key:string;scopeVersion:string}):Promise<{targetIds:string[];scope:PbeSourceScope}>{
 seasonId=guid(seasonId);const admitted=await admission(ctx,seasonId),baseAdmission=await chapterBase(ctx,seasonId),work=(await ctx.store.get<Work>('pbe-chapter-work',ownerId(ctx,seasonId),ctx.orgId))?.value;
 if(admitted.reason||!work||work.stage!=='Complete'||work.scopeVersion!==selection.scopeVersion||work.sourceHash!==baseAdmission.signature||!await current(ctx,work))throw new HttpError(409,'PBE_CHAPTER_SCOPE_STALE');
 const result=await ctx.env.DB.prepare(`WITH ${chapterGroupCtes()},selected AS (SELECT id FROM members WHERE parentKey=? OR groupKey=?)
 SELECT json_extract(e.value,'$.target.id') AS id FROM Records m INDEXED BY Records_training_scope JOIN json_each(m.data,'$.entries') e WHERE m.org_id=? AND m.season_id=? AND m.owner_id=? AND m.kind='pbe-chapter-manifest' AND json_extract(m.data,'$.generationId')=? AND json_extract(m.data,'$.family')='targets' AND EXISTS(SELECT 1 FROM json_each(e.value,'$.target.sourceUnitIds') unit WHERE unit.value IN (SELECT id FROM selected)) ORDER BY id LIMIT 10001`).bind(ctx.orgId,seasonId,ctx.actor.userId,work.workId,selection.key,selection.key,ctx.orgId,seasonId,ctx.actor.userId,work.workId).all<{id:string}>();
 if(result.results.length>10000)throw new HttpError(413,'PBE_CHAPTER_SCOPE_TOO_LARGE');
 const known=await ctx.env.DB.prepare("SELECT 1 AS present FROM Records m INDEXED BY Records_training_scope JOIN json_each(m.data,'$.entries') e WHERE m.org_id=? AND m.season_id=? AND m.owner_id=? AND m.kind='pbe-chapter-manifest' AND json_extract(m.data,'$.generationId')=? AND json_extract(m.data,'$.family')='groups' AND json_extract(e.value,'$.key')=? LIMIT 1").bind(ctx.orgId,seasonId,ctx.actor.userId,work.workId,selection.key).first();if(!known)throw new HttpError(404,'Choose a current progress group.');
 return {targetIds:result.results.map(r=>r.id),scope:admitted.scope!};
}
