import {expect,it} from 'vitest';
import {simulationAchievements} from './simulation-awards';
import type {RoomStats} from './room-history';
function room(id:string,date:string,count=10):RoomStats{return {id,orgId:'org',seasonId:'season',revision:1,format:'Pbe',status:'Completed',teamCount:1,teamSize:2,questionCount:count,coached:false,completedAt:date,simulation:{version:1,preset:'Custom',bookKeys:[],chapters:[],includeScripture:true,includeIntroductions:true,timeMultiplier:1,halfTime:false,discussion:'InPerson',audioPresenterId:'a'},members:[{userId:'a',displayName:'A',team:1,ready:true,captain:true,scribe:true}],contributions:[],services:Array.from({length:count},(_,n)=>({id:`${id}-${n}`,questionId:`${id}-${n}`,questionKind:'ShortAnswer',targetIds:[],memberIds:['a'],atMs:Date.parse(date)-1000})),questions:Array.from({length:count},(_,n)=>({id:`${id}-${n}`,version:1,sourceUnitId:'source',parts:[{points:1}]})),submissions:Array.from({length:count},(_,n)=>({questionId:`${id}-${n}`,team:1,scribeId:'a',elapsedMs:1000,deadlineDraft:false,accuracyHundredths:100,speedHundredths:0,appealed:false,resolved:true}))};}
it('counts only served versioned completed simulation evidence and reports every requirement',()=>{
 const r=room('r','2026-09-10T12:00:00Z');const progress=simulationAchievements([r,{...r,id:'pvp',teamCount:2},{...r,id:'lobby',status:'Lobby'},{...r,id:'unserved',services:[]}],'org','a',['season']);
 expect(progress).toHaveLength(5);expect(progress.find(p=>p.key==='simulation:first-rehearsal')).toMatchObject({current:1,target:1,earnedAtUtc:r.completedAt});expect(progress.find(p=>p.key==='simulation:trusted-scribe')).toMatchObject({current:10,earnedAtUtc:null});
});
it('requires three UTC dates, manual distinct submissions and resolved latest accuracy; replay corrections revoke precision',()=>{
 const rooms=[room('a','2026-09-10T12:00:00Z'),room('b','2026-09-10T13:00:00Z'),room('c','2026-09-11T12:00:00Z'),room('d','2026-09-12T12:00:00Z'),room('e','2026-09-12T13:00:00Z')];
 let progress=simulationAchievements(rooms,'org','a',['season']);expect(progress.every(p=>p.key==='simulation:event-ready'||p.earnedAtUtc)).toBe(true);
 const repeated={...rooms[0],id:'z',completedAt:'2026-09-13T12:00:00Z',submissions:rooms[0].submissions.map(s=>({...s,resolved:false}))};
 progress=simulationAchievements([...rooms,repeated],'org','a',['season']);expect(progress.find(p=>p.key==='simulation:team-precision')).toMatchObject({current:40,earnedAtUtc:null});
 repeated.submissions=repeated.submissions.map(s=>({...s,resolved:true,accuracyHundredths:0}));expect(simulationAchievements([...rooms,repeated],'org','a',['season']).find(p=>p.key==='simulation:team-precision')?.earnedAtUtc).toBeNull();
 expect(simulationAchievements(rooms,'other-org','a',['season']).every(p=>!p.earnedAtUtc)).toBe(true);
});
it('orders repeated questions by accepted server response time before completion and stable room ID',()=>{
 const older=room('old','2026-09-13T00:00:00Z',30);older.submissions.forEach(s=>{s.responseLockedAtMs=1000;s.accuracyHundredths=100;});
 const newer={...older,id:'new',completedAt:'2026-09-12T00:00:00Z',submissions:older.submissions.map(s=>({...s,responseLockedAtMs:2000,accuracyHundredths:0}))};
 expect(simulationAchievements([older,newer],'org','a',['season']).find(a=>a.key==='simulation:team-precision')?.earnedAtUtc).toBeNull();
});
