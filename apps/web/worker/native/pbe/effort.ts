import { builtInContentSql } from '../application/library-access';
import type { RequestContext } from '../types';
import type { PbeSession } from './sessions';
import type { DayRecord, WeekRecord, Writes } from '../training/store';
import { identity, preference, resolvePreference, write } from '../training/store';
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
/** Stage participation only. No legacy mastery, badges or Honor evaluator is called. */
export async function preparePbeEffort(ctx: RequestContext, s: PbeSession, at: string): Promise<Writes> {
    const w: Writes = { statements: [], guards: [] }, old = await preference(ctx), p = resolvePreference(ctx, old, at), m = await ctx.store.require<PbeMission>('pbe-daily-mission', s.id, ctx.orgId);
    p.lastEventAtUtc = p.lastEventAtUtc > at ? p.lastEventAtUtc : at;
    const mission = { ...m.value, completed: s.attempts.length };
    write(ctx, w, 'pbe-daily-mission', s.id, mission, m, s.seasonId);
    if (s.cards.length > 0 && s.attempts.length === s.cards.length && !s.creditedLocalDate) {
        const c = resolveTrainingCalendar(at, p), dayId = identity(ctx, c.localDate), day = await ctx.store.get<DayRecord>('training-day', dayId, ctx.orgId);
        s.creditedLocalDate = c.localDate;
        if (!day) {
            s.newlyCreditedDay = true;
            write(ctx, w, 'training-day', dayId, { id: dayId, localDate: c.localDate, timeZone: c.timeZone, firstQualifiedAtUtc: at, sessionId: s.id, credited: true }, null);
            const wid = identity(ctx, c.weekStartLocalDate), oldWeek = await ctx.store.get<WeekRecord>('training-week', wid, ctx.orgId), week = oldWeek?.value ?? { id: wid, weekStartLocalDate: c.weekStartLocalDate, timeZone: c.timeZone, target: p.weeklyTarget, dates: Array.from({ length: 7 }, (_, i) => addDays(c.weekStartLocalDate, i)), creditedDates: [], qualifiedAtUtc: null };
            if (!week.creditedDates.includes(c.localDate))
                week.creditedDates.push(c.localDate);
            if (week.creditedDates.length >= week.target && !week.qualifiedAtUtc) {
                week.qualifiedAtUtc = at;
                if (p.qualifyingWeekStarts.length < 4 && !p.qualifyingWeekStarts.includes(week.weekStartLocalDate))
                    p.qualifyingWeekStarts.push(week.weekStartLocalDate);
            }
            write(ctx, w, 'training-week', wid, week, oldWeek);
        }
    }
    // The same preference revision serializes day/week races with Memory sessions.
    write(ctx, w, 'training-preferences', p.id, p, old);
    return w;
}
export const pbeMissionSteps = (s: PbeSession) => [{ kind: s.mode, target: s.cards.length, completed: s.attempts.length, status: s.attempts.length === s.cards.length ? 'Complete' : 'Active', sessionId: s.id }];
export async function pbeToday(ctx: RequestContext, season: import('../application/model').Season, now: string): Promise<import('../../../src/api/trainingTypes').TrainingToday> {
    const { resolvePbeSources, resolvePbeSessionSources } = await import('./sources'), { loadFromResolvedSources } = await import('./bank');
    const old = await preference(ctx), p = resolvePreference(ctx, old, now), c = resolveTrainingCalendar(now, p), week = (await ctx.store.get<WeekRecord>('training-week', identity(ctx, c.weekStartLocalDate), ctx.orgId))?.value;
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
    return { format: 'Pbe', seasonId: season.id, seasonName: season.name, seasonStatus: season.status, localDate: c.localDate, preferences: { timeZone: p.timeZone, weeklyTarget: p.weeklyTarget, pending: p.pending }, week: { weekStartLocalDate: c.weekStartLocalDate, timeZone: week?.timeZone ?? p.timeZone, target: week?.target ?? p.weeklyTarget, completedDays: week?.creditedDates.length ?? 0, days: Array.from({ length: 7 }, (_, i) => { const localDate = addDays(c.weekStartLocalDate, i); return { localDate, credited: week?.creditedDates.includes(localDate) ?? false, isToday: localDate === c.localDate }; }) }, mission: { id: s && !stale ? s.id : null, revision: s && !stale ? 1 : null, status: !available ? 'Unavailable' : stale ? 'Invalidated' : !s ? 'Suggested' : complete ? 'Complete' : 'Active', scopeVersion: scope.eligibility, steps, explanation: !available ? 'No published PBE questions are available for your assignment. Ask your coach to add questions, or choose Memory.' : stale ? 'Your assignment changed. Start updated training.' : null }, nextAction: available && next ? { label: next.sessionId && s?.status !== 'Completed' ? 'Resume PBE practice' : 'Start PBE practice', mode: next.kind, sessionId: s?.status === 'Completed' ? null : next.sessionId } : null, honors: [] };
}
