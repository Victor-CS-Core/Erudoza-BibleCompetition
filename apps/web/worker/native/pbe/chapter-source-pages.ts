import type {RequestContext} from '../types';
import {HttpError} from '../types';
import {builtInContentSql,scopeEntriesSql} from '../application/library-access';
import {rangeSql,memberId} from '../application/model';
import {guid} from './bank';
import {chapterHash,CHAPTER_PAGE_BYTES,utf8Bytes,type InputGuard} from './chapter-manifest';
import type {PbeSource} from './sources';
export type ChapterBase={reason:'PbeDisabled'|'SeasonClosed'|'NoAssignment'|null;signature:string;guards:InputGuard[]};
export type ChapterSourceCapture={source:PbeSource;guards:InputGuard[]};
export type ChapterSourcePage={items:ChapterSourceCapture[];after:string|null};
export type ChapterAssignmentCapture={guard:InputGuard;tuple:(string|number|null)[];introductionGuard:InputGuard|null};
export type ChapterAssignmentPage={items:ChapterAssignmentCapture[];after:string|null};
const tooLarge=()=>new HttpError(413,'PBE_CHAPTER_INPUT_TOO_LARGE');
const scopeTooLarge=()=>new HttpError(413,'PBE_CHAPTER_SCOPE_TOO_LARGE');
/** Small admission snapshot only. Source/assignment completeness belongs to final publication. */
export async function chapterBase(ctx:RequestContext,seasonId:string):Promise<ChapterBase>{
 guid(seasonId);
 if(ctx.orgId!==ctx.actor.organizationId)throw new HttpError(403,'Organization access denied.');
 const actor=await ctx.env.DB.prepare('SELECT active,kind,role FROM Users WHERE id=? AND org_id=?').bind(ctx.actor.userId,ctx.orgId).first<{active:number;kind:string;role:string}>();
 if(!actor?.active||actor.kind!=='Student'||actor.role!=='Student')throw new HttpError(403,'Active student required.');
 const row=await ctx.env.DB.prepare(`SELECT s.revision, json_extract(s.data,'$.organizationId') AS organizationId,json_extract(s.data,'$.status') AS status,json_extract(s.data,'$.pbeEnabled') AS enabled,sc.revision AS scopeRevision,m.revision AS membershipRevision
 FROM Records s LEFT JOIN Records sc ON sc.kind='scope' AND sc.org_id=s.org_id AND sc.id=s.id LEFT JOIN Records m ON m.kind='membership' AND m.org_id=s.org_id AND m.id=?
 WHERE s.kind='season' AND s.org_id=? AND s.id=?`).bind(memberId(seasonId,ctx.actor.userId),ctx.orgId,seasonId).first<{revision:number;organizationId:string;status:string;enabled:number;scopeRevision:number|null;membershipRevision:number|null}>();
 if(!row)throw new HttpError(404,'Season was not found.');
 if(row.organizationId!==ctx.orgId)throw new HttpError(403,'Organization access denied.');
 const guards:InputGuard[]=[{kind:'season',id:seasonId,revision:row.revision},{kind:'scope',id:seasonId,revision:row.scopeRevision},{kind:'membership',id:memberId(seasonId,ctx.actor.userId),revision:row.membershipRevision},{kind:'@active-user',id:ctx.actor.userId,revision:0}];
 const reason=row.status!=='Active'?'SeasonClosed':!row.enabled?'PbeDisabled':row.scopeRevision===null||row.membershipRevision===null?'NoAssignment':null;
 return {reason,guards,signature:await chapterHash([ctx.orgId,seasonId,ctx.actor.userId,actor,row,guards])};
}
const contextSql='context(org,season,student) AS (VALUES(?,?,?))';
// These predicates intentionally match resolvePbeSources, including case-sensitive introduction licenses/books.
const scriptureFrom=`FROM context c CROSS JOIN Records u CROSS JOIN Records p ON p.kind='pack' AND p.id=u.owner_id AND p.org_id=u.org_id
 WHERE u.kind='source' AND (p.org_id=c.org OR ${builtInContentSql('p')}) AND json_extract(p.data,'$.isActive')=1
 AND lower(json_extract(p.data,'$.licensingStatus')) IN ('development-sample','public-domain','approved','creative-commons')
 AND json_extract(u.data,'$.isActive')=1 AND coalesce(json_extract(u.data,'$.isRetired'),0)=0
 AND EXISTS(SELECT 1 FROM Records sc JOIN json_each(${scopeEntriesSql('sc')}) selected WHERE sc.kind='scope' AND sc.org_id=c.org AND sc.id=c.season AND json_extract(selected.value,'$.contentPackId')=p.id
 AND EXISTS(SELECT 1 FROM json_each(selected.value,'$.includes') inc WHERE ${rangeSql('inc')}) AND NOT EXISTS(SELECT 1 FROM json_each(selected.value,'$.excludes') exc WHERE ${rangeSql('exc')}))`;
