// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {createNativeTestApp,TEST_ORG,TEST_USER} from '../test-runtime';
import {Store} from '../store';
import type {Env,RequestContext} from '../types';
import type {D1PreparedStatement,D1Result} from '@cloudflare/workers-types';
import {LIBRARY_ORG} from '../application/library-access';
import {chapterBase,chapterSourcePage,chapterAssignmentPage,chapterSelectedSources} from './chapter-source-pages';
const season='cccccccc-0000-0000-0000-000000000001',student='dddddddd-0000-0000-0000-000000000001',pack='aaaaaaaa-0000-0000-0000-000000000001';
let app:Awaited<ReturnType<typeof createNativeTestApp>>;
afterEach(async()=>{await app?.runtime.dispose();});
const range=(start=1,end=10000)=>({bookKey:'GEN',startChapter:1,startVerse:start,endChapter:1,endVerse:end});
async function setup(n=1){
 app=await createNativeTestApp();
 const reads:{rows:number;payloads:number;payloadBytes:number;rowsRead:number;plan:string[]}[]=[];
 const db=app.db as unknown as Env['DB'];
 const track=(statement:D1PreparedStatement,sql:string,args:unknown[]=[]):D1PreparedStatement=>new Proxy(statement,{get(target,key){
  if(key==='bind')return (...values:unknown[])=>track(target.bind(...values),sql,values);
  if(key==='all')return async()=>{const result=await target.all() as D1Result<{payload?:string}>;
   if(sql.includes('sized AS')){const plan=await db.prepare('EXPLAIN QUERY PLAN '+sql).bind(...args).all<{detail:string}>();const payloads=result.results.flatMap(r=>r.payload?[r.payload]:[]);reads.push({rows:result.results.length,payloads:payloads.length,payloadBytes:payloads.reduce((n,p)=>n+new TextEncoder().encode(p).byteLength,0),rowsRead:result.meta.rows_read,plan:plan.results.map(r=>r.detail)});}
   return result;};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const env={DB:new Proxy(db,{get(target,key){if(key==='prepare')return (sql:string)=>track(target.prepare(sql),sql);const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}})} as Env,store=new Store(env.DB);
 await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT ?,org_id,'page-student','Student','Student','Student',password_hash,credential_version FROM Users WHERE id=?").bind(student,TEST_USER).run();
 const ctx={env,store,orgId:TEST_ORG,actor:{userId:student,organizationId:TEST_ORG,kind:'Student',role:'Student'},request:new Request('https://erudoza.test'),path:'/fixture'} as RequestContext;
 await store.insert('season',season,TEST_ORG,{id:season,organizationId:TEST_ORG,status:'Active',pbeEnabled:true});
 await store.insert('scope',season,TEST_ORG,{contentPackId:pack,includes:[range()],excludes:[]});
 await store.insert('membership',`${season}:${student}`,TEST_ORG,{}, {seasonId:season,ownerId:student});
 await store.insert('pack',pack,TEST_ORG,{id:pack,isActive:true,licensingStatus:'approved',sourceType:'Scripture'});
 await store.insert('assignment','a',TEST_ORG,{id:'a',contentPackId:pack,...range()}, {seasonId:season,ownerId:student});
 const units=Array.from({length:n},(_,i)=>({id:`s${String(i+1).padStart(5,'0')}`,contentPackId:pack,bookKey:'GEN',chapter:1,verse:i+1,ordinal:i+1,citation:`GEN 1:${i+1}`,canonicalText:'Alpha',isActive:true}));
 await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) SELECT 'source',json_extract(value,'$.id'),?,?,value FROM json_each(?)").bind(TEST_ORG,pack,JSON.stringify(units)).run();
 const intro=async(id:string,extra:Record<string,unknown>={},assigned=true)=>{await store.insert('pbe-introduction',id,TEST_ORG,{id,organizationId:TEST_ORG,seasonId:season,bookKey:'GEN',reviewed:true,licensingStatus:'approved',units:[{id:`unit-${id}`,citation:'Introduction',canonicalText:'Context'}],...extra},{seasonId:season});if(assigned)await store.insert('pbe-introduction-assignment',`assign-${id}`,TEST_ORG,{id:`assign-${id}`,contentPackId:id},{seasonId:season,ownerId:student});};
 return {ctx,store,intro,reads};
}
it('reauthorizes the actual student and guards missing scope/member without reading source bodies',async()=>{
 const {ctx}=await setup();const base=await chapterBase(ctx,season);expect(base.reason).toBe(null);expect(base.guards).toContainEqual({kind:'@active-user',id:student,revision:0});
 await app.db.prepare("DELETE FROM Records WHERE kind='membership'").run();const missing=await chapterBase(ctx,season);expect(missing.reason).toBe('NoAssignment');expect(missing.guards).toContainEqual({kind:'membership',id:`${season}:${student}`,revision:null});expect(missing.signature).not.toBe(base.signature);
 await app.db.prepare("UPDATE Records SET data=json_set(data,'$.pbeEnabled',0) WHERE kind='season'").run();expect((await chapterBase(ctx,season)).reason).toBe('PbeDisabled');
 await app.db.prepare('UPDATE Users SET active=0 WHERE id=?').bind(student).run();await expect(chapterBase(ctx,season)).rejects.toMatchObject({status:403});
 await expect(chapterBase({...ctx,orgId:LIBRARY_ORG},season)).rejects.toMatchObject({status:403});
},30000);
it('seeks 128 actual sources and resumes the remaining source without duplicate or skipped input',async()=>{
 const {ctx,reads}=await setup(129);const first=await chapterSourcePage(ctx,season,'');expect(first.items).toHaveLength(128);expect(first.after).not.toBeNull();
 const last=await chapterSourcePage(ctx,season,first.after!);expect(last.items.map(x=>x.source.id)).toEqual(['s00129']);expect(last.after).toBeNull();
 expect(first.items[0].guards).toEqual(expect.arrayContaining([{kind:'source',id:'s00001',revision:1},{kind:'pack',id:pack,revision:1}]));
 expect(await chapterSelectedSources(ctx,season,['s00001','s00129','unknown'])).toHaveLength(2);
 expect(reads.every(r=>r.rows<=129&&r.payloads<=128&&r.payloadBytes<=65536)).toBe(true);
 expect(reads[1].plan.some(p=>/SEARCH u USING PRIMARY KEY \(kind=\? AND id>\?\)/.test(p))).toBe(true);
 process.stdout.write('source-page-query-evidence '+JSON.stringify(reads.map(({plan,...r})=>({...r,sourceSeek:plan.filter(p=>p.includes('SEARCH u'))})))+'\n');
},30000);
it('preserves personal ranges, excluded gaps and approved introduction organization/book/license membership',async()=>{
 const {ctx,intro}=await setup(5);await app.db.prepare("UPDATE Records SET data=json_set(data,'$.excludes',json(?)) WHERE kind='scope'").bind(JSON.stringify([range(2,2)])).run();
 await app.db.prepare("UPDATE Records SET data=json_set(data,'$.endVerse',3) WHERE kind='assignment'").run();
 await intro('good');await intro('unreviewed',{reviewed:false});await intro('license',{licensingStatus:'APPROVED'});await intro('book',{bookKey:'EXO'});await intro('tenant',{organizationId:LIBRARY_ORG});await intro('season',{seasonId:'other'});await intro('unassigned',{},false);
 expect((await chapterSourcePage(ctx,season,'')).items.map(x=>x.source.id).sort()).toEqual(['s00001','s00003','unit-good']);
 const assigned=await chapterAssignmentPage(ctx,season,'');expect(assigned.items.filter(x=>x.introductionGuard).map(x=>x.introductionGuard!.id).sort()).toEqual(['book','good','license','season','tenant','unreviewed']);
 await app.db.prepare("UPDATE Records SET season_id='moved-season',revision=2 WHERE kind='pbe-introduction' AND id='season'").run();expect((await chapterAssignmentPage(ctx,season,'')).items.find(x=>x.introductionGuard?.id==='season')?.introductionGuard?.revision).toBe(2);
 await app.db.prepare("DELETE FROM Records WHERE kind='pbe-introduction' AND id='good'").run();expect((await chapterAssignmentPage(ctx,season,'')).items.find(x=>x.introductionGuard?.id==='good')?.introductionGuard?.revision).toBeNull();
 await app.db.prepare("DELETE FROM Records WHERE kind='membership'").run();expect((await chapterSourcePage(ctx,season,'')).items.every(x=>x.source.chapter!==null)).toBe(true);
},30000);
it('allows only immutable library provenance across tenant boundaries',async()=>{
 const {ctx}=await setup();await app.db.prepare("INSERT INTO Organizations(id,name,slug) VALUES(?,?,?),('other-org','Other','other')").bind(LIBRARY_ORG,'Library','library').run();await app.db.prepare("UPDATE Records SET org_id=? WHERE kind IN ('pack','source')").bind(LIBRARY_ORG).run();expect((await chapterSourcePage(ctx,season,'')).items).toEqual([]);
 await app.db.prepare("UPDATE Records SET data=json_set(data,'$.isBuiltIn',1) WHERE kind='pack'").run();expect((await chapterSourcePage(ctx,season,'')).items).toHaveLength(1);
 await app.db.prepare("UPDATE Records SET org_id='other-org' WHERE kind IN ('pack','source')").run();expect((await chapterSourcePage(ctx,season,'')).items).toEqual([]);
},30000);
it('pages assigned revision tuples including excluded and absent introductions across 128 rows',async()=>{
 const {ctx}=await setup();const rows=Array.from({length:129},(_,i)=>({id:`i${String(i).padStart(4,'0')}`,contentPackId:`missing-${i}`}));
 await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) SELECT 'pbe-introduction-assignment',json_extract(value,'$.id'),?,?,?,value FROM json_each(?)").bind(TEST_ORG,season,student,JSON.stringify(rows)).run();
 const first=await chapterAssignmentPage(ctx,season,'');expect(first.items).toHaveLength(128);const last=await chapterAssignmentPage(ctx,season,first.after!);expect(last.items).toHaveLength(2);expect(last.after).toBeNull();expect(last.items.every(x=>x.introductionGuard?.revision===null)).toBe(true);
},30000);
it('bounds UTF8 payloads before returning them and resumes byte-truncated source pages',async()=>{
 const {ctx,intro}=await setup(3);await app.db.prepare("UPDATE Records SET data=json_set(data,'$.canonicalText',?) WHERE kind='source'").bind('漢'.repeat(9000)).run();
 const first=await chapterSourcePage(ctx,season,'');expect(first.items.length).toBeGreaterThan(0);expect(first.items.length).toBeLessThan(3);expect(new TextEncoder().encode(JSON.stringify(first)).byteLength).toBeLessThanOrEqual(65536);
 const second=await chapterSourcePage(ctx,season,first.after!);expect(new Set([...first.items,...second.items].map(x=>x.source.id)).size).toBe(3);
 await intro('huge',{units:[{id:'huge-unit',citation:'Intro',canonicalText:'漢'.repeat(23000)}]});await expect(chapterSourcePage(ctx,season,'')).rejects.toMatchObject({status:413,message:'PBE_CHAPTER_INPUT_TOO_LARGE'});
},30000);
it('rejects season Scripture cap before personal filtering and assignment cap without loading payloads',async()=>{
 const {ctx}=await setup(5001);await app.db.prepare("UPDATE Records SET data=json_set(data,'$.endVerse',1) WHERE kind='assignment'").run();await expect(chapterSourcePage(ctx,season,'')).rejects.toMatchObject({message:'PBE_CHAPTER_SCOPE_TOO_LARGE'});
 await app.db.prepare("DELETE FROM Records WHERE kind='source'").run();const rows=Array.from({length:10000},(_,i)=>({id:`a${i}`,contentPackId:pack,...range()}));await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) SELECT 'assignment',json_extract(value,'$.id'),?,?,?,value FROM json_each(?)").bind(TEST_ORG,season,student,JSON.stringify(rows)).run();await expect(chapterAssignmentPage(ctx,season,'')).rejects.toMatchObject({message:'PBE_CHAPTER_SCOPE_TOO_LARGE'});
},30000);

