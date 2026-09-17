import { Store } from '../store';
import type { Env, RequestContext } from '../types';
import { createNativeTestApp, TEST_ORG } from '../test-runtime';
import { lockedCosmetics, unlockedCosmetics } from './cosmetics';
// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';

let app: Awaited<ReturnType<typeof createNativeTestApp>>;
const U1 = '77777777-7777-4333-8777-777777777777'; // earns everything
const U2 = '88888888-8888-4333-8888-888888888888'; // earns nothing

function ctxFor(userId: string): RequestContext {
    return {
        env: { DB: app.db } as Env, store: new Store(app.db as unknown as Env['DB']), orgId: TEST_ORG,
        actor: { userId, organizationId: TEST_ORG, displayName: 'Cosmetic', userName: 'cosmetic', email: null, kind: 'Student', role: 'Student', credentialVersion: 'v1' },
        path: '', request: new Request('https://erudoza.test'),
    };
}

beforeAll(async () => {
    app = await createNativeTestApp();
    for (const id of [U1, U2]) {
        await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version,active) VALUES(?,?,?,?,?,?,?,?,1)")
            .bind(id, TEST_ORG, `cosmetic${id.slice(0, 4)}`, 'Cosmetic', 'Student', 'Student', 'x', 'v1').run();
    }
    // U1: 7 consecutive credited days (any season) -> starlight.
    for (let i = 0; i < 7; i++) {
        const localDate = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('training-day',?,?,?,?)")
            .bind(`${TEST_ORG}:${U1}:${localDate}`, TEST_ORG, U1, JSON.stringify({ id: `${TEST_ORG}:${U1}:${localDate}`, localDate, timeZone: 'UTC', firstQualifiedAtUtc: `${localDate}T12:00:00Z`, sessionId: 's', credited: true })).run();
    }
    // U1: 600 XP (level 4 Keeper) -> set-2 hairstyles.
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('training-xp',?,?,?,?)")
        .bind(`${TEST_ORG}:${U1}`, TEST_ORG, U1, JSON.stringify({ totalXp: 600, xpBySeason: {}, attemptXpByDay: {}, xpByDay: {}, updatedAtUtc: '2026-09-17T12:00:00Z' })).run();
    // U1: a team Honor and a simulation Honor -> sash slots 2 and 3.
    for (const key of ['team:first-fellowship', 'simulation:first-rehearsal']) {
        await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('mastery-honor',?,?,?,?)")
            .bind(`${TEST_ORG}:${U1}:mastery-v1:${key}`, TEST_ORG, U1, JSON.stringify({ id: `${TEST_ORG}:${U1}:mastery-v1:${key}`, userId: U1, key, ruleVersion: 'mastery-v1', earnedAtUtc: '2026-09-10T12:00:00Z', seasonId: 's', evidence: null })).run();
    }
});

it('unlocks every cosmetic for a fully-earned learner', async () => {
    const unlocked = await unlockedCosmetics(ctxFor(U1));
    expect(unlocked.has('background:starlight')).toBe(true);
    for (const style of ['buzz', 'waves', 'locs', 'braids', 'natural-curls', 'low-bun']) expect(unlocked.has(`style:${style}`)).toBe(true);
    expect(unlocked.has('sash:2')).toBe(true);
    expect(unlocked.has('sash:3')).toBe(true);
    expect(lockedCosmetics(unlocked)).toEqual([]);
});

it('locks every cosmetic for a fresh learner, with requirement copy', async () => {
    const unlocked = await unlockedCosmetics(ctxFor(U2));
    expect(unlocked.size).toBe(0);
    const locks = lockedCosmetics(unlocked);
    expect(locks).toHaveLength(9);
    const byId = new Map(locks.map(l => [l.id, l.requirement]));
    expect(byId.get('background:starlight')).toMatch(/7-day/);
    expect(byId.get('style:buzz')).toMatch(/level 4/);
    expect(byId.get('sash:2')).toMatch(/Team Practice/);
    expect(byId.get('sash:3')).toMatch(/Simulation/);
});

it('unlocks set-2 styles exactly at level 4', async () => {
    // U2 has 0 XP: styles locked. Give 499 XP (level 3): still locked. 500 XP (level 4): unlocked.
    expect((await unlockedCosmetics(ctxFor(U2))).has('style:buzz')).toBe(false);
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('training-xp',?,?,?,?)")
        .bind(`${TEST_ORG}:${U2}`, TEST_ORG, U2, JSON.stringify({ totalXp: 499, xpBySeason: {}, attemptXpByDay: {}, xpByDay: {}, updatedAtUtc: '2026-09-17T12:00:00Z' })).run();
    expect((await unlockedCosmetics(ctxFor(U2))).has('style:buzz')).toBe(false);
    await app.db.prepare("UPDATE Records SET data=? WHERE kind='training-xp' AND id=?")
        .bind(JSON.stringify({ totalXp: 500, xpBySeason: {}, attemptXpByDay: {}, xpByDay: {}, updatedAtUtc: '2026-09-17T12:00:00Z' }), `${TEST_ORG}:${U2}`).run();
    expect((await unlockedCosmetics(ctxFor(U2))).has('style:buzz')).toBe(true);
    // But the streak-gated background is still locked at level 4 alone.
    expect((await unlockedCosmetics(ctxFor(U2))).has('background:starlight')).toBe(false);
});
