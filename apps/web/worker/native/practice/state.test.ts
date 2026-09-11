// @vitest-environment node
import {expect,it} from "vitest";
import {advance,applyCommand,join,makeRoom,recover,view} from "./state";
import type {Actor} from "../types";
const actor=(id:string):Actor=>({userId:id,organizationId:"org",organizationName:"Org",displayName:id,userName:id,email:null,kind:"Student",role:"Student",credentialVersion:"v1"});
it("ignores forged room and organization identity in creation input",()=>{
 const input={seasonId:"season",teamSize:1,questionCount:10,coached:false,id:"forged",orgId:"foreign"};
 expect(makeRoom("trusted",actor("a"),input,"epoch",1000)).toMatchObject({id:"trusted",orgId:"org"});
});
function setup(size=1){const a=actor("a"),b=actor("b"),r=makeRoom("room",a,{seasonId:"season",teamSize:size,questionCount:10,coached:false},"epoch",1000);join(r,b,2);for(let i=1;i<size;i++){join(r,actor(`a${i}`),1);join(r,actor(`b${i}`),2);}r.members.forEach(m=>m.ready=true);const questions=Array.from({length:11},(_,i)=>({id:`q${i}`,contentPackId:"p",sourceUnitId:`s${i}`,prompt:"Name",reference:"John 1:1",evidence:"Word",kind:"ShortAnswer",parts:[{acceptedAnswers:["Word"],points:1}],ordered:false,version:1}));applyCommand(r,a,{commandId:crypto.randomUUID(),revision:r.revision,action:"start"},1000,1000,{questions});return{r,a,b};}
it.each([1,2,3,4,5])("starts %iv%i full ready teams and hides keys",size=>{const {r,a}=setup(size);expect(r.status).toBe("Playing");expect(r.members).toHaveLength(size*2);expect(JSON.stringify(view(r,a,1000))).not.toContain("acceptedAnswers");expect(()=>applyCommand(r,a,{commandId:crypto.randomUUID(),revision:r.revision,action:"move",targetUserId:"b",team:1},1000,1000)).toThrow();});
it("requires both scheduled acknowledgements and preserves accepted time on retries",()=>{
 const {r,a,b}=setup();advance(r,16000);const ack=(user:Actor)=>applyCommand(r,user,{commandId:crypto.randomUUID(),revision:r.revision,action:"ack",scheduleId:r.scheduleId},17000,17000);
 ack(a);advance(r,19000);expect(r.phase).toBe("Scheduled");expect(r.acknowledged).toHaveLength(0);
 for(const user of [a,b])applyCommand(r,user,{commandId:crypto.randomUUID(),revision:r.revision,action:"ack",scheduleId:r.scheduleId},20000,20000);
 advance(r,22000);const c={commandId:crypto.randomUUID(),revision:r.revision,action:"submit",questionId:"q0",answers:["Word"]};
 applyCommand(r,a,c,27000,28000);applyCommand(r,a,{...c,commandId:crypto.randomUUID(),answers:["Wrong"]},23000,29000);
 expect(r.submissions[0].elapsedMs).toBe(5000);expect(r.submissions[0].speedHundredths).toBe(20);
 expect(view(r,b,29000).submitted).toBe(false);
});
it("defers deadline for admitted requests and replaces active question after epoch change",()=>{
 const {r,a,b}=setup();advance(r,16000);for(const user of [a,b])applyCommand(r,user,{commandId:crypto.randomUUID(),revision:r.revision,action:"ack",scheduleId:r.scheduleId},17000,17000);advance(r,19000);
 advance(r,45000,true);expect(r.submissions).toHaveLength(0);advance(r,45000,false);expect(r.submissions).toHaveLength(2);expect(r.submissions.every(s=>s.speedHundredths===0)).toBe(true);
 const active=setup().r;recover(active,"new",50000,"restart");expect(active.phase).toBe("Paused");expect(active.questions[0].id).toBe("q10");expect(active.submissions).toHaveLength(0);
});
it("exposes sanitized recovery reasons only to the owner and an authorized non-playing coach",()=>{
 const {r,a,b}=setup();recover(r,"new-epoch",50000,"runtime-replacement");
 Object.assign(r.timingAnomalies[0],{internalEpoch:"private-runtime-value"});
 const expected=[{at:50000,reason:"runtime-replacement"}];
 expect(view(r,a,50000)).toHaveProperty("timingAnomalies",expected);
 expect(view(r,b,50000)).not.toHaveProperty("timingAnomalies");
 const coach:Actor={...actor("coach"),kind:"Adult",role:"Admin"};r.coachId=coach.userId;
 expect(view(r,coach,50000)).toHaveProperty("timingAnomalies",expected);
 expect(JSON.stringify(view(r,a,50000))).not.toContain("private-runtime-value");
 expect(()=>view(r,{...coach,userId:"unrelated-coach"},50000)).toThrow("Room access denied");
});
