// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { Store } from '../store';
import type { Env, RequestContext } from '../types';
import { atomic } from '../application/model';
import { createNativeTestApp, TEST_ORG } from '../test-runtime';
import { awardPbeSimulationAttemptXp, creditPbePracticeDay, pbeAttemptXp, preparePbeEffort, pbeQuestSignals, type PbeMission } from './effort';
import { preference, resolvePreference } from '../training/store';
import type { XpEvent, XpRecord } from '../training/xp';
import type { PbeAttempt, PbeCard, PbeSession } from './sessions';
import type { PbeQuestion } from './types';
import { QUEST_DEFS, type QuestRecord, type QuestState } from '../training/quests';

let app: Awaited<ReturnType<typeof createNativeTestApp>>;
const STUDENT = '66666666-6666-4666-8666-666666666666';

function studentCtx(userId: string): RequestContext {
    return {
        env: { DB: app.db } as Env, store: new Store(app.db as unknown as Env['DB']), orgId: TEST_ORG,
        actor: { userId, organizationId: TEST_ORG, displayName: 'Student', userName: 'student', email: null, kind: 'Student', role: 'Student', credentialVersion: 'v1' },
        path: '', request: new Request('https://erudoza.test'),
    };
}

const question = (id: string): PbeQuestion => ({
    schemaVersion: 2, id, version: 1, contentPackId: 'pack', sourceUnitId: 'src', sourceUnitIds: ['src'],
    sourceKind: 'Scripture', reference: 'GEN 1:1', evidence: 'e', kind: 'List', prompt: 'p', ordered: false,
    parts: [{ targetId: 't1', acceptedAnswers: ['a'], points: 2 }],
});
const card = (id: string, questionId: string): PbeCard => ({ id, question: question(questionId), targets: [], servedAtMs: 1, assistedAtMs: null });
const attempt = (id: string, cardId: string, earned: number, available = 2): PbeAttempt => ({
    id, cardId, clientSubmissionId: id, answers: [], hintsUsed: false, atMs: 1,
    result: { attemptId: id, earnedPoints: earned, availablePoints: available, expectedParts: [], sourceEvidence: '', citation: '', unaided: true, acceptedAtUtc: '2026-09-17T12:00:00Z', acceptedSequence: 1, alreadyProcessed: false },
});

beforeAll(async () => {
    app = await createNativeTestApp();
    await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) VALUES(?,?,?,?,?,?,?,?)")
        .bind(STUDENT, TEST_ORG, 'pbequeststudent', 'PBE Quest Student', 'Student', 'Student', 'x', 'v1').run();
});

it('computes explorer/comeback signals from session cards and attempts', () => {
    const cards = [card('c1', 'q1'), card('c2', 'q1'), card('c3', 'q1'), card('c4', 'q2')];
    const s = { cards, attempts: [] as PbeAttempt[] };
    // Fresh question (served 0 times before) → explorer.
    expect(pbeQuestSignals(s, attempt('a1', 'c1', 0)).explorerFresh).toBe(true);
    // Question served twice before in this session → not fresh.
    expect(pbeQuestSignals(s, attempt('a3', 'c3', 2)).explorerFresh).toBe(false);
    // Fully correct attempt repairing an earlier incorrect one on the same question.
    const withHistory = { cards, attempts: [attempt('a1', 'c1', 0)] };
    expect(pbeQuestSignals(withHistory, attempt('a2', 'c2', 2)).repairedQuestionId).toBe('q1');
    // Latest attempt incorrect → no repair.
    expect(pbeQuestSignals(withHistory, attempt('a2', 'c2', 0)).repairedQuestionId).toBeNull();
    // No earlier attempt on the question → no repair.
    expect(pbeQuestSignals({ cards, attempts: [] }, attempt('a4', 'c4', 2)).repairedQuestionId).toBeNull();
    // Unknown card → no signals.
    expect(pbeQuestSignals(s, attempt('ax', 'nope', 2))).toEqual({ explorerFresh: false, repairedQuestionId: null });
});

