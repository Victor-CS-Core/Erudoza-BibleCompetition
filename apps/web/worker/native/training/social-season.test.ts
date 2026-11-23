import { Store } from '../store';
import type { Env, RequestContext } from '../types';
import { createNativeTestApp, TEST_ORG, TEST_USER } from '../test-runtime';
import { seasonLeaderboard } from './social';
import type { XpRecord } from './xp';
// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';

let app: Awaited<ReturnType<typeof createNativeTestApp>>;
const A = '12121212-1212-4121-8121-121212121212'; // Maya Reed — opted in, top season XP
const B = '23232323-2323-4232-8232-232323232323'; // Jonah Kim — opted in
const C = '34343434-3434-4343-8343-343434343434'; // Sam Rivera — opted in, the usual viewer
const D = '45454545-4545-4454-8454-454545454545'; // Eli Turner — assigned, NOT opted in, highest season XP
const E = '56565656-5656-4565-8565-565656565656'; // Grace Nolan — opted in, huge XP, but NOT assigned in the season
const COACH = TEST_USER;
const SEASON = '66666666-6666-4666-8666-666666666666';
const WEEK = '2026-09-14'; // a Monday
const dayInWeek = (offset: number) => `2026-09-${14 + offset}`;
const url = new URL(`https://erudoza.test/?weekStart=${WEEK}`);

function ctxFor(userId: string, kind: 'Student' | 'Adult' = 'Student', displayName = 'Test User'): RequestContext {
    return {
        env: { DB: app.db } as Env, store: new Store(app.db as unknown as Env['DB']), orgId: TEST_ORG,
        actor: { userId, organizationId: TEST_ORG, displayName, userName: 'user', email: null, kind, role: kind === 'Student' ? 'Student' : 'Owner', credentialVersion: 'v1' },
        path: '', request: new Request('https://erudoza.test'),
    };
}

const seedXp = (userId: string, rec: Pick<XpRecord, 'xpBySeason' | 'xpByDay' | 'totalXp'>) =>
    app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('training-xp',?,?,?,?)")
        .bind(`${TEST_ORG}:${userId}`, TEST_ORG, userId, JSON.stringify({ attemptXpByDay: {}, updatedAtUtc: '2026-09-17T12:00:00Z', ...rec } satisfies XpRecord)).run();

const seedPreferences = (userId: string, leaderboardOptIn: boolean) =>
    app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('training-preferences',?,?,?,?)")
        .bind(`${TEST_ORG}:${userId}`, TEST_ORG, userId, JSON.stringify({ id: `${TEST_ORG}:${userId}`, timeZone: 'UTC', weeklyTarget: 5, pending: null, leaderboardOptIn, lastEventAtUtc: '2026-09-17T12:00:00Z', qualifyingWeekStarts: [] })).run();

const seedAssignment = (userId: string, seasonId: string) =>
    app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) VALUES('assignment',?,?,?,?,?)")
        .bind(`asg-${seasonId}-${userId}`, TEST_ORG, seasonId, userId, JSON.stringify({ id: `asg-${seasonId}-${userId}`, seasonId, studentUserId: userId, contentPackId: 'pack', type: 'PrimarySpecialist', bookKey: 'DAN', startChapter: 1, startVerse: 1, endChapter: 6, endVerse: 28, createdAtUtc: '2026-09-01T12:00:00Z' })).run();

const seedDay = (userId: string, localDate: string) =>
    app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('training-day',?,?,?,?)")
        .bind(`${TEST_ORG}:${userId}:${localDate}`, TEST_ORG, userId, JSON.stringify({ id: `${TEST_ORG}:${userId}:${localDate}`, localDate, timeZone: 'UTC', firstQualifiedAtUtc: `${localDate}T12:00:00Z`, sessionId: 's', credited: true })).run();

const seedCharacter = (userId: string) =>
    app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('profile-character',?,?,?,?)")
        .bind(userId, TEST_ORG, userId, JSON.stringify({ userId, avatarKind: 'character', characterVersion: 1, character: { bodyType: 'female', style: 'braids', hairColor: 'black', skin: 'deep', eyes: 'hazel', attire: 'student', background: 'sunrise', slots: [null, null, null] }, shareOptions: { showName: true, showBrand: true, showQR: false }, sharePlacements: [] })).run();

