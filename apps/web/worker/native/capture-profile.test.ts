// @vitest-environment node
// CROSS-WIRE CONTRACT suite for the profile surface (card 15; pattern from
// capture-control-center.test.ts + control-center-contract.test.ts). Boots
// the real native app, seeds one earned Achievement patch + a saved
// character + two bell notifications through the real record shapes, then
// (a) pins every payload to the CLIENT contract (src/features/profile/
// profile.ts MyProfile/ProfileIdentity + src/api/types.ts NotificationList)
// and (b) saves the exact server-emitted payloads as fixtures for
// src/features/profile/profile-real.test.tsx. Re-run when the profile
// contract changes:
//   npx vitest run worker/native/capture-profile.test.ts
// A hand-edited fixture is no evidence at all — regenerate, never patch.
import { afterAll, beforeAll, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { createNativeTestApp, TEST_ORG, TEST_USER } from "./test-runtime";
import { honorId } from "./mastery/catalog";

const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9";
const HONOR_KEY = "solo:exact-recall";
const SEASON = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let app: Awaited<ReturnType<typeof createNativeTestApp>>;
let cookie = "";

async function record(kind: string, id: string, value: unknown, owner: string | null = null) {
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) VALUES(?,?,?,?,?,?)").bind(kind, id, TEST_ORG, null, owner, JSON.stringify(value)).run();
}
async function request(path: string) {
  const res = await app.fetch(path, { headers: { Cookie: cookie, Origin: "https://erudoza.test" } });
  return { status: res.status, body: await res.json() as Record<string, any> };
}
function expectKeys(obj: Record<string, unknown>, required: string[], context: string) {
  for (const key of required) expect(obj, `${context} missing ${key}`).toHaveProperty(key);
}

beforeAll(async () => {
  app = await createNativeTestApp();
  cookie = (await app.login()).headers.get("set-cookie")!.split(";")[0];
  await app.db.prepare(`INSERT INTO Users(id, org_id, user_name, email, display_name, kind, role, password_hash, credential_version, created_at)
    SELECT ?, ?, 'teammate', NULL, 'Teammate', 'Student', 'Student', password_hash, credential_version, NULL FROM Users WHERE id = ?`).bind(OTHER, TEST_ORG, TEST_USER).run();
  const unlockId = honorId(TEST_ORG, TEST_USER, HONOR_KEY);
  await record("mastery-honor", unlockId, { id: unlockId, userId: TEST_USER, key: HONOR_KEY, ruleVersion: "mastery-v1", earnedAtUtc: "2026-11-20T00:00:00Z" }, TEST_USER);
  await record("user-profile", TEST_USER, { id: TEST_USER, userId: TEST_USER, honorKey: HONOR_KEY, unlockId, ruleVersion: "mastery-v1" }, TEST_USER);
  await record("profile-character", TEST_USER, { userId: TEST_USER, character: { bodyType: "male", style: "curls", hairColor: "brown", skin: "medium", eyes: "brown", attire: "student", background: "sunrise", slots: [HONOR_KEY, null, null] }, avatarKind: "character", shareOptions: { showName: true, showBrand: true, showQR: false }, sharePatches: [], operationId: "capture-op" }, TEST_USER);
  await record("notification", "notif-unread", { id: "notif-unread", seasonId: SEASON, seasonName: "Synthetic study", studentUserId: TEST_USER, actorUserId: OTHER, actorDisplayName: "Coach Pat", action: "added", citation: "Genesis 1:1", readAtUtc: null, createdAtUtc: "2026-11-24T09:00:00Z" }, TEST_USER);
  await record("notification", "notif-read", { id: "notif-read", seasonId: SEASON, seasonName: "Synthetic study", studentUserId: TEST_USER, actorUserId: OTHER, actorDisplayName: "Coach Pat", action: "removed", citation: "Genesis 1:2", readAtUtc: "2026-11-24T10:00:00Z", createdAtUtc: "2026-11-23T09:00:00Z" }, TEST_USER);
}, 60000);
afterAll(async () => { await app?.runtime.dispose(); });

