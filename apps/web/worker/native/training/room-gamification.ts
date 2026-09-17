import type { D1PreparedStatement } from '@cloudflare/workers-types';
import type { Env, RequestContext } from '../types';
import { Store } from '../store';
import { atomic } from '../application/model';
import { addDays, resolveTrainingCalendar } from './calendar';
import { awardXp, XP_VALUES, type XpEvent } from './xp';
import { progressQuests, type QuestKey } from './quests';
import { identity, resolvePreference, write, type DayRecord, type PreferenceRecord, type WeekRecord, type Writes } from './store';
import type { RoomHistorySummary } from '../practice/room-history';

/**
 * Gamification hook for team practice rooms (practice review item 1, 2, 6).
 *
 * Called once per room publication from `PracticeReports.publish()` — only on
 * the real completion path (`review === false`) and only when the room
 * actually completed. Feeds room completion into the Phase 1/2 gamification
 * systems that previously only saw solo sessions:
 *
 * - attempt-style XP: 2 XP per DISTINCT question answered as scribe (deadline
 *   drafts excluded), flowing through the shared 300 XP/day anti-grind cap;
 * - day credit: one `training-day` per learner-local day (streak-safe rooms),
 *   with the `training-week` record updated exactly like the solo path;
 * - `lastEventAtUtc` monotonic bump so the coach Engagement tab's
 *   "Last active" goes fresh;
 * - the Teammate daily quest completes on *participation*, never on mere
 *   presence;
 * - profile-Honor XP (150) for team/simulation `mastery-honor` unlocks newly
 *   created by this publication;
 * - a `room-participation` record per participant for downstream consumers
 *   (coach history + room recap UI).
 *
 * Lurkers (members with zero scored contribution) get nothing.
 */

export interface RoomGamificationResult {
    /** Statements for the caller to append to its publication batch. */
    statements: D1PreparedStatement[];
    /** Run after the caller's batch commits: detects newly unlocked honors. */
    postBatch: () => Promise<void>;
}

interface Participant {
    userId: string;
    /** Distinct question ids submitted as scribe (deadline drafts excluded). */
    questionsAnswered: string[];
}

/**
 * Participation = at least one non-draft scribe submission, or a services
 * entry whose memberIds include the user. Everything else is lurking.
 */
function participants(r: RoomHistorySummary): Participant[] {
    const served = new Set<string>();
    for (const service of r.services ?? []) for (const memberId of service.memberIds ?? []) served.add(memberId);
    const scribed = new Map<string, Set<string>>();
    for (const s of r.submissions ?? []) {
        if (!s.scribeId || s.deadlineDraft || !s.questionId) continue;
        let set = scribed.get(s.scribeId);
        if (!set) { set = new Set(); scribed.set(s.scribeId, set); }
        set.add(s.questionId);
    }
    const out: Participant[] = [];
    for (const m of r.members ?? []) {
        const qs = scribed.get(m.userId);
        if ((qs && qs.size > 0) || served.has(m.userId)) out.push({ userId: m.userId, questionsAnswered: [...(qs ?? [])] });
    }
    return out;
}

/** Internal learner context for room gamification writes (actor is the participant). */
function learnerCtx(env: Env, orgId: string, userId: string): RequestContext {
    return {
        request: new Request('https://internal/room-gamification'),
        env,
        actor: {
            userId, organizationId: orgId, organizationName: 'Room gamification',
            displayName: userId, userName: userId, email: null,
            kind: 'Student', role: 'Student', credentialVersion: 'v1',
        },
        path: '/internal/room-gamification',
        orgId,
        store: new Store(env.DB),
    };
}

/** Team/simulation `mastery-honor` rows in this org+season. */
async function teamHonorRows(env: Env, orgId: string, seasonId: string): Promise<{ id: string; owner_id: string }[]> {
    // instr() substring matching instead of LIKE: D1 rejects multi-wildcard
    // LIKE patterns as too complex.
    const rows = await env.DB.prepare(
        `SELECT id,owner_id FROM Records WHERE kind='mastery-honor' AND org_id=? AND season_id=? AND (instr(id,':mastery-v1:team:')>0 OR instr(id,':simulation-v1:simulation:')>0)`
    ).bind(orgId, seasonId).all<{ id: string; owner_id: string }>();
    return rows.results;
}