it('prices attempts with partial credit: full/partial/zero × hints on/off = 10/5/2 and 6/3/2', () => {
    // Fully correct (earned === available).
    expect(pbeAttemptXp(2, 2, false)).toBe(10);
    expect(pbeAttemptXp(2, 2, true)).toBe(6);
    // Partial (0 < earned < available): half of full, floored.
    expect(pbeAttemptXp(1, 2, false)).toBe(5);
    expect(pbeAttemptXp(1, 2, true)).toBe(3);
    expect(pbeAttemptXp(3, 4, false)).toBe(5);
    expect(pbeAttemptXp(1, 4, true)).toBe(3);
    // Zero earned pays the incorrect value either way.
    expect(pbeAttemptXp(0, 2, false)).toBe(2);
    expect(pbeAttemptXp(0, 2, true)).toBe(2);
});

const insertStudent = async (id: string, name: string) => {
    await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) VALUES(?,?,?,?,?,?,?,?)")
        .bind(id, TEST_ORG, name, name, 'Student', 'Student', 'x', 'v1').run();
};

it('credits the mission (start) date when a Practice session crosses midnight (D12)', async () => {
    const student2 = '77777777-7777-4777-8777-777777777777';
    await insertStudent(student2, 'pbe-midnight-student');
    const ctx = studentCtx(student2), store = new Store(app.db as unknown as Env['DB']);
    const sid = 'pbe-midnight-session', startDate = '2026-09-17', afterMidnight = '2026-09-18T00:30:00Z';
    const mission: PbeMission = { id: sid, format: 'Pbe', ruleVersion: 'r', scoringVersion: 's', selectionVersion: 'sel', seasonId: 's1', sessionId: sid, scopeVersion: 'v', localDate: startDate, timeZone: 'UTC', mode: 'Practice', target: 1, completed: 0 };
    await store.insert('pbe-daily-mission', sid, TEST_ORG, mission, { seasonId: 's1' });
    const s: PbeSession = {
        id: sid, format: 'Pbe', studentUserId: student2, seasonId: 's1', mode: 'Practice', status: 'Active',
        scopeVersion: 'v', ruleVersion: 'r', scoringVersion: 's', selectionVersion: 'sel', questionIds: ['q1'],
        cards: [card('c1', 'q1')], attempts: [attempt('a1', 'c1', 2)], createdAtUtc: '2026-09-17T23:30:00Z', startPayload: '{}', missionLocalDate: startDate, creditedLocalDate: null, newlyCreditedDay: false,
    };
    const w = await preparePbeEffort(ctx, s, afterMidnight);
    await atomic(ctx, 'pbe-midnight.test', w.statements, w.guards);
    // The reward snapshot rides on the attempt's stored result: it carries
    // the full awarded delta, bracketed by the learner's before/after
    // lifetime totals (a fresh learner starts at 0).
    const reward = s.attempts.at(-1)!.result.xpReward;
    expect(reward).toBeDefined();
    expect(reward!.earned).toBe(s.xpEarned);
    expect(reward!.before.total).toBe(0);
    expect(reward!.after.total).toBe(reward!.earned);
    expect(reward!.after.level).toBe(1);
    // Day credit belongs to the start date, not the post-midnight attempt date.
    expect(s.creditedLocalDate).toBe(startDate);
    expect(s.newlyCreditedDay).toBe(true);
    const days = await store.list<{ localDate: string }>('training-day', TEST_ORG, { ownerId: student2 });
    expect(days.map(d => d.localDate)).toEqual([startDate]);
    // Quest progress is also recorded on the start date.
    const quests = await store.list<{ localDate: string }>('training-quest', TEST_ORG, { ownerId: student2 });
    expect(quests.map(q => q.localDate)).toEqual([startDate]);
    // But the XP award itself stays attempt-dated in xpByDay.
    const xp = (await store.list<XpRecord>('training-xp', TEST_ORG, { ownerId: student2 }))[0];
    expect(Object.keys(xp.xpByDay)).toEqual(['2026-09-18']);
    expect(xp.xpByDay['2026-09-18']).toBeGreaterThanOrEqual(60); // 10 attempt + 50 day (+ any quest XP)
});