const personallyAssigned=`AND EXISTS(SELECT 1 FROM Records a INDEXED BY Records_training_scope JOIN json_each(json_array(json(a.data))) ar
 WHERE a.kind='assignment' AND a.org_id=c.org AND a.season_id=c.season AND a.owner_id=c.student AND json_extract(a.data,'$.contentPackId')=json_extract(u.data,'$.contentPackId') AND ${rangeSql('ar')})`;
const introductionFrom=`FROM context c CROSS JOIN Records intro JOIN json_each(intro.data,'$.units') unit
 WHERE intro.kind='pbe-introduction' AND intro.org_id=c.org AND intro.season_id=c.season
 AND json_extract(intro.data,'$.organizationId')=c.org AND json_extract(intro.data,'$.seasonId')=c.season AND json_extract(intro.data,'$.reviewed')=1
 AND json_extract(intro.data,'$.licensingStatus') IN ('approved','public-domain','creative-commons')
 AND EXISTS(SELECT 1 FROM Records a INDEXED BY Records_training_scope WHERE a.kind='pbe-introduction-assignment' AND a.org_id=c.org AND a.season_id=c.season AND a.owner_id=c.student AND json_extract(a.data,'$.contentPackId')=intro.id)
 AND EXISTS(SELECT 1 FROM Records sc JOIN json_each(${scopeEntriesSql('sc')}) selected JOIN json_each(selected.value,'$.includes') inc WHERE sc.kind='scope' AND sc.org_id=c.org AND sc.id=c.season AND upper(json_extract(inc.value,'$.bookKey'))=json_extract(intro.data,'$.bookKey'))
 AND EXISTS(SELECT 1 FROM Records m WHERE m.kind='membership' AND m.org_id=c.org AND m.id=c.season||':'||c.student)`;
