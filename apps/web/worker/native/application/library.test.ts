// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG } from '../test-runtime';
import { Store } from '../store';
import type { D1Database } from '@cloudflare/workers-types';

const libraryOrg = '00000000-0000-4000-8000-000000000066';
const eph = '00000000-0000-5000-8000-000000000001', jude = '00000000-0000-5000-8000-000000000002';
let app: Awaited<ReturnType<typeof createNativeTestApp>>, cookie: string, store: Store;
const call = (path: string, data?: unknown, method = data ? 'POST' : 'GET') => app.fetch(`/api/v1/organizations/${TEST_ORG}${path}`, { method, headers: { Cookie: cookie, Origin: 'https://erudoza.test' }, ...(data ? { body: JSON.stringify(data) } : {}) });
const range = (bookKey: string, startChapter = 1, endChapter = startChapter, endVerse = 2) => ({ bookKey, startChapter, startVerse: 1, endChapter, endVerse });
beforeAll(async () => {
  app = await createNativeTestApp(); store = new Store(app.db as unknown as D1Database);
  cookie = (await app.login()).headers.get('set-cookie')!.split(';')[0];
  await app.db.prepare('INSERT INTO Organizations(id,name,slug) VALUES(?,?,?)').bind(libraryOrg, 'Immutable Scripture Library', 'scripture-library').run();
  for (const [packId, bookKey, name, chapters] of [[eph, 'EPH', 'Ephesians', 6], [jude, 'JUD', 'Jude', 1]] as const) {
    await store.insert('pack', packId, libraryOrg, { id: packId, packKey: `builtin-nkjv-${bookKey.toLowerCase()}`, version: 1, locale: 'en', sourceType: 'Scripture', licensingStatus: 'approved', isActive: true, isBuiltIn: true, bookKey, bookName: name, unitCount: chapters * 2, chapters: Array.from({ length: chapters }, (_, i) => ({ number: i + 1, verses: [1, 2] })) });
    for (let chapter = 1; chapter <= chapters; chapter++) for (let verse = 1; verse <= 2; verse++) {
      const id = crypto.randomUUID();
      await store.insert('source', id, libraryOrg, { id, knowledgeUnitId: id, contentPackId: packId, citation: `${name} ${chapter}:${verse}`, bookKey, chapter, verse, ordinal: (bookKey === 'EPH' ? 100 : 200) + chapter * 3 + verse, canonicalText: `Fixture ${name} chapter ${chapter} verse ${verse}.`, isActive: true }, { ownerId: packId });
    }
  }
  await store.insert('library-version', 'nkjv-v1', libraryOrg, { translationId: 'nkjv', translationName: 'New King James Version', version: 1, bookCount: 2, ready: true });
}, 30000);
afterAll(async () => { await app?.runtime.dispose(); });

it('exposes installed structure and shared verses without copying library rows into the coach organization', async () => {
  const response = await call('/library'); expect(response.status).toBe(200);
  const library = await response.json() as { books: { contentPackId: string; chapters: unknown[] }[] };
  expect(library.books).toHaveLength(2); expect(library.books.find(b => b.contentPackId === eph)!.chapters).toHaveLength(6);
  const verses = await call(`/content-packs/${eph}/source-units`); expect(verses.status).toBe(200); expect(await verses.json()).toHaveLength(12);
  const count = await app.db.prepare("SELECT count(*) AS n FROM Records WHERE kind IN ('pack','source') AND org_id=?").bind(TEST_ORG).first<{ n: number }>(); expect(count!.n).toBe(0);
});

it('retires manual and external catalog imports and protects built-in deletion', async () => {
  for (const path of ['/content-packs/import', '/content-packs/import-from-catalog']) expect((await call(path, {})).status).toBe(410);
  expect((await call(`/content-packs/${eph}`, undefined, 'DELETE')).status).toBe(403);
  expect((await call(`/content-packs/${eph}/source-units`)).status).toBe(200);
});

