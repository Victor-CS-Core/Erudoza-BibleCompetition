import type { RequestContext } from '../types';
import { identity, write, type Writes } from './store';
import { XP_VALUES, type XpEvent } from './xp';

/**
 * Gamification Phase 2 — daily bonus quests (spec §6).
 *
 * Three quests per learner-local day, generated deterministically from
 * `userId:localDate` so the read path (`today()`) and the write paths
 * (attempt/session completion) agree without extra coordination. One
 * `training-quest` record per learner per day (id `orgId:userId:localDate`)
 * holds progress. Quest XP (25 each, +25 triple bonus) bypasses the
 * attempt-XP daily cap. Quests are always bonus — they never gate the
 * coach-assigned mission.
 */

export type QuestKey = 'warmup' | 'sharpshooter' | 'explorer' | 'comeback' | 'marathon' | 'teammate';

export interface QuestDef {
    key: QuestKey;
    title: string;
    description: string;
    target: number;
}

export const QUEST_DEFS: Record<QuestKey, QuestDef> = {
    warmup: { key: 'warmup', title: 'Warm-up', description: "Complete today's Review step", target: 1 },
    sharpshooter: { key: 'sharpshooter', title: 'Sharpshooter', description: 'Score 90% or better in one Practice session', target: 1 },
    explorer: { key: 'explorer', title: 'Explorer', description: 'Practice a chapter you have seen less than half of', target: 1 },
    comeback: { key: 'comeback', title: 'Comeback', description: 'Practice 3 of your weakest passages', target: 3 },
    marathon: { key: 'marathon', title: 'Marathon', description: 'Reach the full session target', target: 1 },
    teammate: { key: 'teammate', title: 'Teammate', description: 'Join a Team Practice room', target: 1 },
};

export interface QuestState {
    key: QuestKey;
    title: string;
    description: string;
    target: number;
    progress: number;
    completed: boolean;
    xpAwarded: boolean;
    /** Distinct passage ids already counted (used by comeback's target of 3). */
    countedIds?: string[];
}

export interface QuestRecord {
    id: string;
    localDate: string;
    timeZone: string;
    quests: QuestState[];
    tripleAwarded: boolean;
}

/** FNV-1a hash → 32-bit seed. */
function hashSeed(str: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed: number) {
    let a = seed;
    return () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Deterministically pick 3 quests from the eligible pool. Pure. */
export function generateDailyQuests(userId: string, localDate: string, eligible: QuestKey[]): QuestState[] {
    const rng = mulberry32(hashSeed(`${userId}:${localDate}`));
    const pool = [...eligible];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 3).map(key => {
        const d = QUEST_DEFS[key];
        return { key, title: d.title, description: d.description, target: d.target, progress: 0, completed: false, xpAwarded: false };
    });
}

export interface QuestEligibility {
    reviewDueCount: number;
    roomsOpen: boolean;
}