it('credits exactly one practice day + 50 day XP when a Simulation deck completes, dated by session start (D1/D12)', async () => {
    const student3 = '88888888-8888-4888-8888-888888888888';
    await insertStudent(student3, 'pbe-simulation-student');
    const ctx = studentCtx(student3), store = new Store(app.db as unknown as Env['DB']);
    const a = attempt('a1', 'c1', 2); // fully correct, no hints → 10 attempt XP
    const s: PbeSession = {
        id: 'pbe-simulation-session', format: 'Pbe', studentUserId: student3, seasonId: 's1', mode: 'Simulation', status: 'Active',
        scopeVersion: 'v', ruleVersion: 'r', scoringVersion: 's', selectionVersion: 'sel', questionIds: ['q1'],
        cards: [card('c1', 'q1')], attempts: [a], createdAtUtc: '2026-09-17T23:30:00Z', startPayload: '{}', missionLocalDate: '2026-09-17', creditedLocalDate: null, newlyCreditedDay: false,
    };
    const at = '2026-09-18T00:15:00Z'; // deck completes after midnight
    const w = await awardPbeSimulationAttemptXp(ctx, s, a, at);
    await atomic(ctx, 'pbe-simulation-day.test', w.statements, w.guards);
    expect(s.creditedLocalDate).toBe('2026-09-17');
    expect(s.newlyCreditedDay).toBe(true);
    expect(s.xpEarned).toBe(60); // 10 attempt + 50 day, nothing else
    const days = await store.list<{ localDate: string }>('training-day', TEST_ORG, { ownerId: student3 });
    expect(days.map(d => d.localDate)).toEqual(['2026-09-17']);
    const xp = (await store.list<XpRecord>('training-xp', TEST_ORG, { ownerId: student3 }))[0];
    expect(xp.totalXp).toBe(60);
    expect(xp.xpByDay).toEqual({ '2026-09-18': 60 }); // award stays attempt-dated
    // Idempotent: a second completion pass credits nothing more.
    const w2 = { statements: [], guards: [] } as Parameters<typeof creditPbePracticeDay>[1], events: XpEvent[] = [];
    const p = resolvePreference(ctx, await preference(ctx), at);
    expect(await creditPbePracticeDay(ctx, w2, s, p, at, events, { localDate: '2026-09-17', weekStartLocalDate: '2026-09-14', timeZone: 'UTC' })).toBe(false);
    expect(events).toEqual([]);
    expect(w2.statements).toEqual([]);
    expect((await store.list('training-day', TEST_ORG, { ownerId: student3 })).length).toBe(1);
});

