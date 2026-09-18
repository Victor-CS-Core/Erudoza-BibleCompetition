import { prepareSoloHonors } from '../mastery/store';
import type { D1PreparedStatement } from '@cloudflare/workers-types';
import type { RequestContext } from '../types';
import { HttpError } from '../types';
import type { Source } from '../application/model';
import type { Stored } from '../store';
import type { Session, Attempt, Mastery } from '../study/routes';
import { nextReview } from '../study/engine';
import type { BadgeProgress, TrainingPreferences, TrainingStep, SkillScores, SessionRecap, StartTrainingContext } from '../../../src/api/trainingTypes';
import { addDays, effectivePreferences, resolveTrainingCalendar, validateZone } from './calendar';
import { badgeCounters, fullTargetReached } from './rules';
import { creditedDates, streakCount } from './streak';
import { awardXp, levelNameFor, xpSummary, XP_VALUES, type XpEvent } from './xp';
import { inTeamRoom, progressQuests, type QuestKey } from './quests';
export interface PreferenceRecord extends TrainingPreferences {
    id: string;
    lastEventAtUtc: string;
    qualifyingWeekStarts: string[];
    /** How timeZone was chosen: 'default' (initial UTC), 'device' (learner's system), 'manual' (explicitly picked). Absent on older rows means 'default'. */
    timeZoneSource?: 'default' | 'device' | 'manual';
}
export interface DayRecord {
    id: string;
    localDate: string;
    timeZone: string;
    firstQualifiedAtUtc: string;
    sessionId: string;
    credited: boolean;
}
export interface WeekRecord {
    id: string;
    weekStartLocalDate: string;
    timeZone: string;
    target: 3 | 4 | 5;
    dates: string[];
    creditedDates: string[];
    qualifiedAtUtc: string | null;
}
export interface MissionHead {
    id: string;
    missionId: string;
    revision: number;
}
export interface MissionRecord {
    id: string;
    seasonId: string;
    localDate: string;
    timeZone: string;
    revision: number;
    scopeVersion: string;
    eligibleKnowledgeUnitIds: string[];
    reviewKnowledgeUnitIds: string[];
    acceptedReviewKnowledgeUnitIds: string[];
    practiceCompleted: number;
    practiceSessionId: string | null;
    reviewSessionId: string | null;
    invalidated: boolean;
}
export interface SeasonProgressRecord {
    id: string;
    seasonId: string;
    scopeVersion: string;
    seenKnowledgeUnitIds: string[];
    counters: ReturnType<typeof badgeCounters>;
}
export interface AwardRecord extends BadgeProgress {
    evidence?: {
        missionId: string | null;
        qualifyingWeekStarts: string[];
        skills: {
            knowledgeUnitId: string;
            algorithmVersion: string;
            scores: SkillScores;
        }[];
    };
    id: string;
    seasonId: string | null;
    scopeVersion: string;
    eligibleKnowledgeUnitIds: string[];
    earnedAtUtc: string;
    evidenceSessionId: string;
}
export interface SessionTraining {
    clientStartId?: string;
    startPayload?: string;
    missionId: string | null;
    missionRevision: number | null;
    missionLocalDate: string | null;
    timeZone: string;
    reviewKnowledgeUnitIds: string[];
    creditedLocalDate: string | null;
    newlyCreditedDay: boolean;
    /** True when the credited day completed the learner's weekly practice goal. */
    weeklyGoalComplete?: boolean;
    earnedBadges: BadgeProgress[];
    /** XP earned during this session (all kinds). */
    xpEarned?: number;
    /** Level-up crossed during this session, if any. */
    leveledUp?: { from: number; to: number } | null;
    /** Quests completed when this session was completed (keys + titles), for the recap celebration. */
    questsCompleted?: { key: QuestKey; title: string }[];
}
export type Guard = {
    kind: string;
    id: string;
    revision: number;
};
export interface Writes {
    statements: D1PreparedStatement[];
    guards: Guard[];
}
export const identity = (ctx: RequestContext, ...parts: string[]) => [ctx.orgId, ctx.actor.userId, ...parts].join(':');
export const kid = (s: Source) => s.knowledgeUnitId ?? s.id;
export async function scopeVersion(sources: Source[]) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode([...new Set(sources.map(kid))].sort().join('\n'))); return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join(''); }
export const startPayload = (seasonId: string, mode: string, training: StartTrainingContext) => JSON.stringify({ seasonId, mode, training: { clientStartId: training.clientStartId, timeZone: training.timeZone, missionId: training.missionId, missionRevision: training.missionRevision, step: training.step } });
export const defaultPreferences = (): TrainingPreferences => ({ timeZone: 'UTC', weeklyTarget: 5, pending: null });
export async function preference(ctx: RequestContext) { return ctx.store.get<PreferenceRecord>('training-preferences', identity(ctx), ctx.orgId); }
export function write<T>(ctx: RequestContext, w: Writes, kind: string, id: string, value: T, previous: Stored<T> | null, seasonId?: string) {
    w.statements.push(previous ? ctx.store.update(kind, id, ctx.orgId, value, previous.revision) : ctx.store.insertion(kind, id, ctx.orgId, value, { ownerId: ctx.actor.userId, seasonId }));
    if (previous)
        w.guards.push({ kind, id, revision: previous.revision });
}
export function resolvePreference(ctx: RequestContext, stored: Stored<PreferenceRecord> | null, at: string, zone?: string, zoneKind: 'device' | 'manual' = 'device'): PreferenceRecord {
    const p: PreferenceRecord = stored?.value ?? { ...defaultPreferences(), id: identity(ctx), timeZone: 'UTC', timeZoneSource: 'default', lastEventAtUtc: at, qualifyingWeekStarts: [] };
    if (zone) {
        const z = validateZone(zone);
        if (!stored) {
            // First save adopts the provided zone immediately.
            p.timeZone = z;
            p.timeZoneSource = zoneKind;
        }
        else if (zoneKind === 'device' && z !== p.timeZone && (p.timeZoneSource ?? 'default') !== 'manual' && !p.pending) {
            // Follow the learner's system clock: adopt the device zone unless they
            // explicitly chose a calendar zone (manual choices still take effect next week).
            p.timeZone = z;
            p.timeZoneSource = 'device';
        }
    }
    const hadPending = !!p.pending, out = { ...p, ...effectivePreferences(at, p) };
    if (hadPending && !out.pending)
        out.timeZoneSource = 'manual';
    return out;
}
export function missionSteps(m: MissionRecord): TrainingStep[] { return [{ kind: 'Review', target: m.reviewKnowledgeUnitIds.length, completed: m.acceptedReviewKnowledgeUnitIds.length, status: m.invalidated ? 'Invalidated' : !m.reviewKnowledgeUnitIds.length ? 'NotNeeded' : m.acceptedReviewKnowledgeUnitIds.length >= m.reviewKnowledgeUnitIds.length ? 'Complete' : m.reviewSessionId ? 'Active' : 'Pending', sessionId: m.reviewSessionId }, { kind: 'Practice', target: 8, completed: m.practiceCompleted, status: m.invalidated ? 'Invalidated' : m.practiceCompleted >= 8 ? 'Complete' : m.practiceSessionId ? 'Active' : 'Pending', sessionId: m.practiceSessionId }]; }
export function missionComplete(m: MissionRecord) { return !m.invalidated && m.practiceCompleted >= 8 && (!m.reviewKnowledgeUnitIds.length || m.acceptedReviewKnowledgeUnitIds.length >= m.reviewKnowledgeUnitIds.length); }
export async function prepareStart(ctx: RequestContext, session: Session, sources: Source[], training: StartTrainingContext | undefined): Promise<Writes> {
    const w: Writes = { statements: [], guards: [] }, old = await preference(ctx), p = resolvePreference(ctx, old, session.createdAtUtc, training?.timeZone), calendar = resolveTrainingCalendar(session.createdAtUtc, p);
    write(ctx, w, 'training-preferences', p.id, p, old);
    session.training = { clientStartId: training?.clientStartId, startPayload: training ? startPayload(session.seasonId, session.mode, training) : undefined, missionId: null, missionRevision: null, missionLocalDate: null, timeZone: p.timeZone, reviewKnowledgeUnitIds: [], creditedLocalDate: null, newlyCreditedDay: false, earnedBadges: [] };
    if (!training)
        return w;
    if (typeof training.clientStartId !== 'string' || !training.clientStartId.trim() || training.clientStartId.length > 200)
        throw new HttpError(400, 'A training start ID is required.');
    if (training.missionRevision !== undefined && !training.missionId)
        throw new HttpError(400, 'A mission revision requires its mission ID.');
    if (training.missionId && (!Number.isSafeInteger(training.missionRevision) || training.missionRevision! < 1))
        throw new HttpError(400, 'Choose a valid mission revision.');
    if (training.step && training.step !== session.mode || training.missionId && (!training.missionRevision || !training.step) || session.mode === 'Simulation' && training.missionId)
        throw new HttpError(400, 'Choose a matching mission revision and step.');
    if (training.timeZone !== undefined)
        validateZone(training.timeZone);
    if (session.mode === 'Simulation' || !training.step)
        return w;
    const headId = identity(ctx, session.seasonId, calendar.localDate), head = await ctx.store.get<MissionHead>('daily-mission-head', headId, ctx.orgId);
    let mid = training.missionId ?? head?.value.missionId ?? `${headId}:1`;
    const prior = await ctx.store.get<MissionRecord>('daily-mission', mid, ctx.orgId), fingerprint = await scopeVersion(sources);
    if (training.missionId && (!prior || prior.value.seasonId !== session.seasonId || !mid.startsWith(identity(ctx) + ':')))
        throw new HttpError(404, 'Training mission was not found.');
    if (training.missionRevision && prior?.value.revision !== training.missionRevision)
        throw new HttpError(409, 'The mission changed. Reload Training HQ.');
    if (prior && (prior.value.invalidated || prior.value.scopeVersion !== fingerprint) && training.missionId)
        throw new HttpError(409, 'The assignment changed. Reload Training HQ and start a new mission.');
    const mastery = await ctx.store.list<Mastery>('mastery', ctx.orgId, { seasonId: session.seasonId, ownerId: ctx.actor.userId });
    const due = [...new Set(mastery.filter(m => Date.parse(m.reviewDueAt) <= Date.parse(session.createdAtUtc) && sources.some(s => kid(s) === m.knowledgeUnitId)).sort((a, b) => a.reviewDueAt.localeCompare(b.reviewDueAt) || a.knowledgeUnitId.localeCompare(b.knowledgeUnitId)).map(m => m.knowledgeUnitId))].slice(0, 8);
    const replacing = !!prior && (prior.value.scopeVersion !== fingerprint || prior.value.invalidated);
    if (replacing) {
        mid = `${headId}:${(head?.value.revision ?? prior.value.revision) + 1}`;
        if (!prior.value.invalidated) {
            const invalidated = { ...prior.value, invalidated: true };
            write(ctx, w, 'daily-mission', prior.value.id, invalidated, prior, session.seasonId);
        }
    }
    const m: MissionRecord = prior && prior.value.scopeVersion === fingerprint && !prior.value.invalidated ? prior.value : { id: mid, seasonId: session.seasonId, localDate: calendar.localDate, timeZone: p.timeZone, revision: (prior?.value.revision ?? 0) + 1, scopeVersion: fingerprint, eligibleKnowledgeUnitIds: [...new Set(sources.map(kid))], reviewKnowledgeUnitIds: due, acceptedReviewKnowledgeUnitIds: [], practiceCompleted: 0, practiceSessionId: null, reviewSessionId: null, invalidated: false };
    if (session.mode === 'Review') {
        const remaining = m.reviewKnowledgeUnitIds.filter(id => !m.acceptedReviewKnowledgeUnitIds.includes(id));
        if (!remaining.length)
            throw new HttpError(400, 'No reviews due. Start the practice drill.');
        session.targetCardCount = remaining.length;
        session.training.reviewKnowledgeUnitIds = [...m.reviewKnowledgeUnitIds];
        m.reviewSessionId = session.id;
    }
    else
        m.practiceSessionId = session.id;
    Object.assign(session.training, { missionId: mid, missionRevision: m.revision, missionLocalDate: m.localDate });
    write(ctx, w, 'daily-mission', mid, m, replacing ? null : prior, session.seasonId);
    if (!head || head.value.missionId !== mid)
        write(ctx, w, 'daily-mission-head', headId, { id: headId, missionId: mid, revision: m.revision }, head, session.seasonId);
    return w;
}
export const titles = { 'exact-recall': 'Exact Recall', 'reference-ready': 'Reference Ready', 'chapter-strong': 'Chapter Strong', 'full-coverage': 'Full Coverage', 'steady-study': 'Steady Study', 'review-complete': 'Review Complete', 'streak-7': 'Week Streak', 'streak-14': 'Fortnight Streak', 'streak-30': 'Month Streak' } as const;
export function badgeDto(award: BadgeProgress): BadgeProgress {
    return { key: award.key, ruleVersion: award.ruleVersion, title: award.title, completed: award.completed, target: award.target, earnedAtUtc: award.earnedAtUtc, scopeLabel: award.scopeLabel, evidenceSessionId: award.evidenceSessionId };
}
export function catalog(counters: ReturnType<typeof badgeCounters>, awards: AwardRecord[], seasonName = 'Assigned scope'): BadgeProgress[] { return (Object.keys(titles) as (keyof typeof titles)[]).map(key => { const earned = awards.find(a => a.key === key); return earned ? badgeDto(earned) : { key, ruleVersion: 'training-v1', title: titles[key], completed: counters[key][0], target: counters[key][1], earnedAtUtc: null, scopeLabel: key === 'steady-study' ? 'Academy practice weeks' : seasonName, evidenceSessionId: null }; }); }
export async function applyAcceptedAttempt(ctx: RequestContext, session: Session, attempt: Attempt, sources: Source[], mastery: Mastery, dueAtUtc?: string): Promise<Writes> {
    const w: Writes = { statements: [], guards: [] }, old = await preference(ctx), at = old && old.value.lastEventAtUtc > attempt.at ? old.value.lastEventAtUtc : attempt.at, p = resolvePreference(ctx, old, at);
    attempt.at = at;
    mastery.lastSeenAt = at;
    mastery.reviewDueAt = nextReview(at, attempt.score ?? (attempt.isCorrect ? 100 : 0), mastery.streak ?? 0);
    attempt.result.reviewDueAtUtc = mastery.reviewDueAt;
    p.lastEventAtUtc = at > p.lastEventAtUtc ? at : p.lastEventAtUtc;
    // A shared preference revision serializes first-day/week/award races across sessions and seasons.
    write(ctx, w, 'training-preferences', p.id, p, old);
    // XP events collected across the attempt; awarded once at the end so the
    // training-xp record sees a single read-modify-write per request.
    const xpEvents: XpEvent[] = [];
    const xpDate = resolveTrainingCalendar(at, p).localDate;
    xpEvents.push({ kind: 'attempt', amount: attempt.isCorrect ? (attempt.hintsUsed ? XP_VALUES.attemptCorrectHints : XP_VALUES.attemptCorrectNoHints) : XP_VALUES.attemptIncorrect });
    session.training ??= { missionId: null, missionRevision: null, missionLocalDate: null, timeZone: p.timeZone, reviewKnowledgeUnitIds: [], creditedLocalDate: null, newlyCreditedDay: false, earnedBadges: [] };
    const training = session.training, fingerprint = await scopeVersion(sources);
    let review = false, reviewTransition = false;
    const reviewIds: string[] = [];
    if (training.missionId) {
        const prior = await ctx.store.require<MissionRecord>('daily-mission', training.missionId, ctx.orgId), m = prior.value;
        if (m.revision === training.missionRevision && !m.invalidated && m.scopeVersion === fingerprint) {
            reviewIds.push(...m.reviewKnowledgeUnitIds);
            const wasReviewComplete = m.reviewKnowledgeUnitIds.length > 0 && m.reviewKnowledgeUnitIds.every(id => m.acceptedReviewKnowledgeUnitIds.includes(id));
            if (session.mode === 'Review' && m.reviewKnowledgeUnitIds.includes(attempt.knowledgeUnitId) && !m.acceptedReviewKnowledgeUnitIds.includes(attempt.knowledgeUnitId))
                m.acceptedReviewKnowledgeUnitIds.push(attempt.knowledgeUnitId);
            if (session.mode === 'Practice')
                m.practiceCompleted = Math.max(m.practiceCompleted, new Set(session.attempts.filter(a => !a.isLegacyDuplicate).map(a => a.cardId)).size);
            review = m.reviewKnowledgeUnitIds.length > 0 && m.reviewKnowledgeUnitIds.every(id => m.acceptedReviewKnowledgeUnitIds.includes(id));
            reviewTransition = review && !wasReviewComplete;
            write(ctx, w, 'daily-mission', m.id, m, prior, m.seasonId);
        }
    }
    if (reviewTransition)
        xpEvents.push({ kind: 'review', amount: XP_VALUES.reviewStepCompleted });
    const before = session.attempts.filter(a => a.id !== attempt.id), qualifies = training.missionId && session.mode === 'Review' ? reviewTransition : fullTargetReached(session.targetCardCount, session.attempts) && !fullTargetReached(session.targetCardCount, before);
    let streak = 0;
    if (qualifies && !training.creditedLocalDate) {
        const c = resolveTrainingCalendar(at, p), dayId = identity(ctx, c.localDate), day = await ctx.store.get<DayRecord>('training-day', dayId, ctx.orgId);
        training.creditedLocalDate = c.localDate;
        if (!day) {
            training.newlyCreditedDay = true;
            write(ctx, w, 'training-day', dayId, { id: dayId, localDate: c.localDate, timeZone: c.timeZone, firstQualifiedAtUtc: at, sessionId: session.id, credited: true }, null);
            xpEvents.push({ kind: 'day', amount: XP_VALUES.dayCredited });
            const wid = identity(ctx, c.weekStartLocalDate), oldWeek = await ctx.store.get<WeekRecord>('training-week', wid, ctx.orgId), week = oldWeek?.value ?? { id: wid, weekStartLocalDate: c.weekStartLocalDate, timeZone: c.timeZone, target: p.weeklyTarget, dates: Array.from({ length: 7 }, (_, i) => addDays(c.weekStartLocalDate, i)), creditedDates: [], qualifiedAtUtc: null };
            if (!week.creditedDates.includes(c.localDate))
                week.creditedDates.push(c.localDate);
            if (week.creditedDates.length >= week.target && !week.qualifiedAtUtc) {
                week.qualifiedAtUtc = at;
                training.weeklyGoalComplete = true;
                if (p.qualifyingWeekStarts.length < 4 && !p.qualifyingWeekStarts.includes(week.weekStartLocalDate))
                    p.qualifyingWeekStarts.push(week.weekStartLocalDate);
            }
            write(ctx, w, 'training-week', wid, week, oldWeek);
            const creditedDays = await creditedDates(ctx);
            creditedDays.add(c.localDate);
            streak = streakCount(creditedDays, c.localDate);
        }
    }
    const pid = identity(ctx, session.seasonId, fingerprint), oldProgress = await ctx.store.get<SeasonProgressRecord>('training-season-progress', pid, ctx.orgId), seen = oldProgress?.value.seenKnowledgeUnitIds ?? [];
    if (!seen.includes(attempt.knowledgeUnitId))
        seen.push(attempt.knowledgeUnitId);
    const states = (await ctx.store.list<Mastery>('mastery', ctx.orgId, { seasonId: session.seasonId, ownerId: ctx.actor.userId })).filter(m => m.knowledgeUnitId !== mastery.knowledgeUnitId);
    states.push(mastery);
    const masteryWrites = await prepareSoloHonors(ctx, session, attempt, sources, states, mastery, dueAtUtc);
    w.statements.push(...masteryWrites.writes.statements);
    w.guards.push(...masteryWrites.writes.guards);
    if (masteryWrites.newAwards.length)
        xpEvents.push({ kind: 'honor', amount: XP_VALUES.profileHonor * masteryWrites.newAwards.length });
    const counters = badgeCounters(sources.map(s => ({ id: kid(s), bookKey: s.bookKey, chapter: s.chapter })), states, seen, p.qualifyingWeekStarts.length, review, streak), projection = { id: pid, seasonId: session.seasonId, scopeVersion: fingerprint, seenKnowledgeUnitIds: seen, counters };
    if (!oldProgress || JSON.stringify(oldProgress.value) !== JSON.stringify(projection))
        write(ctx, w, 'training-season-progress', pid, projection, oldProgress, session.seasonId);
    for (const key of Object.keys(titles) as (keyof typeof titles)[]) {
        const [completed, target] = counters[key];
        if (!target || completed < target)
            continue;
        const academyScoped = key === 'steady-study' || key.startsWith('streak-');
        const aid = identity(ctx, key, 'training-v1', academyScoped ? 'academy' : session.seasonId), existing = await ctx.store.get<AwardRecord>('solo-badge-award', aid, ctx.orgId);
        if (existing)
            continue;
        const chapter = key === 'chapter-strong' ? sources.find(source => sources.filter(s => s.bookKey === source.bookKey && s.chapter === source.chapter).every(s => states.some(m => m.knowledgeUnitId === kid(s) && m.algorithmVersion === 'v2-skill-evidence' && ['Strong', 'Mastered'].includes(m.level)))) : undefined;
        const awardSources = key === 'review-complete' ? sources.filter(s => reviewIds.includes(kid(s))) : chapter ? sources.filter(s => s.bookKey === chapter.bookKey && s.chapter === chapter.chapter) : sources;
        const award: AwardRecord = { id: aid, key, ruleVersion: 'training-v1', title: titles[key], completed, target, earnedAtUtc: at, scopeLabel: key === 'steady-study' ? 'Academy practice weeks' : key.startsWith('streak-') ? 'Practice streak' : key === 'review-complete' ? `Daily review (${reviewIds.length} passages)` : `Assigned scope${chapter ? ` · ${chapter.bookKey} ${chapter.chapter}` : ''} (${target} passages)`, evidenceSessionId: session.id, seasonId: academyScoped ? null : session.seasonId, scopeVersion: fingerprint, eligibleKnowledgeUnitIds: awardSources.map(kid), evidence: { missionId: training.missionId, qualifyingWeekStarts: [...p.qualifyingWeekStarts], skills: states.filter(m => awardSources.some(s => kid(s) === m.knowledgeUnitId)).map(m => ({ knowledgeUnitId: m.knowledgeUnitId, algorithmVersion: m.algorithmVersion, scores: skills(m) })) } };
        write(ctx, w, 'solo-badge-award', aid, award, null, award.seasonId ?? undefined);
        training.earnedBadges.push(badgeDto(award));
        xpEvents.push({ kind: 'milestone', amount: XP_VALUES.soloMilestone });
    }
    // Daily bonus quests: explorer / comeback progress from this attempt,
    // warmup on review-step completion, teammate on room membership.
    const questRes = await progressQuests(ctx, w, { localDate: xpDate, timeZone: p.timeZone, seasonId: session.seasonId, atUtc: at }, async api => {
        const has = (key: QuestKey) => api.quests.some(q => q.key === key && !q.completed);
        if (has('warmup') && reviewTransition)
            api.complete('warmup');
        if (has('explorer')) {
            const source = sources.find(s => kid(s) === attempt.knowledgeUnitId);
            if (source) {
                const chapterSources = sources.filter(s => s.bookKey === source.bookKey && s.chapter === source.chapter);
                const seenBefore = chapterSources.filter(s => kid(s) !== attempt.knowledgeUnitId && seen.includes(kid(s))).length;
                if (chapterSources.length > 0 && seenBefore / chapterSources.length < 0.5)
                    api.addProgress('explorer', 1);
            }
        }
        if (has('comeback')) {
            const weakest = [...states]
                .map(m => ({ id: m.knowledgeUnitId, total: m.exactWording + m.recognition + m.reference + m.sequence + m.factualRecall }))
                .sort((a, b) => a.total - b.total)
                .slice(0, 3)
                .map(x => x.id);
            if (weakest.includes(attempt.knowledgeUnitId))
                api.addProgress('comeback', 1, attempt.knowledgeUnitId);
        }
        if (has('teammate') && await inTeamRoom(ctx))
            api.complete('teammate');
    });
    xpEvents.push(...questRes.xpEvents);
    if (xpEvents.length) {
        const awarded = await awardXp(ctx, w, { seasonId: session.seasonId, localDate: xpDate, atUtc: at, events: xpEvents });
        training.xpEarned = (training.xpEarned ?? 0) + awarded.awarded;
        if (awarded.leveledUp)
            training.leveledUp = { from: training.leveledUp?.from ?? awarded.leveledUp.from, to: awarded.leveledUp.to };
    }
    // Serialize the final preference value after qualification changed its bounded week evidence.
    w.statements[0] = old ? ctx.store.update('training-preferences', p.id, ctx.orgId, p, old.revision) : ctx.store.insertion('training-preferences', p.id, ctx.orgId, p, { ownerId: ctx.actor.userId });
    return w;
}
const skills = (s: SkillScores): SkillScores => ({ exactWording: s.exactWording, recognition: s.recognition, reference: s.reference, sequence: s.sequence, factualRecall: s.factualRecall });
export async function makeRecap(ctx: RequestContext, s: Session): Promise<SessionRecap> {
    const t = s.training, mission = t?.missionId ? await ctx.store.get<MissionRecord>('daily-mission', t.missionId, ctx.orgId) : null;
    const xp = await xpSummary(ctx);
    const changes: SessionRecap['passageChanges'] = [];
    for (const id of new Set(s.attempts.filter(a => a.before && a.after && !a.isLegacyDuplicate).map(a => a.knowledgeUnitId))) {
        const attempts = s.attempts.filter(a => a.knowledgeUnitId === id && a.before && a.after && !a.isLegacyDuplicate), events = attempts.map(a => ({ attemptId: a.id, acceptedAtUtc: a.at, before: skills(a.before!), after: skills(a.after!) }));
        const delta = skills({ exactWording: 0, recognition: 0, reference: 0, sequence: 0, factualRecall: 0 });
        for (const e of events)
            for (const k of Object.keys(delta) as (keyof SkillScores)[])
                delta[k] += e.after[k] - e.before[k];
        const contiguous = events.every((e, i) => !i || attempts[i].previousAttemptId === events[i - 1].attemptId && JSON.stringify(e.before) === JSON.stringify(events[i - 1].after));
        changes.push({ knowledgeUnitId: id, title: attempts[0].result.citation, delta, before: contiguous ? events[0].before : null, after: contiguous ? events.at(-1)!.after : null, events });
    }
    return { version: t ? 'training-v1' : 'legacy-counts', sessionId: s.id, seasonId: s.seasonId, mode: s.mode, completedAtUtc: s.completedAtUtc ?? null, attempted: s.attempts.filter(a => !a.isLegacyDuplicate).length, correct: s.attempts.filter(a => !a.isLegacyDuplicate && a.isCorrect).length, targetCardCount: s.targetCardCount, fullTargetReached: fullTargetReached(s.targetCardCount, s.attempts), newlyCreditedDay: t?.newlyCreditedDay ?? false, missionLocalDate: t?.missionLocalDate ?? null, creditedLocalDate: t?.creditedLocalDate ?? null, weeklyGoalComplete: t?.weeklyGoalComplete ?? false, personalBest: null, xp: { earned: t?.xpEarned ?? 0, total: xp.total, level: xp.level, levelName: xp.levelName }, levelUp: t?.leveledUp ? { from: t.leveledUp.from, to: t.leveledUp.to, fromName: levelNameFor(t.leveledUp.from), toName: levelNameFor(t.leveledUp.to) } : null, missionSteps: mission && mission.value.revision === t?.missionRevision ? missionSteps(mission.value) : [], earnedBadges: t?.earnedBadges ?? [], questsCompleted: t?.questsCompleted ?? [], passageChanges: changes };
}
/** Streak milestone keys share the solo-badge pipeline but are academy-scoped (cross-season). */
const streakKeys = ['streak-7', 'streak-14', 'streak-30'] as const;
/** Award any newly-earned streak badges. Idempotent: skips keys already awarded. Used by the PBE effort path, which has no other badge pipeline. */
export async function awardStreakBadges(ctx: RequestContext, w: Writes, streak: number, at: string, evidenceSessionId: string): Promise<BadgeProgress[]> {
    const earned: BadgeProgress[] = [];
    for (const key of streakKeys) {
        const target = Number(key.split('-')[1]);
        if (streak < target)
            continue;
        const aid = identity(ctx, key, 'training-v1', 'academy'), existing = await ctx.store.get<AwardRecord>('solo-badge-award', aid, ctx.orgId);
        if (existing)
            continue;
        const award: AwardRecord = { id: aid, key, ruleVersion: 'training-v1', title: titles[key], completed: streak, target, earnedAtUtc: at, scopeLabel: 'Practice streak', evidenceSessionId, seasonId: null, scopeVersion: '', eligibleKnowledgeUnitIds: [] };
        write(ctx, w, 'solo-badge-award', aid, award, null);
        earned.push(badgeDto(award));
    }
    return earned;
}
export interface BestsRecord {
    id: string;
    mode: string;
    format: 'Memory' | 'Pbe';
    bestAccuracy: number;
    bestCorrect: number;
    sessionId: string;
    atUtc: string;
}
export interface BestsInput {
    mode: string;
    format: 'Memory' | 'Pbe';
    /** 0-100 accuracy-style score for this session. */
    accuracy: number;
    /** Whole-unit "correct" count for this session (fully-correct cards/questions). */
    correct: number;
    sessionId: string;
    atUtc: string;
}
/**
 * Compare one completed session's scores against the learner's stored personal
 * bests and queue bests-record writes. Returns which records this session set.
 * Shared by the Memory and PBE complete paths; called once per completion
 * (never from recap reads).
 */
