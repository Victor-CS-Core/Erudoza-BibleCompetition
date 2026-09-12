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
 fixture=await disputeFixture('fix1-eight-target-pages',{parts:8});const f=fixture;
 const session=await (await f.call(0,'/study/sessions',{seasonId:f.season,format:'Pbe',mode:'Practice'})).json() as {id:string};const card=await (await f.call(0,`/study/sessions/${session.id}/next`)).json() as {id:string;question:PbeQuestion};
 const ctx={store:f.store,env:{DB:f.store.db},orgId:TEST_ORG,actor:{userId:f.players[0].id,organizationId:TEST_ORG,kind:'Student',role:'Student'},request:new Request('https://erudoza.test'),path:''} as unknown as RequestContext;
 for(let n=0;n<97;n++){const aid=crypto.randomUUID(),atMs=Date.now()-(104-n)*86400000,evidence=f.targets.map(t=>({attemptId:aid,targetId:t.id,questionId:card.question.id,atMs,earnedPoints:1,availablePoints:1,unaided:true,recall:true}));const w=await prepareRecallEvidence(ctx,f.season,'prior-frozen-scope',evidence,'List');await atomic(ctx,'fixture.legacy-accept',w.statements,w.guards);}
 await f.app.db.prepare("DELETE FROM Records WHERE org_id=? AND season_id=? AND kind IN ('pbe-evidence-ref','pbe-evidence-index')").bind(TEST_ORG,f.season).run();
 const answer=await f.call(0,`/study/sessions/${session.id}/attempts`,{clientSubmissionId:crypto.randomUUID(),challengeCardId:card.id,answers:['Alpha',...Array(7).fill('wrong')],hintsUsed:false});expect(answer.status,await answer.clone().text()).toBe(200);const accepted=await answer.json() as {attemptId:string};
 const flagged=await f.call(0,'/pbe/disputes',{activity:'Solo',sessionId:session.id,attemptId:accepted.attemptId,reason:'Check all eight frozen parts'});expect(flagged.status).toBe(201);const d=await flagged.json() as {id:string;partPoints:number[]};expect(d.partPoints).toEqual(Array(8).fill(1));
 const path='/pbe/disputes/'+encodeURIComponent(d.id);const pending=await f.store.list<ReviewProjection>('pbe-target-review',TEST_ORG,{seasonId:f.season});expect(pending.every(p=>p.provisional)).toBe(true);
 const first=await f.call(-1,path+'/replay',{});expect(first.status).toBe(200);expect(await first.json()).toMatchObject({stage:'Indexing',indexReady:false});
 // A new acceptance after the first legacy page writes refs directly, even if its UUID sorts before that page.
 const extraAt=Date.now()+1,extra=f.targets.map(t=>({attemptId:'00000001-0000-4000-8000-000000000001',targetId:t.id,questionId:card.question.id,atMs:extraAt,earnedPoints:1,availablePoints:1,unaided:true,recall:true}));const concurrent=await prepareRecallEvidence(ctx,f.season,'new-frozen-scope',extra,'List');await atomic(ctx,'fixture.concurrent-accept',concurrent.statements,concurrent.guards);
 const original=await f.store.list('pbe-recall-event',TEST_ORG,{seasonId:f.season});let ready=false;
 const resolution={expectedRevision:1,pointsByPart:Array(8).fill(1),reason:'All eight parts are supported by the frozen source'};expect((await f.call(-1,path+'/resolve',resolution)).status).toBe(200);expect((await f.call(-1,path+'/resolve',resolution)).status).toBe(200);
 const queue=await (await f.call(-1,'/pbe/disputes')).json() as {items:{id:string;status:string}[]};expect(queue.items).toEqual([expect.objectContaining({id:d.id,status:'Resolved'})]);
 // A page batch can stop, then another correction for the same targets must remain independently discoverable.
 for(let n=0;n<20;n++){const page=await f.call(-1,path+'/replay',{});expect((await page.json() as {status:string}).status).toBe('Provisional');}
 expect((await (await f.call(-1,'/pbe/disputes')).json() as {items:unknown[]}).items).toHaveLength(1);
 const pendingProof=await (await f.call(0,path+'/evidence?targetId='+f.targets[0].id)).json() as {items:unknown[];nextCursor:string};expect(pendingProof.items).toHaveLength(32);expect(pendingProof.nextCursor).toBeTruthy();
 const nextCard=await (await f.call(0,`/study/sessions/${session.id}/next`)).json() as {id:string};
 const secondAnswer=await (await f.call(0,`/study/sessions/${session.id}/attempts`,{clientSubmissionId:crypto.randomUUID(),challengeCardId:nextCard.id,answers:f.labels,hintsUsed:false})).json() as {attemptId:string};
 const second=await (await f.call(0,'/pbe/disputes',{activity:'Solo',sessionId:session.id,attemptId:secondAnswer.attemptId,reason:'Second correction on shared targets'})).json() as {id:string};
 const secondPath='/pbe/disputes/'+encodeURIComponent(second.id);
 expect((await f.call(-1,secondPath+'/resolve',resolution)).status).toBe(200);
 expect((await (await f.call(-1,'/pbe/disputes')).json() as {items:unknown[]}).items).toHaveLength(2);
 const allOriginal=await f.store.list('pbe-recall-event',TEST_ORG,{seasonId:f.season});

 ready=false;for(let n=0;n<64&&!ready;n++){const r=await f.call(-1,path+'/replay',{});expect(r.status).toBe(200);ready=(await r.json() as {status:string}).status==='Ready';}expect(ready).toBe(true);
 expect((await (await f.call(-1,'/pbe/disputes')).json() as {items:{id:string}[]}).items.map(d=>d.id)).toEqual([second.id]);expect((await f.call(-1,secondPath+'/replay',{})).status).toBe(200);
 expect((await (await f.call(-1,'/pbe/disputes')).json() as {items:unknown[]}).items).toHaveLength(0);expect((await f.call(-1,path+'/resolve',resolution)).status).toBe(200);expect((await (await f.call(-1,'/pbe/disputes')).json() as {items:unknown[]}).items).toHaveLength(0);
 expect(allOriginal).toEqual(expect.arrayContaining(original));expect(await f.store.list('pbe-recall-event',TEST_ORG,{seasonId:f.season})).toEqual(allOriginal);expect((await f.store.list<ReviewProjection>('pbe-target-review',TEST_ORG,{seasonId:f.season})).every(p=>!p.provisional&&p.acceptedSequence===100)).toBe(true);
 const proof=await (await f.call(0,path+'/evidence?targetId='+f.targets[0].id+'&after='+encodeURIComponent(pendingProof.nextCursor))).json() as {items:{gradeStatus:string;responseLockedAtMs:number|null;finalEvidence:unknown}[]};expect(proof.items).toHaveLength(32);expect((await f.call(0,path+'/evidence?targetId='+crypto.randomUUID())).status).toBe(403);
 // Mixed pending/correction streams are independently capped before cursor merge.
 const frozen=(await f.store.require('pbe-dispute',d.id,TEST_ORG)).value as Record<string,unknown>;
 const queued=Array.from({length:120},(_,n)=>({kind:n%2?'pbe-dispute-pending':'pbe-dispute-correction',id:`Solo:queue-${String(n).padStart(3,'0')}:attempt`,value:{...frozen,id:`Solo:queue-${String(n).padStart(3,'0')}:attempt`,status:n%2?'Pending':'Resolved'}}));
 await f.app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) SELECT json_extract(value,'$.kind'),json_extract(value,'$.id'),?,?,'Solo',json_extract(value,'$.value'),1 FROM json_each(?)").bind(TEST_ORG,f.season,JSON.stringify(queued)).run();
 await f.flagControl(false);let cursor='';const seen:string[]=[];
 for(const count of [50,50,20]){const page=await (await f.call(-1,'/pbe/disputes?after='+encodeURIComponent(cursor))).json() as {items:{id:string}[];nextCursor:string|null};expect(page.items).toHaveLength(count);seen.push(...page.items.map(d=>d.id));cursor=page.nextCursor??'';}
 expect(cursor).toBe('');expect(seen).toEqual(queued.map(d=>d.id));
 (await f.call(0,`/study/sessions/${session.id}/complete`,{}));expect((await f.call(0,`/study/sessions/${session.id}/recap`)).status).toBe(200);
},60000);
