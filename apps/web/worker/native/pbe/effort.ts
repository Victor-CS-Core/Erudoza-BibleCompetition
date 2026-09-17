import { builtInContentSql } from '../application/library-access';
import type { RequestContext } from '../types';
import type { PbeAttempt, PbeSession } from './sessions';
import type { DayRecord, WeekRecord, Writes } from '../training/store';
import { awardStreakBadges, identity, preference, recordBests, resolvePreference, write } from '../training/store';
import type { BestsInput } from '../training/store';
import { awardXp, xpSummary, XP_VALUES, type XpEvent } from '../training/xp';
import { getDailyQuests, inTeamRoom, progressQuests, questDto, type QuestKey } from '../training/quests';
import { bestStreak, creditedDates, streakCount, streakStatus } from '../training/streak';
import { addDays, resolveTrainingCalendar } from '../training/calendar';
export interface PbeMission {
    id: string;
    format: 'Pbe';
    ruleVersion: string;
    scoringVersion: string;
    selectionVersion: string;
    seasonId: string;
    sessionId: string;
    scopeVersion: string;
    localDate: string;
    timeZone: string;
    mode: 'Practice' | 'Review' | 'Simulation';
    target: number;
    completed: number;
}
export async function preparePbeStartEffort(ctx: RequestContext, s: PbeSession, zone?: string): Promise<Writes> {
    const w: Writes = { statements: [], guards: [] }, old = await preference(ctx), p = resolvePreference(ctx, old, s.createdAtUtc, zone), c = resolveTrainingCalendar(s.createdAtUtc, p);
    s.missionLocalDate = c.localDate;
    const m: PbeMission = { id: s.id, format: 'Pbe', ruleVersion: s.ruleVersion, scoringVersion: s.scoringVersion, selectionVersion: s.selectionVersion, seasonId: s.seasonId, sessionId: s.id, scopeVersion: s.scopeVersion, localDate: c.localDate, timeZone: c.timeZone, mode: s.mode, target: s.cards.length, completed: 0 };
    const headId = identity(ctx, s.seasonId, c.localDate), head = await ctx.store.get('pbe-daily-mission-head', headId, ctx.orgId);
    write(ctx, w, 'training-preferences', p.id, p, old);
    write(ctx, w, 'pbe-daily-mission', s.id, m, null, s.seasonId);
    write(ctx, w, 'pbe-daily-mission-head', headId, { id: headId, format: 'Pbe', missionId: s.id, ruleVersion:s.ruleVersion, scoringVersion:s.scoringVersion, selectionVersion:s.selectionVersion }, head, s.seasonId);
    return w;
}
/** Attempt XP for PBE Simulation sessions (preparePbeEffort is bypassed there). */
export async function awardPbeSimulationAttemptXp(ctx: RequestContext, s: PbeSession, attempt: PbeAttempt, at: string): Promise<Writes> {
    const w: Writes = { statements: [], guards: [] };
    const old = await preference(ctx), p = resolvePreference(ctx, old, at), cal = resolveTrainingCalendar(at, p);
    const correct = attempt.result.earnedPoints === attempt.result.availablePoints;
    const awarded = await awardXp(ctx, w, { seasonId: s.seasonId, localDate: cal.localDate, atUtc: at, events: [{ kind: 'attempt', amount: correct ? (attempt.hintsUsed ? XP_VALUES.attemptCorrectHints : XP_VALUES.attemptCorrectNoHints) : XP_VALUES.attemptIncorrect }] });
    s.xpEarned = (s.xpEarned ?? 0) + awarded.awarded;
    if (awarded.leveledUp)
        s.leveledUp = { from: s.leveledUp?.from ?? awarded.leveledUp.from, to: awarded.leveledUp.to };
    return w;
}

/**
 * Pure explorer/comeback signals for one PBE attempt. "Target" here is the
 * card's served question (card.question.id): a PBE session serves questions,
 * one per card, so the question is the natural analogue of a Memory passage.
 *
 * - explorer: true when the question was served fewer than 2 times before in
 *   this session (earlier cards with the same question id). Sessions select
 *   distinct questions, so the first attempt of a session normally qualifies —
 *   the PBE analogue of Memory's "practice a chapter you have seen less than
 *   half of".
 * - comeback: the repaired question id when this attempt is fully correct on
 *   a question that was attempted incorrectly earlier in this session
 *   (distinctId counting dedupes repairs of the same question within the day).
 */
