import type { RequestContext } from '../types';
import { identity, write, type Writes } from './store';
import { addDays } from './calendar';

/**
 * Gamification Phase 2 — XP and levels.
 *
 * One `training-xp` record per learner (id `orgId:userId`) holds the lifetime
 * total plus a per-season split. Attempt XP is anti-grind capped at 300/day;
 * every other event kind bypasses the cap. Levels are derived from the total,
 * so they can never drift from it.
 */

export interface XpLevel {
    level: number;
    name: string;
    /** Cumulative XP required to reach this level. */
    xp: number;
}

export const LEVELS: XpLevel[] = [
    { level: 1, name: 'Seedling', xp: 0 },
    { level: 2, name: 'Seeker', xp: 100 },
    { level: 3, name: 'Reader', xp: 250 },
    { level: 4, name: 'Keeper', xp: 500 },
    { level: 5, name: 'Scribe', xp: 900 },
    { level: 6, name: 'Scholar', xp: 1400 },
    { level: 7, name: 'Guide', xp: 2000 },
    { level: 8, name: 'Torchbearer', xp: 2800 },
];

export const MAX_LEVEL = LEVELS[LEVELS.length - 1];

/** Level for a lifetime XP total. Pure — safe to call from read paths. */
export function levelForXp(totalXp: number): { level: number; levelName: string; xpIntoLevel: number; xpForNext: number } {
    const total = Math.max(0, Math.floor(totalXp));
    let current = LEVELS[0];
    for (const l of LEVELS) {
        if (total >= l.xp) current = l;
        else break;
    }
    const next = LEVELS.find(l => l.level === current.level + 1) ?? null;
    return {
        level: current.level,
        levelName: current.name,
        xpIntoLevel: total - current.xp,
        xpForNext: next ? next.xp - total : 0,
    };
}

/** Level name for a level number (recap banners). */
export function levelNameFor(level: number): string {
    return LEVELS.find(l => l.level === level)?.name ?? '';
}

/** Per-event XP values (spec §3). Attempt events are capped; the rest are not. */
export const XP_VALUES = {
    attemptCorrectNoHints: 10,
    attemptCorrectHints: 6,
    attemptIncorrect: 2,
    dayCredited: 50,
    reviewStepCompleted: 30,
    questCompleted: 25,
    dailyTripleBonus: 25,
    soloMilestone: 100,
    profileHonor: 150,
} as const;

/** Attempt XP accepted per local day before the anti-grind cap bites. */
export const DAILY_ATTEMPT_XP_CAP = 300;

export interface XpRecord {
    id: string;
    totalXp: number;
    xpBySeason: Record<string, number>;
    /** Attempt-kind XP per local day (anti-grind cap accounting). */
    attemptXpByDay: Record<string, number>;
    /** All XP per local day (powers the coach weekly sparkline). */
    xpByDay: Record<string, number>;
    /** XP per local day split by season (seasonId -> localDate -> xp); powers the season board's week XP. Absent on legacy records. */
    xpByDaySeason?: Record<string, Record<string, number>>;
    updatedAtUtc: string;
}

export type XpEventKind = 'attempt' | 'day' | 'review' | 'quest' | 'milestone' | 'honor';

export interface XpEvent {
    kind: XpEventKind;
    amount: number;
}

export interface AwardXpOptions {
    /** Season split bucket; omit for non-season XP (e.g. teammate quest edge cases). */
    seasonId?: string;
    /** Learner-local date the XP was earned (cap + history accounting). */
    localDate: string;
    atUtc: string;
    events: XpEvent[];
}

export interface AwardXpResult {
    awarded: number;
    leveledUp: { from: number; to: number } | null;
    /** Lifetime total immediately before / after this award (authoritative — read from the record the award mutated). */
    totalBefore: number;
    totalAfter: number;
}

/** One learner's level state at a specific lifetime total. */
export interface XpLevelSnapshot {
    total: number;
    level: number;
    levelName: string;
    xpIntoLevel: number;
    xpForNext: number;
}

/** Level snapshot for a lifetime total (pure derivation from the curve). */
export function levelSnapshot(totalXp: number): XpLevelSnapshot {
    const total = Math.max(0, Math.floor(totalXp));
    return { total, ...levelForXp(total) };
}

/**
 * The per-attempt reward payload the client animates: the XP this attempt
 * actually earned plus the learner's level state immediately before and
 * after, all computed here from the award's own record — the client never
 * recomputes totals or curve math.
 */
export interface XpReward {
    earned: number;
    before: XpLevelSnapshot;
    after: XpLevelSnapshot;
}

