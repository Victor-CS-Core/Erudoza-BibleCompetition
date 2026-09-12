// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {createNativeTestApp,TEST_ORG,TEST_USER} from '../test-runtime';
import {Store} from '../store';
import type {Env,RequestContext} from '../types';
import {atomic} from '../application/model';
import {prepareRecallEvidence,type ReviewProjection} from './progress';
let app:Awaited<ReturnType<typeof createNativeTestApp>>;
afterEach(async()=>{await app?.runtime.dispose();});
it('advances retention with original response locks atomically beside scheduling',async()=>{
 app=await createNativeTestApp();const store=new Store(app.db as unknown as Env['DB']),ctx={store,env:{DB:store.db},orgId:TEST_ORG,actor:{userId:TEST_USER,organizationId:TEST_ORG,kind:'Adult',role:'Owner'},request:new Request('https://erudoza.test'),path:''} as unknown as RequestContext;
 const season=crypto.randomUUID(),target=crypto.randomUUID(),delay=172800000;
 const append=async(accepted:number,locked:number)=>{const e={attemptId:crypto.randomUUID(),targetId:target,questionId:crypto.randomUUID(),atMs:accepted,earnedPoints:1,availablePoints:1,unaided:true,recall:true};const w=await prepareRecallEvidence(ctx,season,'scope',[e],'ShortAnswer',{questionVersion:1,responseLockedAtMs:locked});await atomic(ctx,'test.accept',w.statements,w.guards);return e;};
 const first=await append(0,0);await append(delay*2,1000);
 const id=`${TEST_USER}:${season}:${target}`;
 expect((await store.require<ReviewProjection>('pbe-target-review',id,TEST_ORG)).value.retention).toMatchObject({practiced:true,recalled:true,witness:null,dataGap:false});
 const last=await append(delay*3,delay);
 const projection=(await store.require<ReviewProjection>('pbe-target-review',id,TEST_ORG)).value;
 expect(projection.retention?.witness?.map(p=>p.attemptId)).toEqual([first.attemptId,last.attemptId]);
 expect(projection.review.lastSuccessfulAtMs).toBe(delay*3);
},30000);
