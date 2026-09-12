import type { Actor } from "../types";
import { HttpError } from "../types";
import type { Question } from "./scoring";
import {duration,evaluate,score,points} from "./scoring";
import {gradePbe} from '../pbe/grading';
import type {PbeQuestion} from '../pbe/types';
import {acknowledgePresentation,rehearsalPoints} from '../pbe/presentation';
export const activeTeams=(r:Pick<Room,'teamCount'>):number[]=>r.teamCount===1?[1]:[1,2];
export const isPbeRoom=(r:Room)=>r.format==='Pbe';
export function roomScore(r:Room,q:Question,answers:string[],elapsedMs:number,deadline=false){
 if(!isPbeRoom(r))return score(evaluate(q,answers),duration(q),elapsedMs,deadline);
 need(r.rules?.scoringVersion==='pbe-accuracy-v1'&&(q as PbeQuestion).schemaVersion===2,'The saved PBE scoring snapshot is invalid.');
 return {accuracyHundredths:rehearsalPoints(gradePbe(q as PbeQuestion,q.parts.map((_,i)=>answers[i]??'')).earnedPoints,elapsedMs,points(q))*100,speedHundredths:0};
}
export function validRoomSet(questions:Question[],count:number){return questions.length===count&&new Set(questions.map(q=>q.id)).size===count&&questions.filter(q=>(q as PbeQuestion).sourceKind==='Commentary').length<=Math.ceil(count*.1)-1&&questions.filter(q=>q.kind==='TrueFalse').length<=Math.floor(count*.1);}

