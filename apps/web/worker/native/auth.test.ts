// @vitest-environment node
import { afterAll, beforeAll, expect, it } from "vitest";
import { createNativeTestApp, TEST_ORG, TEST_USER } from "./test-runtime";
import { authenticate } from "./auth";
import type { Env } from "./types";
let app: Awaited<ReturnType<typeof createNativeTestApp>>;
beforeAll(async () => { app = await createNativeTestApp(); }, 30_000);
afterAll(async () => { await app?.runtime.dispose(); });
it("rejects anonymous access and foreign origins", async () => {
  expect((await app.fetch("/api/v1/me")).status).toBe(401);
  expect((await app.fetch("/api/v1/auth/login", { method: "POST", headers: { Origin: "https://evil.test" }, body: JSON.stringify({ identifier: "coach", password: "Testing!123" }) })).status).toBe(403);
});
it("accepts compatible PBKDF2 credentials and revokes existing sessions immediately", async () => {
  const login = await app.login();
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  expect(login.headers.get("set-cookie")).toContain("HttpOnly");
  expect(login.headers.get("set-cookie")).toContain("Secure");
  expect((await app.fetch("/api/v1/me", { headers: { Cookie: cookie } })).status).toBe(200);
  await app.db.prepare("UPDATE Users SET credential_version = 'revoked' WHERE user_name = 'coach'").run();
  expect((await app.fetch("/api/v1/me", { headers: { Cookie: cookie } })).status).toBe(401);
});
it("does not disclose tenant records to authenticated outsiders", async () => {
  const login = await app.login();
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  expect((await app.fetch("/api/v1/organizations/22222222-2222-4222-8222-222222222222", { headers: { Cookie: cookie } })).status).toBe(403);
  expect((await app.fetch("/api/v1/auth/logout", { method: "POST", headers: { Cookie: cookie, Origin: "https://erudoza.test" } })).status).toBe(204);
  expect((await app.fetch("/api/v1/me", { headers: { Cookie: cookie } })).status).toBe(401);
});
it("checks live practice access with one database statement per authentication", async () => {
  const login = await app.login();
  const request = new Request("https://erudoza.test/room", { headers: { Cookie: login.headers.get("set-cookie")!.split(";")[0] } });
  // Count statements while executing the real bound D1 query; no cached/fabricated rows.
  let queries = 0;
  const env = { DB: { prepare(sql: string) {
    const statement = app.db.prepare(sql);
    return { bind(...values: unknown[]) {
      const bound = statement.bind(...values);
      return { first() { queries++; return bound.first(); } };
    } };
  } } } as unknown as Env;
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,data) VALUES('practice-setting',?,?,?)").bind(TEST_ORG, TEST_ORG, '{"enabled":false}').run();
  await expect(authenticate(request, env, TEST_ORG)).rejects.toMatchObject({ status: 403 });
  expect(queries).toBe(1);
  await app.db.prepare("UPDATE Records SET data=? WHERE kind='practice-setting' AND org_id=?").bind('{"enabled":true}', TEST_ORG).run();
  queries = 0;
  expect((await authenticate(request, env, TEST_ORG)).userId).toBe(TEST_USER);
  expect(queries).toBe(1);
  queries = 0;
  await expect(authenticate(request, env, "22222222-2222-4222-8222-222222222222")).rejects.toMatchObject({ status: 403 });
  expect(queries).toBe(1);
  await app.db.prepare("DELETE FROM Records WHERE kind='practice-setting' AND org_id=?").bind(TEST_ORG).run();
  queries = 0;
  expect((await authenticate(request, env, TEST_ORG)).userId).toBe(TEST_USER);
  expect(queries).toBe(1);
});
