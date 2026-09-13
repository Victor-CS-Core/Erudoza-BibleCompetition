import type {RequestContext} from '../types';
import {HttpError} from '../types';
import type {Room} from './state';
import {validRoomSet} from './state';
import type {PbeQuestion} from '../pbe/types';
import {resolvePbeRoomSources} from '../pbe/sources';
import {loadFromResolvedSources,sourceProof} from '../pbe/bank';
import {selectPbeQuestions} from '../pbe/selection';
import {filterSimulationSources} from './simulation';
import {contains,type Assignment} from '../application/model';
import {atomic} from '../application/model';

export function selectRoomQuestions(bank:PbeQuestion[],served:Map<string,number>,seed:string,count:number):PbeQuestion[]{
 const selected=selectPbeQuestions({sessionId:seed,count,mode:'Simulation',usedQuestionIds:[],usedTargetIds:[],trueFalseMaxRatio:.1,candidates:bank.map(q=>({questionId:q.id,targetIds:[],sourceUnitIds:q.sourceUnitIds,sourceKind:q.sourceKind,kind:q.kind,servedCount:served.get(q.id)??0,targetServedCount:served.get(q.id)??0,lastServedAtMs:null,due:false,repairEligible:false}))});
 if(selected.length!==count)throw new HttpError(400,`This scope needs ${count} eligible questions; ${selected.length} satisfy the final-set quotas (${bank.length} in the bank).`);
 const chosen=selected.map(id=>bank.find(q=>q.id===id)!);
 const reserves=bank.filter(q=>!selected.includes(q.id)&&chosen.some((_,i)=>validRoomSet(chosen.map((old,n)=>i===n?q:old),count)));
 if(!reserves.length)throw new HttpError(400,`This scope needs ${count} questions plus a distinct eligible recovery reserve; ${bank.length} are available.`);
 return [...chosen,reserves[0]];
}
export async function authorizePbeRoom(ctx:RequestContext,r:Room,starting=false,unfiltered=false){
 const scope=await resolvePbeRoomSources(ctx,r,!starting&&r.status!=='Lobby');
 if(r.simulation){
  const rows=await ctx.env.DB.prepare("SELECT kind,id,data,revision FROM Records WHERE org_id=? AND season_id=? AND owner_id IN (SELECT value FROM json_each(?)) AND kind IN ('assignment','pbe-introduction-assignment') LIMIT 10001").bind(ctx.orgId,r.seasonId,JSON.stringify(r.members.map(m=>m.userId))).all<{kind:string;id:string;data:string;revision:number}>();
  if(rows.results.length>10000)throw new HttpError(413,'Simulation assignment scope is too large.');
  const assignments=rows.results.filter(x=>x.kind==='assignment').map(x=>JSON.parse(x.data) as Assignment),intros=new Set(rows.results.filter(x=>x.kind==='pbe-introduction-assignment').map(x=>(JSON.parse(x.data) as {contentPackId:string}).contentPackId));
  scope.sources=scope.sources.filter(s=>s.chapter===null?intros.has(s.contentPackId):assignments.some(a=>a.contentPackId===s.contentPackId&&contains(a,{...s,chapter:s.chapter!,verse:s.verse!,isActive:true})));
  if(!unfiltered)scope.sources=filterSimulationSources(scope.sources,r.simulation);scope.guards.push(...rows.results.map(({kind,id,revision})=>({kind,id,revision})));
 }
 if(r.bookKey)scope.sources=scope.sources.filter(s=>s.bookKey===r.bookKey);
 if(!starting&&r.questions.length){const sources=new Map(scope.sources.map(s=>[s.id,s]));for(const q of r.questions as PbeQuestion[]){if(q.sourceUnitIds.some(id=>!sources.has(id))||await sourceProof(q,sources)!==r.sourceProofs?.[q.id])throw new HttpError(403,'Saved room material is no longer approved for this season.');}}
 await atomic(ctx,'practice.pbe.authorize',[],scope.guards);
 const eligibleReserveIds=await eligibleRoomReserves(r,new Map(scope.sources.map(s=>[s.id,s])));
 return {...scope,eligibleReserveIds};
}
export function selectPbeRoomBank(ctx:RequestContext,r:Room):Promise<PbeQuestion[]>;
export function selectPbeRoomBank(ctx:RequestContext,r:Room,availability:true):Promise<{eligibleQuestions:number;requestedQuestions:number;canStart:boolean;reason:string|null}>;
export async function selectPbeRoomBank(ctx:RequestContext,r:Room,availability=false){
 const scope=await authorizePbeRoom(ctx,r,true);
 const bank=await loadFromResolvedSources(ctx,{organizationId:ctx.orgId,seasonId:r.seasonId,sourceUnitIds:scope.sources.map(s=>s.id)},scope,true);
 const rows=await ctx.env.DB.prepare("SELECT json_extract(data,'$.subjectId') AS questionId,MAX(json_extract(data,'$.servedCount')) AS served FROM Records INDEXED BY Records_training_scope WHERE org_id=? AND season_id=? AND kind='pbe-question-service' AND owner_id IN (SELECT value FROM json_each(?)) AND json_extract(data,'$.subjectId') IN (SELECT value FROM json_each(?)) GROUP BY json_extract(data,'$.subjectId')").bind(ctx.orgId,r.seasonId,JSON.stringify(r.members.map(m=>m.userId)),JSON.stringify(bank.questions.map(q=>q.id))).all<{questionId:string;served:number}>();
 let selected:PbeQuestion[];try{selected=selectRoomQuestions(bank.questions,new Map(rows.results.map(row=>[row.questionId,row.served])),r.selectionSeed!,r.questionCount);}catch(error){if(availability&&error instanceof HttpError&&error.status===400)return {eligibleQuestions:bank.questions.length,requestedQuestions:r.questionCount,canStart:false,reason:error.message};throw error;}
 if(availability)return {eligibleQuestions:bank.questions.length,requestedQuestions:r.questionCount,canStart:true,reason:null};
 const sources=new Map(scope.sources.map(s=>[s.id,s]));r.sourceProofs=Object.fromEntries(await Promise.all(selected.map(async q=>[q.id,await sourceProof(q,sources)])));
 await atomic(ctx,'practice.pbe.select',[],scope.guards);
 return selected;
}