it('progresses explorer and comeback through preparePbeEffort with distinct counting', async () => {
    const ctx = studentCtx(STUDENT);
    const store = new Store(app.db as unknown as Env['DB']);
    const localDate = '2026-09-17', at = `${localDate}T12:00:00Z`;
    const sid = 'pbe-quest-session';
    const mission: PbeMission = { id: sid, format: 'Pbe', ruleVersion: 'r', scoringVersion: 's', selectionVersion: 'sel', seasonId: 's1', sessionId: sid, scopeVersion: 'v', localDate, timeZone: 'UTC', mode: 'Practice', target: 5, completed: 0 };
    await store.insert('pbe-daily-mission', sid, TEST_ORG, mission, { seasonId: 's1' });
    const questState = (key: 'explorer' | 'comeback' | 'marathon'): QuestState => {
        const d = QUEST_DEFS[key];
        return { key, title: d.title, description: d.description, target: d.target, progress: 0, completed: false, xpAwarded: false };
    };
    const questId = `${TEST_ORG}:${STUDENT}:${localDate}`;
    const seed: QuestRecord = { id: questId, localDate, timeZone: 'UTC', quests: [questState('explorer'), questState('comeback'), questState('marathon')], tripleAwarded: false };
    await store.insert('training-quest', questId, TEST_ORG, seed, { ownerId: STUDENT });
    const s: PbeSession = {
        id: sid, format: 'Pbe', studentUserId: STUDENT, seasonId: 's1', mode: 'Practice', status: 'Active',
        scopeVersion: 'v', ruleVersion: 'r', scoringVersion: 's', selectionVersion: 'sel',
        questionIds: ['q1', 'q1', 'q1', 'q2', 'q2'],
        cards: [card('c1', 'q1'), card('c2', 'q1'), card('c3', 'q1'), card('c4', 'q2'), card('c5', 'q2')],
        attempts: [], createdAtUtc: at, startPayload: '{}', missionLocalDate: localDate, creditedLocalDate: null, newlyCreditedDay: false,
    };
    const readQuests = async () => {
        const row = await app.db.prepare("SELECT data FROM Records WHERE kind='training-quest' AND org_id=? AND id=?").bind(TEST_ORG, questId).first<{ data: string }>();
        return (JSON.parse(row!.data) as QuestRecord).quests;
    };
    const runAttempt = async (a: PbeAttempt) => {
        s.attempts.push(a);
        const w = await preparePbeEffort(ctx, s, at);
        await atomic(ctx, 'pbe-quest-hooks.test', w.statements, w.guards);
        return readQuests();
    };
    // Incorrect first attempt on a fresh question: explorer completes, comeback untouched.
    let quests = await runAttempt(attempt('a1', 'c1', 0));
    expect(quests.find(q => q.key === 'explorer')!.completed).toBe(true);
    expect(quests.find(q => q.key === 'comeback')!.progress).toBe(0);
    // Correct repair of q1: comeback progresses once with the question as distinct id.
    quests = await runAttempt(attempt('a2', 'c2', 2));
    const comeback1 = quests.find(q => q.key === 'comeback')!;
    expect(comeback1.progress).toBe(1);
    expect(comeback1.countedIds).toEqual(['q1']);
    // Repairing the same question again does not double count.
    quests = await runAttempt(attempt('a3', 'c3', 2));
    const comeback2 = quests.find(q => q.key === 'comeback')!;
    expect(comeback2.progress).toBe(1);
    expect(comeback2.countedIds).toEqual(['q1']);
    // Incorrect attempt on a new question: no comeback progress.
    quests = await runAttempt(attempt('a4', 'c4', 0));
    expect(quests.find(q => q.key === 'comeback')!.progress).toBe(1);
    // Correct repair of q2: comeback reaches 2 with both question ids counted.
    quests = await runAttempt(attempt('a5', 'c5', 2));
    const comeback3 = quests.find(q => q.key === 'comeback')!;
    expect(comeback3.progress).toBe(2);
    expect(comeback3.countedIds).toEqual(['q1', 'q2']);
});

