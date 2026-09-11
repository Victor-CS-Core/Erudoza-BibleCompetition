// @vitest-environment node
import { afterAll, beforeAll, expect, it } from "vitest";
import { createNativeTestApp, TEST_ORG, TEST_USER } from "../worker/native/test-runtime";
import { recoverySql } from "./native-admin-recovery.mjs";
let app: Awaited<ReturnType<typeof createNativeTestApp>>;
beforeAll(async () => { app = await createNativeTestApp(); }, 30000);
afterAll(async () => { await app?.runtime.dispose(); });
const password = "Recovered!Staging123";
async function apply(organizationId = TEST_ORG, userId = TEST_USER) {
  const sql = recoverySql({ organizationId, userId, password });
  for (const statement of sql.split(";").filter((s: string) => s.trim())) await app.db.prepare(statement).run();
}
it("recovers the exact active administrator and revokes its old login", async () => {
  const login = await app.login();
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  await apply();
  expect((await app.fetch("/api/v1/me", { headers: { Cookie: cookie } })).status).toBe(401);
  expect((await app.login()).status).toBe(401);
  expect((await app.fetch("/api/v1/auth/login", { method: "POST", headers: { Origin: "https://erudoza.test" }, body: JSON.stringify({ identifier: "coach", password }) })).status).toBe(200);
});
it("does not change another tenant, a student, or an inactive account", async () => {
  const before = await app.db.prepare("SELECT password_hash FROM Users WHERE id=?").bind(TEST_USER).first();
  await apply("22222222-2222-4222-8222-222222222222");
  expect(await app.db.prepare("SELECT password_hash FROM Users WHERE id=?").bind(TEST_USER).first()).toEqual(before);
  for (const [kind, role, active] of [["Student", "Student", 1], ["Adult", "Owner", 0]]) {
    await app.db.prepare("UPDATE Users SET kind=?,role=?,active=? WHERE id=?").bind(kind, role, active, TEST_USER).run();
    await apply();
    expect(await app.db.prepare("SELECT password_hash FROM Users WHERE id=?").bind(TEST_USER).first()).toEqual(before);
  }
});
it("rejects injected identifiers and invalid passwords without emitting SQL or plaintext", () => {
  expect(() => recoverySql({ organizationId: TEST_ORG, userId: "' OR 1=1--", password })).toThrow();
  expect(() => recoverySql({ organizationId: TEST_ORG, userId: TEST_USER, password: "short" })).toThrow();
  expect(recoverySql({ organizationId: TEST_ORG, userId: TEST_USER, password })).not.toContain(password);
});
