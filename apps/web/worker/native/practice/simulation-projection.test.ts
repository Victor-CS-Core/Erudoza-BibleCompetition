// @vitest-environment node
import {expect,it} from 'vitest';
import {createNativeTestApp,TEST_ORG,TEST_USER} from '../test-runtime';
import {makeRoom} from './state';
import type {Actor} from '../types';
import {honorId} from '../mastery/catalog';
it('reconciles corrected precision eligibility without deleting immutable honors or duplicating replay awards',async()=>{
 const app=await createNativeTestApp();try{
 const actor={userId:TEST_USER,organizationId:TEST_ORG,displayName:'Student',kind:'Student',role:'Student'} as Actor;
 const r=makeRoom(crypto.randomUUID(),actor,{seasonId:crypto.randomUUID(),teamSize:2,teamCount:1,questionCount:30,format:'Pbe',simulation:{version:1,preset:'ShortPractice',bookKeys:[],chapters:[],includeScripture:true,includeIntroductions:true,timeMultiplier:1,halfTime:false,discussion:'InPerson',audioPresenterId:TEST_USER}},'epoch',1);
 r.status='Completed';r.completedAt='2026-09-13T00:00:00Z';r.questions=Array.from({length:30},(_,i)=>({id:`q${i}`,version:1,contentPackId:'pack',sourceUnitId:'source',kind:'ShortAnswer',prompt:'Question',reference:'Synthetic',evidence:'Answer',ordered:false,parts:[{points:1,acceptedAnswers:['Answer']}]}));r.services=r.questions.map(q=>({id:crypto.randomUUID(),questionId:q.id,questionKind:q.kind,targetIds:[],memberIds:[TEST_USER],atMs:1}));r.submissions=r.questions.map(q=>({questionId:q.id,team:1,scribeId:TEST_USER,answers:['Answer'],elapsedMs:1000,deadlineDraft:false,accuracyHundredths:100,speedHundredths:0,appealed:false,resolved:true}));
 const namespace=await app.runtime.getDurableObjectNamespace('REPORTS'),stub=namespace.get(namespace.idFromName(`${TEST_ORG}:${r.seasonId}`));const project=()=>stub.fetch('https://internal/project',{method:'POST',body:JSON.stringify(r)});
 let response=await project();expect(response.status,await response.clone().text()).toBe(200);const key='simulation:team-precision',id=honorId(TEST_ORG,TEST_USER,key),read=()=>app.db.prepare("SELECT data FROM Records WHERE kind='mastery-honor' AND id=? AND org_id=?").bind(id,TEST_ORG).first<{data:string}>(),original=await read();expect(original).not.toBeNull();
 response=await project();expect(response.status).toBe(200);expect(await read()).toEqual(original);
 r.revision++;r.submissions.forEach(s=>s.accuracyHundredths=0);response=await project();expect(response.status,await response.clone().text()).toBe(200);expect(await read()).toEqual(original);
 const evidence=await app.db.prepare("SELECT json_extract(data,'$.eligible') eligible FROM Records WHERE kind='simulation-eligibility' AND id=? AND org_id=?").bind(`${id}:${r.seasonId}`,TEST_ORG).first<{eligible:number}>();expect(evidence?.eligible).toBe(0);
 const cookie=(await app.login()).headers.get('set-cookie')!.split(';')[0];response=await app.fetch('/api/v1/profile/me/avatar',{method:'PUT',headers:{Cookie:cookie,Origin:'https://erudoza.test'},body:JSON.stringify({honorKey:key})});expect(response.status).toBe(403);
 r.revision++;r.submissions.forEach(s=>s.accuracyHundredths=100);expect((await project()).status).toBe(200);expect(await read()).toEqual(original);response=await app.fetch('/api/v1/profile/me/avatar',{method:'PUT',headers:{Cookie:cookie,Origin:'https://erudoza.test'},body:JSON.stringify({honorKey:key})});expect(response.status).toBe(200);
 }finally{await app.runtime.dispose();}
},30000);
