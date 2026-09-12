// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {createNativeTestApp,TEST_ORG,TEST_USER} from '../test-runtime';
import {Store} from '../store';
import type {Env,RequestContext} from '../types';
import {atomic} from '../application/model';
import {prepareRecallEvidence,type ReviewProjection} from './progress';
import {prepareEvidenceDispute,replayDisputeEvidence,disputeEvidencePage} from './evidence-replay';
import type {PbeDispute} from './disputes';
import {advanceReview,initialReview} from './review';
let app:Awaited<ReturnType<typeof createNativeTestApp>>;
afterEach(async()=>{await app?.runtime.dispose();});
it('backfills25 immutable legacy events per page, covers concurrent new acceptance and replays32refs in original tied chronology',async()=>{
 app=await createNativeTestApp();const store=new Store(app.db as unknown as Env['DB']),ctx={store,env:{DB:store.db},orgId:TEST_ORG,actor:{userId:TEST_USER,organizationId:TEST_ORG,kind:'Adult',role:'Owner'},request:new Request('https://erudoza.test'),path:''} as unknown as RequestContext;
 const season=crypto.randomUUID(),target=crypto.randomUUID(),question=crypto.randomUUID(),session=crypto.randomUUID();
 const evidence=Array.from({length:34},(_,n)=>({attemptId:n===33?'00000001-0000-4000-8000-000000000001':crypto.randomUUID(),targetId:target,questionId:question,atMs:Math.floor(n/2)*86400000,earnedPoints:n===32?0:1,availablePoints:1,unaided:true,recall:true}));
 for(const e of evidence.slice(0,33)){const w=await prepareRecallEvidence(ctx,season,'saved-scope',[e],'ShortAnswer');await atomic(ctx,'test.accept',w.statements,w.guards);}
 await store.remove('pbe-evidence-index',`${TEST_USER}:${season}`,TEST_ORG);await app.db.prepare("DELETE FROM Records WHERE kind='pbe-evidence-ref' AND season_id=?").bind(season).run();
 const d:PbeDispute={id:`Solo:${session}:${evidence[32].attemptId}`,organizationId:TEST_ORG,seasonId:season,activity:'Solo',sessionId:session,attemptId:evidence[32].attemptId,questionId:question,questionVersion:1,team:null,status:'Pending',reason:'Check the label',revision:1,partPoints:[1],sourceEvidence:'Daniel',question:{schemaVersion:2,id:question,version:1,sourceKind:'Scripture',sourceUnitId:target,sourceUnitIds:[target],contentPackId:target,reference:'Daniel1',evidence:'Daniel',kind:'ShortAnswer',prompt:'Who?',ordered:false,parts:[{targetId:target,points:1,acceptedAnswers:['Daniel']}]},answers:['wrong'],originalPointsByPart:[0],acceptedAtUtc:new Date(evidence[32].atMs).toISOString(),participantIds:[TEST_USER],allParticipantIds:[TEST_USER],resolution:null};
 let w=await prepareEvidenceDispute(ctx,d);await atomic(ctx,'test.flag',w.statements,w.guards);
 expect((await disputeEvidencePage(ctx,d,target,'')).status).toBe('Provisional');
 expect(await replayDisputeEvidence(ctx,d)).toMatchObject({status:'Provisional',stage:'Indexing'});expect(await store.list('pbe-evidence-ref',TEST_ORG,{seasonId:season})).toHaveLength(25);
 w=await prepareRecallEvidence(ctx,season,'saved-scope',[evidence[33]],'ShortAnswer');await atomic(ctx,'test.concurrent',w.statements,w.guards);
 const original=await store.list('pbe-recall-event',TEST_ORG,{seasonId:season});
 const pages=[];for(let page=0;page<10;page++){const result=await replayDisputeEvidence(ctx,d);pages.push(result);if(result.status==='Ready')break;}
 expect(pages).toContainEqual(expect.objectContaining({processed:32,targetComplete:false}));expect(pages.at(-1)).toMatchObject({status:'Ready',proofs:[expect.objectContaining({provisional:true,pendingCount:1,acceptedSequence:34})]});expect(await store.list('pbe-evidence-ref',TEST_ORG,{seasonId:season})).toHaveLength(34);
 const resolved:PbeDispute={...d,status:'Resolved',revision:2,resolution:{pointsByPart:[1],reason:'Supported by the source',resolvedBy:TEST_USER,resolvedAtUtc:new Date().toISOString()}};w=await prepareEvidenceDispute(ctx,resolved);await atomic(ctx,'test.resolve',w.statements,w.guards);
 for(let page=0;page<10;page++){if((await replayDisputeEvidence(ctx,resolved)).status==='Ready')break;}
 const projection=(await store.require<ReviewProjection>('pbe-target-review',`${TEST_USER}:${season}:${target}`,TEST_ORG)).value;let expected=initialReview(target);for(const e of evidence)expected=advanceReview(expected,{...e,earnedPoints:1});expect(projection.review).toEqual(expected);expect(projection.provisional).toBe(false);expect(projection.acceptedSequence).toBe(34);expect(await store.list('pbe-recall-event',TEST_ORG,{seasonId:season})).toEqual(original);
 const proof=await disputeEvidencePage(ctx,resolved,target,'');expect(proof.items).toHaveLength(32);expect(proof.nextCursor).toBeTruthy();expect(proof.items.every(p=>p.responseLockedAtMs===null)).toBe(true);expect(proof.provisional).toBe(false);
 // An incomplete restored index must not finalize an empty history over a saved accepted sequence.
 await app.db.prepare("DELETE FROM Records WHERE kind='pbe-evidence-ref' AND season_id=?").bind(season).run();
 w=await prepareEvidenceDispute(ctx,resolved);await atomic(ctx,'test.repair-request',w.statements,w.guards);
 expect(await replayDisputeEvidence(ctx,resolved)).toMatchObject({status:'Provisional',stage:'Indexing',indexReady:false});
 expect((await store.require<ReviewProjection>('pbe-target-review',`${TEST_USER}:${season}:${target}`,TEST_ORG)).value.acceptedSequence).toBe(34);
 for(let page=0;page<10;page++){if((await replayDisputeEvidence(ctx,resolved)).status==='Ready')break;}
 expect((await store.require<ReviewProjection>('pbe-target-review',`${TEST_USER}:${season}:${target}`,TEST_ORG)).value.review).toEqual(expected);
},30000);
