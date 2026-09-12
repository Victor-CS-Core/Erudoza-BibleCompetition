// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG, TEST_USER } from '../test-runtime';

import type { Attempt, Session } from './routes';


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

async function fixture(expected = ['in','the']) {
  const session = await (await request('/api/v1/study/sessions','POST',{seasonId:season,mode:'Practice'})).json() as Session;
  const base = `/api/v1/study/sessions/${session.id}`;
  await request(`${base}/next`);
  const saved = JSON.parse((await app.db.prepare("SELECT data FROM Records WHERE kind='session' AND id=?").bind(session.id).first<{data:string}>())!.data) as Session;
  const card=saved.cards[0];
  card.payload.tokens=[{index:0,text:'Visible',hidden:false},...expected.map((text,i)=>({index:i+2,text,hidden:true}))];
  card.payload.prompt='Visible '+expected.map(()=>'____').join(' '); card.answerKey.canonicalAnswer=expected.join(' ');
  await app.db.prepare("UPDATE Records SET data=?,revision=revision+1 WHERE kind='session' AND id=?").bind(JSON.stringify(saved),session.id).run();
  return {base,session:saved,card,body:{clientSubmissionId:crypto.randomUUID(),challengeCardId:card.id,responseTimeMs:42,hintsUsed:false}};
}
async function evidence() {return (await app.db.prepare("SELECT kind,id,data,revision FROM Records WHERE kind IN ('session','attempt','mastery','mastery-proof','training-event','honor-grant') ORDER BY kind,id").all()).results;}
it('grades immutable indexed positions and replays raw payload despite joined-string collisions',async()=>{
  const {base,card,body}=await fixture();
  const missingWordAnswers=[{index:3,text:''},{index:2,text:'in the'}];
  const response=await request(`${base}/attempts`,'POST',{...body,missingWordAnswers});expect(response.status).toBe(200);
  const result=await response.json() as {attemptId:string;missingWordResults:unknown[]};
  expect(result).toMatchObject({isCorrect:false,missingWordAnswers:[{index:2,text:'in the'},{index:3,text:''}],missingWordResults:[{index:2,isCorrect:false,expected:'in'},{index:3,isCorrect:false,expected:'the'}]});
  const attempt=JSON.parse((await app.db.prepare("SELECT data FROM Records WHERE kind='attempt' AND id=?").bind(result.attemptId).first<{data:string}>())!.data) as Attempt;
  expect(attempt).toMatchObject({submittedAnswer:'in the ',answerPayload:{format:'missing-words-slots/v1',answers:[{index:2,text:'in the'},{index:3,text:''}],results:result.missingWordResults}});
  const before=await evidence();
  expect(await (await request(`${base}/attempts`,'POST',{...body,missingWordAnswers:[...missingWordAnswers].reverse()})).json()).toEqual({...result,alreadyProcessed:true});
  expect((await request(`${base}/attempts`,'POST',{...body,missingWordAnswers:[{index:2,text:'in'},{index:3,text:'the '}]})).status).toBe(409);
  expect((await request(`${base}/attempts`,'POST',{...body,submittedAnswer:'in the '})).status).toBe(409);
  expect(await evidence()).toEqual(before);
  // Historical retry authority is the saved payload, even if private card data changes later.
  const saved=JSON.parse((await app.db.prepare("SELECT data FROM Records WHERE kind='session' AND id=?").bind(attempt.sessionId).first<{data:string}>())!.data) as Session;
  saved.cards[0].payload.tokens=[{index:99,text:'changed',hidden:true}];
  await app.db.prepare("UPDATE Records SET data=? WHERE kind='session' AND id=?").bind(JSON.stringify(saved),saved.id).run();
  expect(await (await request(`${base}/attempts`,'POST',{...body,missingWordAnswers})).json()).toEqual({...result,alreadyProcessed:true});
  expect(await (await request(base)).json()).toMatchObject({card:{id:card.id},attempt:{...result,alreadyProcessed:true}});
});
it.each([
  [['in','the'],['the','in'],false],
  [['same','same'],['same','same'],true],
  [['in','the','king'],['in','','the king'],false],
  [["Don't",'God’s','well-being','in  the',','],[" DON'T ",'god’s,','WELL-BEING','in the',' , '],true],
  [[','],[''],false], [[','],['!'],false],
])('grades private frozen tokens %j with positional entries %j',async(expected,entered,isCorrect)=>{
  const {base,body}=await fixture(expected as string[]);
  const missingWordAnswers=(entered as string[]).map((text,i)=>({index:i+2,text}));
  const response=await request(`${base}/attempts`,'POST',{...body,missingWordAnswers});expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({isCorrect});
});
it('rejects malformed, duplicate, visible, missing, unknown, XOR and oversized bodies with no evidence writes',async()=>{
  const {base,body}=await fixture();const slots=[{index:2,text:'in'},{index:3,text:'the'}];const before=await evidence();
  for(const answer of [
    {},{submittedAnswer:'in the',missingWordAnswers:slots},{submittedAnswer:null,missingWordAnswers:slots},
    {missingWordAnswers:null},{missingWordAnswers:{}},{missingWordAnswers:[]},
    ...[[slots[0],slots[0]],[slots[0]], [...slots,{index:4,text:'x'}], [{index:0,text:'x'},slots[1]], [{index:2.5,text:'in'},slots[1]], [{index:2,text:2},slots[1]], [null,slots[1]], [{index:2,text:'x'.repeat(100001)},slots[1]]].map(missingWordAnswers=>({missingWordAnswers})),
  ]) expect((await request(`${base}/attempts`,'POST',{...body,...answer})).status,JSON.stringify(answer).slice(0,160)).toBe(400);
  expect((await request(`${base}/attempts`,'POST',{...body,missingWordAnswers:[{index:2,text:'x'.repeat(1048576)},slots[1]]})).status).toBe(413);
  expect(await evidence()).toEqual(before);
  const accepted=await request(`${base}/attempts`,'POST',{...body,missingWordAnswers:slots});expect(accepted.status).toBe(200);
  const frozen=await evidence();
  expect((await request(`${base}/attempts`,'POST',{...body,clientSubmissionId:'new-key',missingWordAnswers:[{index:99,text:'in'},{index:3,text:'the'}]})).status).toBe(400);
  expect((await request(`${base}/attempts`,'POST',{...body,submittedAnswer:'in the',missingWordAnswers:slots})).status).toBe(400);expect(await evidence()).toEqual(frozen);
});
it('preserves legacy string attempts and rejects structured answers for other activities',async()=>{
  const {base,body}=await fixture();const legacy={...body,submittedAnswer:'IN THE'};
  const response=await request(`${base}/attempts`,'POST',legacy);expect(response.status).toBe(200);const original=await response.json();expect(original).toMatchObject({isCorrect:true});expect(original).not.toHaveProperty('missingWordResults');
  expect(await (await request(`${base}/attempts`,'POST',legacy)).json()).toEqual({...original as object,alreadyProcessed:true});
  const other=await (await request(`${base}/next`)).json() as {id:string};const before=await evidence();
  expect((await request(`${base}/attempts`,'POST',{...body,clientSubmissionId:'other',challengeCardId:other.id,missingWordAnswers:[]})).status).toBe(400);expect(await evidence()).toEqual(before);
});
it('enforces structured identity and answer-only fields before answered-card replay',async()=>{
  const {base,body}=await fixture();const missingWordAnswers=[{index:2,text:'in'},{index:3,text:'the'}];
  expect((await request(`${base}/attempts`,'POST',{...body,missingWordAnswers})).status).toBe(200);
  const before=await evidence();
  for(const payload of [
    {clientSubmissionId:''},{clientSubmissionId:' '.repeat(5)},{clientSubmissionId:'x'.repeat(201)},{clientSubmissionId:undefined},
    {responseTimeMs:-1},{responseTimeMs:1.5},{responseTimeMs:undefined},{hintsUsed:undefined},{hintsUsed:null},
    {missingWordAnswers:missingWordAnswers.map(a=>({...a,expected:'anything'}))},
    {missingWordAnswers:missingWordAnswers.map(a=>({...a,isCorrect:true}))},
  ]) expect((await request(`${base}/attempts`,'POST',{...body,clientSubmissionId:'new-key',missingWordAnswers,...payload})).status,JSON.stringify(payload)).toBe(400);
  expect(await evidence()).toEqual(before);
});