export async function recordBests(ctx: RequestContext, input: BestsInput): Promise<{ writes: Writes; beaten: { accuracyBeaten: boolean; correctBeaten: boolean } }> {
    const w: Writes = { statements: [], guards: [] }, beaten = { accuracyBeaten: false, correctBeaten: false };
    const id = identity(ctx, input.mode, input.format), old = await ctx.store.get<BestsRecord>('training-bests', id, ctx.orgId), prev = old?.value;
    beaten.accuracyBeaten = !prev || input.accuracy > prev.bestAccuracy;
    beaten.correctBeaten = !prev || input.correct > prev.bestCorrect;
    if (beaten.accuracyBeaten || beaten.correctBeaten)
        write(ctx, w, 'training-bests', id, { id, mode: input.mode, format: input.format, bestAccuracy: Math.max(input.accuracy, prev?.bestAccuracy ?? 0), bestCorrect: Math.max(input.correct, prev?.bestCorrect ?? 0), sessionId: input.sessionId, atUtc: input.atUtc }, old);
    return { writes: w, beaten };
}
/**
 * Compare a completed Memory session against the learner's stored personal bests
 * and queue bests-record writes. Returns which records this session set.
 * Called once from the session-complete action (never from recap reads).
 */
export async function recordPersonalBests(ctx: RequestContext, session: Session): Promise<{ writes: Writes; beaten: { accuracyBeaten: boolean; correctBeaten: boolean } }> {
    const attempts = session.attempts.filter(a => !a.isLegacyDuplicate), attempted = attempts.length;
    if (!attempted)
        return { writes: { statements: [], guards: [] }, beaten: { accuracyBeaten: false, correctBeaten: false } };
    const correct = attempts.filter(a => a.isCorrect).length;
    return recordBests(ctx, { mode: session.mode, format: 'Memory', accuracy: correct / attempted * 100, correct, sessionId: session.id, atUtc: session.completedAtUtc ?? session.attempts.at(-1)?.at ?? new Date().toISOString() });
}
