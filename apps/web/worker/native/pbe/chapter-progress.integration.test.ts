import {writeFile} from 'node:fs/promises';
// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG, TEST_USER } from '../test-runtime';
import { Store } from '../store';
import type { Env, RequestContext } from '../types';
import type { PbeQuestion, PbeTarget } from './types';
import { sourceProof } from './bank';
import {targetVariantCounts} from './chapter-projection-pages';
import {prepareRecallEvidence,type ReviewProjection} from './progress';
import {chapterHash,CHAPTER_STAGE_BYTES,utf8Bytes} from './chapter-manifest';
import {atomic} from '../application/model';
import {prepareEvidenceDispute} from './evidence-replay';
import type {PbeDispute} from './disputes';
import type {ChapterPage,ContinueChaptersResponse} from '../../../src/api/pbeTypes';
const season = 'cccccccc-0000-0000-0000-000000000001', student = 'dddddddd-0000-0000-0000-000000000001', pack = 'aaaaaaaa-0000-0000-0000-000000000001', source = 'aaaaaaaa-0000-0000-0000-000000000002';
const tid = (n: number) => `bbbbbbbb-0000-0000-0000-${String(n).padStart(12, '0')}`;
let app: Awaited<ReturnType<typeof createNativeTestApp>>;
const allMeters:Record<string,unknown>[]=[];
afterEach(async () => { await app?.runtime.dispose(); await writeFile('../../.local/d1-native-request-meters.json',JSON.stringify(allMeters,null,2)); });
async function setup(count = 2, beforeD1Statement?: (sql: string) => Promise<void>, options: {replaceSoloAuthority?:boolean} = {}) {
    app = await createNativeTestApp({ measureD1: true, beforeD1Statement, ...options });
    const store = new Store(app.db as unknown as Env['DB']);
    await store.insert('season', season, TEST_ORG, { id: season, name: 'Test season', organizationId: TEST_ORG, status: 'Active', pbeEnabled: true });
    await store.insert('pack', pack, TEST_ORG, { id: pack, isActive: true, licensingStatus: 'approved', sourceType: 'Scripture' });
    const unit = { id: source, contentPackId: pack, bookKey: 'GEN', chapter: 1, verse: 1, ordinal: 1, citation: 'GEN 1:1', canonicalText: 'Alpha and Beta', isActive: true };
    await store.insert('source', source, TEST_ORG, unit, { ownerId: pack });
    const range = { bookKey: 'GEN', startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1 };
    await store.insert('scope', season, TEST_ORG, { contentPackId: pack, includes: [range], excludes: [] });
    await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT ?,org_id,'pbe-student','Student','Student','Student',password_hash,credential_version FROM Users WHERE id=?").bind(student, TEST_USER).run();
    await store.insert('assignment', 'assignment', TEST_ORG, { id: 'assignment', seasonId: season, studentUserId: student, contentPackId: pack, ...range }, { seasonId: season, ownerId: student });
    await store.insert('membership', `${season}:${student}`, TEST_ORG, { id: `${season}:${student}`, seasonId: season, userId: student, difficulty: 'Standard' }, { seasonId: season, ownerId: student });
    const targets: PbeTarget[] = [1, 2].map(n => ({ id: tid(n), sourceUnitIds: [source], skill: 'FactualRecall', label: `Label ${n}` }));
    for (const t of targets)
        await store.insert('pbe-target', t.id, TEST_ORG, t, { seasonId: season, ownerId: source });
    for (let n = 0; n < count; n++) {
        const q: PbeQuestion = { schemaVersion: 2, id: tid(100 + n), version: 1, contentPackId: pack, sourceUnitId: source, sourceUnitIds: [source], sourceKind: 'Scripture', reference: 'GEN 1:1', evidence: 'Alpha and Beta', kind: 'List', prompt: 'Name the two labels.', ordered: false, parts: targets.map((t, i) => ({ targetId: t.id, acceptedAnswers: [i ? 'Beta' : 'Alpha'], points: 1 })) };
        await store.insert('pbe-question-head', q.id, TEST_ORG, { id: q.id, seasonId: season, published: true, sourceFingerprint: await sourceProof(q, new Map([[source, unit]])), question: q }, { seasonId: season, ownerId: source });
    }
    const login = await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'pbe-student', password: 'Testing!123' }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const meters:Record<string,unknown>[]=[];
    const send = async (path: string, value?: unknown, empty = false) => { const r = await app.fetch('/api/v1' + path, { method: value === undefined && !empty ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, body: value === undefined || empty ? undefined : JSON.stringify(value) }); const meter = JSON.parse(r.headers.get('x-test-d1-meter')!) as {
        bindingCalls: number;
        statements: number;
    }; const responseText=await r.clone().text(),responseBody=JSON.parse(responseText) as {scopeVersion?:string|null};const sample={path,...meter,scopeVersion:responseBody.scopeVersion??null,responseBytes:new TextEncoder().encode(responseText).byteLength};meters.push(sample);allMeters.push(sample);if(r.status===503)process.stderr.write(JSON.stringify(sample)+'\n');expect((meter as {maxBoundUtf8Bytes?:number}).maxBoundUtf8Bytes??0).toBeLessThanOrEqual(65536); expect(meter.statements, `${path}: ${JSON.stringify(meter)}`).toBeLessThanOrEqual(50); return r; };
    return { app, store, send, cookie, meters };
}
it('admits coach learners (Adult/Owner) to chapter views instead of 403', async () => {
 // Regression: a coach on their own student view (/student/progress honours tab) got
 // "PBE chapter stamps could not load" because chapterBase required kind/role Student
 // while the /progress/me routes admit coaches via requireLearner.
 const {app}=await setup();
 const login=await app.fetch('/api/v1/auth/login',{method:'POST',headers:{Origin:'https://erudoza.test','Content-Type':'application/json'},body:JSON.stringify({identifier:'coach',password:'Testing!123'})});
 expect(login.status).toBe(200);
 const coachCookie=login.headers.get('set-cookie')!.split(';')[0];
 const asCoach=async(path:string)=>app.fetch('/api/v1'+path,{headers:{Cookie:coachCookie,Origin:'https://erudoza.test'}});
 const stamps=await asCoach(`/progress/me/chapters?seasonId=${season}&view=Stamps`);
 expect(stamps.status,await stamps.clone().text()).toBe(200);
 expect(await stamps.json()).toMatchObject({view:'Stamps',items:[]});
 const chaptersView=await asCoach(`/progress/me/chapters?seasonId=${season}`);
 expect(chaptersView.status,await chaptersView.clone().text()).toBe(200);
 expect(await chaptersView.json()).toMatchObject({view:'Chapters',items:[],work:{state:'Blocked',reason:'NoAssignment'}});
},30000);
it('discovers chapter work read-only and bootstraps one owned generation through HTTP', async () => {
 const {send,store}=await setup();
 const before=await send(`/progress/me/chapters?seasonId=${season}`);
 expect(before.status).toBe(200);
 expect(await before.json()).toMatchObject({view:'Chapters',items:[],work:{id:null,state:'NotStarted'}});
 expect(await store.list('pbe-chapter-work',TEST_ORG,{seasonId:season,ownerId:student})).toHaveLength(0);
 const response=await send('/progress/me/chapters/continue',{seasonId:season});
 expect(response.status).toBe(200);
 const started=await response.json() as {work:{id:string}};
 expect(started.work.id).toBeTruthy();
 const retry=await send('/progress/me/chapters/continue',{seasonId:season});
 expect((await retry.json() as {work:{id:string}}).work.id).toBe(started.work.id);
},30000);

