import type { RequestContext } from '../types';
import { admin,body,HttpError,json,noContent } from '../types';
import { atomic } from '../application/model';
import type { Pack, Season } from '../application/model';
import { guid,loadPbeBank,resolvePbeSources,sourceProof } from './bank';
import type { PbeQuestionRecord } from './bank';
import type { PbeQuestion,PbeTarget } from './types';
import { validatePbeQuestion } from './grading';
function normalizeQuestion(q:PbeQuestion):PbeQuestion{return {...q,id:guid(q.id),contentPackId:guid(q.contentPackId),sourceUnitId:guid(q.sourceUnitId),sourceUnitIds:q.sourceUnitIds.map(guid),parts:q.parts.map(p=>({...p,targetId:guid(p.targetId)}))};}
function normalizeTarget(t:PbeTarget):PbeTarget{const {id,sourceUnitIds,skill,label,...extra}=t;return {id:guid(id),sourceUnitIds:sourceUnitIds.map(guid),skill,label,...extra};}
export async function pbeRoutes(ctx:RequestContext):Promise<Response|null>{
 const match=ctx.path.match(/^\/practice\/pbe\/seasons\/([^/]+)(.*)$/);if(!match)return null;
 const seasonId=guid(match[1]),path=match[2],base={organizationId:ctx.orgId,seasonId};
 if(path==='/bank'&&ctx.request.method==='GET'){
  const scope={...base,...(ctx.actor.kind==='Student'?{studentId:ctx.actor.userId}:{})},resolved=await resolvePbeSources(ctx,scope);
  const bank=await loadPbeBank(ctx,{...scope,sourceUnitIds:resolved.sources.map(s=>s.id)});
  if((await resolvePbeSources(ctx,scope)).fingerprint!==resolved.fingerprint)throw new HttpError(409,'The PBE scope changed. Refresh and retry.');
  return json({questionCount:bank.questions.length,targetCount:bank.targets.length,sourceUnitCount:resolved.sources.length,missingSourceUnitIds:bank.missingSourceUnitIds});
 }
 admin(ctx.actor);const resolved=await resolvePbeSources(ctx,base);
 if(path==='/enabled'&&ctx.request.method==='POST'){
  const input=await body<{enabled:boolean}>(ctx.request);if(typeof input.enabled!=='boolean')throw new HttpError(400,'Provide an enabled flag.');
  const season=await ctx.store.require<Season>('season',seasonId,ctx.orgId);await ctx.store.put('season',seasonId,ctx.orgId,{...season.value,pbeEnabled:input.enabled},season.revision);return noContent();
 }
 if(path==='/questions/import'&&ctx.request.method==='POST'){
  const input=await body<{questions:PbeQuestion[];targets:PbeTarget[]}>(ctx.request);
  if(!input||!Array.isArray(input.questions)||!input.questions.length||input.questions.length>100||!Array.isArray(input.targets)||input.targets.length>500)throw new HttpError(400,'Import 1–100 questions with at most 500 targets.');
  let questions:PbeQuestion[],targets:PbeTarget[];
  try{questions=input.questions.map(normalizeQuestion);targets=input.targets.map(normalizeTarget);for(const q of questions)validatePbeQuestion(q,targets.filter(t=>q.parts.some(p=>p.targetId===t.id)));}catch{throw new HttpError(400,'Malformed PBE question or target.');}
  if(new Set(targets.map(t=>t.id)).size!==targets.length||new Set(questions.map(q=>`${q.id}:${q.version}`)).size!==questions.length)throw new HttpError(400,'Duplicate question or target identities.');
  // Validate each declared target even when no question references it.
  if(targets.some(t=>!questions.some(q=>q.parts.some(p=>p.targetId===t.id))))throw new HttpError(400,'Every imported target must be used by a question.');
  const sources=new Map(resolved.sources.map(s=>[s.id,s])),packs=new Map((await ctx.store.getMany<Pack>('pack',[...new Set(resolved.sources.map(s=>s.contentPackId))],ctx.orgId)).map(p=>[p.value.id,p.value]));
  for(const q of questions)if(q.sourceUnitIds.some(id=>{const s=sources.get(id);return !s||s.contentPackId!==q.contentPackId||packs.get(s.contentPackId)?.sourceType!==(q.sourceKind==='Scripture'?'Scripture':'Supplemental');}))throw new HttpError(400,'Each source must be approved season content of the declared kind.');
  const statements=[];
  for(const t of targets){const prior=await ctx.store.get<PbeTarget>('pbe-target',t.id,ctx.orgId);if(prior){const owner=await ctx.env.DB.prepare("SELECT season_id FROM Records WHERE kind='pbe-target' AND org_id=? AND id=?").bind(ctx.orgId,t.id).first<{season_id:string}>();if(owner?.season_id!==seasonId)throw new HttpError(409,'Declare a new target ID for this season.');if(JSON.stringify(prior.value)!==JSON.stringify(t))throw new HttpError(409,'Target meaning is immutable; declare a new target ID.');}else statements.push(ctx.store.insertion('pbe-target',t.id,ctx.orgId,t,{seasonId,ownerId:t.sourceUnitIds[0]}));}
  for(const q of questions){
   const otherSeason=await ctx.env.DB.prepare("SELECT 1 FROM Records WHERE kind='pbe-question' AND org_id=? AND id>=? AND id<? AND season_id<>? LIMIT 1").bind(ctx.orgId,q.id+':',q.id+';',seasonId).first();
   if(otherSeason)throw new HttpError(409,'Declare a new question ID for this season.');
   const id=`${q.id}:${q.version}`;
   if(await ctx.store.get('pbe-question',id,ctx.orgId))throw new HttpError(409,'This question version already exists.');
   const row:PbeQuestionRecord={id,seasonId,published:false,sourceFingerprint:await sourceProof(q,sources),question:q};
   // Check identity ownership in the same transaction as all target/question inserts.
   // A failed Records JSON constraint makes atomic() roll back the entire batch.
   statements.push(ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,season_id,data,revision) VALUES('pbe-question',?,?,?,CASE WHEN EXISTS(SELECT 1 FROM Records WHERE kind='pbe-question' AND org_id=? AND id>=? AND id<? AND season_id<>?) THEN 'invalid-json' ELSE ? END,1)").bind(id,ctx.orgId,seasonId,ctx.orgId,q.id+':',q.id+';',seasonId,JSON.stringify(row)));
  }
  if((await resolvePbeSources(ctx,base)).fingerprint!==resolved.fingerprint)throw new HttpError(409,'The PBE scope changed. Refresh and retry.');
  try{await atomic(ctx,'pbe-import',statements,resolved.guards);}catch(error){if(String(error).includes('UNIQUE'))throw new HttpError(409,'This question or target already exists.');throw error;}return noContent();
 }
 const publish=path.match(/^\/questions\/([^/]+)\/(\d+)\/publish$/);
 if(publish&&ctx.request.method==='POST'){
  const row=await ctx.store.require<PbeQuestionRecord>('pbe-question',`${guid(publish[1])}:${Number(publish[2])}`,ctx.orgId);
  if(row.value.seasonId!==seasonId)throw new HttpError(404,'Question was not found in this season.');
  const targets=await ctx.store.getMany<PbeTarget>('pbe-target',row.value.question.parts.map(p=>p.targetId),ctx.orgId);
  try{validatePbeQuestion(row.value.question,targets.map(t=>t.value));}catch{throw new HttpError(400,'Malformed PBE question or target.');}
  if(row.value.question.sourceUnitIds.some(id=>!resolved.sources.some(s=>s.id===id)))throw new HttpError(400,'Question sources are no longer in the approved season scope.');
  if(await sourceProof(row.value.question,new Map(resolved.sources.map(s=>[s.id,s])))!==row.value.sourceFingerprint)throw new HttpError(409,'Question sources changed; import a new version.');
  const published={...row.value,published:true},head=await ctx.store.get<PbeQuestionRecord>('pbe-question-head',row.value.question.id,ctx.orgId);
  if(head&&head.value.seasonId!==seasonId)throw new HttpError(409,'Declare a new question ID for this season.');
  const writes=[ctx.store.update('pbe-question',row.value.id,ctx.orgId,published,row.revision)],guards=[...resolved.guards,{kind:'pbe-question',id:row.value.id,revision:row.revision}];
  if(!head)writes.push(ctx.store.insertion('pbe-question-head',row.value.question.id,ctx.orgId,published,{seasonId,ownerId:row.value.question.sourceUnitId}));
  else if(head.value.question.version<row.value.question.version){writes.push(ctx.env.DB.prepare("UPDATE Records SET data=?,owner_id=?,revision=revision+1 WHERE kind='pbe-question-head' AND id=? AND org_id=? AND revision=?").bind(JSON.stringify(published),row.value.question.sourceUnitId,row.value.question.id,ctx.orgId,head.revision));guards.push({kind:'pbe-question-head',id:row.value.question.id,revision:head.revision});}
  try{await atomic(ctx,'pbe-publish',writes,guards);}catch(error){if(String(error).includes('UNIQUE'))throw new HttpError(409,'The PBE record changed. Refresh and retry.');throw error;}return noContent();
 }
 return null;
}
