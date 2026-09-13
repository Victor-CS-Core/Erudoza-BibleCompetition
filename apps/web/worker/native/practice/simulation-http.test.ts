// @vitest-environment node
import {expect,it} from 'vitest';
import {probeFixture} from './pbe-room-source-fixture';
import {TEST_ORG} from '../test-runtime';
it('returns assigned metadata and quota-safe availability without question or answer data; validates configure before commit',async()=>{
 const f=await probeFixture();try{const base=`/organizations/${TEST_ORG}/practice`;
 const material=await f.call(0,`${base}/simulation/material?seasonId=${f.season}`);expect(material.status).toBe(200);const m=await material.json() as {books:{key:string;chapters:number[]}[]};expect(m.books).toEqual([expect.objectContaining({key:'GEN',chapters:[1]})]);expect(JSON.stringify(m)).not.toMatch(/canonicalText|acceptedAnswers|Alpha/);
 const simulation={version:1,preset:'ShortPractice',bookKeys:['GEN'],chapters:[{bookKey:'GEN',chapter:1}],includeScripture:true,includeIntroductions:true,timeMultiplier:1,halfTime:false,discussion:'InPerson',audioPresenterId:f.players[0].id};
 const input={seasonId:f.season,teamSize:2,questionCount:10,simulation};const available=await f.call(0,`${base}/simulation/availability`,input);expect(available.status).toBe(200);expect(await available.json()).toMatchObject({eligibleQuestions:91,requestedQuestions:10,canStart:true,reason:null});
 const created=await f.call(0,`${base}/rooms`,{...input,format:'Pbe',teamCount:1});expect(created.status).toBe(200);const room=await created.json() as {id:string;revision:number};
 const invalid=await f.call(0,`${base}/rooms/${room.id}/commands`,{commandId:crypto.randomUUID(),revision:room.revision,action:'configure',teamSize:3,simulation:{...simulation,chapters:[{bookKey:'GEN',chapter:99}]}});expect(invalid.status).toBe(400);
 const saved=await (await f.call(0,`${base}/rooms/${room.id}`)).json();expect(saved).toMatchObject({teamSize:2,revision:room.revision,simulation});
 const denied=await f.call(1,`${base}/simulation/availability`,{...input,roomId:room.id});expect(denied.status).toBe(403);
 }finally{await f.app.runtime.dispose();}
},60000);
it('completes a versioned rehearsal through real room authority and projects a selectable simulation patch',async()=>{
 const f=await probeFixture();try{const base=`/organizations/${TEST_ORG}/practice`,simulation={version:1,preset:'ShortPractice',bookKeys:[],chapters:[],includeScripture:true,includeIntroductions:true,timeMultiplier:1,halfTime:false,discussion:'InPerson',audioPresenterId:f.players[0].id};
 let r=await (await f.call(0,`${base}/rooms`,{seasonId:f.season,teamSize:2,questionCount:10,format:'Pbe',teamCount:1,simulation})).json() as import('./state').Room & {question:{id:string}};
 const command=async(n:number,action:string,extra={})=>{const response=await f.call(n,`${base}/rooms/${r.id}/commands`,{commandId:crypto.randomUUID(),revision:r.revision,action,...extra});expect(response.status,await response.clone().text()).toBe(200);r=await response.json() as typeof r;};
 await command(0,'invite',{targetUserId:f.players[1].id,team:1});const inbox=await (await f.call(1,`${base}/bootstrap`)).json() as {invitations:{id:string}[]};r=await (await f.call(1,`${base}/invitations/${inbox.invitations[0].id}/accept`,{team:1})).json() as typeof r;
 await command(0,'ready');await command(1,'ready');await command(0,'start');
 for(let q=0;q<10;q++){await command(0,'present',{questionId:r.question.id,delivery:'TextFallback'});f.advance(3000);await command(0,'submit',{questionId:r.question.id,answers:['Alpha','Beta']});expect(r.phase).toBe('AnswerLocked');f.advance(3000);r=await (await f.call(0,`${base}/rooms/${r.id}`)).json() as typeof r;expect(r.phase).toBe('Review');f.advance(10000);r=await (await f.call(0,`${base}/rooms/${r.id}`)).json() as typeof r;}
 expect(r.status).toBe('Completed');
 for(let i=0;i<50;i++){f.advance(5000);await f.call(0,`${base}/rooms/${r.id}`,undefined,{'x-test-room-alarm':'1'});const saved=await f.store.get('mastery-honor',`${TEST_ORG}:${f.players[0].id}:simulation-v1:simulation:first-rehearsal`,TEST_ORG);if(saved)break;}
 const profile=await f.app.fetch('/api/v1/profile/me/avatar',{method:'PUT',headers:{Cookie:f.players[0].cookie,Origin:'https://erudoza.test'},body:JSON.stringify({honorKey:'simulation:first-rehearsal'})});expect(profile.status,await profile.clone().text()).toBe(200);expect(await profile.json()).toMatchObject({avatarHonorKey:'simulation:first-rehearsal'});
 const bootstrap=await (await f.call(0,`${base}/bootstrap`)).json() as {simulationAchievements:{key:string;current:number;earnedAtUtc:string|null}[]};expect(bootstrap.simulationAchievements.find(a=>a.key==='simulation:first-rehearsal')).toMatchObject({current:1,earnedAtUtc:expect.any(String)});
 }finally{await f.app.runtime.dispose();}
},60000);
it('uses complementary roster assignments for room material and prospective availability without changing saved setup',async()=>{
 const f=await probeFixture();try{const base=`/organizations/${TEST_ORG}/practice`,simulation={version:1,scope:'AllAssigned',preset:'ShortPractice',bookKeys:['GEN'],chapters:[],includeScripture:true,includeIntroductions:true,timeMultiplier:1,halfTime:false,discussion:'InPerson',audioPresenterId:f.players[0].id};
 const sources=await f.store.list<import('../application/model').Source>('source',TEST_ORG),source={...sources[0],id:crypto.randomUUID(),bookKey:'EXO',citation:'Exodus 1:1'};await f.store.insert('source',source.id,TEST_ORG,source,{ownerId:source.contentPackId});
 const scope=await f.store.require<{contentPackId:string;includes:unknown[];excludes:unknown[]}>('scope',f.season,TEST_ORG),range={bookKey:'EXO',startChapter:1,startVerse:1,endChapter:1,endVerse:1};await f.store.put('scope',f.season,TEST_ORG,{...scope.value,includes:[...scope.value.includes,range]},scope.revision);
 await f.app.db.prepare("UPDATE Records SET data=json_set(data,'$.bookKey','EXO') WHERE kind='assignment' AND org_id=? AND season_id=? AND owner_id=?").bind(TEST_ORG,f.season,f.players[1].id).run();
 const qrow=(await f.store.list<{question:import('../pbe/types').PbeQuestion}>('pbe-question-head',TEST_ORG,{seasonId:f.season}))[0];const {sourceProof}=await import('../pbe/bank');
 for(let i=0;i<11;i++){const q={...qrow.question,id:crypto.randomUUID(),sourceUnitId:source.id,sourceUnitIds:[source.id],reference:source.citation};await f.store.insert('pbe-question-head',q.id,TEST_ORG,{id:q.id,seasonId:f.season,published:true,sourceFingerprint:await sourceProof(q,new Map([[source.id,source]])),question:q},{seasonId:f.season,ownerId:source.id});}
 let r=await (await f.call(0,`${base}/rooms`,{seasonId:f.season,teamSize:2,questionCount:10,format:'Pbe',teamCount:1,simulation})).json() as {id:string;revision:number};
 const invite=await f.call(0,`${base}/rooms/${r.id}/commands`,{commandId:crypto.randomUUID(),revision:r.revision,action:'invite',targetUserId:f.players[1].id,team:1});expect(invite.status).toBe(200);
 const inbox=await (await f.call(1,`${base}/bootstrap`)).json() as {invitations:{id:string}[]};r=await (await f.call(1,`${base}/invitations/${inbox.invitations[0].id}/accept`,{team:1})).json() as typeof r;
 const material=await (await f.call(0,`${base}/simulation/material?seasonId=${f.season}&roomId=${r.id}`)).json() as {books:{key:string}[]};expect(material.books.map(b=>b.key)).toEqual(['EXO','GEN']);
 const available=await f.call(0,`${base}/simulation/availability`,{seasonId:f.season,roomId:r.id,teamSize:2,questionCount:30,simulation:{...simulation,scope:'SelectedChapters',bookKeys:['EXO'],chapters:[{bookKey:'EXO',chapter:1}]}});expect(available.status,await available.clone().text()).toBe(200);expect(await available.json()).toMatchObject({requestedQuestions:30,canStart:false});
 expect(await (await f.call(0,`${base}/rooms/${r.id}`)).json()).toMatchObject({questionCount:10,revision:r.revision,simulation});
 }finally{await f.app.runtime.dispose();}
},60000);
