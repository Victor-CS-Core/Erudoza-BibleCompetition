import { pbeToday } from '../pbe/effort';
import type { RequestContext } from '../types';
import { HttpError } from '../types';
import { effectiveSources, requiredSources } from '../application/model';
import type { Season, Assignment, Source } from '../application/model';
import type { Mastery } from '../study/routes';
import type { TrainingToday, PassageJourneyPage } from '../../../src/api/trainingTypes';
import { addDays, resolveTrainingCalendar } from './calendar';
import { trainingNow } from './clock';
import { badgeCounters } from './rules';
import { isScoredMasteryVersion } from '../study/engine';
import { bestStreak, creditedDates, streakStatus } from './streak';
import { xpSummary } from './xp';
import { getDailyQuests, questDto } from './quests';
import { catalog, identity, kid, missionComplete, missionSteps, preference, resolvePreference, scopeVersion } from './store';
import type { AwardRecord, MissionHead, MissionRecord, SeasonProgressRecord, WeekRecord } from './store';
export async function trainingScope(ctx: RequestContext, requested: string | null) { const assignments = await ctx.store.list<Assignment>('assignment', ctx.orgId, { ownerId: ctx.actor.userId }); const introductions=await ctx.store.list<{seasonId:string}>('pbe-introduction-assignment',ctx.orgId,{ownerId:ctx.actor.userId}); const seasons = await ctx.store.list<Season>('season', ctx.orgId); const withAssignment = seasons.filter(s => (assignments.some(a => a.seasonId === s.id)||s.pbeEnabled&&introductions.some(a=>a.seasonId===s.id))); const byNewest = (a: Season, b: Season) => (b.createdAtUtc ?? '').localeCompare(a.createdAtUtc ?? ''); const season = withAssignment.filter(s => (requested ? s.id === requested : s.status === 'Active')).sort(byNewest)[0]
    // Fallback: when the student's only assignments sit in a season that has
    // not started yet, surface that season (status as-is) so the home page can
    // say "Training opens when this season is Active" instead of the
    // misleading "Not assigned". Sources below still resolve only for Active
    // seasons, so nothing becomes studyable early.
    ?? (requested ? null : withAssignment.sort(byNewest)[0] ?? null); const sources = season && season.status === 'Active' ? await effectiveSources(ctx, season.id, ctx.actor.userId) : []; const required = season ? requiredSources(sources, assignments.filter(a => a.seasonId === season.id)) : []; return { season, sources, requiredSources: required, fingerprint: await scopeVersion(sources) }; }
