import type { Actor } from "../types";
import { HttpError } from "../types";
import type { Question } from "./scoring";
import {duration,evaluate,score,points} from "./scoring";
export interface Member {userId:string;displayName:string;team:number;ready:boolean;captain:boolean;scribe:boolean}
export interface Submission {questionId:string;team:number;scribeId:string;answers:string[];elapsedMs:number;deadlineDraft:boolean;accuracyHundredths:number;speedHundredths:number;appealed:boolean;resolved:boolean;appealReason?:string}
export interface Invitation {id:string;roomId:string;userId:string;team?:number;inviterName:string;expiresAt:string;accepted:boolean}
export interface Room {
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
export interface Command {commandId:string;revision:number;action:string;targetUserId?:string;otherUserId?:string;team?:number;text?:string;answers?:string[];scheduleId?:string;questionId?:string;points?:number}
export function canCoach(r:Room,a:Actor):boolean {return a.kind==="Adult"&&["Owner","Admin"].includes(a.role)&&!r.members.some(m=>m.userId===a.userId)&&(r.coachId===a.userId||r.submissions.some(s=>s.appealed));}
export function participant(r:Room,a:Actor):boolean{return r.ownerId===a.userId||r.coachId===a.userId||r.members.some(m=>m.userId===a.userId);}
function need(ok:unknown,message:string,status=400):asserts ok {if(!ok)throw new HttpError(status,message);}
export function resetReady(r:Room){r.members.forEach(m=>m.ready=false);}
export function repairRoles(r:Room){for(const t of [1,2]) {const ms=r.members.filter(m=>m.team===t); if(ms.length&&!ms.some(m=>m.captain))ms[0].captain=true;if(ms.length&&!ms.some(m=>m.scribe))ms[0].scribe=true;}}
export function join(r:Room,a:Actor,team:number){need(r.status==="Lobby","Teams are locked.");need([1,2].includes(team),"Choose a team.");need(a.userId!==r.coachId,"The coach cannot play.");const existing=r.members.find(m=>m.userId===a.userId);if(existing)return;need(r.members.filter(m=>m.team===team).length<r.teamSize,"That team is full.");r.members.push({userId:a.userId,displayName:a.displayName,team,ready:false,captain:false,scribe:false});repairRoles(r);resetReady(r);}
export function makeRoom(id:string,a:Actor,input:{seasonId:string;teamSize:number;questionCount:number;coached:boolean;bookKey?:string},epoch:string,now:number):Room {
 need(Number.isInteger(input.teamSize)&&input.teamSize>=1&&input.teamSize<=5,"Choose a team size from one to five.");need([10,30,90].includes(input.questionCount),"Choose 10, 30 or 90 questions.");need(!input.coached||(a.kind==="Adult"&&["Admin","Owner"].includes(a.role)),"Only a coach can create coached practice.",403);
 const r:Room={id,orgId:a.organizationId,seasonId:input.seasonId,teamSize:input.teamSize,questionCount:input.questionCount,coached:input.coached,bookKey:input.bookKey,ownerId:a.userId,coachId:input.coached?a.userId:undefined,status:"Lobby",phase:"Presentation",revision:1,questionIndex:0,epoch,lastObserved:now,phaseEndsAt:null,responseStartsAt:null,scheduleId:"",acknowledged:[],questions:[],reserves:[],members:[],invitations:[],submissions:[],drafts:{},messages:[],contributions:[],applied:{},adjustments:[],timingAnomalies:[],rules:{ruleVersion:"ERUDOZA_PBE_PVP_2023_24_V1",scoringVersion:"accuracy-plus-speed-25-cf-event-v1",clock:"server-event-time",presentationSeconds:15,reviewSeconds:10,speedPercent:25,stepSeconds:1}};if(!input.coached)join(r,a,1);return r;
}
const current=(r:Room)=>r.questions[r.questionIndex];
export function presentation(r:Room,now:number){r.phase="Presentation";r.phaseEndsAt=r.coached?null:now+15000;r.responseStartsAt=null;r.drafts={};r.acknowledged=[];}
export function schedule(r:Room,now:number){r.phase="Scheduled";r.responseStartsAt=now+3000;r.phaseEndsAt=r.responseStartsAt;r.scheduleId=crypto.randomUUID();r.acknowledged=[];}
function next(r:Room,now:number){
 if(r.phase==="Paused"){presentation(r,now);return;}
 if(r.questionIndex+1>=r.questions.length){r.status="Completed";r.phase="Complete";r.phaseEndsAt=null;r.completedAt=new Date(now).toISOString();return;}
 if(r.questionCount===90&&r.questionIndex===44&&r.phase!=="Break"){r.phase="Break";r.phaseEndsAt=now+300000;return;}
 r.questionIndex++;presentation(r,now);
}
function addSubmission(r:Room,team:number,scribeId:string,answers:string[],elapsedMs:number,deadlineDraft:boolean){const q=current(r);r.submissions.push({questionId:q.id,team,scribeId,answers,elapsedMs,deadlineDraft,...score(evaluate(q,answers),duration(q),elapsedMs,deadlineDraft),appealed:false,resolved:!r.coached});}
export function recover(r:Room,epoch:string,now:number,reason:string):void {
 r.epoch=epoch;r.lastObserved=now;r.timingAnomalies.push({at:now,reason});
 if(r.status!=="Playing")return;
 if(["Presentation","Scheduled","Response"].includes(r.phase)) {
  const id=current(r).id;r.submissions=r.submissions.filter(s=>s.questionId!==id);r.contributions=r.contributions.filter(c=>c.questionId!==id);
  if(!r.reserves.length){r.status="Abandoned";r.phaseEndsAt=null;return;}
  r.questions[r.questionIndex]=r.reserves.shift()!;r.phase="Paused";r.phaseEndsAt=null;r.responseStartsAt=null;r.drafts={};r.acknowledged=[];
 } else if(r.phase==="Review"&&!r.coached)r.phaseEndsAt=now+10000;else if(r.phase==="Break")r.phaseEndsAt=now+300000;
}
export function advance(r:Room,now:number,pending=false):boolean {
 if(now<r.lastObserved){recover(r,r.epoch,now,"backwards-clock");return true;}r.lastObserved=now;
 const cutoff=new Date(now-30*86400000).toISOString(),before=r.messages.length;r.messages=r.messages.filter(m=>m.createdAt>=cutoff);
 if(r.status!=="Playing")return before!==r.messages.length;
 if(r.phase==="Presentation"&&!r.coached&&now>=r.phaseEndsAt!){schedule(r,now);return true;}
 if(r.phase==="Scheduled"&&now>=r.responseStartsAt!){if(pending)return false;const scribes=r.members.filter(m=>m.scribe);if(scribes.length!==2||scribes.some(m=>!r.acknowledged.includes(m.userId))){schedule(r,now);return true;}r.phase="Response";r.phaseEndsAt=r.responseStartsAt!+duration(current(r))*1000;return true;}
 if(r.phase==="Response") {
  if(pending)return false;const q=current(r);
  if(now>=r.phaseEndsAt!)for(const team of [1,2])if(!r.submissions.some(s=>s.questionId===q.id&&s.team===team))addSubmission(r,team,r.members.find(m=>m.team===team&&m.scribe)!.userId,r.drafts[team]??[],duration(q)*1000,true);
  if(r.submissions.filter(s=>s.questionId===q.id).length===2){r.phase="Review";r.phaseEndsAt=r.coached?null:now+10000;return true;}
 }
 if(r.phase==="Review"&&!r.coached&&now>=r.phaseEndsAt!&&!pending){next(r,now);return true;}
 if(r.phase==="Break"&&now>=r.phaseEndsAt!){next(r,now);return true;}
 return before!==r.messages.length;
}
export function applyCommand(r:Room,a:Actor,c:Command,ingress:number,now:number,options:{questions?:Question[];invitee?:{id:string;displayName:string};pending?:boolean}={}):void {
 need(participant(r,a)||(canCoach(r,a)&&c.action==="judge"),"Room access denied.",403);
 need(typeof c.commandId==="string"&&/^[a-f0-9-]{36}$/i.test(c.commandId),"A command ID is required.");
 if(r.applied[c.commandId]){need(r.applied[c.commandId]===a.userId,"Command belongs to another player.",403);return;}
 if(c.action!=="submit"&&c.action!=="ack")advance(r,now,options.pending);
 if(["move","swap","remove","owner","start","captain","scribe"].includes(c.action))need(c.revision===r.revision,"Room changed. Refresh and retry.",409);
 const m=r.members.find(m=>m.userId===a.userId),target=r.members.find(m=>m.userId===c.targetUserId),owner=r.ownerId===a.userId;
 const lobby=()=>need(r.status==="Lobby","Teams are locked after starting."),own=()=>need(owner,"Only the room owner can do that.",403),player=()=>need(m,"A playing team is required.",403);
 const validate=()=>need(Array.isArray(c.answers)&&c.answers.length<=current(r).parts.length&&c.answers.every(v=>typeof v==="string"&&v.length<=2000),"Answers exceed the response fields.");
 const contribution=(scribe:boolean)=>{const item={userId:a.userId,questionId:current(r).id,scribe};if(!r.contributions.some(x=>x.userId===item.userId&&x.questionId===item.questionId&&x.scribe===scribe))r.contributions.push(item);};
 switch(c.action){
 case "join":lobby();join(r,a,c.team??1);break;
 case "ready":lobby();player();m!.ready=!m!.ready;break;
 case "move":lobby();own();need(target&&[1,2].includes(c.team!),"Choose a player and team.");if(target.team===c.team)break;need(r.members.filter(x=>x.team===c.team).length<r.teamSize,"That team is full.");target.team=c.team!;target.captain=false;target.scribe=false;repairRoles(r);resetReady(r);break;
 case "swap":{lobby();own();const other=r.members.find(x=>x.userId===c.otherUserId);need(target&&other&&target.team!==other.team,"Choose opposing players.");[target.team,other.team]=[other.team,target.team];target.captain=target.scribe=other.captain=other.scribe=false;repairRoles(r);resetReady(r);break;}
 case "remove":lobby();own();need(target&&target.userId!==r.ownerId,"Transfer ownership first.");r.members=r.members.filter(x=>x!==target);repairRoles(r);resetReady(r);break;
 case "leave":lobby();player();need(!owner,"Transfer ownership first.");r.members=r.members.filter(x=>x!==m);repairRoles(r);resetReady(r);break;
 case "owner":lobby();own();need(!r.coached&&target,"Choose a player in an independent room.");r.ownerId=target.userId;resetReady(r);break;
 case "captain":case "scribe":player();need(r.status==="Lobby"||["Review","Break","Paused"].includes(r.phase),"Change roles between questions.");need(m!.captain&&target&&target.team===m!.team,"Only your captain can transfer roles.",403);for(const x of r.members.filter(x=>x.team===m!.team))x[c.action]=x===target;if(r.status==="Lobby")resetReady(r);break;
 case "invite":lobby();need(c.targetUserId!==r.coachId,"The room judge cannot be invited to play.");need(options.invitee&&options.invitee.id===c.targetUserId&&!r.members.some(x=>x.userId===c.targetUserId),"Player not found or already joined.");need(c.team===undefined||[1,2].includes(c.team),"Choose a team.");need(c.team===undefined||owner||m?.team===c.team,"Invite to your own team.",403);need(!r.invitations.some(i=>i.userId===c.targetUserId&&!i.accepted&&Date.parse(i.expiresAt)>now),"An invitation is already pending.");r.invitations.push({id:crypto.randomUUID(),roomId:r.id,userId:c.targetUserId!,team:c.team,inviterName:a.displayName,expiresAt:new Date(now+86400000).toISOString(),accepted:false});break;
 case "start":lobby();own();need(r.members.length===r.teamSize*2&&r.members.every(x=>x.ready),"Both teams must be full and ready.");need(options.questions&&options.questions.length>=r.questionCount,"Insufficient eligible published questions.");r.questions=structuredClone(options.questions.slice(0,r.questionCount));r.reserves=structuredClone(options.questions.slice(r.questionCount));r.status="Playing";presentation(r,now);break;
 case "ack":player();need(r.phase==="Scheduled"&&c.scheduleId===r.scheduleId&&m!.scribe,"Schedule no longer awaits your acknowledgement.");if(ingress>=r.responseStartsAt!){schedule(r,now);break;}if(!r.acknowledged.includes(a.userId))r.acknowledged.push(a.userId);break;
 case "draft":player();need(m!.scribe&&r.phase==="Response"&&ingress>=r.responseStartsAt!&&ingress<=r.phaseEndsAt!,"Only the scribe can edit during response.");need(c.questionId===current(r).id,"Draft is for another question.");need(!r.submissions.some(s=>s.questionId===c.questionId&&s.team===m!.team),"Answer is already locked.");validate();r.drafts[m!.team]=c.answers!;contribution(true);break;
 case "submit":{player();need(r.status==="Playing"&&current(r)&&c.questionId===current(r).id,"No matching active question.");need(m!.scribe,"Only the scribe can submit.",403);const original=r.submissions.find(s=>s.questionId===c.questionId&&s.team===m!.team);if(original&&!original.deadlineDraft)break;need(["Scheduled","Response","Review"].includes(r.phase)&&r.acknowledged.length===2&&ingress>=r.responseStartsAt!,"Shared response has not started.");validate();const elapsed=ingress-r.responseStartsAt!;
  if(elapsed>duration(current(r))*1000){if(!original)addSubmission(r,m!.team,a.userId,r.drafts[m!.team]??[],duration(current(r))*1000,true);break;}
  if(original)r.submissions=r.submissions.filter(s=>s!==original);addSubmission(r,m!.team,a.userId,c.answers!,elapsed,false);contribution(true);if(r.phase==="Scheduled"){r.phase="Response";r.phaseEndsAt=r.responseStartsAt!+duration(current(r))*1000;}advance(r,now,options.pending??false);break;}
 case "chat":player();need(!["Completed","Abandoned"].includes(r.status),"Discussion is closed.");need(typeof c.text==="string"&&c.text.trim()&&c.text.length<=500,"Messages must contain 1–500 characters.");need(r.messages.filter(x=>x.userId===a.userId&&Date.parse(x.createdAt)>now-10000).length<5,"Wait before sending another message.",429);r.messages.push({id:crypto.randomUUID(),userId:a.userId,displayName:a.displayName,team:m!.team,text:c.text.trim(),createdAt:new Date(now).toISOString()});if(r.phase==="Response")contribution(false);break;
 case "next":need((r.coached&&canCoach(r,a))||(owner&&r.phase==="Paused"),"Coach access required.",403);need(r.status==="Playing","Match is not playing.");need(!options.pending,"An answer is being processed.");need(r.phase!=="Break"||now>=r.phaseEndsAt!,"The five-minute break is still in progress.");if(r.phase==="Presentation")schedule(r,now);else if(["Review","Break","Paused"].includes(r.phase)){need(r.phase!=="Review"||r.submissions.filter(s=>s.questionId===current(r).id).every(s=>s.resolved),"Judge both answers before advancing.");next(r,now);}else throw new HttpError(400,"Wait for this question to finish.");break;
 case "appeal":{player();need(typeof c.text==="string"&&c.text.trim()&&c.text.length<=500,"Provide an appeal reason.");need(r.status==="Completed"||r.phase==="Review","Wait for reveal.");const s=r.submissions.find(s=>s.team===m!.team&&s.questionId===c.questionId);need(s&&!s.appealed,"Answer not found or already appealed.");s.appealed=true;s.resolved=false;s.appealReason=c.text.trim();break;}
 case "judge":{need(canCoach(r,a),"A non-playing coach is required.",403);const s=r.submissions.find(s=>s.team===c.team&&s.questionId===c.questionId);need(s&&(s.appealed||(r.coached&&r.phase==="Review")),"Only revealed coached answers or appeals can be judged.");const q=r.questions.find(q=>q.id===s.questionId)!;need(Number.isInteger(c.points)&&c.points!>=0&&c.points!<=points(q)&&typeof c.text==="string"&&c.text.trim()&&c.text.length<=500,"Provide valid rubric points and reason.");r.adjustments.push({questionId:q.id,team:s.team,coachId:a.userId,oldPoints:s.accuracyHundredths/100,newPoints:c.points!,reason:c.text,at:new Date(now).toISOString()});Object.assign(s,score(c.points!,duration(q),s.elapsedMs,s.deadlineDraft),{resolved:true});break;}
 case "abandon":own();need(["Lobby","Playing"].includes(r.status),"A completed match cannot be abandoned.");r.status="Abandoned";r.phaseEndsAt=null;break;
 default:throw new HttpError(400,"Unknown room command.");
 }
 r.applied[c.commandId]=a.userId;r.revision++;
}
export function view(r:Room,a:Actor,now:number){
 const member=r.members.find(m=>m.userId===a.userId),coach=canCoach(r,a);need(participant(r,a)||coach,"Room access denied.",403);
 const reveal=new Set(r.questions.slice(0,r.status==="Completed"?r.questions.length:r.questionIndex+(r.phase==="Review"?1:0)).map(q=>q.id)),visible=r.submissions.filter(s=>reveal.has(s.questionId)),q=current(r);
 return {...(r.ownerId===a.userId||coach?{timingAnomalies:(r.timingAnomalies??[]).map(({at,reason})=>({at,reason}))}:{}),id:r.id,seasonId:r.seasonId,ownerId:r.ownerId,coachId:r.coachId,teamSize:r.teamSize,questionCount:r.questionCount,coached:r.coached,revision:r.revision,status:r.status,phase:r.phase,questionIndex:r.questionIndex,phaseEndsAt:r.phaseEndsAt?new Date(r.phaseEndsAt).toISOString():null,responseStartsAt:r.responseStartsAt?new Date(r.responseStartsAt).toISOString():null,scheduleId:r.scheduleId,serverNow:new Date(now).toISOString(),members:r.members,isCoach:coach,ruleVersion:r.rules?.ruleVersion??"ERUDOZA_PBE_PVP_2023_24_V1",scoringVersion:r.rules?.scoringVersion??"accuracy-plus-speed-25-cf-event-v1",question:q?{id:q.id,prompt:q.prompt,reference:q.reference,kind:q.kind,partCount:q.parts.length,points:points(q),durationSeconds:duration(q)}:null,draft:member?r.drafts[member.team]??[]:[],submitted:!!member&&r.submissions.some(s=>s.team===member.team&&s.questionId===q?.id),messages:r.messages.filter(m=>Date.parse(m.createdAt)>now-30*86400000&&(coach||m.team===member?.team)),scores:[1,2].map(team=>{const accuracyHundredths=visible.filter(s=>s.team===team).reduce((n,s)=>n+s.accuracyHundredths,0),speedHundredths=visible.filter(s=>s.team===team).reduce((n,s)=>n+s.speedHundredths,0);return{team,accuracyHundredths,speedHundredths,totalHundredths:accuracyHundredths+speedHundredths};}),results:visible.map(s=>{const q=r.questions.find(q=>q.id===s.questionId)!;return{...s,prompt:q.prompt,reference:q.reference,evidence:q.evidence,acceptedAnswers:q.parts.map(p=>p.acceptedAnswers),availableHundredths:points(q)*100};}),achievements:[],provisional:r.submissions.some(s=>!s.resolved)};
}
