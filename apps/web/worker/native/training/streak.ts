import { addDays } from './calendar';
import type { RequestContext } from '../types';

/** How a student's practice streak currently stands. */
export type StreakDisplayState = 'active' | 'paused' | 'none';

export interface StreakStatus {
    /** Consecutive credited practice days, tolerating isolated single-day misses. */
    current: number;
    state: StreakDisplayState;
}

/**
 * Count consecutive credited days ending at `anchor` (a localDate like '2026-09-17').
 * A single missed day is forgiven (the streak pauses, the count is preserved);
 * two missed days in a row end the run. Walks back at most 400 days.
 */
export function streakCount(credited: Set<string>, anchor: string): number {
    let count = 0, gaps = 0, cursor = anchor;
    for (let i = 0; i < 400; i++) {
        if (credited.has(cursor)) {
            count++;
            // A credited day ends the pause: only *consecutive* misses break the run.
            gaps = 0;
        }
        else {
            gaps++;
            if (gaps > 1) break;
        }
        cursor = addDays(cursor, -1);
    }
    return count;
}

/** Best (longest) streak visible in the credited-day history. */
export function bestStreak(credited: Set<string>): number {
    let best = 0;
    for (const date of credited) best = Math.max(best, streakCount(credited, date));
    return best;
}

/**
 * Student-facing streak status for `localDate` (today in the learner's time zone).
 * - today credited -> active (practice extends the count)
 * - only yesterday credited -> active (practice today to keep it going)
 * - only the day before credited -> paused (one missed day; practice today to resume the count)
 * - otherwise -> none
 */
export function streakStatus(credited: Set<string>, localDate: string): StreakStatus {
    if (credited.has(localDate)) return { current: streakCount(credited, localDate), state: 'active' };
    const yesterday = addDays(localDate, -1);
    if (credited.has(yesterday)) return { current: streakCount(credited, yesterday), state: 'active' };
    const dayBefore = addDays(localDate, -2);
    if (credited.has(dayBefore)) return { current: streakCount(credited, dayBefore), state: 'paused' };
    return { current: 0, state: 'none' };
}

/** All credited practice-day dates for the learner behind `ctx`. */
export async function creditedDates(ctx: RequestContext): Promise<Set<string>> {
    const rows = await ctx.store.list<{ credited: boolean; localDate: string }>('training-day', ctx.orgId, { ownerId: ctx.actor.userId, limit: 5000 });
    return new Set(rows.filter(d => d.credited).map(d => d.localDate));
}
