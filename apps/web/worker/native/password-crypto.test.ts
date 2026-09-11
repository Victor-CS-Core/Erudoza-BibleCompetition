// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createNativeTestApp, TEST_ORG, TEST_USER } from './test-runtime';
import { handleAuth } from './auth';
import { handleApplication } from './application';
import { Store } from './store';
import type { Env, RequestContext } from './types';
let app: Awaited<ReturnType<typeof createNativeTestApp>>;
beforeAll(async () => { app = await createNativeTestApp(); }, 30000);
beforeEach(async () => { await app.db.prepare('DELETE FROM LoginLimits').run(); });
afterAll(async () => { await app?.runtime.dispose(); });
const login = (identifier = 'coach', password = 'Testing!123') => new Request('https://erudoza.test/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test' }, body: JSON.stringify({ identifier, password }) });
it('fails closed when the password-computation binding is absent', async () => {
  await expect(handleAuth(login(), { DB: app.db } as unknown as Env)).rejects.toMatchObject({ status: 503 });
});
it('dispatches known and unknown credentials through the same bounded RPC pool', async () => {
  const verify = vi.fn(async () => false), getByName = vi.fn(() => ({ verify }));
  const env = { DB: app.db, PASSWORD_CRYPTO: { getByName } } as unknown as Env;
  for (const identifier of ['coach', 'unknown-user']) await expect(handleAuth(login(identifier), env)).rejects.toMatchObject({ status: 401 });
  expect(verify).toHaveBeenCalledTimes(2);
  expect(verify.mock.calls[0]).toEqual([expect.stringMatching(/^pbkdf2:/), 'Testing!123']);
  expect(verify.mock.calls[1]).toEqual(['pbkdf2:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'Testing!123']);
  for (const [name] of getByName.mock.calls) expect(name).toMatch(/^password-v1:(?:[0-9]|[1-5][0-9]|6[0-3])$/);
});
it('rate limits login before dispatching expensive crypto', async () => {
  const getByName = vi.fn();
  const env = { DB: app.db, PASSWORD_CRYPTO: { getByName } } as unknown as Env;
  // Unknown login requests are limited in D1 as well as known credentials.
  const { sha256 } = await import('./auth');
  await app.db.prepare('INSERT INTO LoginLimits(key,window,attempts) VALUES(?,?,10)').bind(`user:${await sha256('coach')}`, Math.floor(Date.now() / 60000)).run();
  await expect(handleAuth(login(), env)).rejects.toMatchObject({ status: 429 });
  expect(getByName).not.toHaveBeenCalled();
});
it('checks administrator authorization before student password computation', async () => {
  const getByName = vi.fn();
  const ctx = { request: new Request('https://erudoza.test/api/v1/organizations/'+TEST_ORG+'/students', { method: 'POST', body: JSON.stringify({ userName: 'unauthorized', displayName: 'No', password: 'Testing!123' }) }), path: '/students', orgId: TEST_ORG,
    actor: { organizationId: TEST_ORG, userId: TEST_USER, kind: 'Student', role: 'Student' }, env: { DB: app.db, PASSWORD_CRYPTO: { getByName } }, store: new Store(app.db as never) } as unknown as RequestContext;
  await expect(handleApplication(ctx)).rejects.toMatchObject({ status: 403 });
  expect(getByName).not.toHaveBeenCalled();
});
it('uses real RPC for compatible login, student creation and reset with session revocation', async () => {
  const response = await app.login();
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  const call = (path: string, data: unknown) => app.fetch(`/api/v1/organizations/${TEST_ORG}${path}`, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://erudoza.test' }, body: JSON.stringify(data) });
  const created = await call('/students', { userName: 'crypto-student', displayName: 'Crypto Student', password: 'Testing!123' });
  expect(created.status).toBe(201);
  const { userId } = await created.json() as { userId: string };
  const studentLogin = await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test' }, body: JSON.stringify({ identifier: 'crypto-student', password: 'Testing!123' }) });
  expect(studentLogin.status).toBe(200);
  const oldCookie = studentLogin.headers.get('set-cookie')!.split(';')[0];
  expect((await call(`/students/${userId}/password`, { password: 'Replacement!123' })).status).toBe(204);
  expect((await app.fetch('/api/v1/me', { headers: { Cookie: oldCookie } })).status).toBe(401);
  const replacement = await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test' }, body: JSON.stringify({ identifier: 'crypto-student', password: 'Replacement!123' }) });
  expect(replacement.status).toBe(200);
  expect((await app.fetch(`/api/v1/organizations/${TEST_ORG}/password-crypto`, { headers: { Cookie: cookie } })).status).toBe(404);
});