const noop: RoomGamificationResult = { statements: [], postBatch: async () => { } };

export async function applyRoomCompletionGamification(env: Env, r: RoomHistorySummary, review: boolean): Promise<RoomGamificationResult> {
    // Re-projections and non-completed rooms feed nothing into gamification.
    if (review || r.status !== 'Completed') return noop;

    // Snapshot team/simulation honors before this publication's batch runs, so
    // postBatch() can award profile-Honor XP for exactly the new unlocks.
    const honorsBefore = new Set((await teamHonorRows(env, r.orgId, r.seasonId)).map(row => row.id));

    // Idempotency: users with a room-participation record for this room were
    // already processed by an earlier publication — award nothing new.
    const doneRows = await env.DB.prepare(
        `SELECT id FROM Records WHERE kind='room-participation' AND org_id=? AND id LIKE ?`
    ).bind(r.orgId, `${r.id}:%`).all<{ id: string }>();
    const done = new Set(doneRows.results.map(row => row.id.slice(r.id.length + 1)));

    const at = r.completedAt && Number.isFinite(Date.parse(r.completedAt)) ? r.completedAt : new Date().toISOString();
    const statements: D1PreparedStatement[] = [];

    for (const p of participants(r)) {
        if (done.has(p.userId)) continue;
        const ctx = learnerCtx(env, r.orgId, p.userId);
        const w: Writes = { statements: [], guards: [] };

        const stored = await ctx.store.get<PreferenceRecord>('training-preferences', identity(ctx), r.orgId);
        const pref = resolvePreference(ctx, stored, at);
        const calendar = resolveTrainingCalendar(at, pref);

        // Last-active freshness for the coach Engagement tab (monotonic bump).
        if (!stored)
            statements.push(ctx.store.insertion('training-preferences', pref.id, r.orgId, pref, { ownerId: p.userId }));
        statements.push(env.DB.prepare(
            `UPDATE Records SET data=json_set(data,'$.lastEventAtUtc',?) WHERE kind='training-preferences' AND id=? AND org_id=? AND (json_extract(data,'$.lastEventAtUtc') IS NULL OR json_extract(data,'$.lastEventAtUtc') < ?)`
        ).bind(at, pref.id, r.orgId, at));

        // Day credit: one immediate INSERT OR IGNORE acts as the lock against
        // concurrent room completions. Day XP is awarded only when this call
        // actually created the day.
        const dayId = identity(ctx, calendar.localDate);
        const day: DayRecord = {
            id: dayId, localDate: calendar.localDate, timeZone: calendar.timeZone,
            firstQualifiedAtUtc: at, sessionId: `room:${r.id}`, credited: true,
        };
        const dayResult = await env.DB.prepare(
            `INSERT OR IGNORE INTO Records(kind,id,org_id,season_id,owner_id,data,revision) VALUES('training-day',?,?,?,?,?,1)`
        ).bind(dayId, r.orgId, null, p.userId, JSON.stringify(day)).run();
        const dayCredited = (dayResult.meta.changes ?? 0) === 1;
        if (dayCredited) {
            const wid = identity(ctx, calendar.weekStartLocalDate);
            const oldWeek = await ctx.store.get<WeekRecord>('training-week', wid, r.orgId);
            const week: WeekRecord = oldWeek?.value ?? {
                id: wid, weekStartLocalDate: calendar.weekStartLocalDate, timeZone: calendar.timeZone,
                target: pref.weeklyTarget, dates: Array.from({ length: 7 }, (_, i) => addDays(calendar.weekStartLocalDate, i)),
                creditedDates: [], qualifiedAtUtc: null,
            };
            if (!week.creditedDates.includes(calendar.localDate)) week.creditedDates.push(calendar.localDate);
            if (week.creditedDates.length >= week.target && !week.qualifiedAtUtc) {
                week.qualifiedAtUtc = at;
                if (pref.qualifyingWeekStarts.length < 4 && !pref.qualifyingWeekStarts.includes(week.weekStartLocalDate))
                    pref.qualifyingWeekStarts.push(week.weekStartLocalDate);
            }
            write(ctx, w, 'training-week', wid, week, oldWeek);
            if (stored && JSON.stringify(pref.qualifyingWeekStarts) !== JSON.stringify(stored.value.qualifyingWeekStarts))
                statements.push(env.DB.prepare(
                    `UPDATE Records SET data=json_set(data,'$.qualifyingWeekStarts',json(?)) WHERE kind='training-preferences' AND id=? AND org_id=?`
                ).bind(JSON.stringify(pref.qualifyingWeekStarts), pref.id, r.orgId));
        }

        // XP: 2 per distinct question answered as scribe. Attempt-kind events
        // flow through the shared 300 XP/day anti-grind cap (rooms never
        // bypass it); the +50 day credit is uncapped, same as solo.
        const xpEvents: XpEvent[] = [{ kind: 'attempt', amount: 2 * p.questionsAnswered.length }];
        if (dayCredited) xpEvents.push({ kind: 'day', amount: XP_VALUES.dayCredited });
        const questRes = await progressQuests(ctx, w, { localDate: calendar.localDate, timeZone: calendar.timeZone, seasonId: r.seasonId, atUtc: at }, api => {
            if (api.quests.some(q => q.key === 'teammate' && !q.completed)) api.complete('teammate');
        });
        xpEvents.push(...questRes.xpEvents);
        const awarded = await awardXp(ctx, w, { seasonId: r.seasonId, localDate: calendar.localDate, atUtc: at, events: xpEvents });

        // Per-participant record for downstream consumers (coach history +
        // room recap UI). INSERT OR IGNORE keeps re-publication idempotent.
        statements.push(env.DB.prepare(
            `INSERT OR IGNORE INTO Records(kind,id,org_id,season_id,owner_id,data,revision) VALUES('room-participation',?,?,?,?,?,1)`
        ).bind(`${r.id}:${p.userId}`, r.orgId, r.seasonId, p.userId, JSON.stringify({
            roomId: r.id, userId: p.userId, seasonId: r.seasonId, format: r.format ?? null,
            simulation: !!r.simulation, completedAtUtc: r.completedAt ?? null,
            questionsAnswered: p.questionsAnswered.length, xpAwarded: awarded.awarded,
            dayCredited, questsCompleted: questRes.completedNow as QuestKey[],
        })));
        statements.push(...w.statements);
    }

    return {
        statements,
        postBatch: async () => {
            // Honor XP for team/simulation honors newly created by this
            // publication (150 XP each, kind 'honor' — same as solo
            // profileHonor). Runs after the caller's batch committed.
            const after = await teamHonorRows(env, r.orgId, r.seasonId);
            const byOwner = new Map<string, number>();
            for (const row of after) {
                if (honorsBefore.has(row.id)) continue;
                byOwner.set(row.owner_id, (byOwner.get(row.owner_id) ?? 0) + 1);
            }
            if (!byOwner.size) return;
            for (const [userId, count] of byOwner) {
                const ctx = learnerCtx(env, r.orgId, userId);
                const stored = await ctx.store.get<PreferenceRecord>('training-preferences', identity(ctx), r.orgId);
                const pref = resolvePreference(ctx, stored, at);
                const calendar = resolveTrainingCalendar(at, pref);
                const w: Writes = { statements: [], guards: [] };
                await awardXp(ctx, w, {
                    seasonId: r.seasonId, localDate: calendar.localDate, atUtc: at,
                    events: Array.from({ length: count }, (): XpEvent => ({ kind: 'honor', amount: XP_VALUES.profileHonor })),
                });
                await atomic(ctx, 'room-gamification.honor-xp', w.statements, w.guards);
            }
        },
    };
}
