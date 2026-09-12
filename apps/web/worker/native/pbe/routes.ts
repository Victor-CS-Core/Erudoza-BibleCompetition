import { introductionRoutes } from './introductions';
import type { RequestContext } from '../types';
import { admin,body,HttpError,json,noContent } from '../types';
import { atomic } from '../application/model';
import type { Season } from '../application/model';
import { guid,loadPbeBankMetadata,resolvePbeSources,sourceProof } from './bank';
import type { PbeQuestionRecord } from './bank';
import type { PbeQuestion,PbeTarget } from './types';
import { validatePbeQuestion, validatePbeTarget } from './grading';
function normalizeQuestion(q:PbeQuestion):PbeQuestion{return {...q,id:guid(q.id),contentPackId:guid(q.contentPackId),sourceUnitId:guid(q.sourceUnitId),sourceUnitIds:q.sourceUnitIds.map(guid),parts:q.parts.map(p=>({...p,targetId:guid(p.targetId)}))};}
function normalizeTarget(t:PbeTarget):PbeTarget{const {id,sourceUnitIds,skill,label,...extra}=t;return {id:guid(id),sourceUnitIds:sourceUnitIds.map(guid),skill,label,...extra};}
export async function pbeRoutes(ctx:RequestContext):Promise<Response|null>{
 const match=ctx.path.match(/^\/practice\/pbe\/seasons\/([^/]+)(.*)$/);if(!match)return null;
 const seasonId=guid(match[1]),path=match[2],base={organizationId:ctx.orgId,seasonId};
 const introduction=await introductionRoutes(ctx,seasonId,path);if(introduction)return introduction;
 if(path==='/bank'&&ctx.request.method==='GET'){
  const scope={...base,...(ctx.actor.kind==='Student'?{studentId:ctx.actor.userId}:{})};
  return json(await loadPbeBankMetadata(ctx,scope));
 }
 admin(ctx.actor);const resolved=await resolvePbeSources(ctx,base);
 if(path==='/authoring'&&ctx.request.method==='GET'){
  const url=new URL(ctx.request.url),after=url.searchParams.get('membersAfter')??'';
  const members=await ctx.env.DB.prepare("SELECT u.id,u.display_name AS displayName FROM Records m CROSS JOIN Users u WHERE m.kind='membership' AND m.org_id=? AND m.id>=? AND m.id<? AND u.id=substr(m.id,38) AND u.org_id=? AND u.active=1 AND u.kind='Student' AND u.role='Student' AND u.id>? ORDER BY u.id LIMIT 101").bind(ctx.orgId,seasonId+':',seasonId+':~',ctx.orgId,after).all<{id:string;displayName:string}>();
  const season=await ctx.store.require<Season>('season',seasonId,ctx.orgId);
  return json({sources:resolved.sources,selectedBookKeys:resolved.selectedBookKeys,pbeEnabled:!!season.value.pbeEnabled,members:members.results.slice(0,100),membersNextCursor:members.results.length>100?members.results[99].id:null});
 }
 if((path==='/targets'||path==='/questions')&&ctx.request.method==='GET'){
  const url=new URL(ctx.request.url),limit=Number(url.searchParams.get('limit')??50),after=url.searchParams.get('after')??'';
  if(!Number.isInteger(limit)||limit<1||limit>100||after.length>100)throw new HttpError(400,'Choose a page size from 1 to 100.');
  const kind=path==='/targets'?'pbe-target':'pbe-question';
  const page=await ctx.env.DB.prepare("SELECT id,data FROM Records INDEXED BY Records_scope WHERE org_id=? AND season_id=? AND kind=? AND id>? ORDER BY id LIMIT ?").bind(ctx.orgId,seasonId,kind,after,limit+1).all<{id:string;data:string}>();
  const items=page.results.slice(0,limit).map(r=>JSON.parse(r.data));
  if(kind==='pbe-question'){
   const heads=await ctx.store.getMany<PbeQuestionRecord>('pbe-question-head',items.map((r:PbeQuestionRecord)=>r.question.id),ctx.orgId);
   for(const r of items)r.publishedHeadVersion=heads.find(h=>h.value.seasonId===seasonId&&h.value.question.id===r.question.id)?.value.question.version??null;
  }
  return json({items,nextCursor:page.results.length>limit?page.results[limit-1].id:null});
 }
 if(path==='/targets'&&ctx.request.method==='POST'){
  const input=await body<{targets:PbeTarget[]}>(ctx.request);let targets:PbeTarget[];
  try{if(!Array.isArray(input?.targets)||!input.targets.length||input.targets.length>500)throw Error();targets=input.targets.map(normalizeTarget);targets.forEach(validatePbeTarget);}catch{throw new HttpError(400,'Declare 1–500 valid targets.');}
  if(new Set(targets.map(t=>t.id)).size!==targets.length||targets.some(t=>t.sourceUnitIds.some(id=>!resolved.sources.some(s=>s.id===id))))throw new HttpError(400,'Choose distinct targets within approved season sources.');
  try{await atomic(ctx,'pbe-targets',await targetWrites(ctx,seasonId,targets),resolved.guards);}catch(error){if(String(error).includes('UNIQUE'))throw new HttpError(409,'The target changed. Refresh and retry.');throw error;}return noContent();
 }
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
  const sources=new Map(resolved.sources.map(s=>[s.id,s]));
  for(const q of questions)if(q.sourceUnitIds.some(id=>{const s=sources.get(id);return !s||s.contentPackId!==q.contentPackId||s.sourceKind!==q.sourceKind;}))throw new HttpError(400,'Each source must be approved season content of the declared kind.');
  const statements=await targetWrites(ctx,seasonId,targets);
  const existing=await ctx.env.DB.prepare("SELECT r.id,r.season_id FROM json_each(?) q CROSS JOIN Records r WHERE r.kind='pbe-question' AND r.org_id=? AND r.id>=q.value||':' AND r.id<q.value||';'").bind(JSON.stringify([...new Set(questions.map(q=>q.id))]),ctx.orgId).all<{id:string;season_id:string}>();
  if(existing.results.some(r=>r.season_id!==seasonId))throw new HttpError(409,'Declare a new question ID for this season.');
  if(questions.some(q=>existing.results.some(r=>r.id===`${q.id}:${q.version}`)))throw new HttpError(409,'This question version already exists.');
  const rows:PbeQuestionRecord[]=await Promise.all(questions.map(async q=>({id:`${q.id}:${q.version}`,seasonId,published:false,sourceFingerprint:await sourceProof(q,sources),question:q})));
  // Identity ownership is rechecked inside the atomic bulk insert, including races.
  statements.push(ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,season_id,data,revision) SELECT 'pbe-question',json_extract(q.value,'$.id'),?,?,CASE WHEN EXISTS(SELECT 1 FROM Records r WHERE r.kind='pbe-question' AND r.org_id=? AND r.id>=json_extract(q.value,'$.question.id')||':' AND r.id<json_extract(q.value,'$.question.id')||';' AND r.season_id<>?) THEN 'invalid-json' ELSE q.value END,1 FROM json_each(?) q").bind(ctx.orgId,seasonId,ctx.orgId,seasonId,JSON.stringify(rows)));
  if((await resolvePbeSources(ctx,base)).fingerprint!==resolved.fingerprint)throw new HttpError(409,'The PBE scope changed. Refresh and retry.');
  try{await atomic(ctx,'pbe-import',statements,resolved.guards);}catch(error){if(String(error).includes('UNIQUE'))throw new HttpError(409,'This question or target already exists.');throw error;}return noContent();
 }
 const publish=path.match(/^\/questions\/([^/]+)\/(\d+)\/publish$/);
 if(publish&&ctx.request.method==='POST'){
  const row=await ctx.store.require<PbeQuestionRecord>('pbe-question',`${guid(publish[1])}:${Number(publish[2])}`,ctx.orgId);
  if(row.value.seasonId!==seasonId)throw new HttpError(404,'Question was not found in this season.');
  const targets=await ctx.store.getMany<PbeTarget>('pbe-target',row.value.question.parts.map(p=>p.targetId),ctx.orgId);
  try{validatePbeQuestion(row.value.question,targets.map(t=>t.value));}catch{throw new HttpError(400,'Malformed PBE question or target.');}
  if(row.value.question.sourceUnitIds.some(id=>!resolved.sources.some(s=>s.id===id&&s.contentPackId===row.value.question.contentPackId&&s.sourceKind===row.value.question.sourceKind)))throw new HttpError(400,'Question sources are no longer in the approved season scope.');
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

async function targetWrites(ctx:RequestContext,seasonId:string,targets:PbeTarget[]){
 const prior=await ctx.env.DB.prepare("SELECT id,season_id,data FROM Records WHERE kind='pbe-target' AND org_id=? AND id IN (SELECT value FROM json_each(?))").bind(ctx.orgId,JSON.stringify(targets.map(t=>t.id))).all<{id:string;season_id:string;data:string}>();
 for(const t of targets){const row=prior.results.find(r=>r.id===t.id);if(row&&(row.season_id!==seasonId||JSON.stringify(JSON.parse(row.data))!==JSON.stringify(t)))throw new HttpError(409,'Target meaning is immutable; declare a new target ID.');}
 const fresh=targets.filter(t=>!prior.results.some(r=>r.id===t.id));
 return fresh.length?[ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) SELECT 'pbe-target',json_extract(value,'$.id'),?,?,json_extract(value,'$.sourceUnitIds[0]'),value,1 FROM json_each(?)").bind(ctx.orgId,seasonId,JSON.stringify(fresh))]:[];
}