export function xpReward(totalBefore: number, totalAfter: number): XpReward {
    return { earned: totalAfter - totalBefore, before: levelSnapshot(totalBefore), after: levelSnapshot(totalAfter) };
}

/** Prune per-day history older than 400 days so the record stays small (400 days keeps a full season's pinned weeks reachable). */
function pruneDaily(maps: Pick<XpRecord, 'attemptXpByDay' | 'xpByDay' | 'xpByDaySeason'>, localDate: string) {
    const cutoff = addDays(localDate, -400);
    for (const m of [maps.attemptXpByDay, maps.xpByDay])
        for (const key of Object.keys(m)) if (key < cutoff) delete m[key];
    if (maps.xpByDaySeason)
        for (const seasonId of Object.keys(maps.xpByDaySeason)) {
            const byDay = maps.xpByDaySeason[seasonId];
            for (const key of Object.keys(byDay)) if (key < cutoff) delete byDay[key];
            if (!Object.keys(byDay).length) delete maps.xpByDaySeason[seasonId];
        }
}

/**
 * Award XP events into the learner's `training-xp` record, queuing the write
 * into `w`. Attempt-kind XP is capped at 300 per local day; all other kinds
 * bypass the cap. Returns the XP actually awarded and any level-up crossed.
 */
export async function awardXp(ctx: RequestContext, w: Writes, opts: AwardXpOptions): Promise<AwardXpResult> {
    const id = identity(ctx), old = await ctx.store.get<XpRecord>('training-xp', id, ctx.orgId);
    const rec: XpRecord = old?.value ?? { id, totalXp: 0, xpBySeason: {}, attemptXpByDay: {}, xpByDay: {}, xpByDaySeason: {}, updatedAtUtc: opts.atUtc };
    rec.xpByDaySeason ??= {};
    const totalBefore = rec.totalXp;
    const fromLevel = levelForXp(rec.totalXp).level;
    let awarded = 0;
    for (const event of opts.events) {
        let amount = Math.max(0, Math.floor(event.amount));
        if (event.kind === 'attempt') {
            const dayTotal = rec.attemptXpByDay[opts.localDate] ?? 0;
            amount = Math.min(amount, Math.max(0, DAILY_ATTEMPT_XP_CAP - dayTotal));
            if (amount <= 0) continue;
            rec.attemptXpByDay[opts.localDate] = dayTotal + amount;
        }
        rec.totalXp += amount;
        rec.xpByDay[opts.localDate] = (rec.xpByDay[opts.localDate] ?? 0) + amount;
        if (opts.seasonId) {
            rec.xpBySeason[opts.seasonId] = (rec.xpBySeason[opts.seasonId] ?? 0) + amount;
            const byDay = rec.xpByDaySeason![opts.seasonId] ??= {};
            byDay[opts.localDate] = (byDay[opts.localDate] ?? 0) + amount;
        }
        awarded += amount;
    }
    pruneDaily(rec, opts.localDate);
    rec.updatedAtUtc = opts.atUtc;
    if (awarded > 0 || !old) write(ctx, w, 'training-xp', id, rec, old);
    const toLevel = levelForXp(rec.totalXp).level;
    return { awarded, leveledUp: toLevel > fromLevel ? { from: fromLevel, to: toLevel } : null, totalBefore, totalAfter: rec.totalXp };
}

export interface XpSummary {
    total: number;
    level: number;
    levelName: string;
    xpIntoLevel: number;
    xpForNext: number;
}

/** Read-only XP summary for `today()` and recap responses. */
export async function xpSummary(ctx: RequestContext): Promise<XpSummary> {
    const rec = (await ctx.store.get<XpRecord>('training-xp', identity(ctx), ctx.orgId))?.value;
    const total = rec?.totalXp ?? 0;
    return { total, ...levelForXp(total) };
}

/** XP earned on one learner-local date (all kinds). */
export async function xpOnDate(ctx: RequestContext, localDate: string): Promise<number> {
    const rec = (await ctx.store.get<XpRecord>('training-xp', identity(ctx), ctx.orgId))?.value;
    return rec?.xpByDay[localDate] ?? 0;
}

/** XP per local date for a list of dates (coach sparkline input). */
export async function xpByDates(ctx: RequestContext, localDates: string[]): Promise<number[]> {
    const rec = (await ctx.store.get<XpRecord>('training-xp', identity(ctx), ctx.orgId))?.value;
    return localDates.map(d => rec?.xpByDay[d] ?? 0);
}
