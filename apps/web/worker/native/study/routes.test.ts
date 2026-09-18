// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG, TEST_USER } from '../test-runtime';
import { handleStudy } from './routes';
import { MASTERY_VERSION } from './engine';
import type { Attempt, Session } from './routes';
import { Store } from '../store';
import type { Env, RequestContext } from '../types';
let app: Awaited<ReturnType<typeof createNativeTestApp>>;
let cookie: string;
const season = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', pack = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sourceIds = [1, 2, 3].map(n => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, '0')}`);
async function record(kind: string, id: string, value: unknown, seasonId: string | null = null, owner: string | null = null) {
  await app.db.prepare('INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) VALUES(?,?,?,?,?,?)').bind(kind,id,TEST_ORG,seasonId,owner,JSON.stringify(value)).run();
}
async function request(path: string, method = 'GET', value?: unknown) {
  return app.fetch(path,{method,headers:{Cookie:cookie,Origin:'https://erudoza.test','Content-Type':'application/json'},...(value === undefined ? {} : {body:JSON.stringify(value)})});
}
beforeAll(async () => {
  app = await createNativeTestApp();
  await app.db.prepare("UPDATE Users SET kind='Student',role='Student' WHERE id=?").bind(TEST_USER).run();
  cookie = (await app.login()).headers.get('set-cookie')!.split(';')[0];
  await record('season',season,{id:season,name:'Synthetic study',status:'Active',organizationId:TEST_ORG,ruleProfileKey:'PBE_STYLE_V1',ruleProfileVersion:1});
  await record('pack',pack,{id:pack,isActive:true,licensingStatus:'development-sample'});
  const range={bookKey:'GEN',startChapter:1,startVerse:1,endChapter:1,endVerse:3};
  await record('scope',season,{contentPackId:pack,includes:[range],excludes:[]});
  await record('assignment','assignment',{id:'assignment',seasonId:season,studentUserId:TEST_USER,contentPackId:pack,type:'PrimarySpecialist',...range},season,TEST_USER);
  await record('membership',`${season}:${TEST_USER}`,{id:`${season}:${TEST_USER}`,seasonId:season,userId:TEST_USER,studentUserId:TEST_USER,difficulty:'Foundation'},season,TEST_USER);
  for (const [i,id] of sourceIds.entries()) await record('source',id,{id,knowledgeUnitId:id,contentPackId:pack,citation:`Genesis 1:${i+1}`,bookKey:'GEN',chapter:1,verse:i+1,ordinal:i+1,canonicalText:`Synthetic verse ${i+1} has words for this exercise.`,isActive:true},null,pack);
},30000);
afterAll(async()=>{await app?.runtime.dispose();});
it('persists immutable cards, concurrent original attempts and resumable summaries',async()=>{
  const start=await request('/api/v1/study/sessions','POST',{seasonId:season,mode:'Practice'});
  expect(start.status).toBe(200);
  const session=await start.json() as {id:string;difficulty:string;targetCardCount:number};
  expect(session).toMatchObject({difficulty:'Foundation',targetCardCount:8});
  const base=`/api/v1/study/sessions/${session.id}`;
  const cards=await Promise.all([request(`${base}/next`),request(`${base}/next`)]);
  const card=await cards[0].json() as {id:string;debugAnswer:null;tokens:{display:string;hidden:boolean}[]};
  expect(await cards[1].json()).toEqual(card);
  expect(card.debugAnswer).toBeNull();
  expect(card.tokens.filter(t=>t.hidden).every(t=>t.display==='____')).toBe(true);
  const value={clientSubmissionId:'first',challengeCardId:card.id,submittedAnswer:'incorrect',responseTimeMs:10,hintsUsed:false};
  expect((await request(`${base}/attempts`,'POST',{...value,responseTimeMs:-1})).status).toBe(400);
  const results=await Promise.all([request(`${base}/attempts`,'POST',value),request(`${base}/attempts`,'POST',value)]);
  const original=await results[0].json() as {attemptId:string};
  expect(results.map(r=>r.status)).toEqual([200,200]);
  expect(await results[1].json()).toMatchObject({attemptId:original.attemptId});
  expect((await request(`${base}/attempts`,'POST',{...value,submittedAnswer:'changed'})).status).toBe(400);
  expect(await (await request(`${base}/attempts`,'POST',{...value,clientSubmissionId:'new-id'})).json()).toMatchObject({attemptId:original.attemptId,alreadyProcessed:true});
  expect(await (await request(base)).json()).toMatchObject({card:{id:card.id},attempt:{attemptId:original.attemptId}});
  expect(await (await request(`${base}/complete`,'POST')).json()).toMatchObject({attempted:1,correct:0,status:'Completed'});
  expect((await request(`${base}/next`)).status).toBe(400);
  expect(await (await request(`/api/v1/progress/me?seasonId=${season}`)).json()).toMatchObject({attemptCount:1,reviewDueCount:1});
  expect(await (await request('/api/v1/progress/me/seasons')).json()).toEqual([{id:season,name:'Synthetic study'}]);
});
it('runs the complete eight-card flow and rebuilds legacy mastery from original evidence',async()=>{
  const session=await (await request('/api/v1/study/sessions','POST',{seasonId:season,mode:'Practice'})).json() as {id:string};
  const base=`/api/v1/study/sessions/${session.id}`, types=new Set<string>();
  expect((await request(`${base}/complete`,'POST')).status).toBe(400);
  for(let n=0;n<8;n++) {
    const card=await (await request(`${base}/next`)).json() as {id:string;activityType:string}; types.add(card.activityType);
    const row=await app.db.prepare("SELECT data FROM Records WHERE kind='session' AND id=?").bind(session.id).first<{data:string}>();
    const saved=JSON.parse(row!.data).cards.find((c:{id:string})=>c.id===card.id);
    const value={clientSubmissionId:`flow-${n}`,challengeCardId:card.id,submittedAnswer:saved.answerKey.canonicalAnswer,responseTimeMs:30,hintsUsed:false};
    if(n===0) {
      await app.db.prepare("UPDATE Records SET data=json_set(data,'$.canonicalText','Modified after immutable card generation'),revision=revision+1 WHERE kind='source' AND id=?").bind(saved.sourceUnitId).run();
      expect(await (await request(`${base}/next`)).json()).toEqual(card);
    }
    const result=await (await request(`${base}/attempts`,'POST',value)).json() as {isCorrect:boolean;skillKey:string;skillLabel:string;skillScore:number};
    expect(result.isCorrect).toBe(true);
    expect(['exactWording','reference','sequence','recognition']).toContain(result.skillKey);
    expect(result.skillLabel).toBeTruthy();
    expect(result.skillScore).toBeGreaterThan(0);
    if(n===0) await app.db.prepare("UPDATE Records SET data=json_set(data,'$.algorithmVersion','v1-scaffold','$.exactWording',100,'$.recognition',100,'$.level','Mastered'),revision=revision+1 WHERE kind='mastery' AND json_extract(data,'$.knowledgeUnitId')=?").bind(saved.knowledgeUnitId).run();
  }
  expect(types).toEqual(new Set(['MissingWords','VerseBuilder','ReferenceMatch','TrueFalse','WhatComesNext']));
  expect((await request(`${base}/next`)).status).toBe(400);
  expect(await (await request(`${base}/complete`,'POST')).json()).toMatchObject({attempted:8,correct:8,status:'Completed'});
  expect(await (await request(base)).json()).toMatchObject({summary:{attempted:8,correct:8}});
  const mastery=await app.db.prepare("SELECT data FROM Records WHERE kind='mastery'").all<{data:string}>();
  expect(mastery.results.map(r=>JSON.parse(r.data)).every(m=>m.algorithmVersion===MASTERY_VERSION&&m.exactWording<=40)).toBe(true);
});
it('keeps mastery atomic across simultaneous sessions and freezes each session difficulty',async()=>{
  expect((await request('/api/v1/study/sessions','POST',{seasonId:season,mode:'Review'})).status).toBe(400);
  await app.db.prepare("UPDATE Records SET data=json_set(data,'$.includes[0].endVerse',1),revision=revision+1 WHERE kind='scope' AND id=?").bind(season).run();
  await app.db.prepare("UPDATE Records SET data=json_set(data,'$.difficulty','Advanced'),revision=revision+1 WHERE kind='membership'").run();
  const sessions=await Promise.all([1,2].map(async()=>await (await request('/api/v1/study/sessions','POST',{seasonId:season,mode:'Practice'})).json() as {id:string;difficulty:string}));
  expect(sessions.every(s=>s.difficulty==='Advanced')).toBe(true);
  await app.db.prepare("UPDATE Records SET data=json_set(data,'$.difficulty','Foundation'),revision=revision+1 WHERE kind='membership'").run();
  const cards=await Promise.all(sessions.map(async s=>await (await request(`/api/v1/study/sessions/${s.id}/next`)).json() as {id:string}));
  const before=JSON.parse((await app.db.prepare("SELECT data FROM Records WHERE kind='mastery' AND json_extract(data,'$.sourceUnitId')=?").bind(sourceIds[0]).first<{data:string}>())!.data);
  const responses=await Promise.all(sessions.map(async(s,i)=>{
    const row=await app.db.prepare("SELECT data FROM Records WHERE kind='session' AND id=?").bind(s.id).first<{data:string}>();
    const card=JSON.parse(row!.data).cards[0]; expect(card.payload.difficulty).toBe(5);
    return request(`/api/v1/study/sessions/${s.id}/attempts`,'POST',{clientSubmissionId:'cross-session',challengeCardId:cards[i].id,submittedAnswer:card.answerKey.canonicalAnswer,responseTimeMs:0,hintsUsed:false});
  }));
  expect(responses.map(r=>r.status)).toEqual([200,200]);
  const after=JSON.parse((await app.db.prepare("SELECT data FROM Records WHERE kind='mastery' AND json_extract(data,'$.sourceUnitId')=?").bind(sourceIds[0]).first<{data:string}>())!.data);
  expect(after.exactWording).toBe(Math.min(100,before.exactWording+36));
  expect(after.recognition).toBe(Math.min(100,before.recognition+20));
  await app.db.prepare("UPDATE Records SET data=json_set(data,'$.includes[0].endVerse',3),revision=revision+1 WHERE kind='scope' AND id=?").bind(season).run();
});
it('replays standalone migrated duplicates by original submission ID without granting evidence',async()=>{
  const saved=await app.db.prepare("SELECT data FROM Records WHERE kind='session' AND json_array_length(data,'$.attempts')>0 ORDER BY id LIMIT 1").first<{data:string}>();
  const session=JSON.parse(saved!.data) as Session,original=session.attempts[0];
  const duplicateId=crypto.randomUUID();
  const duplicate:Attempt={...original,id:duplicateId,clientSubmissionId:'migrated-duplicate',submittedAnswer:'original legacy payload',responseTimeMs:432,hintsUsed:true,isLegacyDuplicate:true,result:{...original.result,attemptId:duplicateId,canonicalAnswer:'original legacy feedback',exactWordingScore:7}};
  await record('attempt',duplicate.id,duplicate,season,TEST_USER);
  const beforeProgress=await (await request(`/api/v1/progress/me?seasonId=${season}`)).json();
  const beforeMastery=await app.db.prepare("SELECT data,revision FROM Records WHERE kind='mastery' ORDER BY id").all();
  const payload={clientSubmissionId:duplicate.clientSubmissionId,challengeCardId:duplicate.cardId,submittedAnswer:duplicate.submittedAnswer,responseTimeMs:duplicate.responseTimeMs,hintsUsed:duplicate.hintsUsed};
  const response=await request(`/api/v1/study/sessions/${session.id}/attempts`,'POST',payload);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({...duplicate.result,alreadyProcessed:true});
  expect((await request(`/api/v1/study/sessions/${session.id}/attempts`,'POST',{...payload,submittedAnswer:'changed'})).status).toBe(400);
  expect(await (await request(`/api/v1/progress/me?seasonId=${season}`)).json()).toEqual(beforeProgress);
  expect((await app.db.prepare("SELECT data,revision FROM Records WHERE kind='mastery' ORDER BY id").all()).results).toEqual(beforeMastery.results);
});
it('rebuilds evidence across sixty historical sessions within the Free plan query budget',async()=>{
  await app.db.prepare("UPDATE Records SET data=json_set(data,'$.includes[0].endVerse',1),revision=revision+1 WHERE kind='scope' AND id=?").bind(season).run();
  const started=await (await request('/api/v1/study/sessions','POST',{seasonId:season,mode:'Practice'})).json() as {id:string};
  await request(`/api/v1/study/sessions/${started.id}/next`);
  const stored=await app.db.prepare("SELECT data FROM Records WHERE kind='session' AND id=?").bind(started.id).first<{data:string}>();
  const session=JSON.parse(stored!.data) as Session,card=session.cards[0];
  for(let i=0;i<60;i++) {
    const sid=crypto.randomUUID(),cid=crypto.randomUUID(),aid=crypto.randomUUID(),at=new Date(Date.UTC(2020,0,i+1)).toISOString();
    const historicalCard={...card,id:cid,answerMode:'ShortFact',activityType:'ReferenceMatch'};
    const attempt={id:aid,sessionId:sid,cardId:cid,studentUserId:TEST_USER,seasonId:season,sourceUnitId:card.sourceUnitId,knowledgeUnitId:card.knowledgeUnitId,clientSubmissionId:aid,submittedAnswer:card.source.citation,responseTimeMs:1,hintsUsed:false,isCorrect:true,evaluationResult:'ExactMatch',activityType:'ReferenceMatch',at};
    await record('session',sid,{...session,id:sid,status:'Completed',cards:[historicalCard],attempts:[attempt]},season,TEST_USER);
    await record('attempt',aid,attempt,season,TEST_USER);
  }
  await app.db.prepare("UPDATE Records SET data=json_set(data,'$.algorithmVersion','v1-scaffold'),revision=revision+1 WHERE kind='mastery' AND json_extract(data,'$.knowledgeUnitId')=?").bind(card.knowledgeUnitId).run();
  let queries=0;
  const db={prepare(sql:string){if(++queries>48)throw new Error('Free plan request query budget exceeded');return app.db.prepare(sql);},batch:app.db.batch.bind(app.db)} as unknown as Env['DB'];
  const url=`https://erudoza.test/api/v1/study/sessions/${session.id}/attempts`;
  const ctx:RequestContext={request:new Request(url,{method:'POST',body:JSON.stringify({clientSubmissionId:'after-sixty',challengeCardId:card.id,submittedAnswer:card.answerKey.canonicalAnswer,responseTimeMs:1,hintsUsed:false})}),path:new URL(url).pathname,orgId:TEST_ORG,env:{DB:db},store:new Store(db),actor:{userId:TEST_USER,organizationId:TEST_ORG,organizationName:'Practice Club',displayName:'Student',userName:'student',email:null,kind:'Student',role:'Student',credentialVersion:'v1'}};
  const response=await handleStudy(ctx);
  expect(response!.status).toBe(200);expect(await response!.json()).toMatchObject({isCorrect:true});
  expect(queries).toBeLessThan(30);
  const mastery=JSON.parse((await app.db.prepare("SELECT data FROM Records WHERE kind='mastery' AND json_extract(data,'$.knowledgeUnitId')=?").bind(card.knowledgeUnitId).first<{data:string}>())!.data);
  expect(mastery.algorithmVersion).toBe(MASTERY_VERSION);expect(mastery.reference).toBe(100);
  await app.db.prepare("UPDATE Records SET data=json_set(data,'$.includes[0].endVerse',3),revision=revision+1 WHERE kind='scope' AND id=?").bind(season).run();
},30000);
it('enforces review eligibility, simulation hints and revoked active scope',async()=>{
  await app.db.prepare("UPDATE Records SET data=json_set(data,'$.reviewDueAt','2000-01-01T00:00:00Z') WHERE kind='mastery'").run();
  const review=await request('/api/v1/study/sessions','POST',{seasonId:season,mode:'Review'});
  expect(await review.json()).toMatchObject({targetCardCount:3});
  const simulation=await (await request('/api/v1/study/sessions','POST',{seasonId:season,mode:'Simulation'})).json() as {id:string};
  const base=`/api/v1/study/sessions/${simulation.id}`;
  const card=await (await request(`${base}/next`)).json() as {id:string};
  expect((await request(`${base}/attempts`,'POST',{clientSubmissionId:'hint',challengeCardId:card.id,submittedAnswer:'x',responseTimeMs:0,hintsUsed:true})).status).toBe(400);
  await app.db.prepare("UPDATE Records SET data=json_set(data,'$.isActive',json('false')),revision=revision+1 WHERE kind='pack' AND id=?").bind(pack).run();
  expect((await request(base)).status).toBe(400);
  expect((await request(`${base}/next`)).status).toBe(400);
  expect((await request('/api/v1/study/sessions','POST',{seasonId:season,mode:'Practice'})).status).toBe(400);
});
it('admits versioned Memory only for enabled seasons and preserves saved generator/grading on resume',async()=>{
 const endpoint='/api/v1/study/sessions';
 await app.db.prepare("UPDATE Records SET data=json_set(data,'$.isActive',json('true')),revision=revision+1 WHERE kind='pack' AND id=?").bind(pack).run();
 await app.db.prepare("UPDATE Records SET data=json_set(data,'$.difficulty','Foundation'),revision=revision+1 WHERE kind='membership'").run();
 expect((await request(endpoint,'POST',{seasonId:season,memoryChallenge:'unsupported'})).status).toBe(400);
 expect((await request(endpoint,'POST',{seasonId:season,memoryChallenge:'Warmup'})).status).toBe(400);
 await app.db.prepare("UPDATE Records SET data=json_set(data,'$.pbeEnabled',json('true')),revision=revision+1 WHERE kind='season' AND id=?").bind(season).run();
 expect((await request(endpoint,'POST',{seasonId:season,memoryChallenge:'Advanced'})).status).toBe(400);
 await app.db.prepare("UPDATE Records SET data=json_set(data,'$.difficulty','Advanced'),revision=revision+1 WHERE kind='membership'").run();
 const started=await (await request(endpoint,'POST',{seasonId:season,format:'Memory',training:{clientStartId:'b3-purpose',timeZone:'UTC'}})).json() as Session;
 expect(started).toMatchObject({memoryChallenge:'Warmup',generatorVersion:'memory-v3',evidenceProfile:'memory-cued-v3',difficulty:'Advanced'});
 const base=`${endpoint}/${started.id}`;
 const card=await (await request(`${base}/next`)).json() as {id:string;evidenceProfile:string};
 expect(card.evidenceProfile).toBe('memory-cued-v3');
 const saved=JSON.parse((await app.db.prepare("SELECT data FROM Records WHERE kind='session' AND id=?").bind(started.id).first<{data:string}>())!.data) as Session;
 const generated=saved.cards[0];
 await app.db.prepare("UPDATE Records SET data=json_set(data,'$.exactWording',69,'$.algorithmVersion','v2-skill-evidence'),revision=revision+1 WHERE kind='mastery' AND json_extract(data,'$.knowledgeUnitId')=?").bind(generated.knowledgeUnitId).run();
 const accepted=await (await request(`${base}/attempts`,'POST',{clientSubmissionId:'b3-answer',challengeCardId:card.id,submittedAnswer:generated.answerKey.canonicalAnswer,responseTimeMs:20,hintsUsed:false})).json() as {exactWordingScore:number};
 expect(accepted.exactWordingScore).toBeLessThanOrEqual(70);
 expect((await request(endpoint,'POST',{seasonId:season,format:'Memory',memoryChallenge:'Advanced',training:{clientStartId:'b3-purpose',timeZone:'UTC'}})).status).toBe(400);
 const advanced=await (await request(endpoint,'POST',{seasonId:season,format:'Memory',memoryChallenge:'Advanced'})).json() as Session;
 expect(advanced.evidenceProfile).toBe('memory-honor-v2');
 await app.db.prepare("UPDATE Records SET data=json_set(data,'$.pbeEnabled',json('false')),revision=revision+1 WHERE kind='season' AND id=?").bind(season).run();
 expect(await (await request(base)).json()).toMatchObject({session:{memoryChallenge:'Warmup'},card:{id:card.id}});
 expect(await (await request(`${base}/next`)).json()).toMatchObject({generatorVersion:'memory-v3',evidenceProfile:'memory-cued-v3'});
 await app.db.prepare("UPDATE Records SET data=json_set(data,'$.evidenceProfile','memory-honor-v2'),revision=revision+1 WHERE kind='session' AND id=?").bind(started.id).run();
 expect((await request(base)).status).toBe(400);
 const legacy=await (await request(endpoint,'POST',{seasonId:season})).json() as Session;
 expect(legacy.generatorVersion).toBeUndefined();
 await app.db.prepare("UPDATE Records SET data=json_set(data,'$.pbeEnabled',json('true')),revision=revision+1 WHERE kind='season' AND id=?").bind(season).run();
 expect((await (await request(`${endpoint}/${legacy.id}/next`)).json() as {generatorVersion?:string}).generatorVersion).toBeUndefined();
 await app.db.prepare("UPDATE Records SET data=json_remove(data,'$.pbeEnabled'),revision=revision+1 WHERE kind='season' AND id=?").bind(season).run();
});
it('rejects inconsistent saved Memory card snapshots before attempt, mastery, or Honor writes',async()=>{
 const endpoint='/api/v1/study/sessions';
 await app.db.prepare("UPDATE Records SET data=json_set(data,'$.pbeEnabled',json('true')),revision=revision+1 WHERE kind='season' AND id=?").bind(season).run();
 await app.db.prepare("UPDATE Records SET data=json_set(data,'$.difficulty','Advanced'),revision=revision+1 WHERE kind='membership'").run();
 const count=async(kind:string)=>(await app.db.prepare('SELECT count(*) AS count FROM Records WHERE kind=? AND season_id=?').bind(kind,season).first<{count:number}>())!.count;
 const invalid=[
  {purpose:'Warmup',generatorVersion:undefined,evidenceProfile:'memory-cued-v3'},
  {purpose:'Warmup',generatorVersion:'unknown',evidenceProfile:'memory-cued-v3'},
  {purpose:'Warmup',generatorVersion:'memory-v3',evidenceProfile:undefined},
  {purpose:'Warmup',generatorVersion:'memory-v3',evidenceProfile:'unknown'},
  {purpose:'Warmup',generatorVersion:'memory-v3',evidenceProfile:'memory-honor-v2'},
  {purpose:'Advanced',generatorVersion:'memory-v3',evidenceProfile:'memory-cued-v3'},
 ] as const;
 for(const [index,variant] of invalid.entries()){
  const started=await (await request(endpoint,'POST',{seasonId:season,format:'Memory',memoryChallenge:variant.purpose})).json() as Session;
  const shown=await (await request(`${endpoint}/${started.id}/next`)).json() as {id:string};
  const row=await app.db.prepare("SELECT data FROM Records WHERE kind='session' AND id=?").bind(started.id).first<{data:string}>();
  const saved=JSON.parse(row!.data) as Session,card=saved.cards[0];
  if(variant.generatorVersion===undefined)delete card.payload.generatorVersion;else card.payload.generatorVersion=variant.generatorVersion;
  if(variant.evidenceProfile===undefined)delete card.payload.evidenceProfile;else card.payload.evidenceProfile=variant.evidenceProfile as typeof card.payload.evidenceProfile;
  await app.db.prepare("UPDATE Records SET data=?,revision=revision+1 WHERE kind='session' AND id=?").bind(JSON.stringify(saved),started.id).run();
  const before=await Promise.all(['attempt','mastery','mastery-proof','mastery-honor'].map(count));
  expect((await request(`${endpoint}/${started.id}/attempts`,'POST',{clientSubmissionId:`invalid-snapshot-${index}`,challengeCardId:shown.id,submittedAnswer:card.answerKey.canonicalAnswer,responseTimeMs:20,hintsUsed:false})).status).toBe(400);
  expect(await Promise.all(['attempt','mastery','mastery-proof','mastery-honor'].map(count))).toEqual(before);
 }
 for(const purpose of ['Warmup','Advanced'] as const){
  const started=await (await request(endpoint,'POST',{seasonId:season,format:'Memory',memoryChallenge:purpose})).json() as Session;
  const shown=await (await request(`${endpoint}/${started.id}/next`)).json() as {id:string};
  const saved=JSON.parse((await app.db.prepare("SELECT data FROM Records WHERE kind='session' AND id=?").bind(started.id).first<{data:string}>())!.data) as Session;
  expect((await request(`${endpoint}/${started.id}/attempts`,'POST',{clientSubmissionId:`valid-${purpose}`,challengeCardId:shown.id,submittedAnswer:saved.cards[0].answerKey.canonicalAnswer,responseTimeMs:20,hintsUsed:false})).status).toBe(200);
 }
 await app.db.prepare("UPDATE Records SET data=json_set(data,'$.pbeEnabled',json('false')),revision=revision+1 WHERE kind='season' AND id=?").bind(season).run();
 const legacy=await (await request(endpoint,'POST',{seasonId:season,format:'Memory'})).json() as Session;
 const shown=await (await request(`${endpoint}/${legacy.id}/next`)).json() as {id:string};
 const saved=JSON.parse((await app.db.prepare("SELECT data FROM Records WHERE kind='session' AND id=?").bind(legacy.id).first<{data:string}>())!.data) as Session;
 expect((await request(`${endpoint}/${legacy.id}/attempts`,'POST',{clientSubmissionId:'valid-legacy',challengeCardId:shown.id,submittedAnswer:saved.cards[0].answerKey.canonicalAnswer,responseTimeMs:20,hintsUsed:false})).status).toBe(200);
 const inconsistent=await (await request(endpoint,'POST',{seasonId:season,format:'Memory'})).json() as Session;
 const inconsistentShown=await (await request(`${endpoint}/${inconsistent.id}/next`)).json() as {id:string};
 const inconsistentRow=await app.db.prepare("SELECT data FROM Records WHERE kind='session' AND id=?").bind(inconsistent.id).first<{data:string}>();
 const inconsistentSaved=JSON.parse(inconsistentRow!.data) as Session,inconsistentCard=inconsistentSaved.cards[0];
 inconsistentCard.payload.generatorVersion='memory-v3';inconsistentCard.payload.evidenceProfile='memory-cued-v3';
 await app.db.prepare("UPDATE Records SET data=?,revision=revision+1 WHERE kind='session' AND id=?").bind(JSON.stringify(inconsistentSaved),inconsistent.id).run();
 const before=await Promise.all(['attempt','mastery','mastery-proof','mastery-honor'].map(count));
 expect((await request(`${endpoint}/${inconsistent.id}/attempts`,'POST',{clientSubmissionId:'invalid-legacy-versioned-card',challengeCardId:inconsistentShown.id,submittedAnswer:inconsistentCard.answerKey.canonicalAnswer,responseTimeMs:20,hintsUsed:false})).status).toBe(400);
 expect(await Promise.all(['attempt','mastery','mastery-proof','mastery-honor'].map(count))).toEqual(before);
});