it('records mid-session quest completions on the session for the recap', async () => {
    const ctx = studentCtx(STUDENT);
    const store = new Store(app.db as unknown as Env['DB']);
    const localDate = '2026-09-18', at = `${localDate}T12:00:00Z`;
    const sid = 'pbe-quest-recap-session';
    const mission: PbeMission = { id: sid, format: 'Pbe', ruleVersion: 'r', scoringVersion: 's', selectionVersion: 'sel', seasonId: 's1', sessionId: sid, scopeVersion: 'v', localDate, timeZone: 'UTC', mode: 'Practice', target: 5, completed: 0 };
    await store.insert('pbe-daily-mission', sid, TEST_ORG, mission, { seasonId: 's1' });
    const questState = (key: 'explorer'): QuestState => {
        const d = QUEST_DEFS[key];
        return { key, title: d.title, description: d.description, target: d.target, progress: 0, completed: false, xpAwarded: false };
    };
    const questId = `${TEST_ORG}:${STUDENT}:${localDate}`;
    const seed: QuestRecord = { id: questId, localDate, timeZone: 'UTC', quests: [questState('explorer')], tripleAwarded: false };
    await store.insert('training-quest', questId, TEST_ORG, seed, { ownerId: STUDENT });
    const s: PbeSession = {
        id: sid, format: 'Pbe', studentUserId: STUDENT, seasonId: 's1', mode: 'Practice', status: 'Active',
        scopeVersion: 'v', ruleVersion: 'r', scoringVersion: 's', selectionVersion: 'sel',
        questionIds: ['q1'],
        cards: [card('c1', 'q1')],
        attempts: [], createdAtUtc: at, startPayload: '{}', missionLocalDate: localDate, creditedLocalDate: null, newlyCreditedDay: false,
    };
    s.attempts.push(attempt('a1', 'c1', 0));
    const w = await preparePbeEffort(ctx, s, at);
    await atomic(ctx, 'pbe-quest-recap.test', w.statements, w.guards);
    // Explorer completed mid-session (fresh question): the session itself now
    // carries it, so the recap can list it alongside any finish-line quests.
    expect(s.questsCompleted).toEqual([{ key: 'explorer', title: QUEST_DEFS.explorer.title }]);
});

it('stamps the reward snapshot with the partial-credit amount actually awarded (D3)', async () => {
    const student4 = '99999999-9999-4999-8999-999999999999';
    await insertStudent(student4, 'pbe-partial-student');
    const ctx = studentCtx(student4), store = new Store(app.db as unknown as Env['DB']);
    const sid = 'pbe-partial-session', localDate = '2026-09-17', at = `${localDate}T12:00:00Z`;
    const mission: PbeMission = { id: sid, format: 'Pbe', ruleVersion: 'r', scoringVersion: 's', selectionVersion: 'sel', seasonId: 's1', sessionId: sid, scopeVersion: 'v', localDate, timeZone: 'UTC', mode: 'Practice', target: 4, completed: 0 };
    await store.insert('pbe-daily-mission', sid, TEST_ORG, mission, { seasonId: 's1' });
    const s: PbeSession = {
        id: sid, format: 'Pbe', studentUserId: student4, seasonId: 's1', mode: 'Practice', status: 'Active',
        scopeVersion: 'v', ruleVersion: 'r', scoringVersion: 's', selectionVersion: 'sel', questionIds: ['q1', 'q1', 'q1', 'q2'],
        // Partial credit on the last attempt: 1 of 2 points, unaided → half
        // of the full 10 = 5 XP. The two earlier scoreless serves of q1 make
        // the question non-fresh (no Explorer completion joins the award),
        // a partial is not a comeback repair, and the deck is unfinished
        // (3 of 4 cards), so no day credit joins either — the snapshot is
        // the attempt's own award.
        cards: [card('c0', 'q1'), card('c1', 'q1'), card('c2', 'q1'), card('c3', 'q2')],
        attempts: [attempt('a0', 'c0', 0), attempt('a1', 'c1', 0), attempt('a2', 'c2', 1)],
        createdAtUtc: at, startPayload: '{}', missionLocalDate: localDate, creditedLocalDate: null, newlyCreditedDay: false,
    };
    const w = await preparePbeEffort(ctx, s, at);
    await atomic(ctx, 'pbe-partial.test', w.statements, w.guards);
    const reward = s.attempts.at(-1)!.result.xpReward;
    expect(reward).toBeDefined();
    expect(reward!.earned).toBe(5);
    expect(reward!.before).toMatchObject({ total: 0, level: 1, xpIntoLevel: 0, xpForNext: 100 });
    expect(reward!.after).toMatchObject({ total: 5, level: 1, xpIntoLevel: 5, xpForNext: 95 });
    const xp = (await store.list<XpRecord>('training-xp', TEST_ORG, { ownerId: student4 }))[0];
    expect(xp.totalXp).toBe(5);
});