/** A room event is atomically projected to every participant; retries do not count a second exposure. */
export function roomExposureStatements(db:RequestContext['env']['DB'],r:Room){
 const events=r.services??[];
 const pending=JSON.stringify(events);
 const statements=[];
 for(const kind of ['pbe-question-service','pbe-target-service']){
  const rows=events.flatMap(event=>event.memberIds.flatMap(owner=>(kind==='pbe-question-service'?[event.questionId]:event.targetIds).map(subjectId=>({id:`${owner}:${r.seasonId}:${subjectId}`,owner,subjectId,eventId:event.id,lastServedAtMs:event.atMs,lastQuestionId:event.questionId,lastQuestionKind:event.questionKind}))));
  statements.push(db.prepare(`INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision)
   SELECT ?,json_extract(value,'$.id'),?,?,json_extract(value,'$.owner'),json_object('id',json_extract(value,'$.id'),'subjectId',json_extract(value,'$.subjectId'),'servedCount',1,'lastServedAtMs',json_extract(value,'$.lastServedAtMs'),'lastQuestionId',json_extract(value,'$.lastQuestionId'),'lastQuestionKind',json_extract(value,'$.lastQuestionKind')),1
   FROM json_each(?) WHERE NOT EXISTS(SELECT 1 FROM Records e WHERE e.kind='pbe-room-service-event' AND e.id=json_extract(value,'$.eventId') AND e.org_id=?)
   ON CONFLICT(kind,id,org_id) DO UPDATE SET data=json_set(Records.data,'$.servedCount',json_extract(Records.data,'$.servedCount')+1,'$.lastServedAtMs',max(json_extract(Records.data,'$.lastServedAtMs'),json_extract(excluded.data,'$.lastServedAtMs')),'$.lastQuestionId',CASE WHEN json_extract(excluded.data,'$.lastServedAtMs')>=json_extract(Records.data,'$.lastServedAtMs') THEN json_extract(excluded.data,'$.lastQuestionId') ELSE json_extract(Records.data,'$.lastQuestionId') END,'$.lastQuestionKind',CASE WHEN json_extract(excluded.data,'$.lastServedAtMs')>=json_extract(Records.data,'$.lastServedAtMs') THEN json_extract(excluded.data,'$.lastQuestionKind') ELSE json_extract(Records.data,'$.lastQuestionKind') END),revision=Records.revision+1`).bind(kind,r.orgId,r.seasonId,JSON.stringify(rows),r.orgId));
 }
 statements.push(db.prepare("INSERT INTO Records(kind,id,org_id,season_id,data) SELECT 'pbe-room-service-event',json_extract(value,'$.id'),?,?,value FROM json_each(?) WHERE true ON CONFLICT(kind,id,org_id) DO NOTHING").bind(r.orgId,r.seasonId,pending));
 return statements;
}

export async function eligibleRoomReserves(r:Room,sources:Parameters<typeof sourceProof>[1]){
 const eligible=new Set<string>();for(const q of r.reserves as PbeQuestion[]){try{if(q.sourceUnitIds.every(id=>sources.has(id))&&await sourceProof(q,sources)===r.sourceProofs?.[q.id])eligible.add(q.id);}catch(error){if(!(error instanceof HttpError)||error.status!==400)throw error;}}return eligible;
}
