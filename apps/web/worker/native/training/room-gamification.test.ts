// @vitest-environment node
import { Store } from '../store';
import type { Env } from '../types';
import { createNativeTestApp, TEST_ORG } from '../test-runtime';
import type { RoomHistorySummary } from '../practice/room-history';
import type { Member, Submission } from '../practice/state';
import { applyRoomCompletionGamification } from './room-gamification';
import type { XpRecord } from './xp';
import type { DayRecord, PreferenceRecord, WeekRecord } from './store';
import { beforeAll, expect, it } from 'vitest';

let app: Awaited<ReturnType<typeof createNativeTestApp>>;
const env = () => ({ DB: app.db } as unknown as Env);
const store = () => new Store(app.db as unknown as Env['DB']);

const S1 = '33333333-3333-4333-8333-333333333333';
const S2 = '44444444-4444-4433-8444-444444444444';
const S3 = '55555555-5555-4533-8555-555555555555';
const SEASON = 'season-1';
const COMPLETED_AT = '2026-09-17T20:00:00Z'; // UTC local date 2026-09-17 (Thursday)
const LOCAL_DATE = '2026-09-17';
const WEEK_START = '2026-09-14'; // Monday of that week

const member = (userId: string, team = 1): Member =>
    ({ userId, displayName: userId.slice(0, 8), team, ready: true, captain: false, scribe: true });
const sub = (scribeId: string, questionId: string, deadlineDraft = false): Submission =>
    ({ questionId, team: 1, scribeId, answers: ['a'], elapsedMs: 1000, deadlineDraft, accuracyHundredths: 9000, speedHundredths: 100, appealed: false, resolved: true });

function room(id: string, overrides: Partial<RoomHistorySummary> = {}): RoomHistorySummary {
    return {
        summaryVersion: 1, id, orgId: TEST_ORG, seasonId: SEASON, revision: 1,
        format: 'Pbe', status: 'Completed', teamCount: 1, teamSize: 3, questionCount: 3,
        coached: false, bookKey: 'GEN', rules: {}, completedAt: COMPLETED_AT,
        members: [member(S1), member(S2)], contributions: [], simulation: undefined,
        services: [{ id: 'svc-1', questionId: 'q1', questionKind: 'Recall', targetIds: [], memberIds: [S1], atMs: 1 }],
        questions: [
            { id: 'q1', version: 1, sourceUnitId: 'u1', parts: [{ points: 10 }] },
            { id: 'q2', version: 1, sourceUnitId: 'u2', parts: [{ points: 10 }] },
            { id: 'q3', version: 1, sourceUnitId: 'u3', parts: [{ points: 10 }] },
        ],
        submissions: [
            sub(S1, 'q1'), sub(S1, 'q2'), sub(S1, 'q1'), // duplicate q1: 2 distinct
            sub(S1, 'q3', true), // deadline draft: not scored
        ],
        ...overrides,
    };
}

async function apply(id: RoomHistorySummary, review: boolean) {
    const res = await applyRoomCompletionGamification(env(), id, review);
    if (res.statements.length) await app.db.batch(res.statements);
    await res.postBatch();
    return res;
}

const xpOf = (userId: string) => store().get<XpRecord>('training-xp', `${TEST_ORG}:${userId}`, TEST_ORG);
const dayOf = (userId: string) => store().get<DayRecord>('training-day', `${TEST_ORG}:${userId}:${LOCAL_DATE}`, TEST_ORG);
const prefsOf = (userId: string) => store().get<PreferenceRecord>('training-preferences', `${TEST_ORG}:${userId}`, TEST_ORG);
const weekOf = (userId: string) => store().get<WeekRecord>('training-week', `${TEST_ORG}:${userId}:${WEEK_START}`, TEST_ORG);
const participationOf = (roomId: string, userId: string) =>
    app.db.prepare(`SELECT data FROM Records WHERE kind='room-participation' AND id=? AND org_id=?`)
        .bind(`${roomId}:${userId}`, TEST_ORG).first<{ data: string }>();

beforeAll(async () => {
    app = await createNativeTestApp();
    for (const [id, name] of [[S1, 's1'], [S2, 's2'], [S3, 's3']] as const)
        await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) VALUES(?,?,?,?,?,?,?,?)")
            .bind(id, TEST_ORG, name, name, 'Student', 'Student', 'x', 'v1').run();
});

it('skips everything on review=true and on non-Completed status', async () => {
    const r1 = await applyRoomCompletionGamification(env(), room('room-skip-review'), true);
    expect(r1.statements).toEqual([]);
    await r1.postBatch();
    const r2 = await applyRoomCompletionGamification(env(), room('room-skip-status', { status: 'Interrupted' }), false);
    expect(r2.statements).toEqual([]);
    await r2.postBatch();
    expect(await xpOf(S1)).toBeNull();
    expect(await dayOf(S1)).toBeNull();
    expect(await participationOf('room-skip-review', S1)).toBeNull();
    expect(await participationOf('room-skip-status', S1)).toBeNull();
});

