import { Store } from '../store';
import type { Env, RequestContext } from '../types';
import { atomic } from '../application/model';
import { createNativeTestApp, TEST_ORG } from '../test-runtime';
import { awardXp, levelForXp, levelNameFor, XP_VALUES } from './xp';
import { generateDailyQuests, progressQuests, questDto, sessionCompleteQuests, questEligibility, inTeamRoom, QUEST_DEFS, type QuestKey, type QuestState } from './quests';
import { makeRecap } from './store';
import type { Session } from '../study/routes';
import { engagementOverview, studentExportCsv, studentSessionHistory } from '../application/engagement';
import { identity, preference, resolvePreference } from './store';
import { resolveTrainingCalendar } from './calendar';
import { trainingNow } from './clock';
import type { Writes } from './store';
// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';

let app: Awaited<ReturnType<typeof createNativeTestApp>>;
const STUDENT = '22222222-2222-4222-8222-222222222222';
const QUEST_STUDENT = '33333333-3333-4333-8333-333333333333';
const ELIGIBLE: QuestKey[] = ['sharpshooter', 'explorer', 'comeback', 'marathon'];

function studentCtx(userId: string): RequestContext {
    return {
        env: { DB: app.db } as Env, store: new Store(app.db as unknown as Env['DB']), orgId: TEST_ORG,
        actor: { userId, organizationId: TEST_ORG, displayName: 'Student', userName: 'student', email: null, kind: 'Student', role: 'Student', credentialVersion: 'v1' },
        path: '', request: new Request('https://erudoza.test'),
    };
}

const newWrites = (): Writes => ({ statements: [], guards: [] });

beforeAll(async () => {
    app = await createNativeTestApp();
    await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) VALUES(?,?,?,?,?,?,?,?)")
        .bind(STUDENT, TEST_ORG, 'xpstudent', 'XP Student', 'Student', 'Student', 'x', 'v1').run();
    await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) VALUES(?,?,?,?,?,?,?,?)")
        .bind(QUEST_STUDENT, TEST_ORG, 'queststudent', 'Quest Student', 'Student', 'Student', 'x', 'v1').run();
});

it('maps XP totals to the eight named levels', () => {
    expect(levelForXp(0)).toMatchObject({ level: 1, levelName: 'Seedling' });
    expect(levelForXp(99).level).toBe(1);
    expect(levelForXp(100)).toMatchObject({ level: 2, levelName: 'Seeker' });
    expect(levelForXp(250)).toMatchObject({ level: 3, levelName: 'Reader' });
    expect(levelForXp(500)).toMatchObject({ level: 4, levelName: 'Keeper' });
    expect(levelForXp(900)).toMatchObject({ level: 5, levelName: 'Scribe' });
    expect(levelForXp(1400)).toMatchObject({ level: 6, levelName: 'Scholar' });
    expect(levelForXp(2000)).toMatchObject({ level: 7, levelName: 'Guide' });
    expect(levelForXp(2800)).toMatchObject({ level: 8, levelName: 'Torchbearer' });
    expect(levelForXp(100000).level).toBe(8);
    expect(levelNameFor(3)).toBe('Reader');
});

