import { Store } from '../store';
import type { Env, RequestContext } from '../types';
import { atomic } from '../application/model';
import { createNativeTestApp, TEST_ORG } from '../test-runtime';
import { awardXp, levelForXp, levelNameFor, XP_VALUES } from './xp';
import { generateDailyQuests, progressQuests, questDto, sessionCompleteQuests, type QuestKey, type QuestState } from './quests';
import { engagementOverview, studentExportCsv, studentSessionHistory } from '../application/engagement';
import type { Writes } from './store';
// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';

let app: Awaited<ReturnType<typeof createNativeTestApp>>;
const STUDENT = '22222222-2222-4222-8222-222222222222';
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
    expect(questDto(state)).toEqual({ key: 'warmup', title: 'Warm-up', description: 'd', target: 1, progress: 0, completed: false });
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
    const xpEvents = await sessionCompleteQuests(ctx, w,
        { localDate, timeZone: 'America/New_York', atUtc: `${localDate}T12:00:00Z` },
        { mode: 'Practice', accuracy: 95, fullTargetReached: true });
    await atomic(ctx, 'gamification.test', w.statements, w.guards);
    // Two quest completions; the third quest was not landed, so no triple bonus.
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