const isoDay = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
    app = await createNativeTestApp();
    for (const [id, name] of [[A, 'Maya Reed'], [B, 'Jonah Kim'], [C, 'Sam Rivera'], [D, 'Eli Turner'], [E, 'Grace Nolan']] as const) {
        await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version,active) VALUES(?,?,?,?,?,?,?,?,1)")
            .bind(id, TEST_ORG, name.replace(/ /g, '').toLowerCase(), name, 'Student', 'Student', 'x', 'v1').run();
    }
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,data) VALUES('season',?,?,?)")
        .bind(SEASON, TEST_ORG, JSON.stringify({ id: SEASON, organizationId: TEST_ORG, name: 'Daniel', yearLabel: '2026', status: 'Active', ruleProfileKey: 'PBE_STYLE_V1', ruleProfileVersion: 1, startDate: null, targetCompetitionDate: null, createdAtUtc: '2026-09-01T12:00:00Z' })).run();
    // Board membership: A–D are assigned in the season; E is not.
    for (const id of [A, B, C, D]) await seedAssignment(id, SEASON);
    await seedPreferences(A, true);
    await seedPreferences(B, true);
    await seedPreferences(C, true);
    await seedPreferences(D, false);
    await seedPreferences(E, true);
    await seedXp(A, { xpBySeason: { [SEASON]: 845 }, xpByDay: { [dayInWeek(0)]: 100, [dayInWeek(2)]: 110 }, totalXp: 1000 });
    await seedXp(B, { xpBySeason: { [SEASON]: 650 }, xpByDay: { [dayInWeek(1)]: 165 }, totalXp: 620 });
    await seedXp(C, { xpBySeason: { [SEASON]: 612 }, xpByDay: { [dayInWeek(0)]: 150 }, totalXp: 612 });
    await seedXp(D, { xpBySeason: { [SEASON]: 900 }, xpByDay: {}, totalXp: 900 });
    await seedXp(E, { xpBySeason: { [SEASON]: 5000 }, xpByDay: { [dayInWeek(0)]: 400 }, totalXp: 5000 });
    // Maya (A) has a selected profile character; nobody else set one.
    await seedCharacter(A);
    // Streaks: A practiced today and the three days before (4-day streak); C today + yesterday (2).
    for (const n of [0, 1, 2, 3]) await seedDay(A, isoDay(n));
    for (const n of [0, 1]) await seedDay(C, isoDay(n));
});

it('ranks season members by season XP with masked names for students', async () => {
    const board = await seasonLeaderboard(ctxFor(C), SEASON, url);
    expect(board).toMatchObject({ seasonId: SEASON, seasonName: 'Daniel', seasonStatus: 'Active', weekStartLocalDate: WEEK });
    // D is not opted in and E is not assigned in the season: neither appears.
    expect(board.entries.map(e => e.userId)).toEqual([A, B, C]);
    expect(board.entries.map(e => e.displayName)).toEqual(['Maya R.', 'Jonah K.', 'Sam R.']);
    expect(board.entries[0]).toMatchObject({ seasonXp: 845, xp: 845, weekXp: 210, streak: 4, level: 5, levelName: 'Scribe' });
    expect(board.entries[1]).toMatchObject({ seasonXp: 650, weekXp: 165, streak: 0, level: 4, levelName: 'Keeper' });
    expect(board.entries[2]).toMatchObject({ seasonXp: 612, weekXp: 150, streak: 2 });
});

it('reports the viewer standing for the pinned card', async () => {
    const board = await seasonLeaderboard(ctxFor(C), SEASON, url);
    expect(board.me).toMatchObject({
        userId: C, optedIn: true, seasonXp: 612, weekXp: 150, streak: 2,
        totalXp: 612, level: 4, levelName: 'Keeper', nextLevelName: 'Scribe', xpIntoLevel: 112, xpForNext: 288,
    });
});

it('keeps a non-opted-in member off the student board but reports their standing', async () => {
    const board = await seasonLeaderboard(ctxFor(D), SEASON, url);
    expect(board.entries.map(e => e.userId)).toEqual([A, B, C]);
    expect(board.me).toMatchObject({ userId: D, optedIn: false, seasonXp: 900 });
});

it('gives coaches every season member with full names, including non-opted-in students', async () => {
    const board = await seasonLeaderboard(ctxFor(COACH, 'Adult', 'Coach Carter'), SEASON, url);
    expect(board.me).toBeNull();
    expect(board.entries.map(e => e.userId)).toEqual([D, A, B, C]);
    expect(board.entries.map(e => e.displayName)).toEqual(['Eli Turner', 'Maya Reed', 'Jonah Kim', 'Sam Rivera']);
    // E is still excluded: she is not assigned in this season.
    expect(board.entries.some(e => e.userId === E)).toBe(false);
});

it('rejects an unknown season', async () => {
    await expect(seasonLeaderboard(ctxFor(C), '99999999-9999-4999-8999-999999999999', url)).rejects.toMatchObject({ status: 404 });
});

it('carries each member’s selected profile image, with the initials default when none is set', async () => {
    const board = await seasonLeaderboard(ctxFor(C), SEASON, url);
    // Head appearance only — no attire/background/slots leave the server.
    expect(board.entries[0].avatar).toEqual({ avatarKind: 'character', avatarHonorKey: null, character: { bodyType: 'female', style: 'braids', hairColor: 'black', skin: 'deep', eyes: 'hazel' } });
    expect(board.entries[1].avatar).toEqual({ avatarKind: 'initials', avatarHonorKey: null, character: null });
    expect(board.entries[2].avatar).toEqual({ avatarKind: 'initials', avatarHonorKey: null, character: null });
    // The viewer's pinned card gets the same treatment (C set nothing).
    expect(board.me?.avatar).toEqual({ avatarKind: 'initials', avatarHonorKey: null, character: null });
});