it('awards XP, detects level-ups and caps attempt XP per day', async () => {
    const ctx = studentCtx(STUDENT);
    const w1 = newWrites();
    const r1 = await awardXp(ctx, w1, { localDate: '2026-09-17', atUtc: '2026-09-17T12:00:00Z', events: [{ kind: 'attempt', amount: XP_VALUES.attemptCorrectNoHints }] });
    await atomic(ctx, 'gamification.test', w1.statements, w1.guards);
    expect(r1).toEqual({ awarded: 10, leveledUp: null });

    // 100 more XP crosses the 100 XP Seeker threshold (10 + 50 + 25 + 25 = 110).
    const w2 = newWrites();
    const r2 = await awardXp(ctx, w2, { localDate: '2026-09-17', atUtc: '2026-09-17T13:00:00Z', seasonId: 's1', events: [{ kind: 'day', amount: XP_VALUES.dayCredited }, { kind: 'quest', amount: XP_VALUES.questCompleted }, { kind: 'quest', amount: XP_VALUES.questCompleted }] });
    await atomic(ctx, 'gamification.test', w2.statements, w2.guards);
    expect(r2.awarded).toBe(100);
    expect(r2.leveledUp).toEqual({ from: 1, to: 2 });

    // Attempt XP is capped at 300 per local day; the cap resets the next day.
    const w3 = newWrites();
    const r3 = await awardXp(ctx, w3, { localDate: '2026-09-17', atUtc: '2026-09-17T14:00:00Z', events: Array.from({ length: 40 }, () => ({ kind: 'attempt' as const, amount: 10 })) });
    await atomic(ctx, 'gamification.test', w3.statements, w3.guards);
    expect(r3.awarded).toBe(290); // 10 already banked today, 300 cap
    const w4 = newWrites();
    const r4 = await awardXp(ctx, w4, { localDate: '2026-09-18', atUtc: '2026-09-18T12:00:00Z', events: [{ kind: 'attempt', amount: 10 }] });
    await atomic(ctx, 'gamification.test', w4.statements, w4.guards);
    expect(r4.awarded).toBe(10);
});

it('generates a deterministic daily quest set', () => {
    const a = generateDailyQuests(STUDENT, '2026-09-17', ELIGIBLE).map(q => q.key);
    const b = generateDailyQuests(STUDENT, '2026-09-17', ELIGIBLE).map(q => q.key);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
    // Quests rotate across days.
    const sets = new Set<string>();
    for (let d = 1; d <= 10; d++) sets.add(generateDailyQuests(STUDENT, `2026-09-${String(d).padStart(2, '0')}`, ELIGIBLE).map(q => q.key).join(','));
    expect(sets.size).toBeGreaterThan(1);
    // questDto carries progress state for the client.
    const state: QuestState = { key: 'warmup', title: 'Warm-up', description: 'd', target: 1, progress: 0, completed: false, xpAwarded: false };
    expect(questDto(state)).toEqual({ key: 'warmup', title: 'Warm-up', description: 'd', target: 1, progress: 0, completed: false, xpReward: XP_VALUES.questCompleted });
});

it('completes sharpshooter + marathon at session completion, with the triple bonus', async () => {
    const ctx = studentCtx(STUDENT);
    // Find a date whose deterministic set includes both session-complete quests.
    let localDate = '2026-09-17';
    for (let d = 1; d <= 31; d++) {
        const candidate = `2026-08-${String(d).padStart(2, '0')}`;
        const keys = generateDailyQuests(STUDENT, candidate, ELIGIBLE).map(q => q.key);
        if (keys.includes('sharpshooter') && keys.includes('marathon')) { localDate = candidate; break; }
    }
    const keys = generateDailyQuests(STUDENT, localDate, ELIGIBLE).map(q => q.key);
    expect(keys).toContain('sharpshooter');
    expect(keys).toContain('marathon');
    const w = newWrites();
    const { xpEvents, completedNow } = await sessionCompleteQuests(ctx, w,
        { localDate, timeZone: 'America/New_York', atUtc: `${localDate}T12:00:00Z` },
        { mode: 'Practice', accuracy: 95, fullTargetReached: true });
    await atomic(ctx, 'gamification.test', w.statements, w.guards);
    // Two quest completions; the third quest was not landed, so no triple bonus.
    expect(new Set(completedNow)).toEqual(new Set(['sharpshooter', 'marathon']));
    const questXp = xpEvents.filter(e => e.kind === 'quest').reduce((n, e) => n + e.amount, 0);
    expect(questXp).toBe(XP_VALUES.questCompleted * 2);
    const rows = await app.db.prepare("SELECT data FROM Records WHERE kind='training-quest' AND org_id=? AND owner_id=?").bind(TEST_ORG, STUDENT).all<{ data: string }>();
    expect(rows.results.length).toBeGreaterThan(0);
    const rec = JSON.parse(rows.results[0].data) as { quests: QuestState[]; tripleAwarded: boolean };
    expect(rec.quests.filter(q => q.completed)).toHaveLength(2);
    expect(rec.tripleAwarded).toBe(false);
});

