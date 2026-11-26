import type { RequestContext } from '../types';
import { resolvePbeSources } from './sources';
import { loadFromResolvedSources } from './bank';
import { loadPbeProjections } from './progress';
import { isTimedPbeMode } from './rules';
import type { PbeAttempt, PbeSession } from './sessions';
import { listRoomSummaries } from '../practice/room-history';
import { overlayRooms } from './result-overlays';
import { trends } from '../practice/awards';

/**
 * Card 49 (GitHub #50): PBE readiness dimensions as a DERIVED VIEW.
 * Composed at read time from already-stored evidence — projections,
 * attempt records, and finalized team trends. Nothing is persisted:
 * the dimensions explain the single XP ledger, they are never a
 * second ledger or an independent score. A dimension with no stored
 * evidence reports percent: null (honest pending), never a guess.
 * Reflection is deliberately absent: no stored evidence source exists
 * for it yet.
 */
export const PBE_READINESS_VERSION = 'pbe-readiness-v1';

export type PbeReadinessKey = 'Coverage' | 'Recall' | 'Precision' | 'Reference' | 'Composure' | 'Team';
export interface PbeReadinessDimension { key: PbeReadinessKey; percent: number | null; basis: string }
export interface PbeReadiness { version: typeof PBE_READINESS_VERSION; seasonId: string; dimensions: PbeReadinessDimension[] }

const ratio = (earned: number, available: number) => available > 0 ? Math.round(100 * earned / available) : null;

type StoredAttempt = PbeAttempt & { sessionId: string };

export async function pbeReadiness(ctx: RequestContext, seasonId: string): Promise<PbeReadiness> {
    const scope = await resolvePbeSources(ctx, { organizationId: ctx.orgId, seasonId, studentId: ctx.actor.userId });
    const bank = await loadFromResolvedSources(ctx, { organizationId: ctx.orgId, seasonId, studentId: ctx.actor.userId, sourceUnitIds: scope.sources.map(s => s.id) }, scope);
    const totalTargets = bank.targets.length;
    const projections = await loadPbeProjections(ctx, seasonId, bank.targets.map(t => t.id), bank.questions.map(q => q.id));
    const practiced = projections.reviews.filter(r => r.retention?.practiced).length;
    const recalled = projections.reviews.filter(r => r.retention?.recalled && !r.retention.pendingCount && !r.retention.dataGap).length;

    const [attempts, sessions, summaries] = await Promise.all([
        ctx.store.list<StoredAttempt>('pbe-attempt', ctx.orgId, { seasonId, ownerId: ctx.actor.userId }),
        ctx.store.list<PbeSession>('pbe-session', ctx.orgId, { seasonId, ownerId: ctx.actor.userId }),
        listRoomSummaries(ctx.env.DB, ctx.orgId, seasonId),
    ]);
    const sessionById = new Map(sessions.map(s => [s.id, s]));
    const kindByCard = new Map<string, string>();
    for (const s of sessions) for (const c of s.cards) kindByCard.set(c.id, c.question.kind);

    let precisionEarned = 0, precisionAvailable = 0;
    let referenceEarned = 0, referenceAvailable = 0;
    let composureEarned = 0, composureAvailable = 0;
    for (const a of attempts) {
        const { earnedPoints, availablePoints } = a.result;
        if (!(availablePoints > 0)) continue;
        precisionEarned += earnedPoints; precisionAvailable += availablePoints;
        if (kindByCard.get(a.cardId) === 'ExactWords') { referenceEarned += earnedPoints; referenceAvailable += availablePoints; }
        const session = sessionById.get(a.sessionId);
        if (session && isTimedPbeMode(session.mode)) { composureEarned += earnedPoints; composureAvailable += availablePoints; }
    }

    const reviewed = await overlayRooms(ctx.store, ctx.orgId, summaries);
    let teamAccuracy = 0, teamAvailable = 0;
    for (const t of trends(reviewed, ctx.actor.userId)) {
        if (t.seasonId !== seasonId || t.format !== 'Pbe' || t.provisional) continue;
        teamAccuracy += t.accuracyHundredths; teamAvailable += t.availableHundredths;
    }

    return {
        version: PBE_READINESS_VERSION, seasonId,
        dimensions: [
            { key: 'Coverage', percent: totalTargets > 0 ? Math.round(100 * practiced / totalTargets) : null, basis: 'Targets you have practiced, out of every target in your assigned passages.' },
            { key: 'Recall', percent: practiced > 0 ? Math.round(100 * recalled / practiced) : null, basis: 'Practiced targets your later answers kept — recall that held up over time.' },
            { key: 'Precision', percent: ratio(precisionEarned, precisionAvailable), basis: 'Points earned out of points available across your solo PBE answers.' },
            { key: 'Reference', percent: ratio(referenceEarned, referenceAvailable), basis: 'Points earned on exact-words questions, where the wording itself is the answer.' },
            { key: 'Composure', percent: ratio(composureEarned, composureAvailable), basis: 'Points earned in timed runs, where answers freeze when the clock ends.' },
            { key: 'Team', percent: ratio(teamAccuracy, teamAvailable), basis: "Your team's accuracy in finalized PBE matches." },
        ],
    };
}
