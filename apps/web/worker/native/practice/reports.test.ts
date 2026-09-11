// @vitest-environment node
import {expect,it} from 'vitest';
import {calculateAwards,trends} from './awards';
import {advance,applyCommand,join,makeRoom} from './state';
import type {Actor} from '../types';
it('completes a judged 90-question rehearsal, enforces the break and reconciles provisional awards',()=>{
 const actor=(id:string,adult=false):Actor=>({userId:id,organizationId:'org',organizationName:'Org',userName:id,displayName:id,email:null,kind:adult?'Adult':'Student',role:adult?'Owner':'Student',credentialVersion:'v1'});
 const coach=actor('coach',true),a=actor('a'),b=actor('b');let now=1000;
 const r=makeRoom('room',coach,{seasonId:'season',teamSize:1,questionCount:90,coached:true},'epoch',now);join(r,a,1);join(r,b,2);r.members.forEach(m=>m.ready=true);
 const questions=Array.from({length:91},(_,i)=>({id:`q${i}`,contentPackId:'p',sourceUnitId:`s${i}`,prompt:'Name',reference:'John 1:1',evidence:'Word',kind:'ShortAnswer',parts:[{acceptedAnswers:['Word'],points:1}],ordered:false,version:1}));
 const cmd=(who:Actor,action:string,extra={})=>applyCommand(r,who,{commandId:crypto.randomUUID(),revision:r.revision,action,...extra},now,now,{questions});
 cmd(coach,'start');
 for(let i=0;i<90;i++){
  cmd(coach,'next');for(const player of [a,b])cmd(player,'ack',{scheduleId:r.scheduleId});now+=4000;advance(r,now);
  for(const player of [a,b])cmd(player,'submit',{questionId:`q${i}`,answers:['Word']});
  expect(()=>cmd(a,'judge',{questionId:`q${i}`,team:1,points:1,text:'Forged'})).toThrow();
  expect(()=>cmd(coach,'next')).toThrow('Judge both');
  for(const team of [1,2])cmd(coach,'judge',{questionId:`q${i}`,team,points:1,text:'Verified'});
  cmd(coach,'next');
  if(i===44){expect(r.phase).toBe('Break');expect(()=>cmd(coach,'next')).toThrow('five-minute');now+=300000;advance(r,now);}
 }
 expect(r.status).toBe('Completed');expect(r.submissions).toHaveLength(180);
 expect(calculateAwards([r]).filter(x=>x.userId==='a').map(x=>x.key)).toEqual(['first-fellowship','shared-scribe','team-precision','rehearsal-complete']);
 const original=r.submissions[0].elapsedMs;cmd(a,'appeal',{questionId:'q0',text:'Review evidence'});expect(calculateAwards([r])).toHaveLength(0);
 cmd(coach,'judge',{questionId:'q0',team:1,points:0,text:'Corrected'});expect(r.submissions[0].elapsedMs).toBe(original);expect(r.submissions[0].speedHundredths).toBe(0);
 expect(trends([r],'a')[0]).toMatchObject({accuracyHundredths:8900,availableHundredths:9000,distinctQuestions:90,matches:1});
 const repeated=structuredClone(r);repeated.id='repeat';repeated.questions.forEach(q=>q.version++);
 expect(trends([r,repeated],'a')[0].distinctQuestions).toBe(90);
});