it("captures real profile payloads and pins them to the client contract", async () => {
  const me = await request("/api/v1/profile/me");
  expect(me.status).toBe(200);
  // MyProfile + CharacterProfileFields (client profile.ts / shared types).
  expectKeys(me.body, ["userId", "displayName", "avatarHonorKey", "honors", "unlockedCosmetics", "cosmeticLocks", "character", "avatarKind", "characterVersion", "shareOptions", "sharePatches", "canUseMasterGuide"], "profile/me");
  expect(me.body.displayName).toBe("Coach");
  expect(me.body.avatarHonorKey).toBe(HONOR_KEY);
  expect(me.body.avatarKind).toBe("character");
  for (const honor of me.body.honors) expectKeys(honor, ["key", "title", "requirement", "category", "ruleVersion", "earnedAtUtc"], "profile honors[]");
  const earned = (me.body.honors as Record<string, unknown>[]).find(h => h.key === HONOR_KEY);
  expect(earned?.earnedAtUtc).toBe("2026-11-20T00:00:00Z");
  expect(earned?.title).toBe("Exact Recall");
  expectKeys(me.body.character, ["bodyType", "style", "hairColor", "skin", "eyes", "attire", "background", "slots"], "profile character");
  expect(me.body.character.slots[0]).toBe(HONOR_KEY);
  expectKeys(me.body.shareOptions, ["showName", "showBrand", "showQR"], "profile shareOptions");
  for (const lock of me.body.cosmeticLocks) expectKeys(lock, ["id", "requirement"], "profile cosmeticLocks[]");

  const notifications = await request("/api/v1/profile/me/notifications");
  expect(notifications.status).toBe(200);
  // NotificationList / UserNotification (client types.ts). `summary` is
  // computed by the server at read time, never stored.
  expectKeys(notifications.body, ["notifications", "unreadCount"], "notifications");
  expect(notifications.body.unreadCount).toBe(1);
  expect(notifications.body.notifications).toHaveLength(2);
  for (const n of notifications.body.notifications) expectKeys(n, ["id", "seasonId", "seasonName", "studentUserId", "actorUserId", "actorDisplayName", "action", "citation", "summary", "readAtUtc", "createdAtUtc"], "notifications[]");
  const unread = (notifications.body.notifications as Record<string, unknown>[]).find(n => n.id === "notif-unread");
  expect(unread?.summary).toBe("Coach Pat added Genesis 1:1");

  const identities = await request(`/api/v1/profile/identities?userId=${TEST_USER}&userId=${OTHER}`);
  expect(identities.status).toBe(200);
  // ProfileIdentity[] (client profile.ts).
  expect(Array.isArray(identities.body)).toBe(true);
  expect((identities.body as unknown[])).toHaveLength(2);
  for (const identity of identities.body as Record<string, unknown>[]) expectKeys(identity, ["userId", "avatarHonorKey", "avatarKind", "character"], "identities[]");
  const mine = (identities.body as Record<string, any>[]).find(i => i.userId === TEST_USER)!;
  expect(mine.avatarKind).toBe("character");
  expectKeys(mine.character, ["bodyType", "style", "hairColor", "skin", "eyes"], "identities[].character");
  const other = (identities.body as Record<string, any>[]).find(i => i.userId === OTHER)!;
  expect(other.avatarHonorKey).toBeNull();
  expect(other.character).toBeNull();

  const out = {
    me: { status: me.status, body: me.body },
    notifications: { status: notifications.status, body: notifications.body },
    identities: { status: identities.status, body: identities.body },
  };
  writeFileSync(new URL("../../src/features/profile/__fixtures__/profile-payloads.json", import.meta.url), JSON.stringify(out, null, 2));
}, 60000);
