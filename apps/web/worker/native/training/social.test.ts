import { Store } from '../store';
import type { Env, RequestContext } from '../types';
import { createNativeTestApp, TEST_ORG, TEST_USER } from '../test-runtime';
import { leaderboard, maskName, mondayOfWeek, setLeaderboardOptIn, teamActivity } from './social';
import type { XpRecord } from './xp';
// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';

let app: Awaited<ReturnType<typeof createNativeTestApp>>;
const S1 = '33333333-3333-4333-8333-333333333333';
const S2 = '44444444-4444-4333-8444-444444444444';
const S3 = '55555555-5555-4333-8555-555555555555';
const COACH = TEST_USER; // the fixture coach (Adult/Owner)

function ctxFor(userId: string, kind: 'Student' | 'Adult' = 'Student', displayName = 'Test User'): RequestContext {
    return {
        env: { DB: app.db } as Env, store: new Store(app.db as unknown as Env['DB']), orgId: TEST_ORG,
        actor: { userId, organizationId: TEST_ORG, displayName, userName: 'user', email: null, kind, role: kind === 'Student' ? 'Student' : 'Owner', credentialVersion: 'v1' },
        path: '', request: new Request('https://erudoza.test'),
    };
}

const seedXp = (userId: string, xpByDay: Record<string, number>, totalXp: number) =>
    app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('training-xp',?,?,?,?)")
        .bind(`${TEST_ORG}:${userId}`, TEST_ORG, userId, JSON.stringify({ totalXp, xpBySeason: {}, attemptXpByDay: {}, xpByDay, updatedAtUtc: '2026-09-17T12:00:00Z' } satisfies XpRecord)).run();

const seedPreferences = (userId: string, leaderboardOptIn: boolean) =>
    app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('training-preferences',?,?,?,?)")
        .bind(`${TEST_ORG}:${userId}`, TEST_ORG, userId, JSON.stringify({ id: `${TEST_ORG}:${userId}`, timeZone: 'UTC', weeklyTarget: 5, pending: null, leaderboardOptIn, lastEventAtUtc: '2026-09-17T12:00:00Z', qualifyingWeekStarts: [] })).run();

const seedDay = (userId: string, localDate: string) =>
    app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('training-day',?,?,?,?)")
        .bind(`${TEST_ORG}:${userId}:${localDate}`, TEST_ORG, userId, JSON.stringify({ id: `${TEST_ORG}:${userId}:${localDate}`, localDate, timeZone: 'UTC', firstQualifiedAtUtc: `${localDate}T12:00:00Z`, sessionId: 's', credited: true })).run();

const WEEK = '2026-09-14'; // a Monday
const dayInWeek = (offset: number) => `2026-09-${14 + offset}`;

beforeAll(async () => {
    app = await createNativeTestApp();
    for (const [id, name] of [[S1, 'Ada Lovelace'], [S2, 'Grace Hopper'], [S3, 'Katherine Johnson']] as const) {
        await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version,active) VALUES(?,?,?,?,?,?,?,?,1)")
            .bind(id, TEST_ORG, name.replace(/ /g, '').toLowerCase(), name, 'Student', 'Student', 'x', 'v1').run();
    }
    // Opt-in: S1 and S2 yes, S3 no.
    await seedPreferences(S1, true);
    await seedPreferences(S2, true);
    await seedPreferences(S3, false);
    // Weekly XP: S1 100 (Mon) + 50 (Wed), S2 200 (Tue), S3 500 (Mon, outside the pinned week below for the windowing test via separate seeds).
    await seedXp(S1, { [dayInWeek(0)]: 100, [dayInWeek(2)]: 50 }, 1000);
    await seedXp(S2, { [dayInWeek(1)]: 200 }, 600);
    await seedXp(S3, { [dayInWeek(0)]: 500 }, 500);
});

it('masks names and finds Monday week starts', () => {
    expect(maskName('Ada Lovelace')).toBe('Ada L.');
    expect(maskName('Plato')).toBe('Plato');
    expect(maskName('  Mary   Jane  Watson ')).toBe('Mary W.');
    expect(mondayOfWeek('2026-09-17')).toBe('2026-09-14'); // Thursday
    expect(mondayOfWeek('2026-09-14')).toBe('2026-09-14'); // Monday
    expect(mondayOfWeek('2026-09-20')).toBe('2026-09-14'); // Sunday
});