it('awards the triple bonus when all three daily quests land', async () => {
    const ctx = studentCtx(STUDENT);
    const w = newWrites();
    const res = await progressQuests(ctx, w,
        { localDate: '2026-09-18', timeZone: 'America/New_York', atUtc: '2026-09-18T12:00:00Z' },
        api => { for (const q of api.quests) api.complete(q.key); });
    await atomic(ctx, 'gamification.test', w.statements, w.guards);
    expect(res.completedNow).toHaveLength(3);
    expect(res.tripleBonus).toBe(true);
    const questXp = res.xpEvents.reduce((n, e) => n + e.amount, 0);
    expect(questXp).toBe(XP_VALUES.questCompleted * 3 + XP_VALUES.dailyTripleBonus);
    // Retries cannot award quest XP twice.
    const w2 = newWrites();
    const retry = await progressQuests(ctx, w2,
        { localDate: '2026-09-18', timeZone: 'America/New_York', atUtc: '2026-09-18T13:00:00Z' },
        api => { for (const q of api.quests) api.complete(q.key); });
    expect(retry.xpEvents).toHaveLength(0);
    expect(retry.tripleBonus).toBe(false);
});

it('builds the coach engagement overview from student records', async () => {
    const ctx = studentCtx(STUDENT);
    const w = newWrites();
    await awardXp(ctx, w, { localDate: '2026-09-17', atUtc: '2026-09-17T12:00:00Z', events: [{ kind: 'day', amount: XP_VALUES.dayCredited }] });
    await atomic(ctx, 'gamification.test', w.statements, w.guards);
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('training-day',?,?,?,?)")
        .bind(`${TEST_ORG}:${STUDENT}:2026-09-17`, TEST_ORG, STUDENT, JSON.stringify({ id: `${TEST_ORG}:${STUDENT}:2026-09-17`, localDate: '2026-09-17', timeZone: 'America/New_York', firstQualifiedAtUtc: '2026-09-17T12:00:00Z', sessionId: 's', credited: true })).run();
    const coach: RequestContext = { ...ctx, actor: { ...ctx.actor, userId: 'coach', kind: 'Adult', role: 'Owner' } };
    const rows = await engagementOverview(coach);
    const row = rows.find(r => r.studentId === STUDENT)!;
    expect(row.name).toBe('XP Student');
    expect(row.xpThisWeek).toBeGreaterThan(0);
    expect(row.level).toBeGreaterThanOrEqual(1);
    expect(row.levelName).toBeTruthy();
});

it('paginates session history and exports CSV', async () => {
    const training = { missionId: null, missionRevision: null, missionLocalDate: null, timeZone: 'UTC', reviewKnowledgeUnitIds: [], creditedLocalDate: null, newlyCreditedDay: false, earnedBadges: [] };
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('session',?,?,?,?)")
        .bind('sess-1', TEST_ORG, STUDENT, JSON.stringify({ id: 'sess-1', studentUserId: STUDENT, seasonId: 's', mode: 'Practice', status: 'Completed', createdAtUtc: '2026-09-16T10:00:00Z', completedAtUtc: '2026-09-16T10:30:00Z', attempts: [], training: { ...training, xpEarned: 42 } })).run();
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('session',?,?,?,?)")
        .bind('sess-2', TEST_ORG, STUDENT, JSON.stringify({ id: 'sess-2', studentUserId: STUDENT, seasonId: 's', mode: 'Review', status: 'Completed', createdAtUtc: '2026-09-17T10:00:00Z', completedAtUtc: '2026-09-17T10:30:00Z', attempts: [], training: { ...training, xpEarned: 58 } })).run();
    const ctx = studentCtx(STUDENT);
    const page1 = await studentSessionHistory(ctx, STUDENT, undefined, 1);
    expect(page1.sessions).toHaveLength(1);
    expect(page1.sessions[0].sessionId).toBe('sess-2'); // newest first
    expect(page1.sessions[0].xpEarned).toBe(58);
    expect(page1.nextBefore).toBe('2026-09-17T10:30:00Z');
    const page2 = await studentSessionHistory(ctx, STUDENT, page1.nextBefore!, 1);
    expect(page2.sessions[0].sessionId).toBe('sess-1');
    expect(page2.nextBefore).toBeNull();
    const csv = await studentExportCsv(ctx, STUDENT);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('date,type,mode,correct,attempted,xp,streak_day,honor_earned');
    expect(lines.some(l => l.includes('session') && l.includes('58'))).toBe(true);
    expect(lines.some(l => l.includes('credited_day'))).toBe(true);
});

