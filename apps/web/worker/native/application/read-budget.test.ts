// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG, TEST_USER } from '../test-runtime';
import { Store } from '../store';
import { scopeSources, seasonSummaries } from './model';
import { handleStudy } from '../study/routes';
import type { RequestContext, Env } from '../types';
// @ts-expect-error Standalone Node provisioning module.
import { loadLibrary, seedStatements, stableId } from '../../../scripts/nkjv-library.mjs';

let app: Awaited<ReturnType<typeof createNativeTestApp>>, ctx: RequestContext;
const season='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',eph=stableId('book:EPH');
const range={bookKey:'EPH',startChapter:6,startVerse:1,endChapter:6,endVerse:3};
const scope={contentPackId:eph,includes:[range],excludes:[{...range,startVerse:2,endVerse:2}]};
let measured:{sql:string;args:unknown[];rows:number;results?:unknown[]}[]=[];
beforeAll(async()=>{
  app=await createNativeTestApp();
  const seed=seedStatements(await loadLibrary());
  for(let i=0;i<seed.length;i+=20)await app.db.batch(seed.slice(i,i+20).map((sql:string)=>app.db.prepare(sql)));
  await app.db.prepare("UPDATE Users SET kind='Student',role='Student' WHERE id=?").bind(TEST_USER).run();
  const store=new Store(app.db as unknown as Env['DB']);
  await store.insert('season',season,TEST_ORG,{id:season,name:'Bounded read test',status:'Active'});
  await store.insert('scope',season,TEST_ORG,scope,{seasonId:season});
  await store.insert('assignment','assigned',TEST_ORG,{id:'assigned',seasonId:season,studentUserId:TEST_USER,contentPackId:eph,type:'PrimarySpecialist',...range},{seasonId:season,ownerId:TEST_USER});
  await store.insert('membership',`${season}:${TEST_USER}`,TEST_ORG,{studentUserId:TEST_USER,difficulty:'Foundation'},{seasonId:season,ownerId:TEST_USER});
  await app.db.prepare("INSERT INTO Organizations(id,name,slug) VALUES('foreign','Foreign','foreign-read-test')").run();
  await store.insert('pack','private-pack','foreign',{id:'private-pack',isActive:true,licensingStatus:'approved'});
  await store.insert('source','private-source','foreign',{id:'private-source',contentPackId:'private-pack',bookKey:'EPH',chapter:6,verse:1,ordinal:1,canonicalText:'Must stay private',isActive:true},{ownerId:'private-pack'});
  for(const [packId,isActive,licensingStatus] of [['inactive-pack',false,'approved'],['unapproved-pack',true,'pending']] as const){
    await store.insert('pack',packId,TEST_ORG,{id:packId,isActive,licensingStatus});
    await store.insert('source',`${packId}-source`,TEST_ORG,{id:`${packId}-source`,contentPackId:packId,bookKey:'EPH',chapter:6,verse:1,ordinal:1,canonicalText:'Unavailable content',isActive:true},{ownerId:packId});
  }
  const wrap=(sql:string,statement:ReturnType<typeof app.db.prepare>,args:unknown[]=[])=>({
    inner:statement,
    bind(...values:unknown[]){return wrap(sql,statement.bind(...values),values);},
    async all(){const result=await statement.all();measured.push({sql,args,rows:result.meta.rows_read,results:result.results});return result;},
    async first(column?:string){const result=await statement.all();measured.push({sql,args,rows:result.meta.rows_read});const row=result.results[0] as Record<string,unknown>|undefined;return column?row?.[column]??null:row??null;},
    async run(){const result=await statement.run();measured.push({sql,args,rows:result.meta.rows_read});return result;},
  });
  const db={prepare(sql:string){return wrap(sql,app.db.prepare(sql));},async batch(statements:{inner:ReturnType<typeof app.db.prepare>}[]){const results=await app.db.batch(statements.map(s=>s.inner));results.forEach(r=>measured.push({sql:'batch',args:[],rows:r.meta.rows_read}));return results;}} as unknown as Env['DB'];
  ctx={env:{DB:db},orgId:TEST_ORG,store:new Store(db),actor:{userId:TEST_USER,organizationId:TEST_ORG,organizationName:'Practice Club',displayName:'Student',userName:'coach',email:null,kind:'Student',role:'Student',credentialVersion:'v1'},path:'',request:new Request('https://erudoza.test')};
},60000);
beforeEach(()=>{measured=[];});
afterAll(async()=>{await app?.runtime.dispose();});
const reads=()=>measured.reduce((n,q)=>n+q.rows,0);

it('reads only selected books for overlapping includes, exclusions and canonical ordering',async()=>{
  const result=await scopeSources(ctx,{...scope,includes:[range,{...range,endVerse:1}]});
  expect(result.map(s=>s.citation)).toEqual(['Ephesians 6:1','Ephesians 6:3']);
  expect(reads()).toBeLessThan(1000);
  const query=measured[0],before=await app.db.prepare(query.sql.replaceAll(' CROSS JOIN ',' JOIN ').replace(' INDEXED BY Records_owner','')).bind(...query.args).all<{data:string}>();
  const previous=before.results.map(r=>JSON.parse(r.data)).sort((a,b)=>a.ordinal-b.ordinal||a.id.localeCompare(b.id));
  // Exact serialized source order also preserves fingerprints computed by consumers.
  expect(JSON.stringify(result)).toBe(JSON.stringify(previous));
  for(const contentPackId of ['missing-pack','private-pack','inactive-pack','unapproved-pack'])expect(await scopeSources(ctx,{contentPackId,includes:[range],excludes:[]})).toEqual([]);
});
it('counts one season without scanning unrelated canonical books',async()=>{
  expect(await seasonSummaries(ctx)).toEqual([expect.objectContaining({id:season,scopeUnitCount:2,assignmentCount:1})]);
  expect(reads()).toBeLessThan(1000);
});
it('bounds source pagination by the requested pack and preserves isolation',async()=>{
  const whole=await ctx.store.list<{id:string}>('source',TEST_ORG,{ownerId:eph});
  expect(whole).toHaveLength(155);expect(reads()).toBeLessThan(1000);
  const paged:{id:string}[]=[];let after:string|undefined;
  for(let i=0;i<3;i++){measured=[];const page=await ctx.store.list<{id:string}>('source',TEST_ORG,{ownerId:eph,limit:70,after});paged.push(...page);after=page.at(-1)?.id;expect(reads()).toBeLessThan(1000);}
  expect(paged).toEqual(whole);
  expect(await ctx.store.list('source',TEST_ORG,{ownerId:'private-pack'})).toEqual([]);
});
it('reads only selected scope guards when starting a shared-library study session',async()=>{
  const response=await handleStudy({...ctx,path:'/api/v1/study/sessions',request:new Request('https://erudoza.test/api/v1/study/sessions',{method:'POST',body:JSON.stringify({seasonId:season,mode:'Practice'})})});
  expect(response?.status).toBe(200);
  const query=measured.find(q=>q.sql.startsWith('WITH selected'))!;
  expect(query.rows).toBeLessThan(100);
  expect(reads()).toBeLessThan(1000);
  const before=await app.db.prepare(query.sql.replaceAll(' CROSS JOIN ',' JOIN ').replace(' INDEXED BY Records_owner','')).bind(...query.args).all();
  const ordered=(rows:unknown[])=>rows.map(row=>JSON.stringify(row)).sort();
  expect(ordered(query.results!)).toEqual(ordered(before.results));
});
