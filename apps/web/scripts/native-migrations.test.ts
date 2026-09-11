// @vitest-environment node
import { expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { Store } from '../worker/native/store';
// @ts-expect-error Standalone Node provisioning module.
import { loadLibrary, seedStatements } from './nkjv-library.mjs';
// @ts-expect-error Standalone Node migration module.
import { readNativeMigrations } from './native-migrations.mjs';

async function migrations() {
  return (await readNativeMigrations()).map((migration:{statements:string[]})=>migration.statements) as string[][];
}
const runtime = () => new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("migration test"); } };', compatibilityDate: '2026-05-22', d1Databases: { DB: 'migration-test' } });

it('preserves populated Records bytes, scopes and revisions while retaining optimistic concurrency', async () => {
  const local = runtime();
  try {
    const db = await local.getD1Database('DB'), files = await migrations();
    await db.batch(files[0].map(sql => db.prepare(sql)));
    await db.prepare("INSERT INTO Organizations(id,name,slug) VALUES('one','One','one'),('two','Two','two')").run();
    await db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) VALUES('answer','same','one','season','student','{ \"answer\": \"faith\", \"count\": 1 }',17),('answer','same','two',NULL,NULL,'{\"answer\":\"hope\"}',9),('pack','legacy','one',NULL,NULL,'{\"isActive\":true}',4)").run();
    const before = (await db.prepare('SELECT * FROM Records ORDER BY kind,id,org_id').all()).results;
    for (const statements of files.slice(1)) await db.batch(statements.map(sql => db.prepare(sql)));
    expect((await db.prepare("SELECT sql FROM sqlite_schema WHERE name='Records'").first<{sql:string}>())?.sql).toMatch(/WITHOUT ROWID/i);
    expect((await db.prepare('SELECT * FROM Records ORDER BY kind,id,org_id').all()).results).toEqual(before);
    const indexes = (await db.prepare("PRAGMA index_list('Records')").all<{name:string}>()).results.map(index => index.name);
    expect(indexes).toEqual(expect.arrayContaining(['Records_scope', 'Records_owner']));
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    const store = new Store(db as unknown as D1Database);
    await store.put('answer', 'same', 'one', {answer:'updated'}, 17);
    await expect(store.put('answer', 'same', 'one', {answer:'stale'}, 17)).rejects.toMatchObject({status:409});
    expect(await store.get('answer', 'same', 'one')).toEqual({value:{answer:'updated'},revision:18});
    expect(await store.get('answer', 'same', 'two')).toEqual({value:{answer:'hope'},revision:9});
    expect(await store.list('answer', 'one', {seasonId:'season',ownerId:'student'})).toEqual([{answer:'updated'}]);
  } finally { await local.dispose(); }
}, 30000);

it('keeps the full immutable NKJV seed within one clean Free write window', async () => {
  const local = runtime();
  try {
    const db = await local.getD1Database('DB');
    for (const statements of await migrations()) await db.batch(statements.map(sql => db.prepare(sql)));
    const statements = seedStatements(await loadLibrary());
    const writes = [];
    for (let pass = 0; pass < 2; pass++) {
      let count = 0;
      for (let i = 0; i < statements.length; i += 20) {
        const results = await db.batch(statements.slice(i, i + 20).map((sql:string) => db.prepare(sql)));
        count += results.reduce((sum, result) => sum + result.meta.rows_written, 0);
      }
      writes.push(count);
    }
    expect(writes).toEqual([93510, 0]);
    expect((await db.prepare("SELECT count(*) n FROM Records WHERE kind='source'").first<{n:number}>())?.n).toBe(31102);
  } finally { await local.dispose(); }
}, 60000);