it('awards XP per distinct question, credits a day, and ignores lurkers', async () => {
    await apply(room('room-1'), false);

    // S1 answered q1 + q2 as scribe (q1 duplicate deduped, q3 was a deadline draft):
    // 2 distinct questions × 2 XP = 4 attempt XP, +50 day credit, no quest XP
    // (teammate is ineligible with no open rooms in the fixture DB).
    const xp = (await xpOf(S1))!.value;
    expect(xp.attemptXpByDay[LOCAL_DATE]).toBe(4);
    expect(xp.totalXp).toBe(54);
    expect(xp.xpByDay[LOCAL_DATE]).toBe(54);

    const day = (await dayOf(S1))!.value;
    expect(day).toMatchObject({ localDate: LOCAL_DATE, sessionId: 'room:room-1', credited: true });

    const week = (await weekOf(S1))!.value;
    expect(week.creditedDates).toContain(LOCAL_DATE);
    expect(week.weekStartLocalDate).toBe(WEEK_START);

    const prefs = (await prefsOf(S1))!.value;
    expect(prefs.lastEventAtUtc).toBe(COMPLETED_AT);

    const part = JSON.parse((await participationOf('room-1', S1))!.data);
    expect(part).toMatchObject({
        roomId: 'room-1', userId: S1, seasonId: SEASON, format: 'Pbe', simulation: false,
        questionsAnswered: 2, xpAwarded: 54, dayCredited: true, questsCompleted: [],
    });

    // S2 never scribed and is in no services entry: a lurker, gets nothing.
    expect(await xpOf(S2)).toBeNull();
    expect(await dayOf(S2)).toBeNull();
    expect(await prefsOf(S2)).toBeNull();
    expect(await participationOf('room-1', S2)).toBeNull();
});

it('treats services entries as participation without scribe submissions', async () => {
    const r = room('room-2', {
        members: [member(S3)],
        submissions: [],
        services: [{ id: 'svc-2', questionId: 'q1', questionKind: 'Recall', targetIds: [], memberIds: [S3], atMs: 1 }],
    });
    await apply(r, false);

    const xp = (await xpOf(S3))!.value;
    expect(xp.attemptXpByDay[LOCAL_DATE] ?? 0).toBe(0);
    expect(xp.totalXp).toBe(50); // day credit only
    const day = (await dayOf(S3))!.value;
    expect(day.sessionId).toBe('room:room-2');
    const part = JSON.parse((await participationOf('room-2', S3))!.data);
    expect(part.questionsAnswered).toBe(0);
    expect(part.dayCredited).toBe(true);
});

it('is idempotent on re-publication: the second call awards nothing new', async () => {
    const before = (await xpOf(S1))!.value.totalXp;
    const res = await applyRoomCompletionGamification(env(), room('room-1'), false);
    expect(res.statements).toEqual([]);
    await res.postBatch();
    expect((await xpOf(S1))!.value.totalXp).toBe(before);
    const rows = await app.db.prepare(`SELECT id FROM Records WHERE kind='room-participation' AND id LIKE 'room-1:%' AND org_id=?`)
        .bind(TEST_ORG).all<{ id: string }>();
    expect(rows.results).toHaveLength(1);
    const days = await app.db.prepare(`SELECT id FROM Records WHERE kind='training-day' AND org_id=? AND owner_id=?`)
        .bind(TEST_ORG, S1).all<{ id: string }>();
    expect(days.results).toHaveLength(1);
});

it('does not credit a second day when another room completes the same local day', async () => {
    // room-3 has the same completedAt date as room-1: S1 already has day credit.
    const r = room('room-3', { submissions: [sub(S1, 'q1')] });
    await apply(r, false);
    const xp = (await xpOf(S1))!.value;
    expect(xp.totalXp).toBe(54 + 2); // +2 attempt XP, no second day credit
    expect(xp.attemptXpByDay[LOCAL_DATE]).toBe(6);
    const part = JSON.parse((await participationOf('room-3', S1))!.data);
    expect(part.dayCredited).toBe(false);
    expect(part.xpAwarded).toBe(2);
    const days = await app.db.prepare(`SELECT id FROM Records WHERE kind='training-day' AND org_id=? AND owner_id=?`)
        .bind(TEST_ORG, S1).all<{ id: string }>();
    expect(days.results).toHaveLength(1);
});

it('awards profile-Honor XP only for honors newly created by the publication', async () => {
    const honor = (id: string, owner: string) =>
        app.db.prepare(`INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) VALUES('mastery-honor',?,?,?,?,?,1)`)
            .bind(id, TEST_ORG, SEASON, owner, JSON.stringify({ id, userId: owner })).run();
    // Pre-existing honor: must not award XP again.
    await honor(`${TEST_ORG}:${S1}:mastery-v1:team:first-fellowship`, S1);

    const res = await applyRoomCompletionGamification(env(), room('room-4', { submissions: [sub(S1, 'q1')] }), false);
    // Simulate the publication's own honor inserts landing before postBatch.
    await honor(`${TEST_ORG}:${S1}:mastery-v1:team:team-steady`, S1);
    await honor(`${TEST_ORG}:${S2}:simulation-v1:simulation:first-rehearsal`, S2);
    await app.db.batch(res.statements);
    await res.postBatch();

    const s1 = (await xpOf(S1))!.value;
    expect(s1.totalXp).toBe(56 + 2 + 150); // prior total + attempt XP + exactly one new honor
    const s2 = (await xpOf(S2))!.value;
    expect(s2.totalXp).toBe(150); // simulation honor for a lurker still pays its owner
    expect(s2.xpByDay[LOCAL_DATE]).toBe(150);
});