it('reports this-week quest completions on the engagement overview', async () => {
    // A dedicated student keeps this deterministic: other tests write quest
    // records for STUDENT that may fall in the same calendar week.
    const ctx = studentCtx(QUEST_STUDENT);
    const pref = await preference(ctx);
    const resolved = resolvePreference(ctx, pref, trainingNow());
    const calendar = resolveTrainingCalendar(trainingNow(), resolved);
    const id = identity(ctx, calendar.weekStartLocalDate);
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('training-quest',?,?,?,?)")
        .bind(id, TEST_ORG, QUEST_STUDENT, JSON.stringify({
            id, localDate: calendar.weekStartLocalDate, timeZone: 'UTC',
            quests: [
                { key: 'warmup', title: 'Warm-up', description: 'd', target: 1, progress: 1, completed: true, xpAwarded: true },
                { key: 'marathon', title: 'Marathon', description: 'd', target: 1, progress: 1, completed: true, xpAwarded: true },
                { key: 'sharpshooter', title: 'Sharpshooter', description: 'd', target: 1, progress: 0, completed: false, xpAwarded: false },
            ],
            tripleAwarded: false,
        })).run();
    const coach: RequestContext = { ...ctx, actor: { ...ctx.actor, userId: 'coach', kind: 'Adult', role: 'Owner' } };
    const rows = await engagementOverview(coach);
    const row = rows.find(r => r.studentId === QUEST_STUDENT)!;
    expect(row.quests).toMatchObject({ completedThisWeek: 2, totalThisWeek: 3 });
    expect(row.quests.rate).toBeCloseTo(2 / 3, 5);
});

