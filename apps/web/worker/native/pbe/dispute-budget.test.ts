// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {disputeFixture} from './dispute-fixture';
import {TEST_ORG} from '../test-runtime';
import type {RequestContext} from '../types';
import {atomic} from '../application/model';
import {prepareRecallEvidence,type ReviewProjection} from './progress';
import type {PbeQuestion} from './types';
let fixture:Awaited<ReturnType<typeof disputeFixture>>;
afterEach(async()=>{await fixture?.app.runtime.dispose();});
it('bounds authenticated eight-target flag/resolve,25-event bulk backfill and32-ref proof pages while retaining concurrent acceptance',async()=>{
 fixture=await disputeFixture('eight-target-pages',{parts:8});const f=fixture;
 const session=await (await f.call(0,'/study/sessions',{seasonId:f.season,format:'Pbe',mode:'Practice'})).json() as {id:string};const card=await (await f.call(0,`/study/sessions/${session.id}/next`)).json() as {id:string;question:PbeQuestion};
 const ctx={store:f.store,env:{DB:f.store.db},orgId:TEST_ORG,actor:{userId:f.players[0].id,organizationId:TEST_ORG,kind:'Student',role:'Student'},request:new Request('https://erudoza.test'),path:''} as unknown as RequestContext;
 for(let n=0;n<33;n++){const aid=crypto.randomUUID(),evidence=f.targets.map(t=>({attemptId:aid,targetId:t.id,questionId:card.question.id,atMs:Date.now()-(40-n)*86400000,earnedPoints:1,availablePoints:1,unaided:true,recall:true}));const w=await prepareRecallEvidence(ctx,f.season,'prior-frozen-scope',evidence,'List');await atomic(ctx,'fixture.legacy-accept',w.statements,w.guards);}
 await f.app.db.prepare("DELETE FROM Records WHERE org_id=? AND season_id=? AND kind IN ('pbe-evidence-ref','pbe-evidence-index')").bind(TEST_ORG,f.season).run();
 const answer=await f.call(0,`/study/sessions/${session.id}/attempts`,{clientSubmissionId:crypto.randomUUID(),challengeCardId:card.id,answers:['Alpha',...Array(7).fill('wrong')],hintsUsed:false});expect(answer.status,await answer.clone().text()).toBe(200);const accepted=await answer.json() as {attemptId:string};
 const flagged=await f.call(0,'/pbe/disputes',{activity:'Solo',sessionId:session.id,attemptId:accepted.attemptId,reason:'Check all eight frozen parts'});expect(flagged.status).toBe(201);const d=await flagged.json() as {id:string;partPoints:number[]};expect(d.partPoints).toEqual(Array(8).fill(1));
 const path='/pbe/disputes/'+encodeURIComponent(d.id);const pending=await f.store.list<ReviewProjection>('pbe-target-review',TEST_ORG,{seasonId:f.season});expect(pending.every(p=>p.provisional)).toBe(true);
 const first=await f.call(-1,path+'/replay',{});expect(first.status).toBe(200);expect(await first.json()).toMatchObject({stage:'Indexing',indexReady:false});
 // A new acceptance after the first legacy page writes refs directly, even if its UUID sorts before that page.
 const extra=f.targets.map(t=>({attemptId:'00000001-0000-4000-8000-000000000001',targetId:t.id,questionId:card.question.id,atMs:Date.now()+1,earnedPoints:1,availablePoints:1,unaided:true,recall:true}));const concurrent=await prepareRecallEvidence(ctx,f.season,'new-frozen-scope',extra,'List');await atomic(ctx,'fixture.concurrent-accept',concurrent.statements,concurrent.guards);
 const original=await f.store.list('pbe-recall-event',TEST_ORG,{seasonId:f.season});let ready=false;for(let n=0;n<24&&!ready;n++){const r=await f.call(-1,path+'/replay',{});expect(r.status).toBe(200);ready=(await r.json() as {status:string}).status==='Ready';}expect(ready).toBe(true);
 const pendingProof=await (await f.call(0,path+'/evidence?targetId='+f.targets[0].id)).json() as {provisional:boolean;items:unknown[];nextCursor:string};expect(pendingProof.provisional).toBe(true);expect(pendingProof.items).toHaveLength(32);expect(pendingProof.nextCursor).toBeTruthy();
 const resolution={expectedRevision:1,pointsByPart:Array(8).fill(1),reason:'All eight parts are supported by the frozen source'};expect((await f.call(-1,path+'/resolve',resolution)).status).toBe(200);expect((await f.call(-1,path+'/resolve',resolution)).status).toBe(200);
 ready=false;for(let n=0;n<24&&!ready;n++){const r=await f.call(-1,path+'/replay',{});expect(r.status).toBe(200);ready=(await r.json() as {status:string}).status==='Ready';}expect(ready).toBe(true);
 expect(await f.store.list('pbe-recall-event',TEST_ORG,{seasonId:f.season})).toEqual(original);expect((await f.store.list<ReviewProjection>('pbe-target-review',TEST_ORG,{seasonId:f.season})).every(p=>!p.provisional&&p.acceptedSequence===35)).toBe(true);
 const proof=await (await f.call(0,path+'/evidence?targetId='+f.targets[0].id+'&after='+encodeURIComponent(pendingProof.nextCursor))).json() as {items:{gradeStatus:string;responseLockedAtMs:number|null;finalEvidence:unknown}[]};expect(proof.items).toHaveLength(3);expect(proof.items.some(i=>i.gradeStatus==='Resolved'&&i.finalEvidence!==null)).toBe(true);expect((await f.call(0,path+'/evidence?targetId='+crypto.randomUUID())).status).toBe(403);
 (await f.call(0,`/study/sessions/${session.id}/complete`,{}));expect((await f.call(0,`/study/sessions/${session.id}/recap`)).status).toBe(200);
},60000);