async function finish(send:Awaited<ReturnType<typeof setup>>['send'],maxSteps=80){
 let work:ContinueChaptersResponse|null=null;
 for(let n=0;n<maxSteps;n++){const response=await send('/progress/me/chapters/continue',{seasonId:season,...(work?.work.id?{workId:work.work.id}:{})});expect(response.status,await response.clone().text()).toBe(200);work=await response.json() as ContinueChaptersResponse;if(work.next!=='Continue')break;}
 expect(work?.work.state).toBe('Complete');
 const response=await send(`/progress/me/chapters?seasonId=${season}`);expect(response.status,await response.clone().text()).toBe(200);return await response.json() as ChapterPage;
}
async function seedPair(store:Store){
 const ctx={store,env:{DB:store.db},orgId:TEST_ORG,actor:{userId:student,organizationId:TEST_ORG,kind:'Student',role:'Student'},request:new Request('https://erudoza.test'),path:''} as unknown as RequestContext;
 const start=Date.now()-5*86400000,attempts:string[]=[];
 for(let n=0;n<2;n++){const attemptId=crypto.randomUUID();attempts.push(attemptId);const evidence=[1,2].map(t=>({attemptId,targetId:tid(t),questionId:tid(100+n),atMs:start+n*172800000,earnedPoints:1,availablePoints:1,unaided:true,recall:true}));const w=await prepareRecallEvidence(ctx,season,'saved',evidence,'List',{questionVersion:1,responseLockedAtMs:start+n*172800000});await atomic(ctx,'test.accept',w.statements,w.guards);}
 return {ctx,attempts,start};
}
it('projects actual parent and nonadditive child counters and persists exactly one dated stamp',async()=>{
 const {send,store}=await setup();const {attempts}=await seedPair(store);
 const page=await finish(send);expect(page.view).toBe('Chapters');expect(page.items).toHaveLength(1);
 expect(page.items[0]).toMatchObject({kind:'Chapter',key:`chapter:${pack}:GEN:1`,wholeChapterAssigned:true,counts:{assignedPassages:1,totalTargets:2,retainedTargets:2},currentReadiness:'Retained',stamp:{earnedAtUtc:expect.any(String)}});
 const groups=await(await send(`/progress/me/chapters?seasonId=${season}&view=Groups&chapterKey=${encodeURIComponent(`chapter:${pack}:GEN:1`)}`)).json() as ChapterPage;
 expect(groups.items[0]).toMatchObject({kind:'PassageGroup',counts:{totalTargets:2,retainedTargets:2},stamp:null,hasHistoricalStamps:false});
 const stamps=await store.list<{id:string;summary:{earnedAtUtc:string}}>('pbe-chapter-stamp',TEST_ORG,{seasonId:season,ownerId:student});expect(stamps).toHaveLength(1);
 const proofs=await store.list<{entries:{witness:{attemptId:string}[]}[]}>('pbe-chapter-stamp-proof',TEST_ORG,{seasonId:season,ownerId:student});expect(proofs.flatMap(p=>p.entries.flatMap(e=>e.witness.map(w=>w.attemptId)))).toEqual([attempts[0],attempts[1],attempts[0],attempts[1]]);
 await finish(send);expect(await store.list('pbe-chapter-stamp',TEST_ORG,{seasonId:season,ownerId:student})).toEqual(stamps);
 expect(JSON.stringify(page)).not.toMatch(/attemptId|sourceUnitIds|acceptedAnswers/);
},30000);
it('keeps immutable dated stamps after wrong recall and disabled current admission',async()=>{
 const {send,store}=await setup();const {ctx,start}=await seedPair(store);await finish(send);const before=await store.list('pbe-chapter-stamp',TEST_ORG,{seasonId:season,ownerId:student});
 const attemptId=crypto.randomUUID(),w=await prepareRecallEvidence(ctx,season,'saved',[{attemptId,targetId:tid(1),questionId:tid(100),atMs:start+3*172800000,earnedPoints:0,availablePoints:1,unaided:true,recall:true}],'List',{questionVersion:1,responseLockedAtMs:start+3*172800000});await atomic(ctx,'test.wrong',w.statements,w.guards);
 const updating=await(await send(`/progress/me/chapters?seasonId=${season}`)).json() as ChapterPage;expect(updating.items).toEqual([]);expect(updating.work.state).toBe('Working');
 const page=await finish(send);expect(page.items[0]).toMatchObject({currentReadiness:'Incomplete',counts:{retainedTargets:1},stamp:{earnedAtUtc:expect.any(String)}});
 const saved=await store.require<{pbeEnabled:boolean}>('season',season,TEST_ORG);await store.update('season',season,TEST_ORG,{...saved.value,pbeEnabled:false},saved.revision).run();
 const history=await(await send(`/progress/me/chapters?seasonId=${season}&view=Stamps`)).json() as ChapterPage;expect(history.items).toHaveLength(1);expect(history).toMatchObject({currentAvailable:false,historyAvailable:true,work:{state:'Blocked',reason:'PbeDisabled'}});expect(history.items[0]).toMatchObject({matchesCurrentScope:null});
 expect(await store.list('pbe-chapter-stamp',TEST_ORG,{seasonId:season,ownerId:student})).toEqual(before);
},30000);