export function pbeQuestSignals(s: Pick<PbeSession, 'cards' | 'attempts'>, attempt: PbeAttempt): { explorerFresh: boolean; repairedQuestionId: string | null } {
    const card = s.cards.find(c => c.id === attempt.cardId);
    if (!card)
        return { explorerFresh: false, repairedQuestionId: null };
    const questionId = card.question.id;
    const cardIndex = s.cards.findIndex(c => c.id === card.id);
    const priorServes = cardIndex < 0 ? 0 : s.cards.slice(0, cardIndex).filter(c => c.question.id === questionId).length;
    const correct = attempt.result.earnedPoints === attempt.result.availablePoints;
    const repaired = correct && s.attempts.some(a => a.id !== attempt.id && s.cards.some(c => c.id === a.cardId && c.question.id === questionId) && a.result.earnedPoints < a.result.availablePoints);
    return { explorerFresh: priorServes < 2, repairedQuestionId: repaired ? questionId : null };
}
/** Stage participation only. No legacy mastery, badges or Honor evaluator is called. */
export async function preparePbeEffort(ctx: RequestContext, s: PbeSession, at: string): Promise<Writes> {
    const w: Writes = { statements: [], guards: [] }, old = await preference(ctx), p = resolvePreference(ctx, old, at), m = await ctx.store.require<PbeMission>('pbe-daily-mission', s.id, ctx.orgId);
    p.lastEventAtUtc = p.lastEventAtUtc > at ? p.lastEventAtUtc : at;
    const mission = { ...m.value, completed: s.attempts.length };
    write(ctx, w, 'pbe-daily-mission', s.id, mission, m, s.seasonId);
    // XP events collected across the attempt; awarded once at the end.
    const xpEvents: XpEvent[] = [];
    const cal = resolveTrainingCalendar(at, p);
    const lastAttempt = s.attempts.at(-1);
    if (lastAttempt) {
        const correct = lastAttempt.result.earnedPoints === lastAttempt.result.availablePoints;
        xpEvents.push({ kind: 'attempt', amount: correct ? (lastAttempt.hintsUsed ? XP_VALUES.attemptCorrectHints : XP_VALUES.attemptCorrectNoHints) : XP_VALUES.attemptIncorrect });
    }
    // Review-step completion: a Review-mode session reaching its full target.
    if (s.mode === 'Review' && s.cards.length > 0 && s.attempts.length === s.cards.length && m.value.completed < s.cards.length)
        xpEvents.push({ kind: 'review', amount: XP_VALUES.reviewStepCompleted });
    if (s.cards.length > 0 && s.attempts.length === s.cards.length && !s.creditedLocalDate) {
        const c = resolveTrainingCalendar(at, p), dayId = identity(ctx, c.localDate), day = await ctx.store.get<DayRecord>('training-day', dayId, ctx.orgId);
        s.creditedLocalDate = c.localDate;
        if (!day) {
            s.newlyCreditedDay = true;
            write(ctx, w, 'training-day', dayId, { id: dayId, localDate: c.localDate, timeZone: c.timeZone, firstQualifiedAtUtc: at, sessionId: s.id, credited: true }, null);
            xpEvents.push({ kind: 'day', amount: XP_VALUES.dayCredited });
            const wid = identity(ctx, c.weekStartLocalDate), oldWeek = await ctx.store.get<WeekRecord>('training-week', wid, ctx.orgId), week = oldWeek?.value ?? { id: wid, weekStartLocalDate: c.weekStartLocalDate, timeZone: c.timeZone, target: p.weeklyTarget, dates: Array.from({ length: 7 }, (_, i) => addDays(c.weekStartLocalDate, i)), creditedDates: [], qualifiedAtUtc: null };
            if (!week.creditedDates.includes(c.localDate))
                week.creditedDates.push(c.localDate);
            if (week.creditedDates.length >= week.target && !week.qualifiedAtUtc) {
                week.qualifiedAtUtc = at;
                s.weeklyGoalComplete = true;
                if (p.qualifyingWeekStarts.length < 4 && !p.qualifyingWeekStarts.includes(week.weekStartLocalDate))
                    p.qualifyingWeekStarts.push(week.weekStartLocalDate);
            }
            write(ctx, w, 'training-week', wid, week, oldWeek);
            const credited = await creditedDates(ctx);
            credited.add(c.localDate);
            const earned = await awardStreakBadges(ctx, w, streakCount(credited, c.localDate), at, s.id);
            if (earned.length) {
                s.earnedBadges = [...(s.earnedBadges ?? []), ...earned];
                xpEvents.push({ kind: 'milestone', amount: XP_VALUES.soloMilestone * earned.length });
            }
        }
    }
    // Daily bonus quests: warmup on Review completion, teammate on room
    // membership, explorer for fresh questions, comeback for repaired ones.
    const questRes = await progressQuests(ctx, w, { localDate: cal.localDate, timeZone: cal.timeZone, seasonId: s.seasonId, atUtc: at }, async api => {
        const has = (key: QuestKey) => api.quests.some(q => q.key === key && !q.completed);
        if (has('warmup') && s.mode === 'Review' && s.cards.length > 0 && s.attempts.length === s.cards.length)
            api.complete('warmup');
        if (has('teammate') && await inTeamRoom(ctx))
            api.complete('teammate');
        const attempt = lastAttempt;
        if (attempt && (has('explorer') || has('comeback'))) {
            const signals = pbeQuestSignals(s, attempt);
            if (has('explorer') && signals.explorerFresh)
                api.addProgress('explorer', 1);
            if (has('comeback') && signals.repairedQuestionId)
                api.addProgress('comeback', 1, signals.repairedQuestionId);
        }
    });
    xpEvents.push(...questRes.xpEvents);
    if (xpEvents.length) {
        const awarded = await awardXp(ctx, w, { seasonId: s.seasonId, localDate: cal.localDate, atUtc: at, events: xpEvents });
        s.xpEarned = (s.xpEarned ?? 0) + awarded.awarded;
        if (awarded.leveledUp)
            s.leveledUp = { from: s.leveledUp?.from ?? awarded.leveledUp.from, to: awarded.leveledUp.to };
    }
    // The same preference revision serializes day/week races with Memory sessions.
    write(ctx, w, 'training-preferences', p.id, p, old);
    return w;
}
export const pbeMissionSteps = (s: PbeSession) => [{ kind: s.mode, target: s.cards.length, completed: s.attempts.length, status: s.attempts.length === s.cards.length ? 'Complete' : 'Active', sessionId: s.id }];
/**
 * Compare a completed PBE session's points against the learner's stored PBE
 * personal bests and queue bests-record writes. Accuracy is earned/available
 * points; "correct" counts fully-correct questions. Tracked per mode, separate
 * from Memory bests. Called once from the session-complete action.
 */
