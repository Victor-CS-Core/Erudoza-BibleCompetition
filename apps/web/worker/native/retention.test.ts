// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {createNativeTestApp,TEST_ORG} from './test-runtime';
import {purgeAuditRows,purgeNotifications,runRetentionPurge} from './retention';

let app:Awaited<ReturnType<typeof createNativeTestApp>>;
afterEach(async()=>{await app?.runtime.dispose();});

const DAY_MS=86400_000;
const NOW=Date.UTC(2026,8,18,12,0,0);
const iso=(agoDays:number)=>new Date(NOW-agoDays*DAY_MS).toISOString();
// Audit rows are written with season_id/owner_id NULL (see atomic() in
// application/model.ts); several guard paths also omit createdAtUtc.
const insertAudit=(id:string,data:unknown)=>app.db.prepare("INSERT INTO Records(kind,id,org_id,data) VALUES('audit',?,?,?)").bind(id,TEST_ORG,JSON.stringify(data)).run();
const insertNotification=(id:string,ownerId:string,agoDays:number)=>app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('notification',?,?,?,?)").bind(id,TEST_ORG,ownerId,JSON.stringify({kind:'assignment.added',createdAtUtc:iso(agoDays)})).run();
const count=async(kind:string,ownerId?:string)=>(await app.db.prepare(`SELECT COUNT(*) AS n FROM Records WHERE kind=?${ownerId?' AND owner_id=?':''}`).bind(...(ownerId?[kind,ownerId]:[kind])).first<{n:number}>())!.n;
const auditIds=async()=>((await app.db.prepare("SELECT id FROM Records WHERE kind='audit'").all<{id:string}>()).results??[]).map(r=>r.id).sort();

it('purges audit rows older than 90 days plus dateless guard receipts',async()=>{
  app=await createNativeTestApp();
  await insertAudit('dateless-early',{});
  await insertAudit('old-1',{createdAtUtc:iso(100)});
  await insertAudit('old-2',{createdAtUtc:iso(91)});
  await insertAudit('boundary-90',{createdAtUtc:iso(90)});
  await insertAudit('recent-1',{createdAtUtc:iso(89)});
  await insertAudit('recent-2',{createdAtUtc:iso(1)});
  await insertAudit('dateless-late',{});
  const deleted=await purgeAuditRows({DB:app.db},NOW);
  // old-1, old-2, and both dateless guard receipts (whose age cannot be
  // determined) are purged; the 90-day boundary and recent rows survive.
  expect(deleted).toBe(4);
  expect(await auditIds()).toEqual(['boundary-90','recent-1','recent-2']);
});

it('deletes at most the batch size of audit rows per run',async()=>{
  app=await createNativeTestApp();
  for(let n=0;n<5;n++)await insertAudit(`old-${n}`,{createdAtUtc:iso(100)});
  expect(await purgeAuditRows({DB:app.db},NOW,2)).toBe(2);
  expect(await count('audit')).toBe(3);
  expect(await purgeAuditRows({DB:app.db},NOW,2)).toBe(2);
  expect(await purgeAuditRows({DB:app.db},NOW,2)).toBe(1);
  expect(await count('audit')).toBe(0);
});

it('caps notifications at the newest 100 per user',async()=>{
  app=await createNativeTestApp();
  const ownerA=crypto.randomUUID(),ownerB=crypto.randomUUID();
  for(let n=0;n<105;n++)await insertNotification(`a-${n}`,ownerA,n);
  for(let n=0;n<3;n++)await insertNotification(`b-${n}`,ownerB,n);
  const deleted=await purgeNotifications({DB:app.db});
  expect(deleted).toBe(5);
  const remainingA=((await app.db.prepare("SELECT id FROM Records WHERE kind='notification' AND owner_id=?").bind(ownerA).all<{id:string}>()).results??[]).map(r=>r.id);
  expect(remainingA).toHaveLength(100);
  expect(remainingA).toContain('a-0');
  expect(remainingA).toContain('a-99');
  expect(remainingA).not.toContain('a-100');
  expect(remainingA).not.toContain('a-104');
  expect(await count('notification',ownerB)).toBe(3);
});

it('breaks notification timestamp ties deterministically',async()=>{
  app=await createNativeTestApp();
  const owner=crypto.randomUUID();
  for(let n=0;n<101;n++)await insertNotification(`t-${n}`,owner,7);
  expect(await purgeNotifications({DB:app.db})).toBe(1);
  const remaining=((await app.db.prepare("SELECT id FROM Records WHERE kind='notification' AND owner_id=?").bind(owner).all<{id:string}>()).results??[]).map(r=>r.id);
  expect(remaining).toHaveLength(100);
  // The tiebreak is arbitrary but stable: a second run deletes nothing more.
  expect(await purgeNotifications({DB:app.db})).toBe(0);
});

it('runRetentionPurge combines both purges',async()=>{
  app=await createNativeTestApp();
  await insertAudit('old',{createdAtUtc:iso(100)});
  await insertAudit('recent',{createdAtUtc:iso(1)});
  const owner=crypto.randomUUID();
  for(let n=0;n<102;n++)await insertNotification(`c-${n}`,owner,n);
  const result=await runRetentionPurge({DB:app.db},NOW);
  expect(result).toEqual({audit:1,notifications:2});
  expect(await count('audit')).toBe(1);
  expect(await count('notification',owner)).toBe(100);
});