it('rejects bank phantoms at stamp publication and recovers a lost bootstrap response',async()=>{
 let armed=false,fired=false;
 const fixture=await setup(2,async sql=>{if(armed&&!fired&&sql.startsWith('WITH guardInputs')){fired=true;await store.insert('pbe-target',tid(3),TEST_ORG,{id:tid(3),sourceUnitIds:[source],skill:'FactualRecall',label:'New declared gap'},{seasonId:season,ownerId:source});}});const store=fixture.store;
 await seedPair(store);let work:ContinueChaptersResponse|null=null;
 for(let n=0;n<50;n++){const response=await fixture.send('/progress/me/chapters/continue',{seasonId:season,...(work?.work.id?{workId:work.work.id}:{})});expect(response.status).toBe(200);work=await response.json() as ContinueChaptersResponse;if(work.work.stage==='Projecting')break;}
 armed=true;let conflict=false;for(let n=0;n<15;n++){const response=await fixture.send('/progress/me/chapters/continue',{seasonId:season,workId:work!.work.id!});if(response.status===409){expect(await response.text()).toContain('PBE_CHAPTER_WORK_STALE');conflict=true;break;}}
 expect(fired).toBe(true);expect(conflict).toBe(true);expect(await store.list('pbe-chapter-stamp',TEST_ORG,{seasonId:season,ownerId:student})).toEqual([]);
 // Caller intentionally discards this committed response, then discovers/reuses the work.
 await fixture.send('/progress/me/chapters/continue',{seasonId:season});
 const result=await finish(fixture.send);expect(result.items[0]).toMatchObject({currentReadiness:'Incomplete',counts:{totalTargets:3,retainedTargets:2,missingVariantTargets:1}});
 process.stdout.write('D1 chapter endpoint metric maxima '+JSON.stringify(Object.fromEntries(['statements','knownRowsRead','returnedBytes','maxBoundUtf8Bytes','firstQueriesWithoutRowsRead','elapsedMs','responseBytes'].map(key=>[key,Math.max(...fixture.meters.map(m=>Number(m[key]??0)))])))+'\n');
},30000);
it('replays legacy original locks without manufacturing delay from later projection',async()=>{
 const {send,store}=await setup(),ctx={store,env:{DB:store.db},orgId:TEST_ORG,actor:{userId:student,organizationId:TEST_ORG,kind:'Student',role:'Student'},request:new Request('https://erudoza.test'),path:''} as unknown as RequestContext;
 const start=Date.now()-8*86400000;
 for(let n=0;n<2;n++){const attemptId=crypto.randomUUID(),sessionId=crypto.randomUUID(),cardId=crypto.randomUUID(),atMs=start+n*3*86400000;
  const evidence=[1,2].map(t=>({attemptId,targetId:tid(t),questionId:tid(100+n),atMs,earnedPoints:1,availablePoints:1,unaided:true,recall:true}));const w=await prepareRecallEvidence(ctx,season,'legacy',evidence,'List');await atomic(ctx,'test.legacy',w.statements,w.guards);
  await store.insert('pbe-attempt',attemptId,TEST_ORG,{id:attemptId,sessionId,cardId,atMs,responseLockedAtMs:start+n*1000},{seasonId:season,ownerId:student});
  await store.insert('pbe-session',sessionId,TEST_ORG,{id:sessionId,cards:[{id:cardId,question:{id:tid(100+n),version:1}}]},{seasonId:season,ownerId:student});
 }
 for(const targetId of [tid(1),tid(2)]){const row=await store.require<Record<string,unknown>>('pbe-target-review',`${student}:${season}:${targetId}`,TEST_ORG);const value={...row.value};delete value.retention;await store.update('pbe-target-review',`${student}:${season}:${targetId}`,TEST_ORG,value,row.revision).run();}
 const page=await finish(send);expect(page.items[0]).toMatchObject({currentReadiness:'Incomplete',counts:{recalledTargets:2,retainedTargets:0},stamp:null});
 const attemptId=crypto.randomUUID(),w=await prepareRecallEvidence(ctx,season,'legacy',[1,2].map(t=>({attemptId,targetId:tid(t),questionId:tid(101),atMs:start+6*86400000,earnedPoints:1,availablePoints:1,unaided:true,recall:true})),'List',{questionVersion:1,responseLockedAtMs:start+172800000});await atomic(ctx,'test.later',w.statements,w.guards);
 expect((await finish(send)).items[0]).toMatchObject({currentReadiness:'Retained',stamp:{earnedAtUtc:expect.any(String)}});
},30000);
it('keeps pending evidence as a barrier until the original corrected chronology finishes replay',async()=>{
 const {send,store}=await setup(),{ctx,attempts,start}=await seedPair(store);
 const question=(await store.require<{question:PbeQuestion}>('pbe-question-head',tid(101),TEST_ORG)).value.question;
 const dispute:PbeDispute={id:'chapter-dispute',organizationId:TEST_ORG,seasonId:season,activity:'Solo',sessionId:crypto.randomUUID(),attemptId:attempts[1],questionId:question.id,questionVersion:1,team:null,status:'Pending',reason:'Check original credit',revision:1,partPoints:[1,1],sourceEvidence:question.evidence,question,answers:['Alpha','Beta'],originalPointsByPart:[1,1],acceptedAtUtc:new Date(start+172800000).toISOString(),participantIds:[student],allParticipantIds:[student],resolution:null};
 let w=await prepareEvidenceDispute(ctx,dispute);await atomic(ctx,'test.flag',w.statements,w.guards);
 const pending=await finish(send);expect(pending.items[0]).toMatchObject({currentReadiness:'Updating',counts:{retainedTargets:0},stamp:null,actions:[]});
 w=await prepareEvidenceDispute(ctx,{...dispute,status:'Resolved',revision:2,resolution:{pointsByPart:[1,1],reason:'Original evidence verified',resolvedBy:TEST_USER,resolvedAtUtc:new Date().toISOString()}});await atomic(ctx,'test.resolve',w.statements,w.guards);
 expect((await finish(send)).items[0]).toMatchObject({currentReadiness:'Retained',counts:{retainedTargets:2},stamp:{earnedAtUtc:expect.any(String)}});
},30000);
it('converges simultaneous bootstrap calls and binds current page/work cursors to the owned snapshot',async()=>{
 const {send,store}=await setup();await seedPair(store);
 const responses=await Promise.all([send('/progress/me/chapters/continue',{seasonId:season}),send('/progress/me/chapters/continue',{seasonId:season})]);expect(responses.map(r=>r.status)).toEqual([200,200]);const bodies=await Promise.all(responses.map(r=>r.json())) as ContinueChaptersResponse[];expect(bodies[0].work.id).toBe(bodies[1].work.id);
 const page=await finish(send);expect((await send('/progress/me/chapters/continue',{seasonId:season,workId:crypto.randomUUID()})).status).toBe(409);
 const forged=btoa(JSON.stringify({orgId:TEST_ORG,studentId:TEST_USER,seasonId:season,view:'Chapters',chapterKey:null,snapshotId:page.snapshotId,after:''}));expect((await send(`/progress/me/chapters?seasonId=${season}&after=${forged}`)).status).toBe(409);
 expect((await send(`/progress/me/chapters?seasonId=${season}&limit=33`)).status).toBe(400);
},30000);