it('pages introduction units within a single large record and enforces the combined cap',async()=>{
 const {ctx,intro}=await setup(0);
 const units=Array.from({length:129},(_,i)=>({id:`unit-${i}`,citation:'Intro',canonicalText:'Context'}));
 await intro('large',{units});
 const first=await chapterSourcePage(ctx,season,'');expect(first.items).toHaveLength(128);expect(first.items[0].source).toMatchObject({chapter:null,verse:null,ordinal:1});
 const last=await chapterSourcePage(ctx,season,first.after!);expect(last.items.map(x=>x.source.id)).toEqual(['unit-128']);expect(last.after).toBeNull();
 const oversized=Array.from({length:10001},(_,i)=>({id:`unit-${i}`,citation:'Intro',canonicalText:'Context'}));await app.db.prepare("UPDATE Records SET data=json_set(data,'$.units',json(?)) WHERE kind='pbe-introduction'").bind(JSON.stringify(oversized)).run();
 await expect(chapterSourcePage(ctx,season,'')).rejects.toMatchObject({message:'PBE_CHAPTER_SCOPE_TOO_LARGE'});
},30000);
it('refuses oversized selected lookups and guard entries instead of returning partial authority',async()=>{
 const {ctx}=await setup(3);
 await expect(chapterSelectedSources(ctx,season,Array(129).fill('s00001'))).rejects.toMatchObject({message:'PBE_CHAPTER_INPUT_TOO_LARGE'});
 await app.db.prepare("UPDATE Records SET data=json_set(data,'$.canonicalText',?) WHERE kind='source'").bind('漢'.repeat(9000)).run();
 await expect(chapterSelectedSources(ctx,season,['s00001','s00002','s00003'])).rejects.toMatchObject({message:'PBE_CHAPTER_INPUT_TOO_LARGE'});
 await app.db.prepare("UPDATE Records SET data=json_set(data,'$.contentPackId',?) WHERE kind='assignment'").bind('漢'.repeat(23000)).run();
 await expect(chapterAssignmentPage(ctx,season,'')).rejects.toMatchObject({message:'PBE_CHAPTER_INPUT_TOO_LARGE'});
},30000);
