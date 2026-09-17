// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG, TEST_USER } from '../test-runtime';
import { honorId, RULE_VERSION } from './catalog';
import type { SaveCharacterProfile } from '../../../shared/profileCharacter';
let app: Awaited<ReturnType<typeof createNativeTestApp>>, cookie: string;
const key = 'solo:exact-recall';
const config = (): SaveCharacterProfile => ({ version: 0, avatarKind: 'character', avatarHonorKey: null, character: { bodyType: 'female', style: 'ponytail', hairColor: 'red', skin: 'deep', eyes: 'blue', attire: 'student', background: 'sunrise', slots: [null, null, null] }, shareOptions: { showName: false, showBrand: true, showQR: false }, sharePatches: [] });
const request = (path = '/api/v1/profile/me', method = 'GET', data?: unknown) => app.fetch(path, { method, headers: { Cookie: cookie, Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
const save = (data: unknown) => request('/api/v1/profile/me/character', 'PUT', data);
const earn = async () => { const id = honorId(TEST_ORG, TEST_USER, key); await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('mastery-honor',?,?,?,?)").bind(id, TEST_ORG, TEST_USER, JSON.stringify({ id, userId: TEST_USER, key, ruleVersion: RULE_VERSION, earnedAtUtc: '2026-09-13T00:00:00Z' })).run(); };
beforeAll(async () => { app = await createNativeTestApp(); cookie = (await app.login()).headers.get('set-cookie')!.split(';')[0]; }, 30000);
beforeEach(async () => { await app.db.prepare("DELETE FROM Records WHERE kind IN ('profile-character','user-profile','mastery-honor','simulation-eligibility')").run(); await app.db.prepare("UPDATE Users SET kind='Adult',role='Owner' WHERE id=?").bind(TEST_USER).run(); });
afterAll(async () => { await app?.runtime.dispose(); });
it('returns read-only safe defaults and migrates the existing earned Honor selection', async () => {
  expect(await (await request()).json()).toMatchObject({ avatarKind: 'initials', characterVersion: 0, canUseMasterGuide: true, character: { bodyType: 'male', style: 'curls', hairColor: 'brown', skin: 'medium', eyes: 'brown', attire: 'student', background: 'sunrise', slots: [null, null, null] }, shareOptions: { showName: true, showBrand: true, showQR: true }, sharePatches: [] });
  expect(await app.db.prepare("SELECT count(*) n FROM Records WHERE kind='profile-character'").first('n')).toBe(0); await earn();
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('user-profile',?,?,?,?)").bind(TEST_USER, TEST_ORG, TEST_USER, JSON.stringify({ id: TEST_USER, userId: TEST_USER, honorKey: key, unlockId: honorId(TEST_ORG, TEST_USER, key), ruleVersion: RULE_VERSION })).run();
  expect(await (await request()).json()).toMatchObject({ avatarKind: 'honor', avatarHonorKey: key, characterVersion: 0 });
});
it('persists appearance, earned slots and shares while identities disclose only the portrait', async () => {
  await earn(); const input = config(); input.character.slots = [key, null, null]; input.sharePatches = [{ key, x: 400, y: 1200, size: 216, rotation: 35 }];
  const saved = await save(input); expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ avatarKind: 'character', character: input.character, shareOptions: input.shareOptions, sharePatches: input.sharePatches, characterVersion: 1 });
  expect(await (await request()).json()).toMatchObject({ character: input.character, shareOptions: input.shareOptions, sharePatches: input.sharePatches, characterVersion: 1 });
  expect(await (await request(`/api/v1/profile/identities?userId=${TEST_USER}&userId=${TEST_USER}`)).json()).toEqual([{ userId: TEST_USER, avatarHonorKey: null, avatarKind: 'character', character: { bodyType: 'female', style: 'ponytail', hairColor: 'red', skin: 'deep', eyes: 'blue' } }]);
});
it('allows one atomic create and update per revision without stale avatar writes', async () => {
  await earn(); const first = config(), second = { ...config(), avatarKind: 'honor', avatarHonorKey: key };
  for (const version of [0, 1]) {
    const responses = await Promise.all([save({ ...first, version }), save({ ...second, version })]); expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const winner = await responses.find(r => r.status === 200)!.json(); expect(await (await request()).json()).toEqual(winner);
  }
  expect((await save(config())).status).toBe(409);
});
it('rejects malformed appearance, slots, switches and placement bounds without saving', async () => {
  const good = config();
  for (const character of [{ ...good.character, bodyType: 'other' }, { ...good.character, style: 'curls' }, { ...good.character, hairColor: 'green' }, { ...good.character, eyes: 'red' }, { ...good.character, background: 'void' }, { ...good.character, slots: [null] }, { ...good.character, slots: [key, key, null] }, { ...good.character, slots: ['unknown', null, null] }]) expect((await save({ ...good, character })).status).toBe(400);
  for (const invalid of [{}, null, { ...good, version: -1 }, { ...good, avatarKind: 'url' }, { ...good, avatarKind: 'honor' }, { ...good, shareOptions: { showName: 'yes', showBrand: true, showQR: true } }, { ...good, avatarHonorKey: 'unknown' }]) expect((await save(invalid)).status).toBe(400);
  await earn(); const patch = { key, x: 400, y: 1200, size: 216, rotation: 0 };
  for (const bad of [{ ...patch, x: -1 }, { ...patch, x: 1201 }, { ...patch, y: 1601 }, { ...patch, size: 143 }, { ...patch, size: 337 }, { ...patch, rotation: 181 }, { ...patch, rotation: null }]) expect((await save({ ...good, sharePatches: [bad] })).status).toBe(400);
  expect((await save({ ...good, sharePatches: [patch, patch] })).status).toBe(400);
  expect(await (await request()).json()).toMatchObject({ characterVersion: 0 });
});
it('requires real earned authority and enforces account attire including role downgrade', async () => {
  const input = config();
  expect((await save({ ...input, character: { ...input.character, slots: [key, null, null] } })).status).toBe(403);
  expect((await save({ ...input, sharePatches: [{ key, x: 400, y: 1200, size: 216, rotation: 0 }] })).status).toBe(403);
  expect((await save({ ...input, avatarHonorKey: key })).status).toBe(403);
  await app.db.prepare("UPDATE Users SET kind='Student',role='Student' WHERE id=?").bind(TEST_USER).run();
  expect((await save({ ...input, character: { ...input.character, attire: 'coach' } })).status).toBe(403); expect((await save(input)).status).toBe(200);
  await app.db.prepare("UPDATE Users SET kind='Adult',role='Admin' WHERE id=?").bind(TEST_USER).run();
  expect((await save({ ...input, version: 1, character: { ...input.character, attire: 'coach' } })).status).toBe(200);
  await app.db.prepare("UPDATE Users SET kind='Student',role='Student' WHERE id=?").bind(TEST_USER).run();
  expect(await (await request()).json()).toMatchObject({ canUseMasterGuide: false, character: { attire: 'student' }, characterVersion: 2 });
});
it('legacy avatar writes preserve saved character preferences and invalidate stale saves', async () => {
  const input = config(); expect((await save(input)).status).toBe(200); await earn();
  expect(await (await request('/api/v1/profile/me/avatar', 'PUT', { honorKey: key })).json()).toMatchObject({ avatarKind: 'honor', avatarHonorKey: key, characterVersion: 2, character: input.character, shareOptions: input.shareOptions });
  expect((await save({ ...input, version: 1 })).status).toBe(409);
  expect(await (await request('/api/v1/profile/me/avatar', 'PUT', { honorKey: null })).json()).toMatchObject({ avatarKind: 'initials', characterVersion: 3, character: input.character });
});
it('sanitizes lost simulation eligibility without changing immutable unlocks', async () => {
  const simulation = 'simulation:team-precision', id = honorId(TEST_ORG, TEST_USER, simulation);
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('mastery-honor',?,?,?,?)").bind(id, TEST_ORG, TEST_USER, JSON.stringify({ id, userId: TEST_USER, key: simulation, ruleVersion: 'simulation-v1', earnedAtUtc: '2026-09-13T00:00:00Z' })).run();
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('simulation-eligibility','eligible',?,?,?)").bind(TEST_ORG, TEST_USER, JSON.stringify({ unlockId: id, userId: TEST_USER, ruleVersion: 'simulation-v1', eligible: true })).run();
  const input = config(); input.character.slots = [simulation, null, null]; input.sharePatches = [{ key: simulation, x: 400, y: 1200, size: 216, rotation: 0 }]; expect((await save(input)).status).toBe(200);
  await app.db.prepare("UPDATE Records SET data=json_set(data,'$.eligible',json('false')) WHERE kind='simulation-eligibility'").run();
  expect(await (await request()).json()).toMatchObject({ character: { slots: [null, null, null] }, sharePatches: [], characterVersion: 1 }); expect((await save({ ...input, version: 1 })).status).toBe(403);
  expect(await app.db.prepare("SELECT count(*) n FROM Records WHERE kind='mastery-honor'").first('n')).toBe(1);
});
it('rejects locked cosmetics until they are earned', async () => {
  await app.db.prepare("DELETE FROM Records WHERE kind IN ('training-day','training-xp','solo-badge-award')").run();
  const base = config();
  expect((await save({ ...base, character: { ...base.character, background: 'starlight' } })).status).toBe(403);
  expect((await save({ ...base, character: { ...base.character, hairColor: 'blond' } })).status).toBe(403);
  expect((await save({ ...base, character: { ...base.character, style: 'braids' } })).status).toBe(403);
  await earn();
  expect((await save({ ...base, character: { ...base.character, slots: [null, key, null] } })).status).toBe(403);
  expect((await save(base)).status).toBe(200);
  for (let i = 0; i < 7; i++) {
    const localDate = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('training-day',?,?,?,?)")
      .bind(`${TEST_ORG}:${TEST_USER}:${localDate}`, TEST_ORG, TEST_USER, JSON.stringify({ id: `${TEST_ORG}:${TEST_USER}:${localDate}`, localDate, timeZone: 'UTC', firstQualifiedAtUtc: `${localDate}T12:00:00Z`, sessionId: 's', credited: true })).run();
  }
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('solo-badge-award',?,?,?,?)")
    .bind(`${TEST_ORG}:${TEST_USER}:steady-study:training-v1:academy`, TEST_ORG, TEST_USER, JSON.stringify({ id: `${TEST_ORG}:${TEST_USER}:steady-study:training-v1:academy`, key: 'steady-study', scope: 'training-v1', scopeId: 'academy', earnedAtUtc: '2026-09-10T12:00:00Z', ruleVersion: 'training-v1' })).run();
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('training-xp',?,?,?,?)")
    .bind(`${TEST_ORG}:${TEST_USER}`, TEST_ORG, TEST_USER, JSON.stringify({ totalXp: 500, xpBySeason: {}, attemptXpByDay: {}, xpByDay: {}, updatedAtUtc: '2026-09-17T12:00:00Z' })).run();
  const teamKey = 'team:first-fellowship', teamId = honorId(TEST_ORG, TEST_USER, teamKey);
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('mastery-honor',?,?,?,?)")
    .bind(teamId, TEST_ORG, TEST_USER, JSON.stringify({ id: teamId, userId: TEST_USER, key: teamKey, ruleVersion: 'mastery-v1', earnedAtUtc: '2026-09-10T12:00:00Z' })).run();
  const unlocked = { ...base, version: 1, character: { ...base.character, background: 'starlight', hairColor: 'blond', style: 'braids', slots: [null, teamKey, null] } };
  expect((await save(unlocked)).status).toBe(200);
  const profile = await (await request()).json();
  expect(profile).toMatchObject({ character: unlocked.character, characterVersion: 2 });
  expect(profile.unlockedCosmetics).toEqual(expect.arrayContaining(['background:starlight', 'hair:blond', 'style:braids', 'sash:2']));
  expect(profile.cosmeticLocks.map((l: { id: string }) => l.id)).toContain('sash:3');
});
it('omits foreign and inactive identities and ignores foreign-owned character records', async () => {
  const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', foreign = '22222222-2222-4222-8222-222222222222';
  await app.db.prepare("INSERT INTO Organizations(id,name,slug) VALUES(?,'Foreign','foreign')").bind(foreign).run();
  await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT ?,?,'foreign','Foreign','Student','Student',password_hash,'v1' FROM Users WHERE id=?").bind(other, foreign, TEST_USER).run();
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('profile-character',?,?,?,?)").bind(TEST_USER, TEST_ORG, other, JSON.stringify({ ...config(), userId: other })).run();
  expect(await (await request()).json()).toMatchObject({ avatarKind: 'initials', characterVersion: 0 });
  expect(await (await request(`/api/v1/profile/identities?userId=${other}&userId=${TEST_USER}`)).json()).toEqual([{ userId: TEST_USER, avatarHonorKey: null, avatarKind: 'initials', character: null }]);
  await app.db.prepare('UPDATE Users SET org_id=?,active=0 WHERE id=?').bind(TEST_ORG, other).run(); expect(await (await request(`/api/v1/profile/identities?userId=${other}`)).json()).toEqual([]);
  expect((await request('/api/v1/profile/me/avatar', 'PUT', { honorKey: null })).status).toBe(409);
  expect((await app.fetch('/api/v1/profile/me/character', { method: 'PUT', headers: { Origin: 'https://erudoza.test' }, body: JSON.stringify(config()) })).status).toBe(401);
});