it('surfaces raw candidate cap+1 without truncating into readiness',async()=>{
 const {send,store}=await setup(0);const targets=Array.from({length:9999},(_,n)=>({id:tid(1000+n),sourceUnitIds:[source],skill:'FactualRecall',label:'Bounded target'}));
 await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) SELECT 'pbe-target',json_extract(value,'$.id'),?,?,?,value,1 FROM json_each(?)").bind(TEST_ORG,season,source,JSON.stringify(targets)).run();
 let response:ContinueChaptersResponse|null=null;for(let n=0;n<8;n++){response=await(await send('/progress/me/chapters/continue',{seasonId:season})).json() as ContinueChaptersResponse;if(response.next==='None')break;}
 expect(response).toMatchObject({work:{state:'Blocked',reason:'ScopeTooLarge'},next:'None'});expect(await store.list('pbe-chapter-stamp',TEST_ORG,{seasonId:season,ownerId:student})).toEqual([]);
 await app.db.prepare("DELETE FROM Records WHERE kind='pbe-target' AND org_id=? AND id>?").bind(TEST_ORG,tid(999)).run();
 expect((await finish(send)).items[0]).toMatchObject({counts:{totalTargets:2},currentReadiness:'Incomplete'});
},30000);
it('projects balanced SQL group membership across 2,6,11-verse runs and opaque introductions',async()=>{
 const {send,store}=await setup();
 for(let verse=2;verse<=21;verse++){const unit={id:tid(5000+verse),contentPackId:pack,bookKey:'GEN',chapter:1,verse,ordinal:verse,citation:`GEN 1:${verse}`,canonicalText:'Alpha and Beta',isActive:true};await store.insert('source',unit.id,TEST_ORG,unit,{ownerId:pack});}
 const scope=await store.require<Record<string,unknown>>('scope',season,TEST_ORG),range={bookKey:'GEN',startChapter:1,startVerse:1,endChapter:1,endVerse:21};
 await store.update('scope',season,TEST_ORG,{contentPackId:pack,includes:[range],excludes:[{...range,startVerse:3,endVerse:3},{...range,startVerse:10,endVerse:10}]},scope.revision).run();
 const assignment=await store.require<Record<string,unknown>>('assignment','assignment',TEST_ORG);await store.update('assignment','assignment',TEST_ORG,{...assignment.value,...range},assignment.revision).run();
 const intro=tid(9000),unit=tid(9001);await store.insert('pbe-introduction',intro,TEST_ORG,{id:intro,organizationId:TEST_ORG,seasonId:season,bookKey:'GEN',sourceEdition:'Approved intro',title:'Introduction',citation:'Introduction',licensingStatus:'approved',reviewed:true,units:[{id:unit,citation:'Introduction',canonicalText:'Context'}]},{seasonId:season});
 await store.insert('pbe-introduction-assignment',tid(9002),TEST_ORG,{id:tid(9002),seasonId:season,studentUserId:student,contentPackId:intro},{seasonId:season,ownerId:student});
 const page=await finish(send);expect(page.items).toHaveLength(2);expect(page.items[0]).toMatchObject({kind:'Chapter',wholeChapterAssigned:false,counts:{assignedPassages:19,questionCoveredPassages:1},stamp:null});expect(page.items[1]).toMatchObject({kind:'Introduction',key:`intro:${intro}`,chapter:null,counts:{assignedPassages:1,totalTargets:0},stamp:null});
 const groups=await(await send(`/progress/me/chapters?seasonId=${season}&view=Groups&chapterKey=${encodeURIComponent(`chapter:${pack}:GEN:1`)}`)).json() as ChapterPage;
 expect(groups.items.map(item=>'counts' in item?item.counts.assignedPassages:null)).toEqual([2,3,3,4,4,3]);
 expect(groups.items.every(item=>'parentChapterKey' in item&&item.parentChapterKey===`chapter:${pack}:GEN:1`)).toBe(true);
},30000);

