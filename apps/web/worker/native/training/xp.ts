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
}

/** Prune per-day history older than 90 days so the record stays small. */
function pruneDaily(maps: Pick<XpRecord, 'attemptXpByDay' | 'xpByDay'>, localDate: string) {
    const cutoff = addDays(localDate, -90);
    for (const m of [maps.attemptXpByDay, maps.xpByDay])
        for (const key of Object.keys(m)) if (key < cutoff) delete m[key];
}

/**
 * Award XP events into the learner's `training-xp` record, queuing the write
 * into `w`. Attempt-kind XP is capped at 300 per local day; all other kinds
 * bypass the cap. Returns the XP actually awarded and any level-up crossed.
 */
export async function awardXp(ctx: RequestContext, w: Writes, opts: AwardXpOptions): Promise<AwardXpResult> {
    const id = identity(ctx), old = await ctx.store.get<XpRecord>('training-xp', id, ctx.orgId);
    const rec: XpRecord = old?.value ?? { id, totalXp: 0, xpBySeason: {}, attemptXpByDay: {}, xpByDay: {}, updatedAtUtc: opts.atUtc };
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
        if (opts.seasonId) rec.xpBySeason[opts.seasonId] = (rec.xpBySeason[opts.seasonId] ?? 0) + amount;
        awarded += amount;
    }
    pruneDaily(rec, opts.localDate);
    rec.updatedAtUtc = opts.atUtc;
    if (awarded > 0 || !old) write(ctx, w, 'training-xp', id, rec, old);
    const toLevel = levelForXp(rec.totalXp).level;
    return { awarded, leveledUp: toLevel > fromLevel ? { from: fromLevel, to: toLevel } : null };
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
