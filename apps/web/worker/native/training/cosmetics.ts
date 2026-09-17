import type { RequestContext } from '../types';
import { COSMETIC_REQUIREMENTS, SET_TWO_STYLES } from '../mastery/character';
import type { HonorUnlock } from '../mastery/catalog';
import { bestStreak, creditedDates } from './streak';
import { levelForXp, type XpRecord } from './xp';

/**
 * Gamification Phase 3 — cosmetic unlock evaluation (spec §5).
 *
 * Unlock rules (evaluated worker-side; everything not listed is free,
 * including all hair colors):
 * - background:starlight → 7-day streak (bestStreak >= 7, any season)
 * - style:<set-2> → XP level 4 (Keeper) reached
 * - sash:2 → any Team Practice Honor earned
 * - sash:3 → any Simulation Honor earned
 */

export interface CosmeticLock {
    id: string;
    requirement: string;
}

/** IDs from COSMETIC_REQUIREMENTS the learner has earned. */
export async function unlockedCosmetics(ctx: RequestContext): Promise<Set<string>> {
    const unlocked = new Set<string>();
    const userId = ctx.actor.userId;
    const [xpRow, honorRows, credited] = await Promise.all([
        ctx.store.get<XpRecord>('training-xp', `${ctx.orgId}:${userId}`, ctx.orgId),
        ctx.env.DB.prepare(`SELECT data FROM Records WHERE kind='mastery-honor' AND org_id=? AND owner_id=?`).bind(ctx.orgId, userId).all<{ data: string }>(),
        creditedDates(ctx),
    ]);
    if (bestStreak(credited) >= 7) unlocked.add('background:starlight');
    if (levelForXp(xpRow?.value.totalXp ?? 0).level >= 4)
        for (const s of SET_TWO_STYLES) unlocked.add(`style:${s}`);
    const keys = honorRows.results.map(r => (JSON.parse(r.data) as HonorUnlock).key);
    if (keys.some(k => k.startsWith('team:'))) unlocked.add('sash:2');
    if (keys.some(k => k.startsWith('simulation:'))) unlocked.add('sash:3');
    return unlocked;
}

/** Locked cosmetics with their requirement copy (for the creator UI). */
export function lockedCosmetics(unlocked: ReadonlySet<string>): CosmeticLock[] {
    return Object.entries(COSMETIC_REQUIREMENTS)
        .filter(([id]) => !unlocked.has(id))
        .map(([id, requirement]) => ({ id, requirement }));
}