it('includes completed team rooms in session history, paginated with solo sessions', async () => {
    const member = (userId: string) => ({ userId, displayName: 'XP Student', team: 1, ready: true, captain: false, scribe: true });
    const submission = (questionId: string, scribeId: string, deadlineDraft: boolean) =>
        ({ questionId, team: 1, scribeId, answers: ['a'], elapsedMs: 1200, deadlineDraft, accuracyHundredths: 10000, speedHundredths: 8000, appealed: false, resolved: true, appealReason: '' });
    // room-1: legacy raw-Room match record, completed, with a participation record.
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,data,revision) VALUES('match',?,?,?,?,1)")
        .bind('room-1', TEST_ORG, 's', JSON.stringify({
            id: 'room-1', status: 'Completed', format: 'Arcade', completedAt: '2026-09-15T12:00:00Z',
            members: [member(STUDENT)],
            submissions: [
                submission('q1', STUDENT, false), submission('q2', STUDENT, false),
                submission('q1', STUDENT, false), // duplicate question: distinct stays 2
                submission('q3', 'other-user', false),
                submission('q4', STUDENT, true), // draft: not participation
            ],
        })).run();
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) VALUES('room-participation',?,?,?,?,?)")
        .bind(`room-1:${STUDENT}`, TEST_ORG, 's', STUDENT, JSON.stringify({
            roomId: 'room-1', userId: STUDENT, seasonId: 's', format: 'Arcade', simulation: null,
            completedAtUtc: '2026-09-15T12:00:00Z', questionsAnswered: 3, xpAwarded: 40, dayCredited: true, questsCompleted: [],
        })).run();
    // room-2: new storage-envelope PBE match record, no participation record.
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,data,revision) VALUES('match',?,?,?,?,1)")
        .bind('room-2', TEST_ORG, 's', JSON.stringify({
            format: 'erudoza.practice-room/1', manifest: {},
            summary: {
                summaryVersion: 1, id: 'room-2', orgId: TEST_ORG, seasonId: 's', revision: 3,
                format: 'Pbe', status: 'Completed', teamCount: 2, teamSize: 3, questionCount: 1,
                coached: false, bookKey: null, rules: null, completedAt: '2026-09-14T12:00:00Z',
                members: [member(STUDENT)], contributions: [], simulation: null, services: [],
                questions: [], submissions: [submission('pq1', STUDENT, false)],
            },
        })).run();
    // room-3: not completed — excluded. room-4: completed, student not a member — excluded.
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,data,revision) VALUES('match',?,?,?,?,1)")
        .bind('room-3', TEST_ORG, 's', JSON.stringify({ id: 'room-3', status: 'Playing', format: 'Arcade', completedAt: null, members: [member(STUDENT)], submissions: [] })).run();
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,data,revision) VALUES('match',?,?,?,?,1)")
        .bind('room-4', TEST_ORG, 's', JSON.stringify({ id: 'room-4', status: 'Completed', format: 'Arcade', completedAt: '2026-09-13T12:00:00Z', members: [member('other-user')], submissions: [] })).run();

    const ctx = studentCtx(STUDENT);
    const history = await studentSessionHistory(ctx, STUDENT);
    // Newest first across solo + room entries: sess-2, sess-1, room-1, room-2.
    expect(history.sessions.map(e => e.sessionId)).toEqual(['sess-2', 'sess-1', 'room-1', 'room-2']);
    const rooms = history.sessions.filter(e => e.format === 'Room');
    expect(rooms).toHaveLength(2);
    // Participation record wins over derived submissions.
    expect(rooms[0]).toMatchObject({
        sessionId: 'room-1', format: 'Room', roomId: 'room-1', teamFormat: 'Arcade',
        mode: 'Team Arcade', completedAtUtc: '2026-09-15T12:00:00Z',
        attempted: 3, correct: null, xpEarned: 40,
    });
    // No participation record: participation derived from match JSON, XP 0.
    expect(rooms[1]).toMatchObject({
        sessionId: 'room-2', format: 'Room', roomId: 'room-2', teamFormat: 'Pbe',
        mode: 'Team PBE', completedAtUtc: '2026-09-14T12:00:00Z',
        attempted: 1, correct: null, xpEarned: 0,
    });
    // Pagination carries the merged list.
    const page1 = await studentSessionHistory(ctx, STUDENT, undefined, 2);
    expect(page1.sessions.map(e => e.sessionId)).toEqual(['sess-2', 'sess-1']);
    expect(page1.nextBefore).toBe('2026-09-16T10:30:00Z');
    const page2 = await studentSessionHistory(ctx, STUDENT, page1.nextBefore!, 2);
    expect(page2.sessions.map(e => e.sessionId)).toEqual(['room-1', 'room-2']);
    expect(page2.nextBefore).toBeNull();
});

it('exports completed rooms in the CSV with day credit from the room day record', async () => {
    // The room-completion hook credits the day with sessionId 'room:' + roomId.
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES('training-day',?,?,?,?)")
        .bind(`${TEST_ORG}:${STUDENT}:2026-09-15`, TEST_ORG, STUDENT, JSON.stringify({
            id: `${TEST_ORG}:${STUDENT}:2026-09-15`, localDate: '2026-09-15', timeZone: 'UTC',
            firstQualifiedAtUtc: '2026-09-15T13:00:00Z', sessionId: 'room:room-1', credited: true,
        })).run();
    const ctx = studentCtx(STUDENT);
    const csv = await studentExportCsv(ctx, STUDENT);
    const roomLines = csv.trim().split('\n').filter(l => l.includes('team_room'));
    expect(roomLines).toHaveLength(2);
    const arcade = roomLines.find(l => l.includes('Team Arcade'))!;
    expect(arcade.startsWith('"2026-09-15"')).toBe(true);
    expect(arcade).toContain('"3"'); // attempted from the participation record
    expect(arcade).toContain('"40"'); // xp from the participation record
    expect(arcade).toContain('"true",""'); // streak_day from the room:room-1 day record
    const pbe = roomLines.find(l => l.includes('Team PBE'))!;
    expect(pbe.startsWith('"2026-09-14"')).toBe(true);
    expect(pbe).toContain('"1"');
    expect(pbe).toContain('"0"');
});

