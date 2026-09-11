// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
// The provisioning entry point is executable directly by Node.
// @ts-expect-error No declaration file for the standalone provisioning script.
import { LIBRARY_ORG, stableId, loadLibrary, seedStatements } from './nkjv-library.mjs';
// @ts-expect-error Standalone Node migration module.
import { readNativeMigrations } from './native-migrations.mjs';
const directory=new URL('../../../content/nkjv/',import.meta.url);
const schemaSql=async()=>(await readNativeMigrations()).map((migration:{sql:string})=>migration.sql).join('\n');

it('uses the shared UUID contract rather than platform Guid byte order',()=>{
  expect(stableId('book:GEN')).toBe('7b815dd7-2050-53ce-9ce9-014e020eb572');
  expect(stableId('book:REV')).toBe('74fb3314-cae0-5802-a8b9-cfa38d04ab4f');
  expect(stableId('verse:GEN:1:1')).toMatch(/^[0-9a-f-]{14}5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

it('validates all real book hashes and canonical coordinates before provisioning',async()=>{
  const library=await loadLibrary(directory);
  expect(library.manifest.books).toHaveLength(66);
  expect(library.units).toHaveLength(31102);
  expect(library.units[0].text).toBe('In the beginning God created the heavens and the earth.');
  expect(library.units.at(-1).ordinal).toBe(31102);
  expect(library.manifest.books.flatMap((b:{chapters:unknown[]})=>b.chapters)).toHaveLength(1189);
});

it('seeds immutable approved records idempotently and marks ready only after all content',async()=>{
  const library=await loadLibrary(directory),statements=seedStatements(library),db=new DatabaseSync(':memory:');
  try {
    db.exec(await schemaSql());
    db.exec("INSERT INTO Organizations(id,name,slug) VALUES('legacy','Legacy Club','legacy'); INSERT INTO Records(kind,id,org_id,data) VALUES('pack','old-kjv','legacy','{\"isActive\":true}')");
    db.exec(statements.slice(0,-1).join('\n'));
    expect(db.prepare("SELECT count(*) n FROM Records WHERE kind='library-version'").get()).toEqual({n:0});
    db.exec(statements.at(-1));
    expect(db.prepare("SELECT kind,count(*) n FROM Records WHERE org_id=? GROUP BY kind ORDER BY kind").all(LIBRARY_ORG)).toEqual([{kind:'library-version',n:1},{kind:'pack',n:66},{kind:'source',n:31102}]);
    const first=JSON.parse(db.prepare("SELECT data FROM Records WHERE kind='source' AND id=?").get(stableId('verse:GEN:1:1')).data);
    expect(first).toMatchObject({contentPackId:stableId('book:GEN'),contentDocumentId:stableId('document:GEN'),canonicalText:'In the beginning God created the heavens and the earth.',ordinal:1,isActive:true});
    const pack=JSON.parse(db.prepare("SELECT data FROM Records WHERE kind='pack' AND id=?").get(stableId('book:GEN')).data);
    expect(pack).toMatchObject({isBuiltIn:true,licensingStatus:'approved',sourceProvenance:{licensingStatus:'supplied-private'}});
    const before=db.prepare('SELECT kind,id,org_id,data,revision FROM Records ORDER BY kind,id,org_id').all();
    db.exec(statements.join('\n'));
    expect(db.prepare('SELECT kind,id,org_id,data,revision FROM Records ORDER BY kind,id,org_id').all()).toEqual(before);
    expect(db.prepare("SELECT data FROM Records WHERE id='old-kjv'").get()).toEqual({data:'{"isActive":true}'});
  } finally {db.close();}
},30000);

it('rejects a same-version text conflict without overwriting it or marking ready',async()=>{
  const library=await loadLibrary(directory),statements=seedStatements(library),db=new DatabaseSync(':memory:');
  try {
    db.exec(await schemaSql());db.exec(statements.slice(0,-1).join('\n'));
    db.prepare("UPDATE Records SET data=json_set(data,'$.canonicalText','conflicting text') WHERE kind='source' AND id=?").run(stableId('verse:GEN:1:1'));
    expect(()=>db.exec(statements.join('\n'))).toThrow(/CHECK constraint failed/);
    expect(db.prepare("SELECT json_extract(data,'$.canonicalText') text FROM Records WHERE kind='source' AND id=?").get(stableId('verse:GEN:1:1'))).toEqual({text:'conflicting text'});
    expect(db.prepare("SELECT count(*) n FROM Records WHERE kind='library-version'").get()).toEqual({n:0});
  } finally {db.close();}
},30000);

it('rejects changed book bytes before producing a seed',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'nkjv-hash-'));
  try {
    const manifest=JSON.parse(await readFile(new URL('library-manifest.json',directory),'utf8'));
    await writeFile(join(temp,'library-manifest.json'),JSON.stringify(manifest));
    await mkdir(join(temp,'import-packs'));
    await writeFile(join(temp,manifest.books[0].file),'{}');
    await expect(loadLibrary(temp)).rejects.toThrow(/SHA-256.*GEN/);
  } finally {await rm(temp,{recursive:true,force:true});}
});

it('executes the generated seed on the native local D1 engine',async()=>{
  const { Miniflare }=await import('miniflare');
  const runtime=new Miniflare({modules:true,script:'export default { fetch() { return new Response("local seed test"); } };',compatibilityDate:'2026-05-22',d1Databases:{DB:'nkjv-provisioning-test'}});
  try {
    const db=await runtime.getD1Database('DB'),library=await loadLibrary(directory),statements=seedStatements(library);
    for(const migration of await readNativeMigrations())await db.batch(migration.statements.map((sql:string)=>db.prepare(sql)));
    for(let start=0;start<statements.length-1;start+=20)await db.batch(statements.slice(start,Math.min(start+20,statements.length-1)).map((sql:string)=>db.prepare(sql)));
    expect(await db.prepare("SELECT count(*) n FROM Records WHERE kind='library-version'").first()).toEqual({n:0});
    await db.prepare(statements.at(-1)).run();
    expect(await db.prepare("SELECT count(*) n FROM Records WHERE kind='source' AND org_id=?").bind(LIBRARY_ORG).first()).toEqual({n:31102});
    expect(await db.prepare("SELECT json_extract(data,'$.ready') ready FROM Records WHERE kind='library-version' AND org_id=?").bind(LIBRARY_ORG).first()).toEqual({ready:1});
  } finally {await runtime.dispose();}
},60000);
