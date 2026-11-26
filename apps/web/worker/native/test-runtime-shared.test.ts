// @vitest-environment node
import { afterAll, expect, it } from 'vitest';
import { disposeSharedNativeTestApps, getSharedNativeTestApp, TEST_ORG, TEST_USER } from './test-runtime';
import { Store } from './store';
import { effectiveSources } from './application/model';
import type { Env, RequestContext } from './types';

/** Isolation proofs for getSharedNativeTestApp. These tests are deliberately
 *  order-dependent within this file: later tests assert that state written
 *  by earlier ones is gone after a shared-app reset. If a reset ever stops
 *  wiping (or the isolate cache clear stops running), this file fails. */

let app: Awaited<ReturnType<typeof getSharedNativeTestApp>>;
afterAll(async () => { await disposeSharedNativeTestApps(); });

const season = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', pack = 'ffffffff-ffff-4fff-8fff-ffffffffffff', source = '12121212-1212-4121-8121-121212121212';
async function seedScopeWithText(text: string) {
  const range = { bookKey: 'GEN', startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1 };
  const insert = async (kind: string, id: string, value: unknown, seasonId: string | null = null, owner: string | null = null) => {
    await app.db.prepare('INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) VALUES(?,?,?,?,?,?)').bind(kind, id, TEST_ORG, seasonId, owner, JSON.stringify(value)).run();
  };
  await insert('season', season, { id: season, name: 'Shared probe', status: 'Active', organizationId: TEST_ORG });
  await insert('pack', pack, { id: pack, isActive: true, licensingStatus: 'development-sample' });
  await insert('scope', season, { contentPackId: pack, includes: [range], excludes: [] }, season);
  await insert('source', source, { id: source, knowledgeUnitId: source, contentPackId: pack, citation: 'Genesis 1:1', bookKey: 'GEN', chapter: 1, verse: 1, ordinal: 1, canonicalText: text, isActive: true }, null, pack);
}
function ctx() {
  const store = new Store(app.db as unknown as Env['DB']);
  return { store, env: { DB: store.db }, orgId: TEST_ORG, actor: { userId: TEST_USER, organizationId: TEST_ORG, kind: 'Adult', role: 'Owner' }, request: new Request('https://erudoza.test'), path: '' } as unknown as RequestContext;
}

it('boots the shared app with only the seed rows present', async () => {
  app = await getSharedNativeTestApp({ clearCachesOnReset: true });
  expect((await app.db.prepare('SELECT COUNT(*) AS n FROM Organizations').first<{ n: number }>())!.n).toBe(1);
  expect((await app.db.prepare('SELECT COUNT(*) AS n FROM Users').first<{ n: number }>())!.n).toBe(1);
  // Pollution for the next test to find (or fail to find).
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,data) VALUES('probe','probe-1',?,'{}')").bind(TEST_ORG).run();
  await app.db.prepare("INSERT INTO LoginLimits(key,window,attempts) VALUES('probe',1,3)").run();
  await seedScopeWithText('Alpha text from the first test.');
}, 30000);

it('reset wipes every application table in the schema back to the seed state', async () => {
  app = await getSharedNativeTestApp({ clearCachesOnReset: true });
  const tables = ((await app.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>()).results ?? [])
    .map(r => r.name).filter(name => !name.startsWith('sqlite_') && !name.startsWith('_cf_'));
  // The derivation must actually see the schema it claims to cover.
  expect(tables).toEqual(expect.arrayContaining(['Organizations', 'Users', 'Sessions', 'LoginLimits', 'Records']));
  for (const name of tables) {
    const { n } = (await app.db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).first<{ n: number }>())!;
    expect(n, `table ${name} must be at its seed count after reset`).toBe(name === 'Organizations' || name === 'Users' ? 1 : 0);
  }
}, 30000);

it('does not serve a previous test\u2019s scope sources after reset (isolate cache clear)', async () => {
  await seedScopeWithText('Alpha text from the first test.');
  const first = await effectiveSources(ctx(), season);
  expect(first.map(s => s.canonicalText)).toEqual(['Alpha text from the first test.']);
  app = await getSharedNativeTestApp({ clearCachesOnReset: true });
  await seedScopeWithText('Beta text from a later test.');
  const second = await effectiveSources(ctx(), season);
  expect(second.map(s => s.canonicalText)).toEqual(['Beta text from a later test.']);
}, 30000);

it('does not serve a previous test\u2019s scope sources over HTTP after reset (worker isolate cache clear)', async () => {
  const range = { bookKey: 'GEN', startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1 };
  app = await getSharedNativeTestApp({ clearCachesOnReset: true });
  const attemptSourceText = async (text: string) => {
    await seedScopeWithText(text);
    await app.db.prepare("UPDATE Users SET kind='Student',role='Student' WHERE id=?").bind(TEST_USER).run();
    const insert = async (kind: string, id: string, value: unknown, seasonId: string | null = null, owner: string | null = null) => {
      await app.db.prepare('INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) VALUES(?,?,?,?,?,?)').bind(kind, id, TEST_ORG, seasonId, owner, JSON.stringify(value)).run();
    };
    await insert('assignment', 'assignment', { id: 'assignment', seasonId: season, studentUserId: TEST_USER, contentPackId: pack, type: 'PrimarySpecialist', ...range }, season, TEST_USER);
    await insert('membership', `${season}:${TEST_USER}`, { id: `${season}:${TEST_USER}`, seasonId: season, userId: TEST_USER, studentUserId: TEST_USER, difficulty: 'Foundation' }, season, TEST_USER);
    const login = await app.login();
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const call = async (path: string, method = 'GET', value?: unknown) => app.fetch(path, { method, headers: { Cookie: cookie, Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    const session = await (await call('/api/v1/study/sessions', 'POST', { seasonId: season, mode: 'Practice' })).json() as { id: string };
    const card = await (await call(`/api/v1/study/sessions/${session.id}/next`)).json() as { id: string };
    const result = await (await call(`/api/v1/study/sessions/${session.id}/attempts`, 'POST', { clientSubmissionId: crypto.randomUUID(), challengeCardId: card.id, submittedAnswer: 'not the verse', responseTimeMs: 10, hintsUsed: false })).json() as { sourceText: string };
    return result.sourceText;
  };
  expect(await attemptSourceText('Alpha verse text for the isolate probe.')).toBe('Alpha verse text for the isolate probe.');
  app = await getSharedNativeTestApp({ clearCachesOnReset: true });
  expect(await attemptSourceText('Beta verse text for the isolate probe.')).toBe('Beta verse text for the isolate probe.');
}, 30000);

it('refuses a different per-test callback identity instead of silently reusing the first closure', async () => {
  const first = async () => {};
  await getSharedNativeTestApp({ beforeD1Statement: first });
  await expect(getSharedNativeTestApp({ beforeD1Statement: async () => {} })).rejects.toThrow(/per-test callbacks differ/);
}, 30000);
