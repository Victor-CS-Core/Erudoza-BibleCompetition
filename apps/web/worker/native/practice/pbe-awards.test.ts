import {expect,it} from 'vitest';
import {advance,applyCommand,join,makeRoom,teamAttemptId} from './state';
import {calculateAwards,trends} from './awards';
import {overlayRoom,type PbeResultOverlay} from '../pbe/result-overlays';
import {teamQualifiers} from '../mastery/team-rules';
import type {Actor} from '../types';
it('keeps PBE participation while the decisive score is pending, then qualifies one versioned team award without personal recall proof',()=>{
 const actor=(n:number):Actor=>({userId:`student-${n}`,organizationId:'org',organizationName:'Org',displayName:`Student ${n}`,userName:`s${n}`,email:null,kind:'Student',role:'Student',credentialVersion:'v1'});
 let now=1000;const r=makeRoom('room',actor(0),{seasonId:'season',format:'Pbe',teamCount:1,teamSize:2,questionCount:30},'epoch',now);join(r,actor(1),1);r.members.forEach(m=>m.ready=true);
 const questions=Array.from({length:31},()=>({schemaVersion:2 as const,id:crypto.randomUUID(),version:1,contentPackId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sourceUnitId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',sourceUnitIds:['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],sourceKind:'Scripture' as const,kind:'ExactWords' as const,prompt:'Quote the label',reference:'Synthetic 1:1',evidence:'the answer',ordered:true,parts:[{targetId:crypto.randomUUID(),acceptedAnswers:['the answer'],points:2}]}));
 const cmd=(action:string,extra:Record<string,unknown>={})=>applyCommand(r,actor(0),{commandId:crypto.randomUUID(),revision:r.revision,action,...extra},now,now,{questions});cmd('start');
 for(let q=0;q<30;q++){cmd('present',{questionId:r.questions[q].id,delivery:'TextFallback'});now+=3000;advance(r,now);cmd('submit',{questionId:r.questions[q].id,answers:[q===0?'wrong':'the answer']});now+=10000;advance(r,now);if(r.phase==='Break'){now+=300000;advance(r,now);}}
 expect(r.status).toBe('Completed');const original=JSON.stringify(r),attemptId=teamAttemptId(r,r.submissions[0]);
 const overlay:PbeResultOverlay={id:'Team:room',activity:'Team',sessionId:'room',entries:{[attemptId]:{id:'dispute',status:'Pending',revision:1,questionId:r.questions[0].id,questionVersion:1,pointsByPart:null}}};
 const pending=overlayRoom(r,overlay),awards=calculateAwards([pending]).filter(a=>a.userId===actor(0).userId);
 expect(awards.map(a=>a.key)).toContain('pbe-team-v1:first-fellowship');expect(awards.map(a=>a.key)).not.toContain('pbe-team-v1:team-precision');
 expect(trends([pending],actor(0).userId)[0]).toMatchObject({matches:1,pendingCount:1,provisional:true,accuracyHundredths:5800,availableHundredths:5800});
 overlay.entries[attemptId]={...overlay.entries[attemptId],status:'Resolved',revision:2,pointsByPart:[2]};const final=overlayRoom(r,overlay);
 expect(calculateAwards([final]).filter(a=>a.userId===actor(0).userId&&a.key==='pbe-team-v1:team-precision')).toHaveLength(1);expect(calculateAwards([overlayRoom(r,overlay)])).toEqual(calculateAwards([final]));expect(teamQualifiers([final],actor(0).userId)).toEqual([]);expect(JSON.stringify(r)).toBe(original);
});