export async function honors(ctx: RequestContext, seasonId: string | null, streak = 0, precomputed?: { season: Season | null; sources: Source[]; requiredSources: Source[]; fingerprint: string }) {
    // today() already derived the scope for the same season; reuse it instead of deriving twice.
    const scope = precomputed ?? await trainingScope(ctx, seasonId), p = await preference(ctx);
    const projection = scope.season ? await ctx.store.get<SeasonProgressRecord>('training-season-progress', identity(ctx, scope.season.id, scope.fingerprint), ctx.orgId) : null;
    const ids = Object.keys((await import('./store')).titles).map(key => identity(ctx, key, 'training-v1', key === 'steady-study' || key.startsWith('streak-') ? 'academy' : scope.season?.id ?? ''));
    const awards = (await ctx.store.getMany<AwardRecord>('solo-badge-award', ids, ctx.orgId)).map(r => r.value);
    const counters = projection?.value.counters ?? badgeCounters(scope.sources.map(s => ({ id: kid(s), bookKey: s.bookKey, chapter: s.chapter })), [], [], p?.value.qualifyingWeekStarts.length ?? 0, false);
    if (!projection) counters['full-coverage'] = [0, scope.requiredSources.length];
    counters['steady-study'] = [Math.min(4, p?.value.qualifyingWeekStarts.length ?? 0), 4];
    // Streak counters are always recomputed fresh so stale projections never under-report.
    counters['streak-7'] = [Math.min(7, streak), 7];
    counters['streak-14'] = [Math.min(14, streak), 14];
    counters['streak-30'] = [Math.min(30, streak), 30];
    return catalog(counters, awards);
}
export async function today(ctx: RequestContext, seasonId: string | null, now = trainingNow(), deviceTimeZone?: string): Promise<TrainingToday> {
    // Read-only: the device zone shapes the displayed calendar, but the stored
    // preference is only healed on session start (which already writes).
    const old = await preference(ctx), p = resolvePreference(ctx, old, now, deviceTimeZone), c = resolveTrainingCalendar(now, p), scope = await trainingScope(ctx, seasonId);
    if(scope.season?.pbeEnabled&&scope.season.status==='Active')return pbeToday(ctx,scope.season,now,deviceTimeZone);
    const week = (await ctx.store.get<WeekRecord>('training-week', identity(ctx, c.weekStartLocalDate), ctx.orgId))?.value;
    const head = scope.season ? (await ctx.store.get<MissionHead>('daily-mission-head', identity(ctx, scope.season.id, c.localDate), ctx.orgId))?.value : null;
    const m = head ? (await ctx.store.get<MissionRecord>('daily-mission', head.missionId, ctx.orgId))?.value : null;
    const stale = !!m && (m.invalidated || m.scopeVersion !== scope.fingerprint);
    const states = (!m || stale) && scope.season ? await ctx.store.list<Mastery>('mastery', ctx.orgId, { seasonId: scope.season.id, ownerId: ctx.actor.userId }) : [];
    const due = Math.min(8, new Set(states.filter(m => Date.parse(m.reviewDueAt) <= Date.parse(now) && scope.requiredSources.some(s => kid(s) === m.knowledgeUnitId)).map(m => m.knowledgeUnitId)).size);
    const available = !!scope.sources.length;
    const steps = m && !stale ? missionSteps(m) : [{ kind: 'Review' as const, target: due, completed: 0, status: due ? 'Pending' as const : 'NotNeeded' as const, sessionId: null }, { kind: 'Practice' as const, target: 8, completed: 0, status: 'Pending' as const, sessionId: null }];
    const linked = await ctx.store.getMany<import('../study/routes').Session>('session', steps.flatMap(s => s.sessionId ? [s.sessionId] : []), ctx.orgId);
    for (const step of steps)
        if (step.sessionId && linked.some(s => s.value.id === step.sessionId && ['Completed', 'Abandoned'].includes(s.value.status)) && step.status !== 'Complete') {
            step.sessionId = null;
            step.status = 'Pending';
        }
    const next = steps.find(s => s.kind === 'Review' && !['NotNeeded', 'Complete'].includes(s.status)) ?? steps.find(s => s.kind === 'Practice' && s.status !== 'Complete');
    const credited = await creditedDates(ctx), streak = streakStatus(credited, c.localDate);
    const xp = await xpSummary(ctx);
    return { seasonId: scope.season?.id ?? null, seasonName: scope.season?.name ?? '', seasonStatus: scope.season?.status ?? 'None', localDate: c.localDate, preferences: { timeZone: p.timeZone, weeklyTarget: p.weeklyTarget, pending: p.pending }, week: { weekStartLocalDate: c.weekStartLocalDate, timeZone: week?.timeZone ?? p.timeZone, target: week?.target ?? p.weeklyTarget, completedDays: week?.creditedDates.length ?? 0, days: Array.from({ length: 7 }, (_, i) => { const localDate = addDays(c.weekStartLocalDate, i); return { localDate, credited: week?.creditedDates.includes(localDate) ?? false, isToday: localDate === c.localDate }; }) }, mission: { id: stale ? null : m?.id ?? null, revision: stale ? null : m?.revision ?? null, status: !available ? 'Unavailable' : stale ? 'Invalidated' : !m ? 'Suggested' : missionComplete(m) ? 'Complete' : 'Active', scopeVersion: scope.fingerprint, steps, explanation: !available ? (scope.season && scope.season.status !== 'Active' ? 'Training opens when this season is Active.' : 'Your coach has not given you any passages yet.') : stale ? "Your passages changed — start today's training to pick up the new ones." : due === 0 && !m ? 'Nothing is due for review.' : null }, nextAction: available && next ? { label: next.sessionId ? 'Resume training' : next.kind === 'Review' ? 'Start daily review' : 'Start practice drill', mode: next.kind, sessionId: next.sessionId } : null, honors: await honors(ctx, scope.season?.id ?? null, streak.current, scope), xp: { total: xp.total, level: xp.level, levelName: xp.levelName, xpIntoLevel: xp.xpIntoLevel, xpForNext: xp.xpForNext }, quests: (await getDailyQuests(ctx, c.localDate, now)).map(questDto), streak: { current: streak.current, best: bestStreak(credited), state: streak.state }, streakNudge: streak.state === 'paused' };
}
export async function journey(ctx: RequestContext, seasonId: string | null, after: string | null): Promise<PassageJourneyPage> {
    if (after && !/^\d+$/.test(after))
        throw new HttpError(400, 'Invalid journey cursor.');
    const scope = await trainingScope(ctx, seasonId), offset = Number(after ?? 0);
    if (offset > 5000)
        throw new HttpError(400, 'Invalid journey cursor.');
    const states = scope.season ? await ctx.store.list<Mastery>('mastery', ctx.orgId, { seasonId: scope.season.id, ownerId: ctx.actor.userId }) : [];
    const sources = [...scope.sources].sort((a, b) => a.bookKey.localeCompare(b.bookKey) || a.chapter - b.chapter || a.ordinal - b.ordinal), page = sources.slice(offset, offset + 100), chapters: PassageJourneyPage['chapters'] = [];
    for (const source of page) {
        let chapter = chapters.find(c => c.bookKey === source.bookKey && c.chapter === source.chapter);
        if (!chapter) {
            const all = sources.filter(s => s.bookKey === source.bookKey && s.chapter === source.chapter);
            chapter = { bookKey: source.bookKey, chapter: source.chapter, scopeLabel: 'Assigned scope', eligibleCount: all.length, seenCount: all.filter(s => states.some(m => m.knowledgeUnitId === kid(s))).length, strongCount: all.filter(s => states.some(m => m.knowledgeUnitId === kid(s) && isScoredMasteryVersion(m.algorithmVersion) && ['Strong', 'Mastered'].includes(m.level))).length, passages: [] };
            chapters.push(chapter);
        }
        const m = states.find(m => m.knowledgeUnitId === kid(source));
        chapter.passages.push({ knowledgeUnitId: kid(source), title: source.citation, level: m?.level ?? 'Unseen', algorithmVersion: m?.algorithmVersion ?? 'Unknown', skills: { exactWording: m?.exactWording ?? 0, recognition: m?.recognition ?? 0, reference: m?.reference ?? 0, sequence: m?.sequence ?? 0, factualRecall: m?.factualRecall ?? 0 }, dueAtUtc: m?.reviewDueAt ?? null });
    }
    return { seasonId: scope.season?.id ?? seasonId ?? '', scopeVersion: scope.fingerprint, after: offset + 100 < sources.length ? String(offset + 100) : null, chapters };
}
