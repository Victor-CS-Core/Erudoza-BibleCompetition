import type { RequestContext } from '../types';
import { HttpError } from '../types';
import { atomic, studentAssignments, students, type Season } from '../application/model';
import { addDays, resolveTrainingCalendar } from './calendar';
import { trainingNow } from './clock';
import { identity, preference, resolvePreference, write, type PreferenceRecord, type Writes } from './store';
import { creditedDates, streakStatus } from './streak';
import { LEVELS, levelForXp, type XpRecord } from './xp';

/**
 * Gamification Phase 3 — peer momentum (spec §4).
 *
 * Team activity and the weekly XP leaderboard are club-scoped and privacy-first:
 * no names without opt-in, no DMs, no public boards. The leaderboard is opt-in
 * for students; coaches see the full board because they already see all student
 * data. Student viewers see masked names (first name + last initial).
 */

export interface TeamActivity {
    /** Teammates (excluding the viewer) with a credited day today. */
    practicedToday: number;
    /** Teammates (excluding the viewer) with a credited day in the last 7 local days. */
    practicedThisWeek: number;
    /** Students in the club. */
    memberCount: number;
}

/** Team activity strip data. No writes. Counts teammates only, never names. */
export async function teamActivity(ctx: RequestContext): Promise<TeamActivity> {
    const list = await students(ctx);
    const now = trainingNow();
    const calendar = resolveTrainingCalendar(now, resolvePreference(ctx, await preference(ctx), now));
    const today = calendar.localDate;
    const weekDates = Array.from({ length: 7 }, (_, i) => addDays(today, -i));
    const placeholders = weekDates.map(() => '?').join(',');
    const rows = await ctx.env.DB.prepare(
        `SELECT DISTINCT owner_id AS ownerId, json_extract(data,'$.localDate') AS localDate FROM Records WHERE kind='training-day' AND org_id=? AND json_extract(data,'$.localDate') IN (${placeholders})`
    ).bind(ctx.orgId, ...weekDates).all<{ ownerId: string; localDate: string }>();
    const me = ctx.actor.userId;
    const teammates = rows.results.filter(r => r.ownerId !== me);
    return {
        practicedToday: new Set(teammates.filter(r => r.localDate === today).map(r => r.ownerId)).size,
        practicedThisWeek: new Set(teammates.map(r => r.ownerId)).size,
        memberCount: list.length,
    };
}

export interface LeaderboardEntry {
    userId: string;
    /** Full name for coaches; masked (first name + last initial) for students. */
    displayName: string;
    xp: number;
    level: number;
    levelName: string;
}

/** Monday (week start) of the week containing a YYYY-MM-DD local date. */
export function mondayOfWeek(localDate: string): string {
    const dow = (new Date(`${localDate}T12:00:00Z`).getUTCDay() + 6) % 7;
    return addDays(localDate, -dow);
}