it('pages multibyte valid question bodies before materialization without skipping heads',async()=>{
 const {send,store,meters}=await setup(30);
 for(let n=0;n<30;n++){const row=await store.require<{question:PbeQuestion}>('pbe-question-head',tid(100+n),TEST_ORG);await store.update('pbe-question-head',tid(100+n),TEST_ORG,{...row.value,question:{...row.value.question,prompt:'界'.repeat(9000)}},row.revision).run();}
 const page=await finish(send);expect(page.items[0]).toMatchObject({counts:{questionCoveredPassages:1,totalTargets:2,missingVariantTargets:0}});
 const manifests=await store.list<{family:string;entries:unknown[]}>('pbe-chapter-manifest',TEST_ORG,{seasonId:season,ownerId:student});expect(manifests.filter(p=>p.family==='heads').flatMap(p=>p.entries)).toHaveLength(30);
 expect(Math.max(...meters.filter(m=>String(m.path).endsWith('/continue')).map(m=>Number(m.maxReturnedPayloadBytes??0)))).toBeLessThanOrEqual(65536);
},30000);

it('stages more than 128 witness candidates across immutable bounded proof pages',async()=>{
 const {send,store,meters}=await setup(0);const allTargets:PbeTarget[]=Array.from({length:130},(_,n)=>({id:tid(n+1),sourceUnitIds:[source],skill:'FactualRecall',label:`Target ${n+1}`}));
 for(const target of allTargets.slice(2))await store.insert('pbe-target',target.id,TEST_ORG,target,{seasonId:season,ownerId:source});
 const unit=(await store.require<Parameters<typeof sourceProof>[1] extends Map<string,infer T>?T:never>('source',source,TEST_ORG)).value;
 const ctx={store,env:{DB:store.db},orgId:TEST_ORG,actor:{userId:student,organizationId:TEST_ORG,kind:'Student',role:'Student'},request:new Request('https://erudoza.test'),path:''} as unknown as RequestContext,start=Date.now()-5*86400000;
 for(let variant=0;variant<2;variant++)for(let offset=0;offset<130;offset+=8){
  const targets=allTargets.slice(offset,offset+8),qid=tid(2000+offset+variant),q:PbeQuestion={schemaVersion:2,id:qid,version:1,contentPackId:pack,sourceUnitId:source,sourceUnitIds:[source],sourceKind:'Scripture',reference:'GEN 1:1',evidence:'Alpha and Beta',kind:'List',prompt:'Name the targets.',ordered:false,parts:targets.map(t=>({targetId:t.id,acceptedAnswers:['Alpha'],points:1}))};
  await store.insert('pbe-question-head',qid,TEST_ORG,{id:qid,seasonId:season,published:true,sourceFingerprint:await sourceProof(q,new Map([[source,unit]])),question:q},{seasonId:season,ownerId:source});
  const attemptId=crypto.randomUUID(),atMs=start+variant*172800000,w=await prepareRecallEvidence(ctx,season,'saved',targets.map(t=>({attemptId,targetId:t.id,questionId:qid,atMs,earnedPoints:1,availablePoints:1,unaided:true,recall:true})),'List',{questionVersion:1,responseLockedAtMs:atMs});await atomic(ctx,'test.witness-page',w.statements,w.guards);
 }
 const page=await finish(send);expect(page.items[0]).toMatchObject({counts:{totalTargets:130,retainedTargets:130},currentReadiness:'Retained',stamp:{earnedAtUtc:expect.any(String)}});
 const proofs=await store.list<{entries:{targetId:string;witness:unknown[]}[]}>('pbe-chapter-stamp-proof',TEST_ORG,{seasonId:season,ownerId:student});expect(proofs.length).toBeGreaterThan(1);expect(proofs.flatMap(p=>p.entries)).toHaveLength(130);for(const proof of proofs){expect(proof.entries.flatMap(e=>e.witness).length).toBeLessThanOrEqual(128);expect(new TextEncoder().encode(JSON.stringify(proof)).byteLength).toBeLessThanOrEqual(65536);}
 process.stdout.write('D1 130target maxima '+JSON.stringify(Object.fromEntries(['statements','knownRowsRead','returnedBytes','maxReturnedPayloadBytes','maxBoundUtf8Bytes','firstQueriesWithoutRowsRead','elapsedMs'].map(k=>[k,Math.max(...meters.map(m=>Number(m[k]??0)))])))+'\n');
},30000);