function bindings(ctx:RequestContext,seasonId:string){return [ctx.orgId,seasonId,ctx.actor.userId];}
async function assignmentCaps(ctx:RequestContext,seasonId:string){
 const rows=await ctx.env.DB.prepare(`WITH ${contextSql} SELECT kind,count(*) AS n FROM (SELECT r.kind FROM context c CROSS JOIN Records r INDEXED BY Records_training_scope WHERE r.org_id=c.org AND r.season_id=c.season AND r.owner_id=c.student AND r.kind='assignment' LIMIT 10001)
 GROUP BY kind UNION ALL SELECT kind,count(*) AS n FROM (SELECT r.kind FROM context c CROSS JOIN Records r INDEXED BY Records_training_scope WHERE r.org_id=c.org AND r.season_id=c.season AND r.owner_id=c.student AND r.kind='pbe-introduction-assignment' LIMIT 10001) GROUP BY kind`).bind(...bindings(ctx,seasonId)).all<{kind:string;n:number}>();
 if(rows.results.some(r=>r.n>10000))throw scopeTooLarge();
}
async function sourceCaps(ctx:RequestContext,seasonId:string){
 await assignmentCaps(ctx,seasonId);
 const row=await ctx.env.DB.prepare(`WITH ${contextSql} SELECT (SELECT count(*) FROM (SELECT u.id ${scriptureFrom} LIMIT 5001)) AS scripture,
 (SELECT count(*) FROM (SELECT u.id ${scriptureFrom} ${personallyAssigned} UNION ALL SELECT unit.key ${introductionFrom} LIMIT 10001)) AS combined`).bind(...bindings(ctx,seasonId)).first<{scripture:number;combined:number}>();
 if(row!.scripture>5000||row!.combined>10000)throw scopeTooLarge();
}
const scriptureKey="'s:'||u.id",introKey="'i:'||intro.id||':'||printf('%010d',unit.key)";
const scriptureCapture=`json_object('source',json_object('id',json_extract(u.data,'$.id'),'contentPackId',json_extract(u.data,'$.contentPackId'),'sourceKind',CASE WHEN json_extract(p.data,'$.sourceType')='Scripture' THEN 'Scripture' ELSE 'Commentary' END,'bookKey',json_extract(u.data,'$.bookKey'),'chapter',json_extract(u.data,'$.chapter'),'verse',json_extract(u.data,'$.verse'),'ordinal',json_extract(u.data,'$.ordinal'),'citation',json_extract(u.data,'$.citation'),'canonicalText',json_extract(u.data,'$.canonicalText')),
 'guards',json_array(json_object('kind','source','id',u.id,'revision',u.revision),json_object('kind','pack','id',p.id,'revision',p.revision)))`;
const introCapture=`json_object('source',json_object('id',json_extract(unit.value,'$.id'),'contentPackId',intro.id,'sourceKind','Commentary','bookKey',json_extract(intro.data,'$.bookKey'),'chapter',NULL,'verse',NULL,'ordinal',unit.key+1,'citation',json_extract(unit.value,'$.citation'),'canonicalText',json_extract(unit.value,'$.canonicalText')),
 'guards',json_array(json_object('kind','pbe-introduction','id',intro.id,'revision',intro.revision)))`;
/** SQL returns at most 128 bounded payloads plus one scalar look-ahead; never whole source/intro bodies.
 * The engine can read more rows to evaluate eligibility, JSON arrays, counts and sorting. */