/** "Ada Lovelace" -> "Ada L." — the only name form students ever see. */
export function maskName(displayName: string): string {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return parts[0] ?? 'Teammate';
    return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export interface LeaderboardResponse {
    weekStartLocalDate: string;
    /** Ranked by weekly XP, descending. Students see opt-in teammates only. */
    entries: LeaderboardEntry[];
    /** The viewer's own standing; null for coaches (they are not on the board). */
    me: { userId: string; rank: number | null; xp: number; optedIn: boolean } | null;
}

/**
 * Weekly XP leaderboard. Students see only opted-in teammates (masked names);
 * coaches see every student with full names. `weekStart` may pin the week;
 * otherwise the current week (Monday start) in the viewer's timezone is used.
 */
export async function leaderboard(ctx: RequestContext, url: URL): Promise<LeaderboardResponse> {
    const isCoach = ctx.actor.kind !== 'Student';
    const list = await students(ctx);
    const now = trainingNow();
    const viewerCal = resolveTrainingCalendar(now, resolvePreference(ctx, await preference(ctx), now));
    const param = url.searchParams.get('weekStart');
    const weekStart = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : mondayOfWeek(viewerCal.localDate);
    const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

    const entries: LeaderboardEntry[] = [];
    let viewerOptedIn = false, viewerXp = 0;
    for (const s of list) {
        const lctx: RequestContext = { ...ctx, actor: { ...ctx.actor, userId: s.userId, kind: 'Student', role: 'Student' } };
        const [xpRow, prefRow] = await Promise.all([
            lctx.store.get<XpRecord>('training-xp', identity(lctx), lctx.orgId),
            preference(lctx),
        ]);
        const optedIn = (prefRow?.value as PreferenceRecord | undefined)?.leaderboardOptIn === true;
        const xp = weekDates.reduce((n, d) => n + (xpRow?.value.xpByDay[d] ?? 0), 0);
        const level = levelForXp(xpRow?.value.totalXp ?? 0);
        if (s.userId === ctx.actor.userId) {
            viewerOptedIn = optedIn;
            viewerXp = xp;
        }
        if (!isCoach && !optedIn) continue;
        entries.push({
            userId: s.userId,
            displayName: isCoach ? s.displayName : maskName(s.displayName),
            xp,
            level: level.level,
            levelName: level.levelName,
        });
    }
    entries.sort((a, b) => b.xp - a.xp || a.displayName.localeCompare(b.displayName));
    const rank = entries.findIndex(e => e.userId === ctx.actor.userId);
    return {
        weekStartLocalDate: weekStart,
        entries,
        me: isCoach ? null : { userId: ctx.actor.userId, rank: rank >= 0 ? rank + 1 : null, xp: viewerXp, optedIn: viewerOptedIn },
    };
}

export interface SeasonLeaderboardEntry {
    userId: string;
    /** Full name for coaches; masked (first name + last initial) for students. */
    displayName: string;
    /** Season XP — the board's primary ranking number (same value as seasonXp). */
    xp: number;
    seasonXp: number;
    weekXp: number;
    /** Current streak in credited practice days (single missed day tolerated). */
    streak: number;
    level: number;
    levelName: string;
}

export interface SeasonLeaderboardResponse {
    seasonId: string;
    seasonName: string;
    seasonStatus: string;
    weekStartLocalDate: string;
    /** Ranked by season XP, descending. Students see opt-in teammates only. */
    entries: SeasonLeaderboardEntry[];
    /**
     * The viewer's own numbers; their rank is read off `entries` (they are
     * listed only when opted in and assigned in the season). Null for coaches.
     */
    me: {
        userId: string;
        optedIn: boolean;
        seasonXp: number;
        weekXp: number;
        streak: number;
        totalXp: number;
        level: number;
        levelName: string;
        nextLevelName: string | null;
        xpIntoLevel: number;
        xpForNext: number;
    } | null;
}

/**
 * Season XP leaderboard. Board membership is the season: only students with
 * an assignment in the season are ranked (the same assignment-based season
 * discovery the student home uses). Ranking is by the per-season XP split
 * (`xpBySeason[seasonId]`); each entry also carries this week's XP (the same
 * Mon–Sun `xpByDay` sum as the weekly board) and the student's current
 * streak. Privacy matches the weekly board: students see opted-in teammates
 * with masked names; coaches see every member with full names.
 */
export async function seasonLeaderboard(ctx: RequestContext, seasonId: string, url?: URL): Promise<SeasonLeaderboardResponse> {
    const season = (await ctx.store.get<Season>('season', seasonId, ctx.orgId))?.value;
    if (!season) throw new HttpError(404, 'Season was not found.');
    const isCoach = ctx.actor.kind !== 'Student';
    const roster = await students(ctx);
    const assigned = new Set((await studentAssignments(ctx, seasonId)).map(a => a.studentUserId));
    const members = roster.filter(s => assigned.has(s.userId));
    const now = trainingNow();
    const viewerCal = resolveTrainingCalendar(now, resolvePreference(ctx, await preference(ctx), now));
    const param = url?.searchParams.get('weekStart');
    const weekStart = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : mondayOfWeek(viewerCal.localDate);
    const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

    const standing = async (lctx: RequestContext): Promise<{ seasonXp: number; weekXp: number; streak: number; totalXp: number; optedIn: boolean; level: ReturnType<typeof levelForXp>; nextLevelName: string | null }> => {
        const [xpRow, prefRow, credited] = await Promise.all([
            lctx.store.get<XpRecord>('training-xp', identity(lctx), lctx.orgId),
            preference(lctx),
            creditedDates(lctx),
        ]);
        const rec = xpRow?.value;
        const cal = resolveTrainingCalendar(now, resolvePreference(lctx, prefRow, now));
        const level = levelForXp(rec?.totalXp ?? 0);
        return {
            seasonXp: rec?.xpBySeason[seasonId] ?? 0,
            weekXp: weekDates.reduce((n, d) => n + (rec?.xpByDay[d] ?? 0), 0),
            streak: streakStatus(credited, cal.localDate).current,
            totalXp: rec?.totalXp ?? 0,
            optedIn: (prefRow?.value as PreferenceRecord | undefined)?.leaderboardOptIn === true,
            level,
            nextLevelName: LEVELS.find(l => l.level === level.level + 1)?.name ?? null,
        };
    };

    const entries: SeasonLeaderboardEntry[] = [];
    let me: SeasonLeaderboardResponse['me'] = null;
    for (const s of members) {
        const lctx: RequestContext = { ...ctx, actor: { ...ctx.actor, userId: s.userId, kind: 'Student', role: 'Student' } };
        const own = await standing(lctx);
        if (s.userId === ctx.actor.userId) {
            me = { userId: s.userId, optedIn: own.optedIn, seasonXp: own.seasonXp, weekXp: own.weekXp, streak: own.streak, totalXp: own.totalXp, level: own.level.level, levelName: own.level.levelName, nextLevelName: own.nextLevelName, xpIntoLevel: own.level.xpIntoLevel, xpForNext: own.level.xpForNext };
        }
        if (!isCoach && !own.optedIn) continue;
        entries.push({
            userId: s.userId,
            displayName: isCoach ? s.displayName : maskName(s.displayName),
            xp: own.seasonXp,
            seasonXp: own.seasonXp,
            weekXp: own.weekXp,
            streak: own.streak,
            level: own.level.level,
            levelName: own.level.levelName,
        });
    }
    entries.sort((a, b) => b.seasonXp - a.seasonXp || a.displayName.localeCompare(b.displayName));
    if (!isCoach && !me) {
        // A learner who is not assigned in this season can still view the
        // (masked, opt-in) board; their own standing is "not on this board".
        const own = await standing(ctx);
        me = { userId: ctx.actor.userId, optedIn: own.optedIn, seasonXp: own.seasonXp, weekXp: own.weekXp, streak: own.streak, totalXp: own.totalXp, level: own.level.level, levelName: own.level.levelName, nextLevelName: own.nextLevelName, xpIntoLevel: own.level.xpIntoLevel, xpForNext: own.level.xpForNext };
    }
    return { seasonId: season.id, seasonName: season.name, seasonStatus: season.status, weekStartLocalDate: weekStart, entries, me: isCoach ? null : me };
}

/** Flip the learner's leaderboard opt-in flag. Takes effect immediately. */
export async function setLeaderboardOptIn(ctx: RequestContext, optIn: unknown): Promise<{ leaderboardOptIn: boolean }> {
    if (typeof optIn !== 'boolean') throw new HttpError(400, 'optIn must be true or false.');
    for (let i = 0; ; i++) {
        try {
            const old = await preference(ctx);
            const p = resolvePreference(ctx, old, trainingNow());
            p.leaderboardOptIn = optIn;
            const w: Writes = { statements: [], guards: [] };
            write(ctx, w, 'training-preferences', p.id, p, old);
            await atomic(ctx, 'training.leaderboard-opt-in', w.statements, w.guards);
            return { leaderboardOptIn: optIn };
        }
        catch (e) {
            if (i >= 4 || !(e instanceof HttpError && e.status === 409 || String(e).includes('UNIQUE constraint failed'))) throw e;
        }
    }
}
