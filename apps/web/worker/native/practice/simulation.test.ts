import {expect,it} from 'vitest';
import {makeRoom,join,applyCommand,advance,view,recover} from './state';
import type {Actor} from '../types';
const actor=(id:string):Actor=>({userId:id,organizationId:'org',organizationName:'Org',displayName:id,userName:id,email:null,kind:'Student',role:'Student',credentialVersion:'v1'});
const settings={version:1 as const,preset:'Custom' as const,bookKeys:['JHN'],chapters:[{bookKey:'JHN',chapter:1}],includeScripture:true,includeIntroductions:true,timeMultiplier:2 as const,halfTime:false,discussion:'InPerson' as const,audioPresenterId:'a'};
const qid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const question=(n:number)=>({schemaVersion:2 as const,id:qid(n),version:1,contentPackId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sourceUnitId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',sourceUnitIds:['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],sourceKind:'Scripture' as const,kind:'ExactWords' as const,prompt:'Quote',reference:'John 1:1',evidence:'answer',ordered:true,parts:[{targetId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',acceptedAnswers:['answer'],points:2}]});
function room(){return makeRoom('r',actor('a'),{seasonId:'season',teamSize:2,teamCount:1,questionCount:10,format:'Pbe',simulation:settings},'epoch',1000);}
it('persists validated versioned settings and rejects incompatible presets and formats',()=>{
 expect(room().simulation).toEqual(settings);
 expect(()=>makeRoom('r',actor('a'),{seasonId:'season',teamSize:2,teamCount:2,questionCount:10,format:'Pbe',simulation:settings},'e',1)).toThrow();
 expect(()=>makeRoom('r',actor('a'),{seasonId:'season',teamSize:2,teamCount:1,questionCount:10,format:'Pbe',simulation:{...settings,preset:'FullEvent'}},'e',1)).toThrow();
});
it('configures atomically in lobby with revision, ownership and roster fences',()=>{
 const r=room();join(r,actor('b'),1);r.members.forEach(m=>m.ready=true);
 const c={commandId:crypto.randomUUID(),revision:r.revision,action:'configure',simulation:{...settings,timeMultiplier:1 as const},teamSize:3,questionCount:30};
 expect(()=>applyCommand(r,actor('b'),c,1000,1000)).toThrow();expect(r.teamSize).toBe(2);
 applyCommand(r,actor('a'),c,1000,1000);expect(r.teamSize).toBe(3);expect(r.members.every(m=>!m.ready)).toBe(true);
 applyCommand(r,actor('a'),c,1000,1000);expect(r.revision).toBe(c.revision+1);
 expect(()=>applyCommand(r,actor('a'),{...c,commandId:crypto.randomUUID(),revision:r.revision,teamSize:1},1000,1000)).toThrow();expect(r.teamSize).toBe(3);
});
it('waits for one presenter and separate scribe, uses extended deadline and hides locked answers',()=>{
 const r=room();join(r,actor('b'),1);r.members.forEach(m=>{m.ready=true;m.scribe=m.userId==='b';});let now=1000;
 const c=(id:string,action:string,extra={})=>applyCommand(r,actor(id),{commandId:crypto.randomUUID(),revision:r.revision,action,...extra},now,now,{questions:Array.from({length:11},(_,n)=>question(n))});
 c('a','start');expect(()=>c('b','present',{questionId:qid(0),delivery:'Audio'})).toThrow();
 c('a','present',{questionId:qid(0),delivery:'Audio'});expect(r.phase).toBe('Presentation');expect(view(r,actor('b'),now).audioReadingComplete).toBe(true);
 c('b','present-ready',{questionId:qid(0)});expect(r.phase).toBe('Scheduled');now+=3000;advance(r,now);expect(view(r,actor('b'),now).question?.durationSeconds).toBe(60);
 now+=45000;c('b','submit',{questionId:qid(0),answers:['answer']});expect(r.phase).toBe('AnswerLocked');expect(view(r,actor('b'),now).results).toEqual([]);expect(r.submissions[0].accuracyHundredths).toBe(200);
 now+=3000;advance(r,now);expect(r.phase).toBe('Review');expect(view(r,actor('b'),now).results[0].acceptedAnswers).toEqual([['answer']]);
 r.phase='Break';r.phaseEndsAt=now+1234;recover(r,'new',now+1,'runtime-replacement');expect(r.phaseEndsAt).toBe(now+1234);
});

it('rejects stale chapter choices instead of broadening scope and excludes disabled source kinds',async()=>{
 const {filterSimulationSources}=await import('./simulation');const source={id:'s',contentPackId:'p',sourceKind:'Scripture' as const,bookKey:'JHN',chapter:1,verse:1,ordinal:1,citation:'John 1:1',canonicalText:'private'};
 expect(()=>filterSimulationSources([source],{...settings,chapters:[{bookKey:'JHN',chapter:2}]})).toThrow(/no longer available/);
 expect(filterSimulationSources([source],{...settings,includeScripture:false})).toEqual([]);
});
it('recovers a trusted draft into the locked phase without revealing before three seconds',()=>{
 const r=room();join(r,actor('b'),1);r.members.forEach(m=>m.ready=true);const c=(action:string,extra={})=>applyCommand(r,actor('a'),{commandId:crypto.randomUUID(),revision:r.revision,action,...extra},1000,1000,{questions:Array.from({length:11},(_,n)=>question(n))});
 c('start');c('present',{questionId:qid(0),delivery:'Audio'});advance(r,4000);applyCommand(r,actor('a'),{commandId:crypto.randomUUID(),revision:r.revision,action:'draft',questionId:qid(0),answers:['answer']},45000,45000);
 recover(r,'new',45001,'runtime-replacement');expect(r.phase).toBe('AnswerLocked');expect(view(r,actor('a'),45001).results).toEqual([]);advance(r,48001);expect(r.phase).toBe('Review');
});
it.each([true,false])('completes 90 simulation questions with configured halftime=%s and stable role recovery',halfTime=>{
 const r=makeRoom('r',actor('a'),{seasonId:'season',teamSize:2,teamCount:1,questionCount:90,format:'Pbe',simulation:{...settings,preset:halfTime?'FullEvent':'Custom',timeMultiplier:1,halfTime}},'epoch',1000);join(r,actor('b'),1);r.members.forEach(m=>m.ready=true);let now=1000,breaks=0;
 const c=(action:string,extra={})=>applyCommand(r,actor('a'),{commandId:crypto.randomUUID(),revision:r.revision,action,...extra},now,now,{questions:Array.from({length:91},(_,n)=>question(n))});c('start');
 for(let i=0;i<90;i++){c('present',{questionId:qid(i),delivery:'TextFallback'});now+=3000;advance(r,now);c('submit',{questionId:qid(i),answers:['answer']});expect(r.phase).toBe('AnswerLocked');now+=3000;advance(r,now);now+=10000;advance(r,now);if(r.phase==='Break'){breaks++;const deadline=r.phaseEndsAt;recover(r,'another',now+1,'runtime-replacement');expect(r.phaseEndsAt).toBe(deadline);now+=300000;advance(r,now);}}
 expect(r.status).toBe('Completed');expect(r.services).toHaveLength(90);expect(breaks).toBe(halfTime?1:0);
});
it('resets readings and readiness when presenter is recovered and rejects stale revision',()=>{
 const r=room();join(r,actor('b'),1);r.members.forEach(m=>{m.ready=true;m.scribe=m.userId==='b';});const c=(id:string,action:string,extra={})=>applyCommand(r,actor(id),{commandId:crypto.randomUUID(),revision:r.revision,action,...extra},1000,1000,{questions:Array.from({length:11},(_,n)=>question(n))});
 c('a','start');c('b','present-ready',{questionId:qid(0)});expect(r.coachReadyScribeIds).toEqual(['b']);c('a','presenter',{targetUserId:'b'});expect(r.coachReadyScribeIds).toEqual([]);expect(r.audioReadingComplete).toBe(false);c('b','present',{questionId:qid(0),delivery:'Audio'});expect(r.phase).toBe('Scheduled');
});
it('keeps explicit selected chapters from collapsing to all scope and resolves all-assigned beyond creator books',async()=>{
 const {filterSimulationSources,validateSimulation}=await import('./simulation');const source={id:'s',contentPackId:'p',sourceKind:'Scripture' as const,bookKey:'GEN',chapter:1,verse:1,ordinal:1,citation:'Genesis 1:1',canonicalText:'private'};
 expect(()=>validateSimulation({...settings,scope:'SelectedChapters',chapters:[]},10,['a'])).toThrow();
 expect(filterSimulationSources([source],{...settings,scope:'AllAssigned',chapters:[]})).toEqual([source]);
});
it('requires replacement of a departed audio presenter before starting',()=>{
 const r=room();join(r,actor('b'),1);const c=(id:string,action:string,extra={})=>applyCommand(r,actor(id),{commandId:crypto.randomUUID(),revision:r.revision,action,...extra},1000,1000,{questions:Array.from({length:11},(_,n)=>question(n))});
 c('a','owner',{targetUserId:'b'});c('b','remove',{targetUserId:'a'});join(r,actor('c'),1);r.members.forEach(m=>m.ready=true);expect(()=>c('b','start')).toThrow(/presenter/);c('b','presenter',{targetUserId:'b'});r.members.forEach(m=>m.ready=true);c('b','start');expect(r.status).toBe('Playing');
});
