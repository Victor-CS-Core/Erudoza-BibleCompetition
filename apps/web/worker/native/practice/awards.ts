import type {RoomStats} from "./room-history";
import {points} from "./scoring";
export interface Award {key:string;title:string;seasonId:string;userId:string}
function legacyAwards(rooms:RoomStats[]):Award[]{
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
/** PBE milestones are separate from legacy personal-accuracy Honors. */
export function calculateAwards(rooms:RoomStats[]):Award[]{
 const result=legacyAwards(rooms.filter(r=>r.format!=='Pbe'));
 const complete=rooms.filter(r=>r.format==='Pbe'&&r.status==='Completed');
 for(const seasonId of new Set(complete.map(r=>r.seasonId)))for(const userId of new Set(complete.filter(r=>r.seasonId===seasonId).flatMap(r=>r.members.map(m=>m.userId)))){
  const played=complete.filter(r=>r.seasonId===seasonId&&r.members.some(m=>m.userId===userId)).sort((a,b)=>b.completedAt!.localeCompare(a.completedAt!)||b.id.localeCompare(a.id));
  const award=(key:string,title:string)=>result.push({key:`pbe-team-v1:${key}`,title,seasonId,userId});award('first-fellowship','First Fellowship');
  if(played.length>=10&&new Set(played.map(r=>r.completedAt!.slice(0,10))).size>=3)award('team-steady','Team Steady');
  if(new Set(played.flatMap(r=>r.submissions.filter(s=>s.scribeId===userId&&!s.deadlineDraft).map(s=>s.questionId))).size>=10)award('shared-scribe','Shared Scribe');
  const distinct=new Map<string,{earned:number;available:number;pending:boolean}>();for(const r of played)for(const s of r.submissions.filter(s=>s.team===r.members.find(m=>m.userId===userId)!.team))if(!distinct.has(s.questionId))distinct.set(s.questionId,{earned:s.accuracyHundredths,available:points(r.questions.find(q=>q.id===s.questionId)!)*100,pending:!s.resolved});
  const final=[...distinct.values()].filter(x=>!x.pending);if(final.length===distinct.size&&final.length>=30&&final.reduce((n,x)=>n+x.earned,0)*10>=final.reduce((n,x)=>n+x.available,0)*9)award('team-precision','Team Precision');
  if(played.some(r=>r.questionCount===90))award('rehearsal-complete','Rehearsal Complete');
 }return result;
}
export function trends(rooms:RoomStats[],userId:string){
 const groups=new Map<string,RoomStats[]>();for(const r of rooms.filter(r=>r.status==="Completed"&&(r.format==='Pbe'||r.submissions.every(s=>s.resolved))&&r.members.some(m=>m.userId===userId))){const key=JSON.stringify([r.seasonId,r.teamSize,r.bookKey,r.format??'Arcade',r.teamCount??2,r.rules?.ruleVersion??'ERUDOZA_PBE_PVP_2023_24_V1',r.rules?.scoringVersion??'accuracy-plus-speed-25-cf-event-v1']);groups.set(key,[...(groups.get(key)??[]),r]);}
 return [...groups.values()].map(group=>{let pendingCount=0,accuracyHundredths=0,speedHundredths=0,availableHundredths=0,wins=0,draws=0,unansweredQuestions=0,totalMs=0,timed=0;const qs=new Set<string>(),ps=new Set<string>(),participated=new Set<string>();for(const r of group){const team=r.members.find(m=>m.userId===userId)!.team;const totals=[1,2].map(t=>r.submissions.filter(s=>s.team===t).reduce((n,s)=>n+s.accuracyHundredths+s.speedHundredths,0));if(r.format!=='Pbe'&&r.teamCount!==1){if(totals[0]===totals[1])draws++;else if(totals[team-1]>totals[2-team])wins++;}for(const s of r.submissions.filter(s=>s.team===team)){const q=r.questions.find(q=>q.id===s.questionId)!;qs.add(q.id);ps.add(q.sourceUnitId);if(r.format==='Pbe'&&!s.resolved){pendingCount++;continue;}accuracyHundredths+=s.accuracyHundredths;speedHundredths+=s.speedHundredths;availableHundredths+=points(q)*100;if(s.unanswered??s.answers?.every(a=>!a.trim()))unansweredQuestions++;if(!s.deadlineDraft){totalMs+=s.elapsedMs;timed++;}}r.contributions.filter(c=>c.userId===userId).forEach(c=>participated.add(c.questionId));}return{format:group[0].format??'Arcade',teamCount:group[0].teamCount??2,seasonId:group[0].seasonId,teamSize:group[0].teamSize,bookKey:group[0].bookKey??null,ruleVersion:group[0].rules?.ruleVersion??"ERUDOZA_PBE_PVP_2023_24_V1",matches:group.length,pendingCount,provisional:pendingCount>0,scoringVersion:group[0].rules?.scoringVersion??'accuracy-plus-speed-25-cf-event-v1',wins,draws,accuracyHundredths,speedHundredths,availableHundredths,unansweredQuestions,averageResponseMs:timed?totalMs/timed:0,distinctQuestions:qs.size,distinctPassages:ps.size,participatedQuestions:participated.size};});
}