export interface Member {userId:string;displayName:string;team:number;ready:boolean;captain:boolean;scribe:boolean}
export interface Submission {dispute?:import("../pbe/result-overlays").PbeResultReview;originalAccuracyHundredths?:number;attemptId?:string;responseLockedAtMs?:number;questionId:string;team:number;scribeId:string;answers:string[];elapsedMs:number;deadlineDraft:boolean;accuracyHundredths:number;speedHundredths:number;appealed:boolean;resolved:boolean;appealReason?:string}
export interface Invitation {id:string;roomId:string;userId:string;team?:number;inviterName:string;expiresAt:string;accepted:boolean}
export interface Room {
 interruptionReason?:'ArmedResponsesUntrusted'|'UnarmedReserveUnavailable';
 replacements?:{original:Question;replacementId:string;atMs:number;reason:string}[];
 coachReading?:{questionId:string;coachId:string;completedAtMs:number};coachReadyScribeIds?:string[];
 presentations?:Record<string,{coachReading?:Room["coachReading"];scheduleId:string;responseStartsAt:number;responseEndsAt:number;delivery:Record<string,string>}>;
 services?:{id:string;questionId:string;questionKind:string;targetIds:string[];memberIds:string[];atMs:number}[];
 sourceProofs?:Record<string,string>;
 format?:'Arcade'|'Pbe';teamCount?:1|2;selectionVersion?:string;selectionSeed?:string;presentationDelivery?:Record<string,'Audio'|'TextFallback'|'Coach'>;draftReceivedAt?:Record<number,number>;
 id:string;orgId:string;seasonId:string;ownerId:string;coachId?:string;teamSize:number;questionCount:number;bookKey?:string;coached:boolean;
 status:string;phase:string;revision:number;questionIndex:number;epoch:string;lastObserved:number;phaseEndsAt:number|null;responseStartsAt:number|null;scheduleId:string;acknowledged:string[];
 questions:Question[];reserves:Question[];members:Member[];invitations:Invitation[];submissions:Submission[];drafts:Record<number,string[]>;
 messages:{id:string;userId:string;displayName:string;team:number;text:string;createdAt:string}[];
 contributions:{userId:string;questionId:string;scribe:boolean}[];applied:Record<string,string>;completedAt?:string;
 adjustments:{questionId:string;team:number;coachId:string;oldPoints:number;newPoints:number;reason:string;at:string}[];
 timingAnomalies:{at:number;reason:string}[];
 rules?:{ruleVersion:string;scoringVersion:string;clock:string;presentationSeconds:number;reviewSeconds:number;speedPercent:number;stepSeconds:number};
 timingQuality?:Record<string,{rttMs:number;jitterMs:number;samples:number;observedAt:number}>;
}
export interface Command {commandId:string;revision:number;action:string;targetUserId?:string;otherUserId?:string;team?:number;text?:string;answers?:string[];scheduleId?:string;questionId?:string;points?:number;delivery?:'Audio'|'TextFallback'|'Coach'}
export function canCoach(r:Room,a:Actor):boolean {return a.kind==="Adult"&&["Owner","Admin"].includes(a.role)&&!r.members.some(m=>m.userId===a.userId)&&(r.coachId===a.userId||isPbeRoom(r)&&r.ownerId===a.userId||r.submissions.some(s=>s.appealed));}
export function participant(r:Room,a:Actor):boolean{return r.ownerId===a.userId||r.coachId===a.userId||r.members.some(m=>m.userId===a.userId);}
function need(ok:unknown,message:string,status=400):asserts ok {if(!ok)throw new HttpError(status,message);}
export function resetReady(r:Room){r.members.forEach(m=>m.ready=false);}
export function repairRoles(r:Room){for(const t of activeTeams(r)) {const ms=r.members.filter(m=>m.team===t); if(ms.length&&!ms.some(m=>m.captain))ms[0].captain=true;if(ms.length&&!ms.some(m=>m.scribe))ms[0].scribe=true;}}
export function join(r:Room,a:Actor,team:number){need(r.status==="Lobby","Teams are locked.");need(activeTeams(r).includes(team),"Choose a team.");need(a.userId!==r.coachId&&(!isPbeRoom(r)||a.kind==='Student'),"The coach cannot play.");const existing=r.members.find(m=>m.userId===a.userId);if(existing)return;need(r.members.filter(m=>m.team===team).length<r.teamSize,"That team is full.");r.members.push({userId:a.userId,displayName:a.displayName,team,ready:false,captain:false,scribe:false});repairRoles(r);resetReady(r);}
export function makeRoom(id:string,a:Actor,input:{seasonId:string;teamSize:number;questionCount:number;coached?:boolean;bookKey?:string;format?:'Arcade'|'Pbe';teamCount?:1|2},epoch:string,now:number):Room {
 need(input.format===undefined||['Arcade','Pbe'].includes(input.format),'Choose Arcade or Pbe.');
 const pbe=input.format==='Pbe';need(input.teamCount===undefined||[1,2].includes(input.teamCount),'Choose one or two teams.');need(pbe||input.teamCount===undefined||input.teamCount===2,'Arcade requires two teams.');
 need(Number.isInteger(input.teamSize)&&input.teamSize>=(pbe?2:1)&&input.teamSize<=(pbe?6:5),pbe?'Choose a team size from two to six.':'Choose a team size from one to five.');need([10,30,90].includes(input.questionCount),"Choose 10, 30 or 90 questions.");need(!input.coached||(a.kind==="Adult"&&["Admin","Owner"].includes(a.role)),"Only a coach can create coached practice.",403);
 const r:Room={id,orgId:a.organizationId,seasonId:input.seasonId,teamSize:input.teamSize,questionCount:input.questionCount,coached:input.coached??false,...(pbe?{format:'Pbe' as const,teamCount:input.teamCount??2,selectionVersion:'pbe-team-question-max-v1',selectionSeed:crypto.randomUUID()}:{format:'Arcade' as const,teamCount:2 as const}),bookKey:input.bookKey,ownerId:a.userId,coachId:input.coached?a.userId:undefined,status:"Lobby",phase:"Presentation",revision:1,questionIndex:0,epoch,lastObserved:now,phaseEndsAt:null,responseStartsAt:null,scheduleId:"",acknowledged:[],questions:[],reserves:[],members:[],invitations:[],submissions:[],drafts:{},messages:[],contributions:[],applied:{},adjustments:[],timingAnomalies:[],rules:{ruleVersion:"ERUDOZA_PBE_PVP_2023_24_V1",scoringVersion:"accuracy-plus-speed-25-cf-event-v1",clock:"server-event-time",presentationSeconds:15,reviewSeconds:10,speedPercent:25,stepSeconds:1}};if(pbe)r.rules={...r.rules!,ruleVersion:'pbe-rehearsal-v1',scoringVersion:'pbe-accuracy-v1',speedPercent:0};if(!input.coached&&(!pbe||a.kind==='Student'))join(r,a,1);return r;
}
const current=(r:Room)=>r.questions[r.questionIndex];
export function presentation(r:Room,now:number){if(isPbeRoom(r)){const q=current(r) as PbeQuestion;r.services??=[];if(!r.services.some(s=>s.questionId===q.id))r.services.push({id:crypto.randomUUID(),questionId:q.id,questionKind:q.kind,targetIds:[...new Set(q.parts.map(p=>p.targetId))],memberIds:r.members.map(m=>m.userId),atMs:now});}r.phase="Presentation";r.phaseEndsAt=r.coached||isPbeRoom(r)?null:now+15000;r.presentationDelivery={};r.coachReading=undefined;r.coachReadyScribeIds=[];r.draftReceivedAt={};r.responseStartsAt=null;r.drafts={};r.acknowledged=[];}
export function schedule(r:Room,now:number){r.phase="Scheduled";r.responseStartsAt=now+3000;r.phaseEndsAt=r.responseStartsAt;r.scheduleId=crypto.randomUUID();r.acknowledged=[];if(isPbeRoom(r))r.presentations={...r.presentations,[current(r).id]:{scheduleId:r.scheduleId,responseStartsAt:r.responseStartsAt,responseEndsAt:r.responseStartsAt+duration(current(r))*1000,delivery:{...r.presentationDelivery},coachReading:r.coachReading}};}
function next(r:Room,now:number){
 if(r.phase==="Paused"){presentation(r,now);return;}
 if(r.questionIndex+1>=r.questions.length){r.status="Completed";r.phase="Complete";r.phaseEndsAt=null;r.completedAt=new Date(now).toISOString();return;}
 if(r.questionCount===90&&r.questionIndex===44&&r.phase!=="Break"){r.phase="Break";r.phaseEndsAt=now+300000;return;}
 r.questionIndex++;presentation(r,now);
}
function addSubmission(r:Room,team:number,scribeId:string,answers:string[],elapsedMs:number,deadlineDraft:boolean){const q=current(r);r.submissions.push({...(isPbeRoom(r)?{attemptId:crypto.randomUUID(),responseLockedAtMs:r.responseStartsAt!+Math.min(elapsedMs,duration(q)*1000)}:{}),questionId:q.id,team,scribeId,answers,elapsedMs,deadlineDraft,...roomScore(r,q,answers,elapsedMs,deadlineDraft),appealed:false,resolved:isPbeRoom(r)||!r.coached});}
export function recover(r:Room,epoch:string,now:number,reason:string,eligibleReserveIds?:Set<string>):void {
 r.epoch=epoch;r.lastObserved=now;r.timingAnomalies.push({at:now,reason});
 if(r.status!=="Playing")return;
 if(isPbeRoom(r)&&['Scheduled','Response'].includes(r.phase)){
  for(const team of activeTeams(r))if(!r.submissions.some(s=>s.questionId===current(r).id&&s.team===team)){
   const at=r.draftReceivedAt?.[team];if(at!==undefined&&at>=r.responseStartsAt!&&at<=r.responseStartsAt!+duration(current(r))*1000)addSubmission(r,team,r.members.find(m=>m.team===team&&m.scribe)!.userId,r.drafts[team],at-r.responseStartsAt!,true);
   else {r.status='Interrupted';r.phase='Interrupted';r.interruptionReason='ArmedResponsesUntrusted';r.phaseEndsAt=null;return;}
  }
  r.phase='Review';r.phaseEndsAt=r.coached?null:now+10000;return;
 }
 if(["Presentation","Scheduled","Response"].includes(r.phase)) {
  const id=current(r).id;r.submissions=r.submissions.filter(s=>s.questionId!==id);r.contributions=r.contributions.filter(c=>c.questionId!==id);
  const replacement=isPbeRoom(r)?r.reserves.findIndex(q=>(!eligibleReserveIds||eligibleReserveIds.has(q.id))&&validRoomSet(r.questions.map((old,i)=>i===r.questionIndex?q:old),r.questionCount)):0;
  if(!r.reserves.length||replacement<0){r.status=isPbeRoom(r)?"Interrupted":"Abandoned";if(isPbeRoom(r)){r.phase='Interrupted';r.interruptionReason='UnarmedReserveUnavailable';}r.phaseEndsAt=null;return;}
  if(isPbeRoom(r))r.replacements=[...(r.replacements??[]),{original:current(r),replacementId:r.reserves[replacement].id,atMs:now,reason}];
  r.questions[r.questionIndex]=r.reserves.splice(replacement,1)[0];r.phase="Paused";r.phaseEndsAt=null;r.responseStartsAt=null;r.drafts={};r.acknowledged=[];
 } else if(r.phase==="Review"&&!r.coached)r.phaseEndsAt=now+10000;else if(r.phase==="Break")r.phaseEndsAt=now+300000;
}
export function advance(r:Room,now:number,pending=false,eligibleReserveIds?:Set<string>):boolean {
 if(now<r.lastObserved){recover(r,r.epoch,now,"backwards-clock",eligibleReserveIds);return true;}r.lastObserved=now;
 const cutoff=new Date(now-30*86400000).toISOString(),before=r.messages.length;r.messages=r.messages.filter(m=>m.createdAt>=cutoff);
 if(r.status!=="Playing")return before!==r.messages.length;
 if(r.phase==="Presentation"&&!isPbeRoom(r)&&!r.coached&&now>=r.phaseEndsAt!){schedule(r,now);return true;}
 if(r.phase==="Scheduled"&&now>=r.responseStartsAt!){if(pending)return false;const scribes=r.members.filter(m=>m.scribe);if(scribes.length!==activeTeams(r).length||scribes.some(m=>!r.acknowledged.includes(m.userId))){schedule(r,now);return true;}r.phase="Response";r.phaseEndsAt=r.responseStartsAt!+duration(current(r))*1000;return true;}
 if(r.phase==="Response") {
  if(pending)return false;const q=current(r);
  if(now>r.phaseEndsAt!||(now===r.phaseEndsAt!&&!isPbeRoom(r)))for(const team of activeTeams(r))if(!r.submissions.some(s=>s.questionId===q.id&&s.team===team))addSubmission(r,team,r.members.find(m=>m.team===team&&m.scribe)!.userId,r.drafts[team]??[],duration(q)*1000,true);
  if(r.submissions.filter(s=>s.questionId===q.id).length===activeTeams(r).length){r.phase="Review";r.phaseEndsAt=r.coached?null:now+10000;return true;}
 }
 if(r.phase==="Review"&&!r.coached&&now>=r.phaseEndsAt!&&!pending){next(r,now);return true;}
 if(r.phase==="Break"&&now>=r.phaseEndsAt!){next(r,now);return true;}
 return before!==r.messages.length;
}
// Preserved terminal phases are historical evidence, never permission to resume play.
export function isTerminatedPbePlay(r:Room,action:string){return isPbeRoom(r)&&!['Lobby','Playing'].includes(r.status)&&['ready','start','next','present','present-ready','ack','draft','submit'].includes(action);}
export function applyCommand(r:Room,a:Actor,c:Command,ingress:number,now:number,options:{questions?:Question[];invitee?:{id:string;displayName:string};pending?:boolean}={}):void {
 need(!isPbeRoom(r)||!["appeal","judge"].includes(c.action),"Use Flag answer and the PBE review queue for versioned rubric review.");
 need(participant(r,a)||(canCoach(r,a)&&c.action==="judge"),"Room access denied.",403);
 need(typeof c.commandId==="string"&&/^[a-f0-9-]{36}$/i.test(c.commandId),"A command ID is required.");
 if(r.applied[c.commandId]){need(r.applied[c.commandId]===a.userId,"Command belongs to another player.",403);return;}
 need(!isTerminatedPbePlay(r,c.action),"This rehearsal has ended.");
 if(!(isPbeRoom(r)&&["remove","leave","abandon"].includes(c.action))&&!["submit","ack","draft","present","present-ready"].includes(c.action))advance(r,now,options.pending);
 if(["move","swap","remove","owner","start","captain","scribe"].includes(c.action))need(c.revision===r.revision,"Room changed. Refresh and retry.",409);
 const m=r.members.find(m=>m.userId===a.userId),target=r.members.find(m=>m.userId===c.targetUserId),owner=r.ownerId===a.userId;
 const independentCaptain=isPbeRoom(r)&&!r.coached&&!!m?.captain;
 const lobby=()=>need(r.status==="Lobby","Teams are locked after starting."),own=()=>need(owner,"Only the room owner can do that.",403),player=()=>need(m,"A playing team is required.",403);
 const validate=()=>need(Array.isArray(c.answers)&&c.answers.length<=current(r).parts.length&&c.answers.every(v=>typeof v==="string"&&v.length<=2000),"Answers exceed the response fields.");
 const contribution=(scribe:boolean)=>{const item={userId:a.userId,questionId:current(r).id,scribe};if(!r.contributions.some(x=>x.userId===item.userId&&x.questionId===item.questionId&&x.scribe===scribe))r.contributions.push(item);};
 switch(c.action){
 case "join":lobby();join(r,a,c.team??1);break;
 case "ready":lobby();player();m!.ready=!m!.ready;break;
 case "move":lobby();own();need(target&&activeTeams(r).includes(c.team!),"Choose a player and team.");if(target.team===c.team)break;need(r.members.filter(x=>x.team===c.team).length<r.teamSize,"That team is full.");target.team=c.team!;target.captain=false;target.scribe=false;repairRoles(r);resetReady(r);break;
 case "swap":{lobby();own();const other=r.members.find(x=>x.userId===c.otherUserId);need(target&&other&&target.team!==other.team,"Choose opposing players.");[target.team,other.team]=[other.team,target.team];target.captain=target.scribe=other.captain=other.scribe=false;repairRoles(r);resetReady(r);break;}
 case "remove":lobby();own();need(target&&target.userId!==r.ownerId,"Transfer ownership first.");r.members=r.members.filter(x=>x!==target);repairRoles(r);resetReady(r);break;
 case "leave":lobby();player();need(!owner,"Transfer ownership first.");r.members=r.members.filter(x=>x!==m);repairRoles(r);resetReady(r);break;
 case "owner":lobby();own();need(!r.coached&&target,"Choose a player in an independent room.");r.ownerId=target.userId;resetReady(r);break;
 case "captain":case "scribe":player();need(r.status==="Lobby"||["Review","Break","Paused"].includes(r.phase),"Change roles between questions.");need(m!.captain&&target&&target.team===m!.team,"Only your captain can transfer roles.",403);for(const x of r.members.filter(x=>x.team===m!.team))x[c.action]=x===target;if(r.status==="Lobby")resetReady(r);break;
 case "invite":lobby();need(options.invitee&&options.invitee.id===c.targetUserId&&!r.members.some(x=>x.userId===c.targetUserId),"Player not found or already joined.");need(c.team===undefined||activeTeams(r).includes(c.team),"Choose a team.");need(c.team===undefined||owner||m?.team===c.team,"Invite to your own team.",403);need(!r.invitations.some(i=>i.userId===c.targetUserId&&!i.accepted&&Date.parse(i.expiresAt)>now),"An invitation is already pending.");r.invitations.push({id:crypto.randomUUID(),roomId:r.id,userId:c.targetUserId!,team:c.team,inviterName:a.displayName,expiresAt:new Date(now+86400000).toISOString(),accepted:false});break;
 case "start":lobby();need(owner||independentCaptain,"Only the owner or an independent PBE captain can start.",403);need(r.members.length===r.teamSize*activeTeams(r).length&&r.members.every(x=>x.ready),"All active teams must be full and ready.");need(options.questions&&options.questions.length>=r.questionCount,"Insufficient eligible published questions.");if(isPbeRoom(r)){need(options.questions.length>r.questionCount,'A distinct eligible recovery reserve is required.');need(validRoomSet(options.questions.slice(0,r.questionCount),r.questionCount),'The final rehearsal set violates its quotas.');need(new Set(options.questions.map(q=>q.id)).size===options.questions.length,'Question IDs must be distinct.');}r.questions=structuredClone(options.questions.slice(0,r.questionCount));r.reserves=structuredClone(options.questions.slice(r.questionCount));r.status="Playing";presentation(r,now);break;
 case "present":case "present-ready":{
  need(isPbeRoom(r)&&r.status==='Playing'&&r.phase==='Presentation','This presentation is not awaiting readings.');need(c.questionId===current(r).id&&c.revision===r.revision,'Presentation changed. Refresh and retry.',409);
  const scribes=r.members.filter(m=>m.scribe).map(m=>m.userId);
  if(r.coached){
   if(c.action==='present'){need(r.coachId===a.userId&&canCoach(r,a),'Only the designated non-playing coach can confirm readings.',403);need(c.delivery==='Coach','Confirm both coach readings.');r.coachReading={questionId:current(r).id,coachId:a.userId,completedAtMs:ingress};}
   else{player();need(m!.scribe&&a.kind==='Student','Only the current student scribe can confirm readiness.',403);need(!c.delivery,'Readiness does not confirm a delivery method.');r.coachReadyScribeIds=[...new Set([...(r.coachReadyScribeIds??[]),a.userId])];}
   if(r.coachReading&&scribes.every(id=>r.coachReadyScribeIds?.includes(id))){r.presentationDelivery=Object.fromEntries(scribes.map(id=>[id,'Coach']));schedule(r,now);r.acknowledged=scribes;}
  }else{player();need(c.action==='present'&&m!.scribe,'Only the current scribe can confirm the readings.');need(c.delivery==='Audio'||c.delivery==='TextFallback','Confirm two readings using audio or text.');
   const state=acknowledgePresentation({questionId:current(r).id,revision:r.revision,delivery:c.delivery,requiredScribeIds:scribes,readyScribeIds:Object.keys(r.presentationDelivery??{}),responseStartsAtMs:null,responseEndsAtMs:null},a.userId,c.questionId,now,points(current(r)));
   r.presentationDelivery={...r.presentationDelivery,[a.userId]:c.delivery};if(state.responseStartsAtMs!==null){schedule(r,now);r.acknowledged=state.readyScribeIds;}
  }break;}
 case "ack":player();need(r.phase==="Scheduled"&&c.scheduleId===r.scheduleId&&m!.scribe,"Schedule no longer awaits your acknowledgement.");if(isPbeRoom(r))break;if(ingress>=r.responseStartsAt!){schedule(r,now);break;}if(!r.acknowledged.includes(a.userId))r.acknowledged.push(a.userId);break;
 case "draft":player();if(isPbeRoom(r)&&r.phase==='Scheduled'&&r.acknowledged.length===activeTeams(r).length&&ingress>=r.responseStartsAt!){r.phase='Response';r.phaseEndsAt=r.responseStartsAt!+duration(current(r))*1000;}need(m!.scribe&&r.phase==="Response"&&ingress>=r.responseStartsAt!&&ingress<=r.phaseEndsAt!,"Only the scribe can edit during response.");need(c.questionId===current(r).id,"Draft is for another question.");need(!r.submissions.some(s=>s.questionId===c.questionId&&s.team===m!.team),"Answer is already locked.");validate();r.drafts[m!.team]=c.answers!;r.draftReceivedAt={...r.draftReceivedAt,[m!.team]:ingress};contribution(true);break;
 case "submit":{player();need(r.status==="Playing"&&current(r)&&c.questionId===current(r).id,"No matching active question.");need(m!.scribe,"Only the scribe can submit.",403);const original=r.submissions.find(s=>s.questionId===c.questionId&&s.team===m!.team);if(original&&(isPbeRoom(r)||!original.deadlineDraft))break;need(["Scheduled","Response","Review"].includes(r.phase)&&r.acknowledged.length===activeTeams(r).length&&ingress>=r.responseStartsAt!,"Shared response has not started.");validate();const elapsed=ingress-r.responseStartsAt!;
  if(elapsed>duration(current(r))*1000){if(!original)addSubmission(r,m!.team,a.userId,r.drafts[m!.team]??[],duration(current(r))*1000,true);break;}
  if(original)r.submissions=r.submissions.filter(s=>s!==original);addSubmission(r,m!.team,a.userId,c.answers!,elapsed,false);contribution(true);if(r.phase==="Scheduled"){r.phase="Response";r.phaseEndsAt=r.responseStartsAt!+duration(current(r))*1000;}advance(r,now,options.pending??false);break;}
 case "chat":player();need(!["Completed","Abandoned","Interrupted"].includes(r.status),"Discussion is closed.");need(typeof c.text==="string"&&c.text.trim()&&c.text.length<=500,"Messages must contain 1–500 characters.");need(r.messages.filter(x=>x.userId===a.userId&&Date.parse(x.createdAt)>now-10000).length<5,"Wait before sending another message.",429);r.messages.push({id:crypto.randomUUID(),userId:a.userId,displayName:a.displayName,team:m!.team,text:c.text.trim(),createdAt:new Date(now).toISOString()});if(r.phase==="Response")contribution(false);break;
 case "next":need((r.coached&&canCoach(r,a))||((owner||independentCaptain)&&r.phase==="Paused"),"Coach access required.",403);need(r.status==="Playing","Match is not playing.");need(!options.pending,"An answer is being processed.");need(r.phase!=="Break"||now>=r.phaseEndsAt!,"The five-minute break is still in progress.");if(r.phase==="Presentation"){need(!isPbeRoom(r),'Each active scribe must confirm the two readings.');schedule(r,now);}else if(["Review","Break","Paused"].includes(r.phase)){need(r.phase!=="Review"||r.submissions.filter(s=>s.questionId===current(r).id).every(s=>s.resolved),"Judge both answers before advancing.");next(r,now);}else throw new HttpError(400,"Wait for this question to finish.");break;
 case "appeal":{player();need(typeof c.text==="string"&&c.text.trim()&&c.text.length<=500,"Provide an appeal reason.");need(r.status==="Completed"||r.phase==="Review","Wait for reveal.");const s=r.submissions.find(s=>s.team===m!.team&&s.questionId===c.questionId);need(s&&!s.appealed,"Answer not found or already appealed.");s.appealed=true;s.resolved=false;s.appealReason=c.text.trim();break;}
 case "judge":{need(canCoach(r,a),"A non-playing coach is required.",403);const s=r.submissions.find(s=>s.team===c.team&&s.questionId===c.questionId);need(s&&(s.appealed||(r.coached&&r.phase==="Review")),"Only revealed coached answers or appeals can be judged.");const q=r.questions.find(q=>q.id===s.questionId)!;need(Number.isInteger(c.points)&&c.points!>=0&&c.points!<=points(q)&&typeof c.text==="string"&&c.text.trim()&&c.text.length<=500,"Provide valid rubric points and reason.");r.adjustments.push({questionId:q.id,team:s.team,coachId:a.userId,oldPoints:s.accuracyHundredths/100,newPoints:c.points!,reason:c.text,at:new Date(now).toISOString()});Object.assign(s,isPbeRoom(r)?{accuracyHundredths:c.points!*100,speedHundredths:0}:score(c.points!,duration(q),s.elapsedMs,s.deadlineDraft),{resolved:true});break;}
 case "abandon":own();need(["Lobby","Playing"].includes(r.status),"A completed match cannot be abandoned.");r.status="Abandoned";r.phaseEndsAt=null;break;
 default:throw new HttpError(400,"Unknown room command.");
 }
 r.applied[c.commandId]=a.userId;r.revision++;
}
export const teamAttemptId=(r:Room,s:Submission)=>s.attemptId?.toLowerCase()??`team:${r.id.toLowerCase()}:${s.questionId.toLowerCase()}:${s.team}`;
export function reviewedQuestion(r:Room,questionId:string){const index=r.questions.findIndex(q=>q.id===questionId);return index>=0&&(r.status==='Completed'||!isPbeRoom(r)&&r.status==='Interrupted'||index<r.questionIndex||index===r.questionIndex&&r.phase==='Review');}
export function view(r:Room,a:Actor,now:number,materialUnavailable=false){
 const member=r.members.find(m=>m.userId===a.userId),coach=canCoach(r,a);need(participant(r,a)||coach,"Room access denied.",403);
 const visible=r.submissions.filter(s=>reviewedQuestion(r,s.questionId)||isPbeRoom(r)&&['Interrupted','Abandoned'].includes(r.status)&&(coach||s.team===member?.team)),q=current(r);
 return {materialUnavailable,coachReading:r.coachReading??null,coachReadyScribeIds:r.coachReadyScribeIds??[],...(r.ownerId===a.userId||coach?{timingAnomalies:(r.timingAnomalies??[]).map(({at,reason})=>({at,reason}))}:{}),format:r.format??"Arcade",teamCount:activeTeams(r).length,presentationDelivery:r.presentationDelivery??{},id:r.id,seasonId:r.seasonId,ownerId:r.ownerId,coachId:r.coachId,teamSize:r.teamSize,questionCount:r.questionCount,coached:r.coached,revision:r.revision,status:r.status,interruptionReason:r.interruptionReason,phase:r.phase,questionIndex:r.questionIndex,phaseEndsAt:r.phaseEndsAt?new Date(r.phaseEndsAt).toISOString():null,responseStartsAt:r.responseStartsAt?new Date(r.responseStartsAt).toISOString():null,scheduleId:r.scheduleId,serverNow:new Date(now).toISOString(),members:r.members,isCoach:coach,ruleVersion:r.rules?.ruleVersion??"ERUDOZA_PBE_PVP_2023_24_V1",scoringVersion:r.rules?.scoringVersion??"accuracy-plus-speed-25-cf-event-v1",question:!materialUnavailable&&q&&!(isPbeRoom(r)&&(['Paused','Break'].includes(r.phase)||r.status==='Abandoned'))?{id:q.id,prompt:q.prompt,reference:q.reference,kind:q.kind,partCount:q.parts.length,points:points(q),durationSeconds:duration(q)}:null,draft:!materialUnavailable&&member?r.drafts[member.team]??[]:[],submitted:!!member&&r.submissions.some(s=>s.team===member.team&&s.questionId===q?.id),messages:(materialUnavailable?[]:r.messages).filter(m=>Date.parse(m.createdAt)>now-30*86400000&&(coach||m.team===member?.team)),scores:activeTeams(r).map(team=>{const accuracyHundredths=visible.filter(s=>s.team===team).reduce((n,s)=>n+s.accuracyHundredths,0),speedHundredths=visible.filter(s=>s.team===team).reduce((n,s)=>n+s.speedHundredths,0);return{team,accuracyHundredths,speedHundredths,availableHundredths:visible.filter(s=>s.team===team).reduce((n,s)=>n+points(r.questions.find(q=>q.id===s.questionId)!)*100,0),totalHundredths:accuracyHundredths+speedHundredths};}),results:(materialUnavailable?[]:visible).map(s=>{const q=r.questions.find(q=>q.id===s.questionId)!;return{...s,...(isPbeRoom(r)?{attemptId:teamAttemptId(r,s)}:{}),prompt:q.prompt,reference:q.reference,evidence:q.evidence,acceptedAnswers:q.parts.map(p=>p.acceptedAnswers),availableHundredths:points(q)*100};}),achievements:[],pendingCount:visible.filter(s=>s.dispute?.status==='Pending').length,provisional:(isPbeRoom(r)?visible:r.submissions).some(s=>!s.resolved)};
}
