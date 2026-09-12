import { expect, it } from 'vitest';
import { makeRoom, join, applyCommand, advance, recover, view } from './state';
import type { Actor } from '../types';
const actor=(n:number):Actor=>({userId:`player-${n}`,organizationId:'org',organizationName:'Org',displayName:`Player ${n}`,userName:`p${n}`,email:null,kind:'Student',role:'Student',credentialVersion:'v1'});
const question=(n:number)=>({schemaVersion:2 as const,id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,version:1,contentPackId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sourceUnitId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',sourceUnitIds:['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],sourceKind:'Scripture' as const,kind:'ExactWords' as const,prompt:`Quote ${n}`,reference:'Synthetic 1:1',evidence:'the answer',ordered:true,parts:[{targetId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',acceptedAnswers:['the answer'],points:2}]});
it('creates an independent one-team rehearsal with six seats',()=>{
 const room=makeRoom('room',actor(0),{seasonId:'season',teamSize:6,teamCount:1,questionCount:90,coached:false,format:'Pbe'},'epoch',1000);
 expect(room).toMatchObject({teamCount:1,teamSize:6,coached:false,format:'Pbe'});
});
it.each([1,2] as const)('completes a genuine 90-question PBE state journey with %i active teams',teamCount=>{
 let now=1000;const r=makeRoom('room',actor(0),{seasonId:'season',teamSize:6,teamCount,questionCount:90,coached:false,format:'Pbe'},'epoch',now);
 const command=(n:number,action:string,extra:Record<string,unknown>={})=>applyCommand(r,actor(n),{commandId:crypto.randomUUID(),revision:r.revision,action,...extra},now,now);
 for(let n=1;n<teamCount*6;n++)join(r,actor(n),Math.floor(n/6)+1);
 for(let n=0;n<teamCount*6;n++)command(n,'ready');
 const questions=Array.from({length:91},(_,n)=>question(n+1));
 applyCommand(r,actor(0),{commandId:crypto.randomUUID(),revision:r.revision,action:'start'},now,now,{questions});
 questions[0].parts[0].acceptedAnswers[0]='mutated';
 expect(r.questions[0].parts[0].acceptedAnswers).toEqual(['the answer']);
 expect(()=>command(1,'present',{questionId:r.questions[0].id,delivery:'TextFallback'})).toThrow();
 let breaks=0;
 for(let q=0;q<90;q++){
  expect(r.questionIndex).toBe(q);expect(r.phase).toBe('Presentation');
  for(const scribe of r.members.filter(m=>m.scribe))command(Number(scribe.userId.split('-')[1]),'present',{questionId:r.questions[q].id,delivery:scribe.team===1?'Audio':'TextFallback'});
  expect(r.phase).toBe('Scheduled');now+=3000;advance(r,now);expect(r.phase).toBe('Response');
  expect(()=>command(0,'scribe',{targetUserId:'player-1'})).toThrow(/between questions/);
  if(q===1){now+=30001;advance(r,now);}else for(const scribe of r.members.filter(m=>m.scribe))command(Number(scribe.userId.split('-')[1]),'submit',{questionId:r.questions[q].id,answers:['the answer']});
  expect(r.phase).toBe('Review');now+=10000;advance(r,now);
  if(r.phase==='Break'){breaks++;expect(q).toBe(44);now+=300000;advance(r,now);}
 }
 expect(r.status).toBe('Completed');expect(breaks).toBe(1);expect(r.submissions).toHaveLength(90*teamCount);
 expect(r.submissions.every(s=>s.speedHundredths===0)).toBe(true);
 const result=view(r,actor(0),now);expect(result.scores).toHaveLength(teamCount);expect(result.scores[0].accuracyHundredths).toBe(89*200);
 expect(result.scores[0].availableHundredths).toBe(90*200);
});
it('does not erase a locked team answer or restart an armed window after clock loss',()=>{
 let now=1000;const r=makeRoom('room',actor(0),{seasonId:'season',teamSize:2,teamCount:2,questionCount:10,coached:false,format:'Pbe'},'epoch',now);
 for(let n=1;n<4;n++)join(r,actor(n),Math.floor(n/2)+1);r.members.forEach(m=>m.ready=true);
 const c=(n:number,action:string,extra:Record<string,unknown>={})=>applyCommand(r,actor(n),{commandId:crypto.randomUUID(),revision:r.revision,action,...extra},now,now,{questions:Array.from({length:11},(_,n)=>question(n+1))});
 c(0,'start');c(0,'present',{questionId:r.questions[0].id,delivery:'Audio'});c(2,'present',{questionId:r.questions[0].id,delivery:'TextFallback'});now+=3000;advance(r,now);
 c(0,'submit',{questionId:r.questions[0].id,answers:['the answer']});recover(r,'replacement',now+1,'runtime-replacement');
 expect(r.status).toBe('Interrupted');expect(r.submissions).toHaveLength(1);expect(r.submissions[0].accuracyHundredths).toBe(200);
});
it('keeps the original armed schedule after a late ack and retains delivery and lock metadata',()=>{
 let now=1000;const r=makeRoom('room',actor(0),{seasonId:'season',teamSize:2,teamCount:1,questionCount:10,format:'Pbe'},'epoch',now);join(r,actor(1),1);r.members.forEach(m=>m.ready=true);
 const c=(action:string,extra:Record<string,unknown>={})=>applyCommand(r,actor(0),{commandId:crypto.randomUUID(),revision:r.revision,action,...extra},now,now,{questions:Array.from({length:11},(_,n)=>question(n+1))});
 c('start');c('present',{questionId:r.questions[0].id,delivery:'TextFallback'});const schedule=r.scheduleId,starts=r.responseStartsAt;now+=3100;c('ack',{scheduleId:schedule});expect(r.responseStartsAt).toBe(starts);expect(r.scheduleId).toBe(schedule);
 c('draft',{questionId:r.questions[0].id,answers:['the answer']});c('submit',{questionId:r.questions[0].id,answers:['the answer']});
 expect(r.submissions[0]).toMatchObject({responseLockedAtMs:now});
 expect(r.presentations?.[r.questions[0].id]).toMatchObject({scheduleId:schedule,responseStartsAt:starts,delivery:{'player-0':'TextFallback'}});
});
it.each(['quota','source'] as const)('ends incomplete without consuming a frozen reserve that violates %s bounds',reason=>{
 const r=makeRoom('room',actor(0),{seasonId:'season',teamSize:2,teamCount:1,questionCount:30,format:'Pbe'},'epoch',1000);join(r,actor(1),1);r.members.forEach(m=>m.ready=true);
 const bank=Array.from({length:31},(_,n)=>({...question(n+1),sourceKind:n>=28?'Commentary' as const:'Scripture' as const}));
 applyCommand(r,actor(0),{commandId:crypto.randomUUID(),revision:r.revision,action:'start'},1000,1000,{questions:bank});
 const original=r.questions[0].id,reserve=r.reserves[0].id;
 recover(r,'replacement',1001,'runtime-replacement',reason==='source'?new Set():new Set([reserve]));
 expect(r).toMatchObject({status:'Interrupted',interruptionReason:'UnarmedReserveUnavailable'});expect(r.questions[0].id).toBe(original);expect(r.reserves[0].id).toBe(reserve);expect(r.replacements??[]).toHaveLength(0);
});

it('keeps an independent coach owner outside student seats and lets the full student roster start',()=>{
 const coach:Actor={...actor(9),kind:'Adult',role:'Admin'};const r=makeRoom('room',coach,{seasonId:'season',format:'Pbe',teamCount:1,teamSize:2,questionCount:10},'epoch',1000);
 expect(r.coached).toBe(false);expect(r.members).toHaveLength(0);expect(()=>join(r,coach,1)).toThrow(/coach cannot play/);
 join(r,actor(0),1);join(r,actor(1),1);r.members.forEach(m=>m.ready=true);
 applyCommand(r,actor(0),{commandId:crypto.randomUUID(),revision:r.revision,action:'start'},1000,1000,{questions:Array.from({length:11},(_,n)=>question(n+1))});
 expect(r.status).toBe('Playing');expect(r.members).toHaveLength(2);expect(view(r,coach,1000).isCoach).toBe(true);
 recover(r,'replacement',1001,'runtime-replacement');expect(r.phase).toBe('Paused');applyCommand(r,actor(0),{commandId:crypto.randomUUID(),revision:r.revision,action:'next'},1001,1001);expect(r.phase).toBe('Presentation');
 expect(()=>applyCommand(r,coach,{commandId:crypto.randomUUID(),revision:r.revision,action:'present',questionId:r.questions[0].id,delivery:'TextFallback'},1000,1000)).toThrow();
});