it('selects two book packs, rejects invalid structure, and narrows student reading to assigned ranges', async () => {
  const created = await call('/seasons', { name: 'Library practice', yearLabel: '2026', ruleProfileKey: 'PBE_STYLE_V1' });
  const season = await created.json() as { id: string };
  const saveScope = (packs: unknown[]) => call(`/seasons/${season.id}/scope`, { contentPackId: null, includes: [], excludes: [], packs });
  expect((await saveScope([{ contentPackId: eph, includes: [range('EPH', 7)], excludes: [] }])).status).toBe(400);
  expect((await saveScope([{ contentPackId: jude, includes: [range('JUD', 1, 1, 3)], excludes: [] }])).status).toBe(400);
  expect((await saveScope([{ contentPackId: eph, includes: [range('JUD')], excludes: [] }])).status).toBe(400);
  expect((await saveScope([{ contentPackId: eph, includes: [range('EPH', 2)], excludes: [] }, { contentPackId: jude, includes: [range('JUD')], excludes: [] }])).status).toBe(204);
  expect((await (await call(`/seasons/${season.id}`)).json() as { scopeUnitCount: number }).scopeUnitCount).toBe(4);
  expect((await (await call(`/seasons/${season.id}/scope`)).json() as { packs: unknown[] }).packs).toHaveLength(2);
  const studentResponse = await call('/students', { userName: 'library-student', displayName: 'Library student', password: 'Testing!123' });
  const student = await studentResponse.json() as { userId: string };
  const assign = (packId: string, r: unknown) => call(`/seasons/${season.id}/assignments`, { studentUserId: student.userId, contentPackId: packId, range: r, type: 'RequiredCoverage' });
  expect((await assign(eph, range('EPH', 2, 7))).status).toBe(400);
  expect((await assign(eph, range('EPH', 2))).status).toBe(200);
  expect((await assign(jude, range('JUD'))).status).toBe(200);
  expect((await call(`/seasons/${season.id}/activate`, {})).status).toBe(200);
  const login = await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test' }, body: JSON.stringify({ identifier: 'library-student', password: 'Testing!123' }) });
  const studentCookie = login.headers.get('set-cookie')!.split(';')[0];
  const reading = await app.fetch(`/api/v1/study/seasons/${season.id}/scripture`, { headers: { Cookie: studentCookie } }); expect(reading.status).toBe(200);
  const read = await reading.json() as { verses: { bookKey: string; chapter: number }[] }; expect(read.verses).toHaveLength(4);
  expect(read.verses.filter(v => v.bookKey === 'EPH').every(v => v.chapter === 2)).toBe(true);
  const study = (path:string, data?:unknown) => app.fetch(`/api/v1/study${path}`, {method:data?'POST':'GET',headers:{Cookie:studentCookie,Origin:'https://erudoza.test'},...(data?{body:JSON.stringify(data)}:{})});
  const started=await study('/sessions',{seasonId:season.id,mode:'Practice'});expect(started.status).toBe(200);
  const session=await started.json() as {id:string};
  const next=await study(`/sessions/${session.id}/next`);expect(next.status).toBe(200);
  const card=await next.json() as {id:string;debugAnswer:unknown};expect(card.debugAnswer).toBeNull();
  const answer=await study(`/sessions/${session.id}/attempts`,{clientSubmissionId:'library-answer',challengeCardId:card.id,submittedAnswer:'incorrect',responseTimeMs:100,hintsUsed:false});expect(answer.status).toBe(200);
  expect(await app.db.prepare("SELECT count(*) AS n FROM Records WHERE kind='mastery' AND org_id=?").bind(TEST_ORG).first('n')).toBe(1);
  expect(await app.db.prepare("SELECT count(*) AS n FROM Records WHERE kind IN ('mastery','session','attempt') AND org_id=?").bind(libraryOrg).first('n')).toBe(0);
  const count = await app.db.prepare("SELECT count(*) AS n FROM Records WHERE kind='source'").first<{ n: number }>(); expect(count!.n).toBe(14);
}, 30000);

it('never exposes another organization private source through built-in fallback', async () => {
  const other = '22222222-2222-4222-8222-222222222222', privatePack = crypto.randomUUID();
  await app.db.prepare('INSERT INTO Organizations(id,name,slug) VALUES(?,?,?)').bind(other, 'Other club', 'other-club').run();
  await store.insert('pack', privatePack, other, { id: privatePack, isActive: true, isBuiltIn: false });
  expect((await call(`/content-packs/${privatePack}/source-units`)).status).toBe(404);
});

it('rejects missing verses inside a retained historical pack range',async()=>{
  const pack=crypto.randomUUID();await store.insert('pack',pack,TEST_ORG,{id:pack,isActive:true,licensingStatus:'approved'});
  for(const verse of [1,3]){const id=crypto.randomUUID();await store.insert('source',id,TEST_ORG,{id,contentPackId:pack,bookKey:'DAN',chapter:1,verse,ordinal:verse,isActive:true,canonicalText:'Historical fixture.'},{ownerId:pack});}
  const season=await (await call('/seasons',{name:'Historical gap',yearLabel:'2026',ruleProfileKey:'PBE_STYLE_V1'})).json() as {id:string};
  expect((await call(`/seasons/${season.id}/scope`,{contentPackId:pack,includes:[range('DAN',1,1,3)],excludes:[]})).status).toBe(400);
});

it('allows retaining historical books but forbids introducing them through the new library scope contract',async()=>{
  const pack=crypto.randomUUID();await store.insert('pack',pack,TEST_ORG,{id:pack,isActive:true,licensingStatus:'approved'});
  for(const verse of [1,2]){const id=crypto.randomUUID();await store.insert('source',id,TEST_ORG,{id,contentPackId:pack,bookKey:'DAN',chapter:1,verse,ordinal:verse,isActive:true,canonicalText:'Historical fixture.'},{ownerId:pack});}
  const season=await (await call('/seasons',{name:'Retained history',yearLabel:'2026',ruleProfileKey:'PBE_STYLE_V1'})).json() as {id:string};
  const entry={contentPackId:pack,includes:[range('DAN')],excludes:[]};
  expect((await call(`/seasons/${season.id}/scope`,{packs:[entry]})).status).toBe(400);
  await store.insert('scope',season.id,TEST_ORG,entry,{seasonId:season.id});
  expect((await call(`/seasons/${season.id}/scope`,{packs:[entry]})).status).toBe(204);
});