it('inTeamRoom only counts active or recently completed rooms', async () => {
    const user = '77777777-7777-4777-8777-777777777777';
    await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) VALUES(?,?,?,?,?,?,?,?)")
        .bind(user, TEST_ORG, 'roomstudent', 'Room Student', 'Student', 'Student', 'x', 'v1').run();
    const ctx = studentCtx(user);
    const roomRow = (id: string, status: string, memberIds: string[]) =>
        app.db.prepare("INSERT INTO Records(kind,id,org_id,data,revision) VALUES('room',?,?,?,1)")
            .bind(id, TEST_ORG, JSON.stringify({ id, status, memberIds, memberCount: memberIds.length, teamSize: 4, teamCount: 2 })).run();
    const matchRow = (id: string, envelope: boolean, status: string, completedAt: string, members: string[]) => {
        const inner = { id, status, completedAt, members: members.map(userId => ({ userId, displayName: 'S', team: 1, ready: true, captain: false, scribe: false })) };
        const data = envelope
            ? { format: 'erudoza.practice-room/1', manifest: { format: 'erudoza.practice-room/1', id, orgId: TEST_ORG, seasonId: 's', revision: 9 }, summary: { ...inner, summaryVersion: 1 } }
            : inner;
        return app.db.prepare("INSERT INTO Records(kind,id,org_id,data,revision) VALUES('match',?,?,?,1)").bind(id, TEST_ORG, JSON.stringify(data)).run();
    };
    const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
    // A room completed 30 days ago no longer counts…
    await matchRow('old-match', false, 'Completed', daysAgo(30), [user]);
    // …nor does a recently completed room the learner never joined…
    await matchRow('stranger-match', true, 'Completed', daysAgo(1), ['someone-else']);
    // …nor an interrupted one.
    await roomRow('interrupted-room', 'Interrupted', [user]);
    expect(await inTeamRoom(ctx)).toBe(false);
    // …but a lobby membership does.
    await roomRow('lobby-room', 'Lobby', [user]);
    expect(await inTeamRoom(ctx)).toBe(true);
    // Clean up: later tests must not see these rooms.
    for (const id of ['old-match', 'stranger-match']) await app.db.prepare("DELETE FROM Records WHERE kind='match' AND id=? AND org_id=?").bind(id, TEST_ORG).run();
    for (const id of ['interrupted-room', 'lobby-room']) await app.db.prepare("DELETE FROM Records WHERE kind='room' AND id=? AND org_id=?").bind(id, TEST_ORG).run();
});

it('inTeamRoom counts Playing membership and recent completions in both history shapes', async () => {
    const user = '88888888-8888-4888-8888-888888888888';
    await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) VALUES(?,?,?,?,?,?,?,?)")
        .bind(user, TEST_ORG, 'roomstudent2', 'Room Student 2', 'Student', 'Student', 'x', 'v1').run();
    const ctx = studentCtx(user);
    const member = [{ userId: user, displayName: 'S', team: 1, ready: true, captain: false, scribe: false }];
    const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
    // Playing membership via the live directory.
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,data,revision) VALUES('room',?,?,?,1)")
        .bind('playing-room', TEST_ORG, JSON.stringify({ id: 'playing-room', status: 'Playing', memberIds: [user], memberCount: 1, teamSize: 4, teamCount: 2 })).run();
    expect(await inTeamRoom(ctx)).toBe(true);
    await app.db.prepare("DELETE FROM Records WHERE kind='room' AND id='playing-room' AND org_id=?").bind(TEST_ORG).run();
    expect(await inTeamRoom(ctx)).toBe(false);
    // Recent completion in the legacy raw-Room shape.
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,data,revision) VALUES('match',?,?,?,1)")
        .bind('legacy-match', TEST_ORG, JSON.stringify({ id: 'legacy-match', status: 'Completed', completedAt: daysAgo(2), members: member })).run();
    expect(await inTeamRoom(ctx)).toBe(true);
    await app.db.prepare("DELETE FROM Records WHERE kind='match' AND id='legacy-match' AND org_id=?").bind(TEST_ORG).run();
    // Recent completion in the envelope shape.
    await app.db.prepare("INSERT INTO Records(kind,id,org_id,data,revision) VALUES('match',?,?,?,1)")
        .bind('envelope-match', TEST_ORG, JSON.stringify({ format: 'erudoza.practice-room/1', manifest: { format: 'erudoza.practice-room/1', id: 'envelope-match', orgId: TEST_ORG, seasonId: 's', revision: 3 }, summary: { summaryVersion: 1, id: 'envelope-match', status: 'Completed', completedAt: daysAgo(6), members: member } })).run();
    expect(await inTeamRoom(ctx)).toBe(true);
});

