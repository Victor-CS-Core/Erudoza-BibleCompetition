import type {RequestContext} from '../types';
import {HttpError} from '../types';
import {builtInContentSql,scopeEntriesSql} from '../application/library-access';
import {rangeSql} from '../application/model';
import type {D1PreparedStatement} from '@cloudflare/workers-types';
export const CHAPTER_PAGE_BYTES=65536, CHAPTER_STAGE_BYTES=16*1024*1024;
export const utf8Bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
export async function chapterHash(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function chapterTextHash(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export interface InputGuard {kind:string;id:string;revision:number|null;ownerId?:string|null}
export interface ManifestPage {id:string;generationId:string;family:string;ordinal:number;entries:unknown[];bytes:number;hash:string}
export function manifestEntriesSql(alias:string,family:string){return `SELECT e.value FROM Records ${alias} INDEXED BY Records_training_scope JOIN json_each(${alias}.data,'$.entries') e WHERE ${alias}.org_id=? AND ${alias}.season_id=? AND ${alias}.owner_id=? AND ${alias}.kind='pbe-chapter-manifest' AND json_extract(${alias}.data,'$.generationId')=? AND json_extract(${alias}.data,'$.family')='${family}'`;}
export async function manifestPage(ctx:RequestContext,seasonId:string,generationId:string,family:string,ordinal:number,entries:unknown[]):Promise<{page:ManifestPage;statement:D1PreparedStatement}>{
 const id=`${generationId}:${family}:${String(ordinal).padStart(6,'0')}`,hash=await chapterHash(entries),page={id,generationId,family,ordinal,entries,bytes:0,hash};let measured=utf8Bytes(page);while(page.bytes!==measured){page.bytes=measured;measured=utf8Bytes(page);}
 if(page.bytes>CHAPTER_PAGE_BYTES||entries.length>128)throw new HttpError(413,'PBE_CHAPTER_INPUT_TOO_LARGE');
 return {page,statement:ctx.store.insertion('pbe-chapter-manifest',id,ctx.orgId,page,{seasonId,ownerId:ctx.actor.userId})};
}
/** Exact source predicate shares range and built-in-library authorization with the personal resolver. */
function currentSourceSql(){return `SELECT DISTINCT u.id FROM Records sc JOIN json_each(${scopeEntriesSql('sc')}) selected
 JOIN Records p ON p.kind='pack' AND p.id=json_extract(selected.value,'$.contentPackId') AND (p.org_id=sc.org_id OR ${builtInContentSql('p')})
 JOIN Records u INDEXED BY Records_owner ON u.kind='source' AND u.owner_id=p.id AND u.org_id=p.org_id
 WHERE sc.org_id=? AND sc.kind='scope' AND sc.id=? AND json_extract(p.data,'$.isActive')=1 AND lower(json_extract(p.data,'$.licensingStatus')) IN ('development-sample','public-domain','approved','creative-commons')
 AND json_extract(u.data,'$.isActive')=1 AND coalesce(json_extract(u.data,'$.isRetired'),0)=0
 AND EXISTS(SELECT 1 FROM json_each(selected.value,'$.includes') inc WHERE ${rangeSql('inc')}) AND NOT EXISTS(SELECT 1 FROM json_each(selected.value,'$.excludes') exc WHERE ${rangeSql('exc')})
 AND EXISTS(SELECT 1 FROM Records ass JOIN json_each(json_array(json(ass.data))) ar WHERE ass.kind='assignment' AND ass.org_id=sc.org_id AND ass.season_id=sc.id AND ass.owner_id=? AND json_extract(ass.data,'$.contentPackId')=p.id AND ${rangeSql('ar')})
 UNION SELECT json_extract(unit.value,'$.id') FROM Records intro JOIN json_each(intro.data,'$.units') unit
 WHERE intro.kind='pbe-introduction' AND json_extract(intro.data,'$.organizationId')=intro.org_id AND json_extract(intro.data,'$.seasonId')=intro.season_id AND intro.org_id=? AND intro.season_id=? AND json_extract(intro.data,'$.reviewed')=1 AND json_extract(intro.data,'$.licensingStatus') IN ('approved','public-domain','creative-commons')
 AND EXISTS(SELECT 1 FROM Records a WHERE a.kind='pbe-introduction-assignment' AND a.org_id=intro.org_id AND a.season_id=intro.season_id AND a.owner_id=? AND json_extract(a.data,'$.contentPackId')=intro.id)
 AND EXISTS(SELECT 1 FROM Records sc JOIN json_each(${scopeEntriesSql('sc')}) selected JOIN json_each(selected.value,'$.includes') inc WHERE sc.org_id=intro.org_id AND sc.kind='scope' AND sc.id=intro.season_id AND upper(json_extract(inc.value,'$.bookKey'))=json_extract(intro.data,'$.bookKey'))
 AND EXISTS(SELECT 1 FROM Records m WHERE m.org_id=intro.org_id AND m.kind='membership' AND m.season_id=intro.season_id AND m.id=intro.season_id||':'||? AND m.owner_id=substr(m.id,length(intro.season_id)+2) )`;}
/** One indexed atomic set comparison; only small ownership/generation identifiers are bound. */
export function chapterInputGuard(ctx:RequestContext,seasonId:string,generationId:string,expectedPages:number, targetFamily?:string,readOnly=false):D1PreparedStatement{
 const owner=ctx.actor.userId,org=ctx.orgId,bindings:unknown[]=[];
 const entries=(family:string)=>{bindings.push(org,seasonId,owner,generationId);return manifestEntriesSql(`m${bindings.length}`,family);};
 const guards=entries('guards'),sources=entries('sources'),targets=entries('targets'),heads=entries('heads');
 bindings.push(org,seasonId,owner,org,seasonId,owner,owner);
 const current=currentSourceSql();
 const evidence=targetFamily?entries(targetFamily):"SELECT null AS value WHERE false";
 const sql=`WITH guardInputs AS (${guards}),sourceInputs AS (${sources}),targetInputs AS (${targets}),headInputs AS (${heads}),currentSources AS (${current}),evidenceInputs AS (${evidence}),
 assignmentGuards AS (SELECT value FROM guardInputs UNION ALL SELECT json_extract(value,'$.introductionGuard') FROM guardInputs WHERE json_type(value,'$.introductionGuard')='object'),
 allGuards AS (SELECT value FROM assignmentGuards UNION ALL SELECT g.value FROM sourceInputs s JOIN json_each(s.value,'$.guards') g UNION ALL SELECT json_extract(value,'$.guard') FROM targetInputs UNION ALL SELECT json_extract(value,'$.guard') FROM headInputs UNION ALL SELECT value FROM evidenceInputs)
 ${readOnly?'SELECT CASE WHEN':"INSERT INTO Records(kind,id,org_id,data) SELECT 'audit',?,?,CASE WHEN"}
 (SELECT count(*) FROM Records WHERE kind='pbe-chapter-manifest' AND org_id=? AND season_id=? AND owner_id=? AND json_extract(data,'$.generationId')=?)=?
 AND NOT EXISTS(SELECT 1 FROM allGuards g WHERE CASE WHEN json_extract(g.value,'$.kind') LIKE '@active-%' THEN
 NOT EXISTS(SELECT 1 FROM Users u WHERE u.org_id=? AND u.id=json_extract(g.value,'$.id') AND u.active=1 AND u.kind='Student' AND u.role='Student')
 WHEN json_extract(g.value,'$.revision') IS NULL THEN EXISTS(SELECT 1 FROM Records r WHERE r.org_id=? AND r.kind=json_extract(g.value,'$.kind') AND r.id=json_extract(g.value,'$.id'))
 ELSE NOT EXISTS(SELECT 1 FROM Records r WHERE (r.org_id=? OR ${builtInContentSql('r')}) AND r.kind=json_extract(g.value,'$.kind') AND r.id=json_extract(g.value,'$.id') AND r.revision=json_extract(g.value,'$.revision')) END)
 AND NOT EXISTS(SELECT id FROM currentSources EXCEPT SELECT json_extract(value,'$.id') FROM sourceInputs)
 AND NOT EXISTS(SELECT json_extract(value,'$.id') FROM sourceInputs EXCEPT SELECT id FROM currentSources)
 AND (SELECT count(*) FROM Records r WHERE r.org_id=? AND r.season_id=? AND r.owner_id=? AND r.kind IN ('assignment','pbe-introduction-assignment'))=(SELECT count(*) FROM guardInputs WHERE json_extract(value,'$.kind') IN ('assignment','pbe-introduction-assignment'))
 AND (SELECT count(*) FROM Records r WHERE r.org_id=? AND r.season_id=? AND r.kind='pbe-target' AND r.owner_id IN (SELECT id FROM currentSources))=(SELECT count(*) FROM targetInputs)
 AND (SELECT count(*) FROM Records r WHERE r.org_id=? AND r.season_id=? AND r.kind='pbe-question-head' AND r.owner_id IN (SELECT id FROM currentSources))=(SELECT count(*) FROM headInputs)
 ${readOnly?'THEN 1 ELSE 0 END AS valid':"THEN ? ELSE 'invalid-json' END"}`;
 const auditId=crypto.randomUUID();if(!readOnly)bindings.push(auditId,org);bindings.push(org,seasonId,owner,generationId,expectedPages,org,org,org,org,seasonId,owner,org,seasonId,org,seasonId);if(!readOnly)bindings.push(JSON.stringify({id:auditId,action:'pbe.chapter.inputs'}));
 return ctx.env.DB.prepare(sql).bind(...bindings);
}
/** Seal staged original witnesses against exactly the guarded parent target membership. */
export function chapterWitnessGuard(ctx:RequestContext,seasonId:string,generationId:string,family:string,chapterKey:string,targetCount:number,pageCount:number){
 const org=ctx.orgId,owner=ctx.actor.userId,id=crypto.randomUUID();
 return ctx.env.DB.prepare(`WITH pages AS (SELECT data,revision FROM Records INDEXED BY Records_training_scope WHERE org_id=? AND season_id=? AND owner_id=? AND kind='pbe-chapter-stamp-proof' AND json_extract(data,'$.generationId')=? AND json_extract(data,'$.family')=?),
 proofs AS (SELECT e.value FROM pages JOIN json_each(pages.data,'$.entries') e),
 states AS (SELECT e.value FROM Records m INDEXED BY Records_training_scope JOIN json_each(m.data,'$.entries') e WHERE m.org_id=? AND m.season_id=? AND m.owner_id=? AND m.kind='pbe-chapter-manifest' AND json_extract(m.data,'$.generationId')=? AND json_extract(m.data,'$.family')='retentions'),
 sources AS (SELECT json_extract(e.value,'$.id') AS id FROM Records m INDEXED BY Records_training_scope JOIN json_each(m.data,'$.entries') e WHERE m.org_id=? AND m.season_id=? AND m.owner_id=? AND m.kind='pbe-chapter-manifest' AND json_extract(m.data,'$.generationId')=? AND json_extract(m.data,'$.family')='sources' AND json_extract(e.value,'$.parentKey')=?),
 targets AS (SELECT json_extract(e.value,'$.target.id') AS id FROM Records m INDEXED BY Records_training_scope JOIN json_each(m.data,'$.entries') e WHERE m.org_id=? AND m.season_id=? AND m.owner_id=? AND m.kind='pbe-chapter-manifest' AND json_extract(m.data,'$.generationId')=? AND json_extract(m.data,'$.family')='targets' AND json_type(e.value,'$.target')='object' AND EXISTS(SELECT 1 FROM json_each(e.value,'$.target.sourceUnitIds') unit WHERE unit.value IN (SELECT id FROM sources)))
 INSERT INTO Records(kind,id,org_id,data) SELECT 'audit',?,?,CASE WHEN NOT EXISTS(SELECT 1 FROM pages WHERE revision<>1) AND (SELECT count(*) FROM pages)=? AND (SELECT count(*) FROM proofs)=? AND (SELECT count(DISTINCT json_extract(value,'$.targetId')) FROM proofs)=? AND (SELECT count(*) FROM targets)=?
 AND NOT EXISTS(SELECT 1 FROM proofs p WHERE json_array_length(p.value,'$.witness')<>2 OR json_extract(p.value,'$.targetId') NOT IN (SELECT id FROM targets) OR NOT EXISTS(SELECT 1 FROM states s WHERE json_extract(s.value,'$.targetId')=json_extract(p.value,'$.targetId') AND json_extract(s.value,'$.projection.retention.witness')=json_extract(p.value,'$.witness')))
 THEN ? ELSE 'invalid-json' END`).bind(org,seasonId,owner,generationId,family,org,seasonId,owner,generationId,org,seasonId,owner,generationId,chapterKey,org,seasonId,owner,generationId,id,org,pageCount,targetCount,targetCount,targetCount,JSON.stringify({id,action:'pbe.chapter.witnesses'}));
}
