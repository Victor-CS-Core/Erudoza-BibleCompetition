// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { Store } from '../store';
import type { Env, RequestContext } from '../types';
import { atomic } from '../application/model';
import { createNativeTestApp, TEST_ORG } from '../test-runtime';
import { preparePbeEffort, pbeQuestSignals, type PbeMission } from './effort';
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