export async function recordPbePersonalBests(ctx: RequestContext, s: PbeSession): Promise<{ writes: Writes; beaten: { accuracyBeaten: boolean; correctBeaten: boolean } }> {
    if (!s.attempts.length)
        return { writes: { statements: [], guards: [] }, beaten: { accuracyBeaten: false, correctBeaten: false } };
    const earned = s.attempts.reduce((n, a) => n + a.result.earnedPoints, 0), available = s.attempts.reduce((n, a) => n + a.result.availablePoints, 0);
    const correct = s.attempts.filter(a => a.result.earnedPoints === a.result.availablePoints).length;
    const input: BestsInput = { mode: s.mode, format: 'Pbe', accuracy: available > 0 ? earned / available * 100 : 0, correct, sessionId: s.id, atUtc: s.completedAtUtc ?? s.attempts.at(-1)?.result.acceptedAtUtc ?? new Date().toISOString() };
    return recordBests(ctx, input);
}
export async function pbeToday(ctx: RequestContext, season: import('../application/model').Season, now: string, deviceTimeZone?: string): Promise<import('../../../src/api/trainingTypes').TrainingToday> {
    const { resolvePbeSources, resolvePbeSessionSources } = await import('./sources'), { loadFromResolvedSources } = await import('./bank');
    const old = await preference(ctx), p = resolvePreference(ctx, old, now, deviceTimeZone), c = resolveTrainingCalendar(now, p), week = (await ctx.store.get<WeekRecord>('training-week', identity(ctx, c.weekStartLocalDate), ctx.orgId))?.value;
    const head = await ctx.store.get<{
        missionId: string;
    }>('pbe-daily-mission-head', identity(ctx, season.id, c.localDate), ctx.orgId), saved = head ? await ctx.store.get<PbeSession>('pbe-session', head.value.missionId, ctx.orgId) : null, s = saved?.value;
    const owned = s?.format === 'Pbe' && s.studentUserId === ctx.actor.userId && s.seasonId === season.id;
    const scope = owned ? await resolvePbeSessionSources(ctx, s.id) : await resolvePbeSources(ctx, { organizationId: ctx.orgId, seasonId: season.id, studentId: ctx.actor.userId });
    const bank = await loadFromResolvedSources(ctx, { organizationId: ctx.orgId, seasonId: season.id, studentId: ctx.actor.userId, sourceUnitIds: scope.sources.map(s => s.id) }, scope, true);
    const stale = !!s && (!owned || s.scopeVersion !== scope.eligibility);
    // Published heads govern new admission; a compatible saved set remains resumable.
    const frozenAvailable = owned && !stale && s.cards.length > 0 && scope.sources.length > 0;
    const available = (frozenAvailable || bank.questions.length > 0) && scope.guards.some(g => g.kind === 'membership');
    const steps: import('../../../src/api/trainingTypes').TrainingStep[] = s && !stale ? pbeMissionSteps(s).map(step => ({ ...step, status: step.status as 'Active' | 'Complete' })) : [{ kind: 'Practice', target: Math.min(8, bank.questions.length), completed: 0, status: 'Pending', sessionId: null }];
    const complete = steps.every(step => step.status === 'Complete'), next = steps.find(step => step.status !== 'Complete');
    // Recheck every captured raw guard in one bounded query after the bank/mission reads.
    const changed = await ctx.env.DB.prepare(`SELECT count(*) AS changed FROM json_each(?) g WHERE CASE WHEN json_extract(g.value,'$.kind') IN ('@active-user','@active-admin') THEN NOT EXISTS(SELECT 1 FROM Users u WHERE u.id=json_extract(g.value,'$.id') AND u.org_id=? AND u.active=1) ELSE NOT EXISTS(SELECT 1 FROM Records r WHERE (r.org_id=? OR ${builtInContentSql('r')}) AND r.kind=json_extract(g.value,'$.kind') AND r.id=json_extract(g.value,'$.id') AND r.revision=json_extract(g.value,'$.revision')) END`).bind(JSON.stringify(scope.guards), ctx.orgId, ctx.orgId).first<{
        changed: number;
    }>();
    if (changed?.changed)
        throw new (await import('../types')).HttpError(409, 'The PBE scope changed. Refresh and retry.');
    const credited = await creditedDates(ctx), streak = streakStatus(credited, c.localDate);
    const xp = await xpSummary(ctx);
    return { format: 'Pbe', seasonId: season.id, seasonName: season.name, seasonStatus: season.status, localDate: c.localDate, preferences: { timeZone: p.timeZone, weeklyTarget: p.weeklyTarget, pending: p.pending }, week: { weekStartLocalDate: c.weekStartLocalDate, timeZone: week?.timeZone ?? p.timeZone, target: week?.target ?? p.weeklyTarget, completedDays: week?.creditedDates.length ?? 0, days: Array.from({ length: 7 }, (_, i) => { const localDate = addDays(c.weekStartLocalDate, i); return { localDate, credited: week?.creditedDates.includes(localDate) ?? false, isToday: localDate === c.localDate }; }) }, mission: { id: s && !stale ? s.id : null, revision: s && !stale ? 1 : null, status: !available ? 'Unavailable' : stale ? 'Invalidated' : !s ? 'Suggested' : complete ? 'Complete' : 'Active', scopeVersion: scope.eligibility, steps, explanation: !available ? 'No published PBE questions are available for your assignment. Ask your coach to add questions, or choose Memory.' : stale ? 'Your assignment changed. Start updated training.' : null }, nextAction: available && next ? { label: next.sessionId && s?.status !== 'Completed' ? 'Resume PBE practice' : 'Start PBE practice', mode: next.kind, sessionId: s?.status === 'Completed' ? null : next.sessionId } : null, honors: [], xp: { total: xp.total, level: xp.level, levelName: xp.levelName, xpIntoLevel: xp.xpIntoLevel, xpForNext: xp.xpForNext }, quests: (await getDailyQuests(ctx, c.localDate, now)).map(questDto), streak: { current: streak.current, best: bestStreak(credited), state: streak.state }, streakNudge: streak.state === 'paused' };
}
