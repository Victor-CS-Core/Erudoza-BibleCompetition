// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { createNativeTestApp, TEST_ORG, TEST_USER } from './test-runtime';
import { handleApplication } from './application';
import { Store } from './store';
import type { Actor, Env, RequestContext } from './types';

let app: Awaited<ReturnType<typeof createNativeTestApp>>, cookie: string;
const coach: Actor = { userId: TEST_USER, organizationId: TEST_ORG, organizationName: 'Practice Club',
  displayName: 'Coach', userName: 'coach', email: null, kind: 'Adult', role: 'Owner', credentialVersion: 'v1' };
const day = () => Math.floor(Date.now() / 86_400_000);
const credentials = { userName: 'new-student', displayName: 'Student', password: 'Testing!123' };
const season = { name: 'Season', yearLabel: '2026', ruleProfileKey: 'PBE_STYLE_V1' };

beforeAll(async () => {
  app = await createNativeTestApp();
  cookie = (await app.login()).headers.get('set-cookie')!.split(';')[0];
}, 30_000);
afterAll(async () => { await app?.runtime.dispose(); });
beforeEach(async () => {
  await app.db.batch([
    app.db.prepare("DELETE FROM Records WHERE org_id=?").bind(TEST_ORG),
    app.db.prepare("DELETE FROM Users WHERE org_id=? AND kind='Student'").bind(TEST_ORG),
    app.db.prepare("DELETE FROM AuthBudgets WHERE key LIKE 'admin:%'")
  ]);
});

