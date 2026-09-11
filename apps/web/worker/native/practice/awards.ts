import type {Room} from "./state";
import {points} from "./scoring";
export interface Award {key:string;title:string;seasonId:string;userId:string}
export function calculateAwards(rooms:Room[]):Award[]{
 const result:Award[]=[];const complete=rooms.filter(r=>r.status==="Completed"&&r.submissions.every(s=>s.resolved));
 for(const seasonId of new Set(complete.map(r=>r.seasonId)))for(const userId of new Set(complete.filter(r=>r.seasonId===seasonId).flatMap(r=>r.members.map(m=>m.userId)))){
  const played=complete.filter(r=>r.seasonId===seasonId&&r.members.some(m=>m.userId===userId));const award=(key:string,title:string)=>result.push({key,title,seasonId,userId});
  award("first-fellowship","First Fellowship");
  if(played.length>=10&&new Set(played.map(r=>r.completedAt!.slice(0,10))).size>=3)award("team-steady","Team Steady");
  if(new Set(played.flatMap(r=>r.submissions.filter(s=>s.scribeId===userId&&!s.deadlineDraft).map(s=>s.questionId))).size>=10)award("shared-scribe","Shared Scribe");
  const distinct=new Map<string,{earned:number;available:number}>();for(const r of played)for(const s of r.submissions.filter(s=>s.team===r.members.find(m=>m.userId===userId)!.team))if(!distinct.has(s.questionId))distinct.set(s.questionId,{earned:s.accuracyHundredths,available:points(r.questions.find(q=>q.id===s.questionId)!)*100});
  if(distinct.size>=30&&[...distinct.values()].reduce((n,x)=>n+x.earned,0)*10>=[...distinct.values()].reduce((n,x)=>n+x.available,0)*9)award("team-precision","Team Precision");
  if(played.some(r=>r.coached&&r.questionCount===90))award("rehearsal-complete","Rehearsal Complete");
 }return result;
}
export function trends(rooms:Room[],userId:string){
 const groups=new Map<string,Room[]>();for(const r of rooms.filter(r=>r.status==="Completed"&&r.submissions.every(s=>s.resolved)&&r.members.some(m=>m.userId===userId))){const key=JSON.stringify([r.seasonId,r.teamSize,r.bookKey]);groups.set(key,[...(groups.get(key)??[]),r]);}
 return [...groups.values()].map(group=>{let accuracyHundredths=0,speedHundredths=0,availableHundredths=0,wins=0,draws=0,unansweredQuestions=0,totalMs=0,timed=0;const qs=new Set<string>(),ps=new Set<string>(),participated=new Set<string>();for(const r of group){const team=r.members.find(m=>m.userId===userId)!.team;const totals=[1,2].map(t=>r.submissions.filter(s=>s.team===t).reduce((n,s)=>n+s.accuracyHundredths+s.speedHundredths,0));if(totals[0]===totals[1])draws++;else if(totals[team-1]>totals[2-team])wins++;for(const s of r.submissions.filter(s=>s.team===team)){accuracyHundredths+=s.accuracyHundredths;speedHundredths+=s.speedHundredths;const q=r.questions.find(q=>q.id===s.questionId)!;availableHundredths+=points(q)*100;qs.add(q.id);ps.add(q.sourceUnitId);if(s.answers.every(a=>!a.trim()))unansweredQuestions++;if(!s.deadlineDraft){totalMs+=s.elapsedMs;timed++;}}r.contributions.filter(c=>c.userId===userId).forEach(c=>participated.add(c.questionId));}return{seasonId:group[0].seasonId,teamSize:group[0].teamSize,bookKey:group[0].bookKey??null,ruleVersion:"ERUDOZA_PBE_PVP_2023_24_V1",matches:group.length,wins,draws,accuracyHundredths,speedHundredths,availableHundredths,unansweredQuestions,averageResponseMs:timed?totalMs/timed:0,distinctQuestions:qs.size,distinctPassages:ps.size,participatedQuestions:participated.size};});
}