it('scopes teammate eligibility to rooms the learner can actually join', async () => {
    const user = '99999999-9999-4999-8999-999999999999';
    await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) VALUES(?,?,?,?,?,?,?,?)")
        .bind(user, TEST_ORG, 'eligstudent', 'Elig Student', 'Student', 'Student', 'x', 'v1').run();
    const ctx = studentCtx(user);
    const atUtc = '2026-09-17T12:00:00Z';
    const roomRow = (id: string, memberIds: string[]) =>
        app.db.prepare("INSERT INTO Records(kind,id,org_id,data,revision) VALUES('room',?,?,?,1)")
            .bind(id, TEST_ORG, JSON.stringify({ id, status: 'Lobby', memberIds, memberCount: memberIds.length, teamSize: 2, teamCount: 2 })).run();
    // A full Lobby room the learner is not in is not joinable.
    await roomRow('full-room', ['o1', 'o2', 'o3', 'o4']);
    expect((await questEligibility(ctx, atUtc)).roomsOpen).toBe(false);
    // A Lobby room with a free slot is joinable even for a non-member.
    await roomRow('open-room', ['o1']);
    expect((await questEligibility(ctx, atUtc)).roomsOpen).toBe(true);
    await app.db.prepare("DELETE FROM Records WHERE kind='room' AND id='open-room' AND org_id=?").bind(TEST_ORG).run();
    // A full Lobby room the learner already belongs to still counts.
    await roomRow('own-full-room', [user, 'o1', 'o2', 'o3']);
    expect((await questEligibility(ctx, atUtc)).roomsOpen).toBe(true);
    // Clean up: later tests must not see these rooms.
    for (const id of ['full-room', 'own-full-room']) await app.db.prepare("DELETE FROM Records WHERE kind='room' AND id=? AND org_id=?").bind(id, TEST_ORG).run();
});

it('carries completed quests through sessionCompleteQuests into the recap', async () => {
    const ctx = studentCtx(STUDENT);
    const base = {
        id: 'sess-quests', studentUserId: STUDENT, seasonId: 's1', status: 'Completed', mode: 'Practice',
        targetCardCount: 0, cards: [], attempts: [], createdAtUtc: '2026-09-17T10:00:00Z', completedAtUtc: '2026-09-17T10:30:00Z',
    };
    const training = { missionId: null, missionRevision: null, missionLocalDate: null, timeZone: 'UTC', reviewKnowledgeUnitIds: [], creditedLocalDate: null, newlyCreditedDay: false, earnedBadges: [] };
    const withQuests = await makeRecap(ctx, {
        ...base,
        training: { ...training, questsCompleted: [{ key: 'marathon' as QuestKey, title: QUEST_DEFS.marathon.title }] },
    } as unknown as Session);
    expect(withQuests.questsCompleted).toEqual([{ key: 'marathon', title: 'Marathon' }]);
    // Sessions completed before this change (or with no quests) default to [].
    const withoutQuests = await makeRecap(ctx, { ...base, training } as unknown as Session);
    expect(withoutQuests.questsCompleted).toEqual([]);
});
