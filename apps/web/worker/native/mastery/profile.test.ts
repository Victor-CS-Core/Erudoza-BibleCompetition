// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG, TEST_USER } from '../test-runtime';
import { honorId, RULE_VERSION } from './catalog';
import { selfProfile } from './profile';
import type { HonorUnlock } from './catalog';
import type { Env, RequestContext } from '../types';
import { Store } from '../store';
import { insertUnlocks } from './store';
let app: Awaited<ReturnType<typeof createNativeTestApp>>, cookie: string;
const otherUser = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', foreignUser = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', foreignOrg = '22222222-2222-4222-8222-222222222222';
const award = (): HonorUnlock => ({ id: honorId(TEST_ORG, TEST_USER, 'solo:exact-recall'), userId: TEST_USER, key: 'solo:exact-recall', ruleVersion: RULE_VERSION, earnedAtUtc: '2026-09-11T00:00:00Z', seasonId: 'season', evidence: { passageIds: ['validated-test-proof'] } });
const request = (path: string, method = 'GET', data?: unknown) => app.fetch(path, { method, headers: { Cookie: cookie, Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
const rows = async () => (await app.db.prepare('SELECT count(*) n FROM Records').first<{ n: number }>())!.n;
beforeAll(async () => {
  app = await createNativeTestApp(); cookie = (await app.login()).headers.get('set-cookie')!.split(';')[0];
  await app.db.prepare('INSERT INTO Organizations(id,name,slug) VALUES(?,?,?)').bind(foreignOrg, 'Foreign', 'foreign').run();
  for (const [user, org] of [[otherUser, TEST_ORG], [foreignUser, foreignOrg]]) await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT ?,?,?,'Fixture','Student','Student',password_hash,'v1' FROM Users WHERE id=?").bind(user, org, user, TEST_USER).run();
}, 30000);
afterAll(async () => { await app?.runtime.dispose(); });
it('returns11 locked definitions read-only and rejects arbitrary, unauthenticated and legacy selections', async () => {
  const before = await rows(), result = await request('/api/v1/profile/me'); expect(result.status).toBe(200);
  const profile = await result.json() as { honors: { earnedAtUtc: string | null }[]; avatarHonorKey: string | null };
  expect(profile.honors).toHaveLength(11); expect(profile.honors.every(h => h.earnedAtUtc === null)).toBe(true); expect(profile.avatarHonorKey).toBeNull(); expect(await rows()).toBe(before);
  expect((await app.fetch('/api/v1/profile/me')).status).toBe(401);
  for (const key of ['https://evil.invalid/avatar.png', 'first-fellowship', 'solo:unknown']) expect((await request('/api/v1/profile/me/avatar', 'PUT', { honorKey: key })).status).toBe(400);
  expect((await request('/api/v1/profile/me/avatar', 'PUT', {})).status).toBe(400);
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('solo-badge-award','legacy',?,?,?)").bind(TEST_ORG, TEST_USER, JSON.stringify({ key: 'exact-recall', ruleVersion: 'training-v1', earnedAtUtc: '2026-09-01T00:00:00Z' })).run();
  expect((await request('/api/v1/profile/me/avatar', 'PUT', { honorKey: 'solo:exact-recall' })).status).toBe(403);
});
it('rolls back failed batches, preserves immutable unlocks and reloads the saved choice', async () => {
  const store = new Store(app.db as unknown as Env['DB']);
  await expect(app.db.batch([insertUnlocks(store, TEST_ORG, [award()]) as never, app.db.prepare("INSERT INTO Records(kind,id,org_id,data) VALUES('failed','bad',?,'not-json')").bind(TEST_ORG)])).rejects.toThrow();
  expect(await store.get('mastery-honor', award().id, TEST_ORG)).toBeNull();
  await insertUnlocks(store, TEST_ORG, [award()]).run();
  await insertUnlocks(store, TEST_ORG, [{ ...award(), earnedAtUtc: '2026-09-12T00:00:00Z', evidence: { replaced: true } }]).run();
  expect((await store.get<HonorUnlock>('mastery-honor', award().id, TEST_ORG))?.value).toEqual(award());
  expect(await (await request('/api/v1/profile/me/avatar', 'PUT', { honorKey: 'solo:exact-recall' })).json()).toMatchObject({ avatarHonorKey: 'solo:exact-recall' });
  expect(await (await request('/api/v1/profile/me')).json()).toMatchObject({ avatarHonorKey: 'solo:exact-recall' });
});
it('resolves same-org identities only, deduplicates up to50 and resets to initials', async () => {
  expect(await (await request(`/api/v1/profile/identities?userId=${TEST_USER}&userId=${TEST_USER}&userId=${otherUser}&userId=${foreignUser}`)).json()).toEqual([{ userId: TEST_USER, avatarHonorKey: 'solo:exact-recall' }, { userId: otherUser, avatarHonorKey: null }]);
  expect((await request('/api/v1/profile/identities?userId=bad')).status).toBe(400);
  const ids = Array.from({ length: 51 }, (_, i) => `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, '0')}`);
  expect((await request(`/api/v1/profile/identities?${ids.slice(0, 50).map(id => `userId=${id}`).join('&')}`)).status).toBe(200);
  expect((await request(`/api/v1/profile/identities?${ids.map(id => `userId=${id}`).join('&')}`)).status).toBe(400);
  expect(await (await request('/api/v1/profile/me/avatar', 'PUT', { honorKey: null })).json()).toMatchObject({ avatarHonorKey: null });
});
it('rejects foreign-owner evidence even with a forged self storage ID', async () => {
  const forged = { ...award(), id: honorId(TEST_ORG, TEST_USER, 'team:first-fellowship'), key: 'team:first-fellowship', userId: otherUser };
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('mastery-honor',?,?,?,?)").bind(forged.id, TEST_ORG, TEST_USER, JSON.stringify(forged)).run();
  expect((await request('/api/v1/profile/me/avatar', 'PUT', { honorKey: forged.key })).status).toBe(403);
});
it('GET cost stays2 indexed queries and zero writes at100 and10000 historical attempts', async () => {
  let measured: { sql: string; rows: number; writes: number }[] = [];
  const wrap = (sql: string, statement: ReturnType<typeof app.db.prepare>) => ({ bind(...v: unknown[]) { return wrap(sql, statement.bind(...v)); }, async all() { const r = await statement.all(); measured.push({ sql, rows: r.meta.rows_read, writes: r.meta.rows_written }); return r; }, async first() { const r = await statement.all(); measured.push({ sql, rows: r.meta.rows_read, writes: r.meta.rows_written }); return r.results[0] ?? null; } });
  const db = { prepare: (sql: string) => wrap(sql, app.db.prepare(sql)) } as unknown as Env['DB'];
  const ctx = { env: { DB: db }, store: new Store(db), orgId: TEST_ORG, actor: { userId: TEST_USER, displayName: 'Coach' } } as RequestContext, snapshots = [];
  for (const n of [100, 10000]) {
    await app.db.prepare("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<?) INSERT OR IGNORE INTO Records(kind,id,org_id,owner_id,data) SELECT 'attempt','mastery-history-'||x,?,?,'{}' FROM n").bind(n, TEST_ORG, TEST_USER).run();
    measured = []; await selfProfile(ctx); expect(measured).toHaveLength(2); expect(measured.reduce((n, q) => n + q.writes, 0)).toBe(0); snapshots.push(measured.map(q => ({ sql: q.sql, rows: q.rows })).sort((a, b) => a.sql.localeCompare(b.sql)));
  }
  expect(snapshots[1]).toEqual(snapshots[0]); expect(measured.reduce((n, q) => n + q.rows, 0)).toBeLessThan(50);
});