// The maximum shape needs hundreds of HTTP continuations (726 in the recorded run).
// Keep the continuation/query/payload limits below; allow their full run on slower CI hosts.
it('completes the accepted 10000-target untouched shape with bounded ordinary continuations',async()=>{
 const {send,store,meters}=await setup(0),targets=Array.from({length:9998},(_,n)=>({id:tid(1000+n),sourceUnitIds:[source],skill:'FactualRecall',label:'Untouched target'}));
 await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) SELECT 'pbe-target',json_extract(value,'$.id'),?,?,?,value,1 FROM json_each(?)").bind(TEST_ORG,season,source,JSON.stringify(targets)).run();
 const page=await finish(send,750);expect(page.items[0]).toMatchObject({counts:{totalTargets:10000,retainedTargets:0,missingVariantTargets:10000},currentReadiness:'Incomplete',stamp:null});
 const requests=meters.filter(m=>String(m.path).endsWith('/continue')),publication=requests.findIndex(m=>m.scopeVersion!==null);expect(publication).toBeGreaterThan(0);
 for(const [index,meter] of requests.entries())if(index!==publication)expect(Number(meter.maxReturnedPayloadBytes??0)).toBeLessThanOrEqual(65536);
 expect(await store.list('pbe-chapter-stamp',TEST_ORG,{seasonId:season,ownerId:student})).toEqual([]);
 process.stdout.write('D1 10000target cost '+JSON.stringify({requests:requests.length,knownRowsRead:requests.reduce((n,m)=>n+Number(m.knownRowsRead??0),0),returnedBytes:requests.reduce((n,m)=>n+Number(m.returnedBytes??0),0),elapsedMs:requests.reduce((n,m)=>n+Number(m.elapsedMs??0),0),maxStatements:Math.max(...requests.map(m=>Number(m.statements))),maxOrdinaryReturnedPayloadBytes:Math.max(...requests.filter((_,i)=>i!==publication).map(m=>Number(m.maxReturnedPayloadBytes??0))),publication:requests[publication]})+'\n');
},120000);

it('scans manifest metadata once when counting a bounded target variant page',async()=>{
 const {store}=await setup(0),generation='diagnostic-generation';
 for(let n=0;n<100;n++)await store.insert('pbe-chapter-manifest',`diagnostic-${n}`,TEST_ORG,{id:`diagnostic-${n}`,generationId:generation,family:'retentions',entries:Array.from({length:100},(_,i)=>({targetId:tid(n*100+i),projection:{padding:'x'.repeat(470)}}))},{seasonId:season,ownerId:student});
 await store.insert('pbe-chapter-manifest','diagnostic-head',TEST_ORG,{id:'diagnostic-head',generationId:generation,family:'heads',entries:[]},{seasonId:season,ownerId:student});
 let rowsRead=0,elapsedMs=0;const db={prepare:(sql:string)=>({bind:(...args:(string|number|null)[])=>({all:async()=>{const start=performance.now(),result=await app.db.prepare(sql).bind(...args).all();elapsedMs+=performance.now()-start;rowsRead+=Number(result.meta.rows_read??0);return result;}})})};
 const ctx={env:{DB:db},orgId:TEST_ORG,actor:{userId:student}} as unknown as RequestContext;
 const counts=await targetVariantCounts(ctx,{seasonId:season,workId:generation},Array.from({length:128},(_,i)=>({id:tid(i),skill:'FactualRecall'})));expect(counts.size).toBe(128);expect([...counts.values()].every(n=>n===0)).toBe(true);
 process.stdout.write('D1 variant query evidence '+JSON.stringify({rowsRead,elapsedMs})+'\n');expect(rowsRead).toBeLessThan(2000);
},30000);