function context(path: string, data: unknown, method = 'POST', actor = coach, orgId = TEST_ORG) {
  let hashCalls = 0;
  const db = app.db as unknown as D1Database;
  // Exercise real routing and D1; fail loudly if a denied call reaches the external KDF service.
  const env = { DB: db, PASSWORD_CRYPTO: { getByName() { hashCalls++; throw new Error('Unexpected password work'); } } } as unknown as Env;
  const request = new Request(`https://erudoza.test/api/v1/organizations/${orgId}${path}`, { method,
    headers: { Origin: 'https://erudoza.test' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { ctx: { env, request, path, actor, orgId, store: new Store(db) } satisfies RequestContext, hashCalls: () => hashCalls };
}
const post = (path: string, data: unknown) => app.fetch(`/api/v1/organizations/${TEST_ORG}${path}`, {
  method: 'POST', headers: { Cookie: cookie, Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, body: JSON.stringify(data)
});
async function setBudget(key: string, attempts: number, window = day()) {
  await app.db.prepare('INSERT INTO AuthBudgets(key,window,attempts,expires_at) VALUES(?,?,?,?)').bind(key, window, attempts, (day() + 2) * 86_400_000).run();
}
async function seedStudents(count: number) {
  const ids = Array.from({ length: count }, (_, i) => `student-${i}`);
  await app.db.prepare(`INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version)
    SELECT value,?,value,value,'Student','Student','fixture-password','v1' FROM json_each(?)`).bind(TEST_ORG, JSON.stringify(ids)).run();
}
async function seedSeasons(count: number) {
  const ids = Array.from({ length: count }, (_, i) => `season-${i}`);
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,data) SELECT 'season',value,?,'{}' FROM json_each(?)").bind(TEST_ORG, JSON.stringify(ids)).run();
}
const records = () => app.db.prepare('SELECT kind,id,data FROM Records WHERE org_id=? ORDER BY kind,id').bind(TEST_ORG).all();

it.each([
  ['actor', `admin:credentials:actor:${TEST_USER}`, 30],
  ['organization', `admin:credentials:org:${TEST_ORG}`, 60],
  ['global', 'admin:credentials:global', 300]
] as const)('rejects exhausted %s password budgets before student creation or password hashing', async (_scope, key, attempts) => {
  await setBudget(key, attempts);
  const call = context('/students', credentials);
  await expect(handleApplication(call.ctx)).rejects.toMatchObject({ status: 429 });
  expect(call.hashCalls()).toBe(0);
  expect(await app.db.prepare("SELECT count(*) FROM Users WHERE kind='Student'").first('count(*)')).toBe(0);
  expect((await records()).results).toEqual([]);
});

it.each([
  ['actor', `admin:credentials:actor:${TEST_USER}`, 30],
  ['organization', `admin:credentials:org:${TEST_ORG}`, 60],
  ['global', 'admin:credentials:global', 300]
] as const)('rejects exhausted %s password-reset budgets without changing credentials', async (_scope, key, attempts) => {
  await seedStudents(1);
  await setBudget(key, attempts);
  const call = context('/students/student-0/password', { password: 'Changed!123' });
  await expect(handleApplication(call.ctx)).rejects.toMatchObject({ status: 429 });
  expect(call.hashCalls()).toBe(0);
  expect(await app.db.prepare('SELECT password_hash FROM Users WHERE id=?').bind('student-0').first('password_hash')).toBe('fixture-password');
  expect((await records()).results).toEqual([]);
});

it.each([
  ['actor', `admin:writes:actor:${TEST_USER}`, 300],
  ['organization', `admin:writes:org:${TEST_ORG}`, 600],
  ['global', 'admin:writes:global', 3000]
] as const)('rejects exhausted %s administration budgets before persistence', async (_scope, key, attempts) => {
  await seedStudents(1);
  await setBudget(key, attempts);
  const call = context('/students/student-0/state', { isActive: false }, 'PUT');
  await expect(handleApplication(call.ctx)).rejects.toMatchObject({ status: 429 });
  expect(await app.db.prepare('SELECT active FROM Users WHERE id=?').bind('student-0').first('active')).toBe(1);
  expect((await records()).results).toEqual([]);
});

it('rejects foreign organizations and students before charging administration budgets', async () => {
  await setBudget('admin:writes:global', 3000);
  const before = await app.db.prepare("SELECT * FROM AuthBudgets WHERE key LIKE 'admin:%'").all();
  for (const call of [context('/students', credentials, 'POST', coach, 'foreign-org'),
    context('/students', credentials, 'POST', { ...coach, kind: 'Student', role: 'Student' })]) {
    await expect(handleApplication(call.ctx)).rejects.toMatchObject({ status: 403 });
    expect(call.hashCalls()).toBe(0);
  }
  expect((await app.db.prepare("SELECT * FROM AuthBudgets WHERE key LIKE 'admin:%'").all()).results).toEqual(before.results);
});

it('counts inactive students toward the roster cap and skips hashing once full', async () => {
  await seedStudents(100);
  await app.db.prepare("UPDATE Users SET active=0 WHERE kind='Student'").run();
  const call = context('/students', credentials);
  await expect(handleApplication(call.ctx)).rejects.toMatchObject({ status: 409 });
  expect(call.hashCalls()).toBe(0);
  expect(await app.db.prepare("SELECT count(*) FROM Users WHERE kind='Student'").first('count(*)')).toBe(100);
  expect((await records()).results).toEqual([]);
});

it('allows only one concurrent student creation for the last roster slot', async () => {
  await seedStudents(99);
  const responses = await Promise.all(['first', 'second'].map(userName => post('/students', { ...credentials, userName })));
  expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
  expect(await app.db.prepare("SELECT count(*) FROM Users WHERE kind='Student'").first('count(*)')).toBe(100);
  expect(await app.db.prepare("SELECT count(*) FROM Records WHERE kind='audit'").first('count(*)')).toBe(1);
});

it('rolls back the audit and student when another creator fills the roster during password work', async () => {
  await seedStudents(99);
  const call = context('/students', credentials);
  call.ctx.env.PASSWORD_CRYPTO = { getByName() {
    return { async hash() {
      await app.db.prepare(`INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version)
        VALUES('racing-student',?,'racing-student','Concurrent student','Student','Student','fixture-password','v1')`).bind(TEST_ORG).run();
      return 'fixture-password';
    } };
  } } as unknown as NonNullable<Env['PASSWORD_CRYPTO']>;
  await expect(handleApplication(call.ctx)).rejects.toMatchObject({ status: 409 });
  expect(await app.db.prepare("SELECT count(*) FROM Users WHERE kind='Student'").first('count(*)')).toBe(100);
  expect(await app.db.prepare('SELECT id FROM Users WHERE user_name=?').bind(credentials.userName).first()).toBeNull();
  expect((await records()).results).toEqual([]);
});

it('reserves the final global password attempt once under concurrency', async () => {
  await setBudget('admin:credentials:global', 299);
  const responses = await Promise.all(['first', 'second'].map(userName => post('/students', { ...credentials, userName })));
  expect(responses.map(r => r.status).sort()).toEqual([201, 429]);
  expect(await app.db.prepare("SELECT attempts FROM AuthBudgets WHERE key='admin:credentials:global'").first('attempts')).toBe(300);
  expect(await app.db.prepare("SELECT count(*) FROM Users WHERE kind='Student'").first('count(*)')).toBe(1);
});

it('performs no writes when the outer administration budget is already exhausted', async () => {
  await setBudget('admin:writes:global', 3000);
  const before = await app.db.prepare("SELECT * FROM AuthBudgets WHERE key LIKE 'admin:%' ORDER BY key").all();
  const call = context('/students', credentials);
  await expect(handleApplication(call.ctx)).rejects.toMatchObject({ status: 429 });
  expect(call.hashCalls()).toBe(0);
  expect((await app.db.prepare("SELECT * FROM AuthBudgets WHERE key LIKE 'admin:%' ORDER BY key").all()).results).toEqual(before.results);
  expect((await records()).results).toEqual([]);
});

it('allows only one concurrent season creation for the last storage slot', async () => {
  await seedSeasons(11);
  const responses = await Promise.all([post('/seasons', season), post('/seasons', season)]);
  expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
  expect(await app.db.prepare("SELECT count(*) FROM Records WHERE kind='season'").first('count(*)')).toBe(12);
  expect(await app.db.prepare("SELECT count(*) FROM Records WHERE kind='audit'").first('count(*)')).toBe(1);
  expect((await post('/seasons', season)).status).toBe(409);
});

it('shares the daily password budget between creation and reset, then resets it on the next UTC day', async () => {
  await setBudget(`admin:credentials:actor:${TEST_USER}`, 29);
  const created = await post('/students', credentials);
  expect(created.status).toBe(201);
  const { userId } = await created.json() as { userId: string };
  const before = await app.db.prepare('SELECT password_hash FROM Users WHERE id=?').bind(userId).first('password_hash');
  expect((await post(`/students/${userId}/password`, { password: 'Changed!123' })).status).toBe(429);
  expect(await app.db.prepare('SELECT password_hash FROM Users WHERE id=?').bind(userId).first('password_hash')).toBe(before);
  await app.db.prepare("UPDATE AuthBudgets SET window=? WHERE key LIKE 'admin:%'").bind(day() - 1).run();
  expect((await post(`/students/${userId}/password`, { password: 'Changed!123' })).status).toBe(204);
  expect(await app.db.prepare('SELECT password_hash FROM Users WHERE id=?').bind(userId).first('password_hash')).not.toBe(before);
});

it('does not charge administration budgets for reads or study answer routes', async () => {
  await setBudget('admin:writes:global', 3000);
  const before = (await app.db.prepare("SELECT * FROM AuthBudgets WHERE key LIKE 'admin:%'").all()).results;
  const read = await handleApplication(context('/students', undefined, 'GET').ctx);
  expect(read?.status).toBe(200);
  expect(await handleApplication(context('/study/answer', {}).ctx)).toBeNull();
  expect((await app.db.prepare("SELECT * FROM AuthBudgets WHERE key LIKE 'admin:%'").all()).results).toEqual(before);
});