/** Eligibility inputs for today's quest pool. */
export async function questEligibility(ctx: RequestContext, atUtc: string): Promise<QuestEligibility> {
    const due = await ctx.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM Records WHERE kind='mastery' AND org_id=? AND owner_id=? AND json_extract(data,'$.reviewDueAt') <= ?`
    ).bind(ctx.orgId, ctx.actor.userId, atUtc).first<{ n: number }>();
    const open = await ctx.env.DB.prepare(
        `SELECT 1 FROM Records WHERE kind='room' AND org_id=? AND json_extract(data,'$.status') IN ('Lobby','Playing') LIMIT 1`
    ).bind(ctx.orgId).first();
    return { reviewDueCount: due?.n ?? 0, roomsOpen: !!open };
}

export function eligibleQuestKeys(e: QuestEligibility): QuestKey[] {
    const keys: QuestKey[] = ['sharpshooter', 'explorer', 'comeback', 'marathon'];
    if (e.reviewDueCount > 0) keys.push('warmup');
    if (e.roomsOpen) keys.push('teammate');
    return keys;
}

/**
 * Read-only daily quests for `today()`. Returns the stored record when the
 * learner already has progress; otherwise the deterministic preview (the
 * write path generates and stores the identical set on first progress).
 */
export async function getDailyQuests(ctx: RequestContext, localDate: string, atUtc: string): Promise<QuestState[]> {
    const stored = await ctx.store.get<QuestRecord>('training-quest', identity(ctx, localDate), ctx.orgId);
    if (stored) return stored.value.quests;
    const e = await questEligibility(ctx, atUtc);
    return generateDailyQuests(ctx.actor.userId, localDate, eligibleQuestKeys(e));
}

/** True when the learner is currently a member of any team practice room. */
export async function inTeamRoom(ctx: RequestContext): Promise<boolean> {
    const row = await ctx.env.DB.prepare(
        `SELECT 1 FROM Records WHERE kind='room' AND org_id=? AND EXISTS (SELECT 1 FROM json_each(json_extract(data,'$.memberIds')) WHERE value=?) LIMIT 1`
    ).bind(ctx.orgId, ctx.actor.userId).first();
    return !!row;
}

export interface QuestProgressApi {
    quests: QuestState[];
    /** Add progress; completes and queues XP when the target is reached. */
    addProgress(key: QuestKey, amount: number, distinctId?: string): void;
    /** Mark complete outright. */
    complete(key: QuestKey): void;
}

export interface QuestUpdateContext {
    localDate: string;
    timeZone: string;
    seasonId?: string;
    atUtc: string;
}

export interface ProgressQuestsResult {
    completedNow: QuestKey[];
    /** XP events for newly completed quests + the triple bonus (caller awards). */
    xpEvents: XpEvent[];
    tripleBonus: boolean;
}

/**
 * Apply a progress update to today's quest record, generating and storing it
 * when absent. Returns XP events for newly completed quests plus the 25 XP
 * triple bonus when all three land; the caller awards them together with its
 * other XP in a single `awardXp` call (one read-modify-write per request).
 */
export async function progressQuests(
    ctx: RequestContext,
    w: Writes,
    qctx: QuestUpdateContext,
    update: (api: QuestProgressApi) => void | Promise<void>,
): Promise<ProgressQuestsResult> {
    const id = identity(ctx, qctx.localDate), old = await ctx.store.get<QuestRecord>('training-quest', id, ctx.orgId);
    let rec: QuestRecord;
    if (old) {
        rec = old.value;
    } else {
        const e = await questEligibility(ctx, qctx.atUtc);
        rec = { id, localDate: qctx.localDate, timeZone: qctx.timeZone, quests: generateDailyQuests(ctx.actor.userId, qctx.localDate, eligibleQuestKeys(e)), tripleAwarded: false };
    }
    const completedNow: QuestKey[] = [];
    let dirty = false;
    const finish = (q: QuestState) => {
        q.completed = true;
        q.progress = q.target;
        dirty = true;
        completedNow.push(q.key);
    };
    const api: QuestProgressApi = {
        quests: rec.quests,
        addProgress(key, amount, distinctId) {
            const q = rec.quests.find(q => q.key === key);
            if (!q || q.completed) return;
            if (distinctId) {
                q.countedIds ??= [];
                if (q.countedIds.includes(distinctId)) return;
                q.countedIds.push(distinctId);
            }
            q.progress = Math.min(q.target, q.progress + amount);
            if (q.progress >= q.target) finish(q);
            else dirty = true;
        },
        complete(key) {
            const q = rec.quests.find(q => q.key === key);
            if (!q || q.completed) return;
            finish(q);
        },
    };
    await update(api);
    const xpEvents: XpEvent[] = [];
    for (const key of completedNow) {
        const q = rec.quests.find(q => q.key === key)!;
        if (!q.xpAwarded) {
            q.xpAwarded = true;
            xpEvents.push({ kind: 'quest', amount: XP_VALUES.questCompleted });
        }
    }
    let tripleBonus = false;
    if (rec.quests.length > 0 && rec.quests.every(q => q.completed) && !rec.tripleAwarded) {
        rec.tripleAwarded = true;
        tripleBonus = true;
        dirty = true;
        xpEvents.push({ kind: 'quest', amount: XP_VALUES.dailyTripleBonus });
    }
    // Write the record when it is new or when progress actually changed.
    if (!old || dirty)
        write(ctx, w, 'training-quest', id, rec, old);
    return { completedNow, xpEvents, tripleBonus };
}

/** Quest DTO for the `today()` response. */
export function questDto(q: QuestState) {
    return { key: q.key, title: q.title, description: q.description, target: q.target, progress: q.progress, completed: q.completed };
}

/** This week's quest rollup for the coach dashboard. */
export async function questWeek(ctx: RequestContext, weekStartLocalDate: string): Promise<{ completedThisWeek: number; totalThisWeek: number; rate: number }> {
    const { addDays } = await import('./calendar');
    const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStartLocalDate, i));
    const ids = dates.map(d => identity(ctx, d));
    const rows = await ctx.store.getMany<QuestRecord>('training-quest', ids, ctx.orgId);
    let completed = 0, total = 0;
    for (const r of rows) {
        for (const q of r.value.quests) {
            total++;
            if (q.completed) completed++;
        }
    }
    return { completedThisWeek: completed, totalThisWeek: total, rate: total ? completed / total : 0 };
}

/**
 * Session-complete quest hook shared by the Memory and PBE complete actions.
 * Sharpshooter needs ≥90% accuracy in a Practice session; marathon needs the
 * full session target. Returns quest XP events for the caller to award with
 * its other XP in a single `awardXp` call.
 */
export async function sessionCompleteQuests(
    ctx: RequestContext,
    w: Writes,
    qctx: QuestUpdateContext,
    opts: { mode: string; accuracy: number; fullTargetReached: boolean },
): Promise<XpEvent[]> {
    const res = await progressQuests(ctx, w, qctx, api => {
        if (opts.mode === 'Practice' && opts.accuracy >= 90) api.complete('sharpshooter');
        if (opts.fullTargetReached) api.complete('marathon');
    });
    return res.xpEvents;
}