async function twoChapterBank(store:Store,commentary=false){
 const second=tid(8000),unit=(await store.require<{id:string;contentPackId:string;bookKey:string;chapter:number;verse:number;ordinal:number;citation:string;canonicalText:string;isActive:boolean}>('source',source,TEST_ORG)).value,other={...unit,id:second,chapter:2,ordinal:2,citation:'GEN 2:1'};
 await store.insert('source',second,TEST_ORG,other,{ownerId:pack});const range={bookKey:'GEN',startChapter:1,startVerse:1,endChapter:2,endVerse:1};
 for(const [kind,id] of [['scope',season],['assignment','assignment']]){const row=await store.require<Record<string,unknown>>(kind,id,TEST_ORG);await store.update(kind,id,TEST_ORG,kind==='scope'?{...row.value,includes:[range]}:{...row.value,...range},row.revision).run();}
 if(commentary){const row=await store.require<Record<string,unknown>>('pack',pack,TEST_ORG);await store.update('pack',pack,TEST_ORG,{...row.value,sourceType:'Commentary'},row.revision).run();}
 for(const id of [tid(1),tid(2)]){const row=await store.require<PbeTarget>('pbe-target',id,TEST_ORG);await store.update('pbe-target',id,TEST_ORG,{...row.value,sourceUnitIds:[source,second]},row.revision).run();}
 for(const id of [tid(100),tid(101)]){const row=await store.require<{question:PbeQuestion;sourceFingerprint:string}>('pbe-question-head',id,TEST_ORG),question={...row.value.question,sourceKind:commentary?'Commentary' as const:'Scripture' as const,sourceUnitIds:[source,second],reference:`${unit.citation}; ${other.citation}`};await store.update('pbe-question-head',id,TEST_ORG,{...row.value,question,sourceFingerprint:await sourceProof(question,new Map([[source,unit],[second,other]]))},row.revision).run();}
 return second;
}
it('fix1 treats two-chapter supplemental content as one stamped Introduction through HTTP',async()=>{
 const {send,store}=await setup();const second=await twoChapterBank(store,true);await seedPair(store);
 const page=await finish(send);expect(page.items).toHaveLength(1);expect(page.items[0]).toMatchObject({key:`intro:${pack}`,kind:'Introduction',chapter:null,counts:{assignedPassages:2,totalTargets:2,retainedTargets:2},stamp:{kind:'Introduction',chapterKey:`intro:${pack}`}});
 const rows=await store.list<{row:{kind:string}}>('pbe-chapter-projection',TEST_ORG,{seasonId:season,ownerId:student});expect(rows.map(r=>r.row.kind)).toEqual(['Introduction']);
 expect((await store.require<{chapter:number}>('source',source,TEST_ORG)).value.chapter).toBe(1);expect((await store.require<{chapter:number}>('source',second,TEST_ORG)).value.chapter).toBe(2);
},30000);
type FixWork={id:string;workId:string;bytes:number;proofBytes?:number;stage:string;abandoned:string|null;rowIndex:number;proofOffset:number;aggregate:{group:{kind:string;chapter:number|null;key:string};targetAfter:string}|null};
async function untilParent(send:Awaited<ReturnType<typeof setup>>['send'],store:Store,chapter:number){
 for(let n=0;n<65;n++){const saved=await store.get<FixWork>('pbe-chapter-work',`${student}:${season}`,TEST_ORG);if(saved?.value.stage==='Projecting'&&saved.value.aggregate?.group.kind==='Chapter'&&saved.value.aggregate.group.chapter===chapter&&saved.value.aggregate.targetAfter==='')return saved;const response=await send('/progress/me/chapters/continue',{seasonId:season});expect(response.status,await response.clone().text()).toBe(200);}
 throw new Error('Expected parent aggregation boundary.');
}
it('fix1 accounts witness families against one generation budget and preserves sealed pages on rejection and retry',async()=>{
 const {send,store}=await setup();await twoChapterBank(store);await seedPair(store);const saved=await untilParent(send,store,1),work=saved.value;
 const family=`proof-${String(work.rowIndex).padStart(6,'0')}`,id=`${work.workId}:${family}:000000`,entries=[];
 for(const targetId of [tid(1),tid(2)])entries.push({targetId,witness:(await store.require<ReviewProjection>('pbe-target-review',`${student}:${season}:${targetId}`,TEST_ORG)).value.retention!.witness!});
 const expected={id,generationId:work.workId,family,entries,hash:await chapterHash(entries)},pageBytes=utf8Bytes(expected),nearCap=CHAPTER_STAGE_BYTES-pageBytes;
 const legacyBudget={...work,bytes:nearCap};delete legacyBudget.proofBytes;await store.update('pbe-chapter-work',work.id,TEST_ORG,legacyBudget,saved.revision).run();
 const replies=await Promise.all([send('/progress/me/chapters/continue',{seasonId:season,workId:work.workId}),send('/progress/me/chapters/continue',{seasonId:season,workId:work.workId})]);expect(replies.map(r=>r.status)).toEqual([200,200]);
 const proof=(await store.require('pbe-chapter-stamp-proof',id,TEST_ORG)).value;expect(proof).toEqual(expected);expect((await store.require<FixWork>('pbe-chapter-work',work.id,TEST_ORG)).value).toMatchObject({bytes:CHAPTER_STAGE_BYTES,proofBytes:pageBytes});
 const next=await untilParent(send,store,2);const before=await store.list('pbe-chapter-stamp-proof',TEST_ORG,{seasonId:season,ownerId:student}),stamps=await store.list('pbe-chapter-stamp',TEST_ORG,{seasonId:season,ownerId:student});expect(stamps).toHaveLength(1);
 const blocked=await send('/progress/me/chapters/continue',{seasonId:season,workId:work.workId});expect(blocked.status).toBe(200);expect(await blocked.json()).toMatchObject({work:{state:'Blocked',reason:'InputTooLarge'},next:'None'});
 const rejected=(await store.require<FixWork>('pbe-chapter-work',work.id,TEST_ORG)).value;expect(rejected.bytes).toBe(CHAPTER_STAGE_BYTES);expect(rejected.proofBytes).toBe(pageBytes);expect(rejected.aggregate).toEqual(next.value.aggregate);expect(rejected.proofOffset).toBe(next.value.proofOffset);expect(await store.list('pbe-chapter-stamp-proof',TEST_ORG,{seasonId:season,ownerId:student})).toEqual(before);
 expect((await send('/progress/me/chapters/continue',{seasonId:season,workId:work.workId})).status).toBe(409);expect(await store.list('pbe-chapter-stamp-proof',TEST_ORG,{seasonId:season,ownerId:student})).toEqual(before);
 for(let n=0;n<10;n++){await send('/progress/me/chapters/continue',{seasonId:season});if((await store.require<FixWork>('pbe-chapter-work',work.id,TEST_ORG)).value.abandoned===null)break;}
 expect((await store.require('pbe-chapter-stamp-proof',id,TEST_ORG)).value).toEqual(proof);expect(await store.list('pbe-chapter-stamp',TEST_ORG,{seasonId:season,ownerId:student})).toEqual(stamps);
},30000);
it('fix1 makes one missing-history repair per generation then finishes DataGap without erasing acceptance',async()=>{
 const {send,store}=await setup();await seedPair(store);const accepted=[];
 for(const targetId of [tid(1),tid(2)]){const row=await store.require<ReviewProjection>('pbe-target-review',`${student}:${season}:${targetId}`,TEST_ORG),value={...row.value};delete value.retention;accepted.push(value);await store.update('pbe-target-review',value.id,TEST_ORG,value,row.revision).run();}
 await app.db.prepare("DELETE FROM Records WHERE org_id=? AND season_id=? AND kind IN ('pbe-recall-event','pbe-evidence-ref')").bind(TEST_ORG,season).run();const index=await store.require('pbe-evidence-index',`${student}:${season}`,TEST_ORG);await store.update('pbe-evidence-index',`${student}:${season}`,TEST_ORG,{id:`${student}:${season}`,ready:true,after:'',coveredLegacyEvents:2},index.revision).run();
 const page=await finish(send,55);expect(page.items[0]).toMatchObject({currentReadiness:'Updating',counts:{retainedTargets:0},stamp:null,actions:[]});
 for(const before of accepted){const after=(await store.require<ReviewProjection>('pbe-target-review',before.id,TEST_ORG)).value;expect(after).toMatchObject({acceptedSequence:before.acceptedSequence,failedSequence:before.failedSequence,lastAnsweredQuestionId:before.lastAnsweredQuestionId,lastAnsweredQuestionKind:before.lastAnsweredQuestionKind,review:before.review,retention:{dataGap:true}});}
 const jobs=await store.list<{missingReferenceRepairAttempted:boolean;generation:number}>('pbe-evidence-replay',TEST_ORG,{seasonId:season,ownerId:student});expect(jobs).toHaveLength(2);expect(jobs.every(j=>j.missingReferenceRepairAttempted&&j.generation===1)).toBe(true);expect((await store.require('pbe-evidence-index',`${student}:${season}`,TEST_ORG)).revision).toBe(index.revision+5);expect(await store.list('pbe-chapter-stamp',TEST_ORG,{seasonId:season,ownerId:student})).toEqual([]);
},30000);

