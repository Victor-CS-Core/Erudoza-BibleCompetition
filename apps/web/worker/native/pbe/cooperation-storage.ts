import type {RequestContext} from '../types';
import {HttpError} from '../types';
import {chapterHash,utf8Bytes,type InputGuard} from './chapter-manifest';
import type {CooperationStudentSummary,CooperationSnapshot} from '../../../src/api/pbeTypes';
export const COOPERATION_RULE='pbe-cooperation-v1';
// Reserve 16 of the whole-step 128 returned rows for auth, work and scalar reads.
export const COOPERATION_STEP_ROWS=112;
export const COOPERATION_BYTES=32*1024*1024,COOPERATION_GUARD_BYTES=16*1024*1024;
export type CooperationReason=CooperationSnapshot['reason'];
export type RosterMember={studentId:string;displayName:string;membershipRevision:number};
export type SubjectDescriptor={studentId:string;generationId:string|null;scopeVersion:string|null;availability:'Known'|'Unknown'|'Unassigned';reason:CooperationStudentSummary['reason'];pointerRevision:number|null;pageCount:number;complete:boolean};
export type CooperationWork={schemaVersion:1;ruleVersion:string;workId:string;seasonId:string;stage:'Sources'|'Assignments'|'Generation'|'CurrentGuards'|'D1Guards'|'Facts'|'Publishing'|'Complete'|'Blocked';subjectIndex:number;after:string;pageCount:number;bytes:number;guardBytes:number;roster:RosterMember[];descriptors:SubjectDescriptor[];baseGuards:InputGuard[];publishedId:string|null;abandonedId:string|null;reason:CooperationReason};
export type CooperationPage={id:string;generationId:string;family:string;ordinal:number;entries:unknown[];bytes:number;hash:string};
export type GuardEntry=InputGuard&{studentId:string};
export type AssignedSource={studentId:string;sourceKind:'Scripture'|'Commentary';contentPackId:string;sourceUnitId:string;guards:InputGuard[]};
export type SavedSourceFacts=Omit<AssignedSource,'guards'>&{questionCovered:boolean|null;practiced:boolean|null;recalled:boolean|null;retained:boolean|null;dueKnown:boolean;unresolved:boolean|null;scheduledAtMs:number|null};
export type SavedCooperationSnapshot={id:string;generationId:string;pageCount:number;scopeVersion:string;checkedAtUtc:string;dueRefreshAtUtc:string;rosterStudents:number;unknownStudents:number;scripture:NonNullable<CooperationSnapshot['scripture']>;introduction:NonNullable<CooperationSnapshot['introduction']>};
export const cooperationTooLarge=(input=false)=>new HttpError(413,input?'PBE_COOPERATION_INPUT_TOO_LARGE':'PBE_COOPERATION_SCOPE_TOO_LARGE');
export const cooperationStale=()=>new HttpError(409,'PBE_COOPERATION_WORK_STALE');
export function entriesSql(family:string){return `SELECT e.value FROM Records m INDEXED BY Records_training_scope JOIN json_each(m.data,'$.entries') e WHERE m.kind='pbe-cooperation-manifest' AND m.org_id=(SELECT org FROM context LIMIT 1) AND m.season_id=(SELECT season FROM context LIMIT 1) AND m.owner_id IS NULL AND json_extract(m.data,'$.generationId')=(SELECT generation FROM meta) AND json_extract(m.data,'$.family')='${family}'`;}
export const cooperationPageBudget=(w:CooperationWork)=>62000-utf8Bytes(w);
/** A whole-page SQL prefix, with room reserved for envelope and work cursor metadata. */
export async function cooperationPage<T>(ctx:RequestContext,sql:string,args:(string|number|null)[],budget=48000):Promise<T[]>{
 const result=await ctx.env.DB.prepare(`WITH candidates AS (${sql}),sized AS(SELECT key,payload,row_number() OVER(ORDER BY key) AS position,sum(length(CAST(json_quote(payload) AS BLOB))+32) OVER(ORDER BY key) AS bytes FROM candidates) SELECT CASE WHEN bytes<=${Math.max(1,Math.min(62000,Math.floor(budget)))} THEN payload END AS payload FROM sized WHERE bytes<=${Math.max(1,Math.min(62000,Math.floor(budget)))} OR position=1 ORDER BY key LIMIT ${COOPERATION_STEP_ROWS}`).bind(...args).all<{payload:string|null}>();
 if(result.results.some(r=>r.payload===null))throw cooperationTooLarge(true);
 return result.results.map(r=>JSON.parse(r.payload!) as T);
}
export async function prepareCooperationPage(ctx:RequestContext,w:CooperationWork,family:string,entries:unknown[],guards=false){
 const ordinal=w.pageCount,id=`${w.workId}:${family}:${String(ordinal).padStart(6,'0')}`;
 const page:CooperationPage={id,generationId:w.workId,family,ordinal,entries,bytes:0,hash:await chapterHash(entries)};
 let bytes=utf8Bytes(page);while(page.bytes!==bytes){page.bytes=bytes;bytes=utf8Bytes(page);}
 if(entries.length>128||bytes>65536||w.bytes+bytes>COOPERATION_BYTES||guards&&w.guardBytes+bytes>COOPERATION_GUARD_BYTES)throw cooperationTooLarge(true);
 w.pageCount++;w.bytes+=bytes;if(guards)w.guardBytes+=bytes;
 return ctx.store.insertion('pbe-cooperation-manifest',id,ctx.orgId,page,{seasonId:w.seasonId});
}
