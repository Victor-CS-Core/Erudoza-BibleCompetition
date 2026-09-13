import type {RoomStats} from './room-history';
import type {Env} from '../types';
import {points} from './scoring';
const honorId=(org:string,user:string,key:string)=>`${org}:${user}:simulation-v1:${key}`;
export const simulationCatalog=[
 {key:'simulation:first-rehearsal',title:'First Rehearsal',category:'Simulation',requirement:'Complete one simulation.',target:1},
 {key:'simulation:event-ready',title:'Event Ready',category:'Simulation',requirement:'Complete a 90-question Full Event at standard time with halftime and two readings.',target:1},
 {key:'simulation:steady-team',title:'Steady Team',category:'Simulation',requirement:'Complete five simulations across at least three UTC dates.',target:5},
 {key:'simulation:trusted-scribe',title:'Trusted Scribe',category:'Simulation',requirement:'Explicitly submit answers to 30 distinct questions as scribe in completed simulations.',target:30},
 {key:'simulation:team-precision',title:'Team Precision',category:'Simulation',requirement:'Resolve at least 30 distinct questions with aggregate team accuracy of at least 90%; latest results count and none may be pending.',target:30},
] as const;
export function simulationAchievements(rooms:RoomStats[],orgId:string,userId:string,seasons:string[]){
 return seasons.flatMap(seasonId=>{
  const completed=rooms.filter(r=>r.orgId===orgId&&r.seasonId===seasonId&&r.format==='Pbe'&&r.teamCount===1&&r.simulation?.version===1&&r.status==='Completed'&&r.completedAt&&Number.isFinite(Date.parse(r.completedAt))&&r.members.some(m=>m.userId===userId)&&r.questions.length===r.questionCount&&r.questions.every(q=>r.services?.some(s=>s.questionId===q.id&&s.memberIds.includes(userId)))).sort((a,b)=>Date.parse(b.completedAt!)-Date.parse(a.completedAt!)||b.id.localeCompare(a.id));
  const full=completed.filter(r=>r.questionCount===90&&r.simulation!.preset==='FullEvent'&&r.simulation!.timeMultiplier===1&&r.simulation!.halfTime);
  const manual=new Set(completed.flatMap(r=>r.submissions.filter(s=>s.scribeId===userId&&!s.deadlineDraft).map(s=>s.questionId)));
  const distinct=new Map<string,{earned:number;available:number;resolved:boolean;timestamp:number;roomId:string}>();
  for(const r of completed)for(const s of r.submissions.filter(s=>s.team===r.members.find(m=>m.userId===userId)!.team)){const q=r.questions.find(q=>q.id===s.questionId);const timestamp=s.responseLockedAtMs??Date.parse(r.completedAt!),old=distinct.get(s.questionId);if(q&&(!old||timestamp>old.timestamp||timestamp===old.timestamp&&r.id.localeCompare(old.roomId)>0))distinct.set(s.questionId,{earned:s.accuracyHundredths,available:points(q)*100,resolved:s.resolved&&s.dispute?.status!=='Pending',timestamp,roomId:r.id});}
  const values=[...distinct.values()],final=values.filter(x=>x.resolved),available=final.reduce((n,x)=>n+x.available,0),earned=final.reduce((n,x)=>n+x.earned,0),dates=new Set(completed.map(r=>new Date(r.completedAt!).toISOString().slice(0,10))).size;
  const counts=[completed.length,full.length,completed.length,manual.size,final.length];
  const eligible=[completed.length>0,full.length>0,completed.length>=5&&dates>=3,manual.size>=30,final.length===values.length&&final.length>=30&&available>0&&earned*10>=available*9];
  return simulationCatalog.map((h,i)=>({...h,seasonId,current:counts[i],earnedAtUtc:eligible[i]?(i===0?completed.at(-1)!.completedAt!:i===1?full.at(-1)!.completedAt!:completed[0].completedAt!):null,...(i===2?{distinctDays:dates}:{}),...(i===4?{accuracyPercent:available?earned/available*100:0,pendingCount:values.length-final.length}:{})}));
 });
}
/** Reconciled season evidence is replaceable; the original earned unlock stays immutable. */
export function simulationHonorStatements(db:Env['DB'],orgId:string,seasonId:string,rooms:RoomStats[]){
 const users=[...new Set(rooms.flatMap(r=>r.members.map(m=>m.userId)))];
 const evidence=users.flatMap(userId=>simulationAchievements(rooms,orgId,userId,[seasonId]).map(a=>({id:`${honorId(orgId,userId,a.key)}:${seasonId}`,unlockId:honorId(orgId,userId,a.key),userId,seasonId,key:a.key,ruleVersion:'simulation-v1',earnedAtUtc:a.earnedAtUtc,eligible:a.earnedAtUtc!==null,current:a.current,roomIds:rooms.filter(r=>r.simulation&&r.status==='Completed'&&r.members.some(m=>m.userId===userId)).map(r=>r.id).sort()})));
 const awards=evidence.filter(e=>e.eligible).map(e=>({...e,id:e.unlockId,evidence:{seasonEvidenceId:e.id,roomIds:e.roomIds}}));
 return [db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) SELECT 'simulation-eligibility',json_extract(value,'$.id'),?,json_extract(value,'$.seasonId'),json_extract(value,'$.userId'),value,1 FROM json_each(?) WHERE true ON CONFLICT(kind,id,org_id) DO UPDATE SET data=excluded.data,revision=Records.revision+1 WHERE Records.data<>excluded.data").bind(orgId,JSON.stringify(evidence)),db.prepare("INSERT OR IGNORE INTO Records(kind,id,org_id,season_id,owner_id,data,revision) SELECT 'mastery-honor',json_extract(value,'$.id'),?,json_extract(value,'$.seasonId'),json_extract(value,'$.userId'),value,1 FROM json_each(?)").bind(orgId,JSON.stringify(awards))];
}