it.each(['bank','assignment'] as const)('history conservatively defers %s scope comparison until ordinary projection verifies it',async(change)=>{
 const {send,store}=await setup();await seedPair(store);await finish(send);const stamps=await store.list<{id:string}>('pbe-chapter-stamp',TEST_ORG,{seasonId:season,ownerId:student});
 if(change==='bank')await store.insert('pbe-target',tid(3),TEST_ORG,{id:tid(3),sourceUnitIds:[source],skill:'FactualRecall',label:'New declared target'},{seasonId:season,ownerId:source});
 else {const a=await store.require<Record<string,unknown>>('assignment','assignment',TEST_ORG);await store.put('assignment','assignment',TEST_ORG,{...a.value,endVerse:2},a.revision);}
 const before=await app.db.prepare("SELECT kind,id,data,revision FROM Records WHERE org_id=? AND season_id=? AND kind LIKE 'pbe-chapter-%' ORDER BY kind,id").bind(TEST_ORG,season).all();
 const response=await send(`/progress/me/chapters?seasonId=${season}&view=Stamps`);expect(response.status).toBe(200);const history=await response.json() as ChapterPage;expect(history.scopeVersion).toBeNull();expect(history.items[0]).toMatchObject({matchesCurrentScope:null});
 const current=await(await send(`/progress/me/chapters?seasonId=${season}`)).json() as ChapterPage;expect(current.items).toEqual([]);expect(current.snapshotId).toBeNull();expect(await store.list('pbe-chapter-stamp',TEST_ORG,{seasonId:season,ownerId:student})).toEqual(stamps);
 const after=await app.db.prepare("SELECT kind,id,data,revision FROM Records WHERE org_id=? AND season_id=? AND kind LIKE 'pbe-chapter-%' ORDER BY kind,id").bind(TEST_ORG,season).all();expect(after.results).toEqual(before.results);
 await finish(send);const rebuilt=await(await send(`/progress/me/chapters?seasonId=${season}&view=Stamps`)).json() as ChapterPage;expect(rebuilt.scopeVersion).toBeTruthy();
 for(const stamp of stamps){expect(rebuilt.items.find(item=>'stampId' in item&&item.stampId===stamp.id)).toMatchObject({matchesCurrentScope:false});expect((await store.require('pbe-chapter-stamp',stamp.id,TEST_ORG)).value).toEqual(stamp);}
},30000);
it('history keeps a matching authorized scope after evidence-only invalidation without publishing counters',async()=>{
 const {send,store}=await setup();const {ctx,start}=await seedPair(store);await finish(send);const stamps=await store.list('pbe-chapter-stamp',TEST_ORG,{seasonId:season,ownerId:student});
 const attemptId=crypto.randomUUID(),w=await prepareRecallEvidence(ctx,season,'saved',[{attemptId,targetId:tid(1),questionId:tid(100),atMs:start+3*172800000,earnedPoints:0,availablePoints:1,unaided:true,recall:true}],'List',{questionVersion:1,responseLockedAtMs:start+3*172800000});await atomic(ctx,'test.wrong',w.statements,w.guards);
 const history=await(await send(`/progress/me/chapters?seasonId=${season}&view=Stamps`)).json() as ChapterPage;expect(history.items[0]).toMatchObject({matchesCurrentScope:true});expect(history.snapshotId).toBeNull();expect(await store.list('pbe-chapter-stamp',TEST_ORG,{seasonId:season,ownerId:student})).toEqual(stamps);
},30000);
it.each(['disabled','membership','assignment'] as const)('history keeps owned dated stamps without a comparison after %s revocation',async(change)=>{
 const {send,store}=await setup();await seedPair(store);await finish(send);const stamps=await store.list('pbe-chapter-stamp',TEST_ORG,{seasonId:season,ownerId:student});
 if(change==='disabled'){const row=await store.require<Record<string,unknown>>('season',season,TEST_ORG);await store.put('season',season,TEST_ORG,{...row.value,pbeEnabled:false},row.revision);}else await store.remove(change,change==='membership'?`${season}:${student}`:'assignment',TEST_ORG);
 const response=await send(`/progress/me/chapters?seasonId=${season}&view=Stamps`);expect(response.status).toBe(200);const history=await response.json() as ChapterPage;expect(history.items[0]).toMatchObject({matchesCurrentScope:null});expect(history.currentAvailable).toBe(false);expect(await store.list('pbe-chapter-stamp',TEST_ORG,{seasonId:season,ownerId:student})).toEqual(stamps);
},30000);