async function boundedPage<T>(ctx:RequestContext,sql:string,args:(string|number)[]):Promise<{items:T[];after:string|null}>{
 const result=await ctx.env.DB.prepare(`${sql}, sized AS (SELECT key,payload,row_number() OVER(ORDER BY key) AS position,sum(length(CAST(payload AS BLOB))) OVER(ORDER BY key) AS bytes FROM candidates)
 SELECT CASE WHEN length(CAST(key AS BLOB))<=4096 THEN key ELSE NULL END AS key,CASE WHEN position<=128 AND bytes<=${CHAPTER_PAGE_BYTES} THEN payload ELSE NULL END AS payload FROM sized ORDER BY key LIMIT 129`).bind(...args).all<{key:string|null;payload:string|null}>();
 const items:T[]=[];let after:string|null=null;
 for(const row of result.results){
  if(row.key===null)throw tooLarge();
  if(row.payload===null){if(!items.length)throw tooLarge();break;}
  const item=JSON.parse(row.payload) as T;
  if(utf8Bytes({items:[...items,item],after:row.key})>CHAPTER_PAGE_BYTES){if(!items.length)throw tooLarge();break;}
  items.push(item);after=row.key;
 }
 return {items,after:items.length===result.results.length?null:after};
}
function sourcePageSql(selected=false){
 const selectedScripture=selected?"AND json_extract(u.data,'$.id') IN (SELECT value FROM json_each((SELECT ids FROM selection)))":'';
 const selectedIntroduction=selected?"AND json_extract(unit.value,'$.id') IN (SELECT value FROM json_each((SELECT ids FROM selection)))":'';
 return `WITH ${contextSql}, cursor(value) AS (VALUES(?))${selected?', selection(ids) AS (VALUES(?))':''},
 scripture AS (SELECT ${scriptureKey} AS key,${scriptureCapture} AS payload ${scriptureFrom} ${personallyAssigned} AND u.id>(SELECT CASE WHEN substr(value,1,2)='s:' THEN substr(value,3) ELSE '' END FROM cursor) AND ${scriptureKey}>(SELECT value FROM cursor) ${selectedScripture} ORDER BY key LIMIT 129),
 introductions AS (SELECT ${introKey} AS key,${introCapture} AS payload ${introductionFrom} AND (SELECT substr(value,1,2) FROM cursor)!='s:' AND intro.id>=(SELECT CASE WHEN substr(value,1,2)='i:' THEN substr(value,3,length(value)-13) ELSE '' END FROM cursor) AND ${introKey}>(SELECT value FROM cursor) ${selectedIntroduction} ORDER BY key LIMIT 129),
 candidates AS (SELECT key,payload FROM scripture UNION ALL SELECT key,payload FROM introductions ORDER BY key LIMIT 129)`;
}
export async function chapterSourcePage(ctx:RequestContext,seasonId:string,after:string):Promise<ChapterSourcePage>{
 if(!after)await sourceCaps(ctx,seasonId);
 return boundedPage<ChapterSourceCapture>(ctx,sourcePageSql(),[...bindings(ctx,seasonId),after]);
}
export async function chapterAssignmentPage(ctx:RequestContext,seasonId:string,after:string):Promise<ChapterAssignmentPage>{
 if(!after)await assignmentCaps(ctx,seasonId);
 const boundary=after.indexOf(':'),kind=boundary<0?'':after.slice(0,boundary),id=boundary<0?'':after.slice(boundary+1);
 const family=(familyKind:string)=>`SELECT a.kind||':'||a.id AS key,json_object('guard',json_object('kind',a.kind,'id',a.id,'revision',a.revision),
 'tuple',json_array(a.kind,a.id,json_extract(a.data,'$.contentPackId'),json_extract(a.data,'$.bookKey'),json_extract(a.data,'$.startChapter'),json_extract(a.data,'$.startVerse'),json_extract(a.data,'$.endChapter'),json_extract(a.data,'$.endVerse')),
 'introductionGuard',CASE WHEN a.kind='pbe-introduction-assignment' THEN json_object('kind','pbe-introduction','id',json_extract(a.data,'$.contentPackId'),'revision',intro.revision) ELSE NULL END) AS payload
 FROM context c CROSS JOIN Records a INDEXED BY Records_training_scope LEFT JOIN Records intro ON a.kind='pbe-introduction-assignment' AND intro.kind='pbe-introduction' AND intro.org_id=c.org AND intro.id=json_extract(a.data,'$.contentPackId')
 WHERE a.org_id=c.org AND a.season_id=c.season AND a.owner_id=c.student AND a.kind='${familyKind}' AND '${familyKind}'>=(SELECT kind FROM cursor)
 AND a.id>(SELECT CASE WHEN kind='${familyKind}' THEN id ELSE '' END FROM cursor) ORDER BY a.id LIMIT 129`;
 return boundedPage<ChapterAssignmentCapture>(ctx,`WITH ${contextSql}, cursor(kind,id) AS (VALUES(?,?)),
 scriptureAssignments AS (${family('assignment')}),introductionAssignments AS (${family('pbe-introduction-assignment')}),
 candidates AS (SELECT key,payload FROM scriptureAssignments UNION ALL SELECT key,payload FROM introductionAssignments ORDER BY key LIMIT 129)`,[...bindings(ctx,seasonId),kind,id]);
}
/** Narrow current eligible reread for server-owned bank candidates; partial results indicate revoked/missing sources. */
export async function chapterSelectedSources(ctx:RequestContext,seasonId:string,ids:string[]):Promise<PbeSource[]>{
 if(ids.length>128||utf8Bytes(ids)>CHAPTER_PAGE_BYTES)throw tooLarge();
 if(!ids.length)return [];
 const page=await boundedPage<ChapterSourceCapture>(ctx,sourcePageSql(true),[...bindings(ctx,seasonId),'',JSON.stringify(ids)]);
 if(page.after!==null)throw tooLarge();
 return page.items.map(x=>x.source);
}
