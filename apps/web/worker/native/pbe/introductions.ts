import type { RequestContext } from '../types';
import { admin, body, HttpError, json } from '../types';
import { atomic, memberId } from '../application/model';
import { guid } from './bank';
import { introductionLicensed, introductionRows, resolvePbeSources } from './sources';
import type { PbeIntroduction, PbeIntroductionAssignment, PbeGuard } from './sources';
const fail=(message:string):never=>{throw new HttpError(400,message);};
function object(value:unknown,keys:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))return fail('Malformed introduction request.');return value as Record<string,unknown>;}
function text(value:unknown,max:number){if(typeof value!=='string'||!value.trim()||value.length>max)return fail(`Provide nonempty text of at most ${max} characters.`);return value;}
const revision=(value:unknown)=>{if(!Number.isInteger(value)||Number(value)<1||Number(value)>2147483647)return fail('Provide a valid revision.');return Number(value);};
async function assignedStudentsByPack(ctx:RequestContext,seasonId:string,packIds:string[]){
 const rows=await ctx.env.DB.prepare("SELECT r.data FROM json_each(?) p CROSS JOIN Records r WHERE r.kind='pbe-introduction-assignment' AND r.org_id=? AND r.season_id=? AND r.id>=?||':'||p.value||':' AND r.id<?||':'||p.value||':~' ORDER BY r.id").bind(JSON.stringify(packIds),ctx.orgId,seasonId,seasonId,seasonId).all<{data:string}>();
 const assignments=new Map<string,string[]>();for(const row of rows.results){const value=JSON.parse(row.data) as PbeIntroductionAssignment;const ids=assignments.get(value.contentPackId)??[];ids.push(value.studentUserId);assignments.set(value.contentPackId,ids);}return assignments;
}
const dto=(value:PbeIntroduction,revision:number,assignedStudentIds:string[])=>({...value,revision,assignedStudentIds});
export async function introductionRoutes(ctx:RequestContext,seasonId:string,path:string):Promise<Response|null>{
 if(!path.startsWith('/introductions'))return null;
 const base={organizationId:ctx.orgId,seasonId};const reader=path.match(/^\/introductions\/([^/]+)\/reader$/);
 if(reader&&ctx.request.method==='GET'){
  const id=guid(reader[1]);const scope={...base,...(ctx.actor.kind==='Student'?{studentId:ctx.actor.userId}:{})};const resolved=await resolvePbeSources(ctx,scope);const sources=resolved.sources.filter(s=>s.contentPackId===id&&s.chapter===null);
  if(!sources.length)throw new HttpError(403,'This introduction is outside your current approved assignment.');
  if((await resolvePbeSources(ctx,scope)).fingerprint!==resolved.fingerprint)throw new HttpError(409,'The PBE scope changed. Refresh and retry.');
  return json({contentPackId:id,sources});
 }
 admin(ctx.actor);const resolved=await resolvePbeSources(ctx,base);
 if(path==='/introductions'&&ctx.request.method==='GET'){const rows=await introductionRows(ctx,seasonId),assignments=await assignedStudentsByPack(ctx,seasonId,rows.map(r=>r.value.id));return json(rows.map(r=>dto(r.value,r.revision,assignments.get(r.value.id)??[])));}
 if(path==='/introductions'&&ctx.request.method==='POST'){
  const input=object(await body(ctx.request),['bookKey','sourceEdition','title','citation','licensingStatus','units']);
  const bookKey=text(input.bookKey,20).trim().toUpperCase();if(!resolved.selectedBookKeys.includes(bookKey))return fail('Choose a book selected for this season.');
  const license=text(input.licensingStatus,40).trim().toLowerCase();if(!['pending','approved','public-domain','creative-commons'].includes(license))return fail('Choose pending, approved, public-domain or creative-commons licensing.');
  if(!Array.isArray(input.units)||input.units.length<1||input.units.length>20)return fail('Provide 1–20 introduction units.');
  const units=input.units.map(v=>{const u=object(v,['citation','canonicalText']);return {id:crypto.randomUUID(),citation:text(u.citation,500),canonicalText:text(u.canonicalText,10000)};});
  if(units.reduce((n,u)=>n+u.canonicalText.length,0)>100000)return fail('An introduction may contain at most 100,000 text characters.');
  const value:PbeIntroduction={id:crypto.randomUUID(),organizationId:ctx.orgId,seasonId,bookKey,sourceEdition:text(input.sourceEdition,200),title:text(input.title,200),citation:text(input.citation,500),licensingStatus:license,reviewed:false,units};
  await atomic(ctx,'pbe-introduction-create',[ctx.store.insertion('pbe-introduction',value.id,ctx.orgId,value,{seasonId})],resolved.guards);return json(dto(value,1,[]));
 }
 const update=path.match(/^\/introductions\/([^/]+)\/(review|assignments)$/);
 if(update&&ctx.request.method==='POST'){
  const id=guid(update[1]),row=await ctx.store.require<PbeIntroduction>('pbe-introduction',id,ctx.orgId);if(row.value.seasonId!==seasonId)throw new HttpError(404,'Introduction not found in this season.');
  const input=object(await body(ctx.request),update[2]==='review'?['revision','reviewed']:['revision','studentIds']);const expected=revision(input.revision);
  const guards:PbeGuard[]=[...resolved.guards,{kind:'pbe-introduction',id,revision:row.revision}];const writes=[];let value=row.value;let assignedIds:string[]|undefined;
  const currentAssignments=async()=>(await assignedStudentsByPack(ctx,seasonId,[id])).get(id)??[];
  if(update[2]==='review'){
   if(expected!==row.revision)throw new HttpError(409,'The introduction changed. Refresh and retry.');
   if(typeof input.reviewed!=='boolean')return fail('Provide a reviewed flag.');
   if(input.reviewed&&(!introductionLicensed(value.licensingStatus)||!resolved.selectedBookKeys.includes(value.bookKey)))return fail('Review requires licensed content and a selected season book.');
   if(input.reviewed===value.reviewed)return json(dto(value,row.revision,await currentAssignments()));value={...value,reviewed:input.reviewed};
  }else{
   if(!Array.isArray(input.studentIds)||input.studentIds.length>500)return fail('Choose at most 500 active season students.');
   const ids=[...new Set(input.studentIds.map(guid))].sort();
   if(ids.length&&!resolved.selectedBookKeys.includes(value.bookKey))return fail('Choose a book selected for this season.');
   // One indexed set query validates all supported 500 students. The same member
   // revisions and active-user predicates are still enforced inside atomic().
   const members=await ctx.env.DB.prepare("SELECT u.id,m.revision FROM json_each(?) selected CROSS JOIN Users u CROSS JOIN Records m WHERE u.id=selected.value AND u.org_id=? AND u.active=1 AND u.kind='Student' AND u.role='Student' AND m.kind='membership' AND m.id=?||':'||u.id AND m.org_id=?").bind(JSON.stringify(ids),ctx.orgId,seasonId,ctx.orgId).all<{id:string;revision:number}>();
   if(members.results.length!==ids.length)return fail('Choose active student members of this season.');
   for(const member of members.results)guards.push({kind:'membership',id:memberId(seasonId,member.id),revision:member.revision},{kind:'@active-user',id:member.id,revision:0});
   const prior=await currentAssignments();if(JSON.stringify(prior)===JSON.stringify(ids))return json(dto(value,row.revision,prior));
   if(expected!==row.revision)throw new HttpError(409,'The introduction changed. Refresh and retry.');
   const prefix=`${seasonId}:${id}:`;writes.push(ctx.env.DB.prepare("DELETE FROM Records WHERE kind='pbe-introduction-assignment' AND org_id=? AND id>=? AND id<?").bind(ctx.orgId,prefix,prefix+'~'));
   assignedIds=ids;const assignments:PbeIntroductionAssignment[]=ids.map(studentId=>({id:prefix+studentId,seasonId,contentPackId:id,studentUserId:studentId}));
   writes.push(ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) SELECT 'pbe-introduction-assignment',json_extract(value,'$.id'),?,?,json_extract(value,'$.studentUserId'),value,1 FROM json_each(?)").bind(ctx.orgId,seasonId,JSON.stringify(assignments)));
  }
  writes.push(ctx.store.update('pbe-introduction',id,ctx.orgId,value,row.revision));await atomic(ctx,'pbe-introduction-'+update[2],writes,guards);return json(dto(value,row.revision+1,assignedIds??await currentAssignments()));
 }
 return null;
}