it('shows opted-in students masked names and the viewer rank', async () => {
    const url = new URL(`https://erudoza.test/?weekStart=${WEEK}`);
    const board = await leaderboard(ctxFor(S1), url);
    expect(board.weekStartLocalDate).toBe(WEEK);
    // S3 is not opted in, so only S1 and S2 appear.
    expect(board.entries.map(e => e.userId).sort()).toEqual([S1, S2].sort());
    expect(board.entries.find(e => e.userId === S2)!.displayName).toBe('Grace H.');
    expect(board.entries.find(e => e.userId === S1)!.displayName).toBe('Ada L.');
    // Ranked by weekly XP: S2 (200) first, S1 (150) second.
    expect(board.entries[0].userId).toBe(S2);
    expect(board.entries[1].userId).toBe(S1);
    expect(board.entries[1]).toMatchObject({ xp: 150, level: 5, levelName: 'Scribe' });
    expect(board.me).toMatchObject({ userId: S1, rank: 2, xp: 150, optedIn: true });
});

it('hides the viewer rank when they have not opted in', async () => {
    const url = new URL(`https://erudoza.test/?weekStart=${WEEK}`);
    const board = await leaderboard(ctxFor(S3), url);
    expect(board.entries.map(e => e.userId).sort()).toEqual([S1, S2].sort());
    expect(board.me).toMatchObject({ userId: S3, rank: null, xp: 500, optedIn: false });
});

it('gives coaches the full board with real names', async () => {
    const url = new URL(`https://erudoza.test/?weekStart=${WEEK}`);
    const board = await leaderboard(ctxFor(COACH, 'Adult', 'Coach Carter'), url);
    expect(board.entries).toHaveLength(3);
    expect(board.entries.find(e => e.userId === S3)!.displayName).toBe('Katherine Johnson');
    expect(board.entries[0].userId).toBe(S3); // 500 XP tops the week
    expect(board.me).toBeNull();
});

it('windows XP to the requested week only', async () => {
    // S1 has 150 XP in the pinned week and nothing the week before.
    const url = new URL('https://erudoza.test/?weekStart=2026-09-07');
    const board = await leaderboard(ctxFor(S1), url);
    expect(board.weekStartLocalDate).toBe('2026-09-07');
    expect(board.entries.find(e => e.userId === S1)!.xp).toBe(0);
    expect(board.me).toMatchObject({ xp: 0 });
});

it('falls back to the current week for a bad weekStart', async () => {
    const board = await leaderboard(ctxFor(S1), new URL('https://erudoza.test/?weekStart=not-a-date'));
    expect(board.weekStartLocalDate).toBe(mondayOfWeek(new Date().toISOString().slice(0, 10)));
});

it('flips the opt-in flag and preserves other preferences', async () => {
    const before = await ctxFor(S1).store.get('training-preferences', `${TEST_ORG}:${S1}`, TEST_ORG);
    expect((before!.value as { leaderboardOptIn?: boolean }).leaderboardOptIn).toBe(true);
    await setLeaderboardOptIn(ctxFor(S1), false);
    const after = await ctxFor(S1).store.get('training-preferences', `${TEST_ORG}:${S1}`, TEST_ORG);
    expect((after!.value as { leaderboardOptIn?: boolean }).leaderboardOptIn).toBe(false);
    expect((after!.value as { weeklyTarget?: number }).weeklyTarget).toBe(5);
    expect((after!.value as { timeZone?: string }).timeZone).toBe('UTC');
    await setLeaderboardOptIn(ctxFor(S1), true);
    await expect(setLeaderboardOptIn(ctxFor(S1), 'yes' as unknown as boolean)).rejects.toMatchObject({ status: 400 });
});

it('counts teammate practice without naming anyone', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    await seedDay(S2, today);
    await seedDay(S3, threeDaysAgo);
    await seedDay(S1, today); // the viewer's own day never counts as a teammate
    const activity = await teamActivity(ctxFor(S1));
    expect(activity.practicedToday).toBe(1);
    expect(activity.practicedThisWeek).toBe(2);
    expect(activity.memberCount).toBe(3);
});
