import type { RequestContext } from '../types';
import { honorId, ruleVersionFor, type HonorKey, type HonorUnlock } from '../mastery/catalog';
import { gradePbe } from './grading';
import { isTimedPbeMode } from './rules';
import type { PbeSession } from './sessions';
import type { PbeDispute } from './disputes';
import { resolvePbeSources } from './sources';
import { loadFromResolvedSources } from './bank';
import { loadPbeProjections } from './progress';

/**
 * Card 54 (GitHub #50): the genuinely new solo PBE patches, added to the
 * EXISTING honor catalog (mastery/catalog.ts, category "PBE Practice") —
 * no second shelf, no second ledger, recognition only (no XP: session
 * XP already paid through the one ledger). Evaluation runs at solo
 * session completion and after a solo dispute ruling, always from
 * stored evidence, and unlocks are INSERT OR IGNORE — the first earned
 * stamp is immutable, re-evaluation only ever adds.
 *
 * Deliberately NOT added (they already exist): Full 90 → simulation
 * 'Event Ready'; Scribe Ready → simulation 'Trusted Scribe' +
 * team:shared-scribe; Team Ready → the team:rehearsal-complete family.
 * #50's 'Coverage Complete' measured the coach's bank and was rejected;
 * 'Coverage Starter' is its learner-side variant (targets the learner
 * practiced). 'Appeal Scholar' is renamed 'Fair Challenge' — Scholar
 * is global Level 6.
 *
 * Read budget (dispute-budget.test.ts caps every /pbe/* request at 50
 * D1 statements): the dispute-resolve call site passes
 * { coverage: false }. A ruling can never change the practiced-target
 * count Coverage Starter measures — practicing happens inside
 * sessions, and every session completion runs the full evaluation
 * including coverage — so re-resolving the bank scope inside a
 * ruling (the coverage block costs ~16 statements: scope resolution
 * runs twice via loadFromResolvedSources' fingerprint recheck, plus
 * the bank page reads) would re-confirm a fact the ruling cannot move.
 * The ruling path still evaluates every patch a ruling CAN change
 * (Captain's Call, Fair Challenge, and Steady Under Time with the new
 * correction folded in) from the two history lists, one statement each.
 */
const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

export interface PbeHonorsOptions {
    /** Set false when the triggering event cannot change practiced
     *  targets (dispute rulings); coverage is completion-evaluated. */
    coverage?: boolean;
}

export async function awardPbeHonors(ctx: RequestContext, userId: string, seasonId: string, options: PbeHonorsOptions = {}): Promise<void> {
    const [sessions, disputes] = await Promise.all([
        ctx.store.list<PbeSession>('pbe-session', ctx.orgId, { seasonId, ownerId: userId }),
        ctx.store.list<PbeDispute>('pbe-dispute', ctx.orgId, { seasonId, ownerId: userId }),
    ]);
    const completed = sessions.filter(s => s.status === 'Completed');
    // Fold solo dispute corrections into attempt earnings so Steady
    // Under Time agrees with the corrected recap, not the raw attempt.
    const corrections = new Map<string, number>();
    for (const d of disputes) if (d.activity === 'Solo' && d.status === 'Resolved' && d.resolution) corrections.set(d.attemptId.toLowerCase(), sum(d.resolution.pointsByPart));
    const earnedOf = (s: PbeSession) => s.attempts.reduce((n, a) => n + (corrections.get(a.result.attemptId.toLowerCase()) ?? a.result.earnedPoints), 0);
    const availableOf = (s: PbeSession) => s.attempts.reduce((n, a) => n + a.result.availablePoints, 0);
    const timed = completed.filter(s => isTimedPbeMode(s.mode));

    const awards: HonorUnlock[] = [];
    const award = (key: HonorKey, earnedAtUtc: string, evidence: unknown) => awards.push({ id: honorId(ctx.orgId, userId, key), userId, key, ruleVersion: ruleVersionFor(key), earnedAtUtc, seasonId, evidence });

    const mockHalf = completed.find(s => s.mode === 'MockHalf');
    if (mockHalf) award('pbe:first-45', mockHalf.completedAtUtc ?? new Date().toISOString(), { sessionId: mockHalf.id, mode: mockHalf.mode, questions: mockHalf.cards.length });

    const steady = timed.find(s => availableOf(s) > 0 && earnedOf(s) * 10 >= availableOf(s) * 9);
    if (steady) award('pbe:steady-under-time', steady.completedAtUtc ?? new Date().toISOString(), { sessionId: steady.id, mode: steady.mode, earnedPoints: earnedOf(steady), availablePoints: availableOf(steady) });

    const zeroExtra = timed.find(s => s.cards.length >= 10 && s.attempts.every(a => {
        const card = s.cards.find(c => c.id === a.cardId);
        if (!card) return false;
        const matched = new Set(gradePbe(card.question, a.answers).parts.map(p => p.answerIndex).filter((i): i is number => i !== null));
        return a.answers.every((answer, i) => answer.trim() === '' || matched.has(i));
    }));
    if (zeroExtra) award('pbe:zero-extra', zeroExtra.completedAtUtc ?? new Date().toISOString(), { sessionId: zeroExtra.id, mode: zeroExtra.mode, questions: zeroExtra.cards.length });

    const soloDisputes = disputes.filter(d => d.activity === 'Solo' && d.participantIds.includes(userId));
    const ruled = soloDisputes.find(d => d.status === 'Resolved' && d.resolution);
    if (ruled) award('pbe:captains-call', ruled.resolution!.resolvedAtUtc, { disputeId: ruled.id });
    const upheld = soloDisputes.find(d => d.status === 'Resolved' && d.resolution && sum(d.resolution.pointsByPart) > sum(d.originalPointsByPart));
    if (upheld) award('pbe:fair-challenge', upheld.resolution!.resolvedAtUtc, { disputeId: upheld.id, originalPoints: sum(upheld.originalPointsByPart), correctedPoints: sum(upheld.resolution!.pointsByPart) });

    // Coverage Starter counts targets the LEARNER practiced (the
    // retention fold's practiced flag). Scope resolution can
    // legitimately fail late (e.g. a ruling lands after the season
    // closes) — that must not fail the caller's completion or ruling,
    // so only this sub-check is failure-tolerant.
    if (options.coverage !== false) try {
        const scope = await resolvePbeSources(ctx, { organizationId: ctx.orgId, seasonId, studentId: userId });
        const bank = await loadFromResolvedSources(ctx, { organizationId: ctx.orgId, seasonId, studentId: userId, sourceUnitIds: scope.sources.map(s => s.id) }, scope);
        if (bank.targets.length >= 10) {
            const projections = await loadPbeProjections(ctx, seasonId, bank.targets.map(t => t.id), bank.questions.map(q => q.id));
            const practiced = projections.reviews.filter(r => r.retention?.practiced).length;
            if (practiced >= 10) award('pbe:coverage-starter', new Date().toISOString(), { practicedTargets: practiced });
        }
    } catch { /* coverage evidence unavailable in this context; other honors still land */ }

    if (!awards.length) return;
    // INSERT OR IGNORE, mirroring mastery/store.insertUnlocks: the first
    // earned unlock is immutable and re-evaluation is idempotent.
    await ctx.env.DB.batch([ctx.env.DB.prepare("INSERT OR IGNORE INTO Records(kind,id,org_id,season_id,owner_id,data,revision) SELECT 'mastery-honor',json_extract(value,'$.id'),?,json_extract(value,'$.seasonId'),json_extract(value,'$.userId'),value,1 FROM json_each(?)").bind(ctx.orgId, JSON.stringify(awards))]);
}
