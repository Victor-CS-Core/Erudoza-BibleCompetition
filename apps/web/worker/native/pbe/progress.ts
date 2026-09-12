import type { D1PreparedStatement } from '@cloudflare/workers-types';
import type { RequestContext } from '../types';
import { HttpError } from '../types';
import {bulkRefs,evidenceRefs} from './evidence-replay';
import type { Stored } from '../store';
import { advanceReview, initialReview, type RecallEvidence, type TargetReview } from './review';
export interface PbeWriteBatch {
    statements: D1PreparedStatement[];
    guards: {
        kind: string;
        id: string;
        revision: number;
    }[];
    acceptedSequence?: number;
    replayed?: boolean;
}
export interface ReviewProjection {
    provisional?:boolean;
    pendingCount?:number;
    evidenceGeneration?:number;
    id: string;
    targetId: string;
    review: TargetReview;
    acceptedSequence: number;
    failedSequence: number | null;
    lastAnsweredQuestionId: string;
    lastAnsweredQuestionKind: string | null;
}
export interface ServiceProjection {
    id: string;
    subjectId: string;
    servedCount: number;
    lastServedAtMs: number;
    lastQuestionId: string;
    lastQuestionKind: string;
}
export interface PbeServiceEvent {
    serviceId: string;
    questionId: string;
    targetIds: string[];
    questionKind: string;
    atMs: number;
}
interface Sequence {
    id: string;
    acceptedSequence: number;
    lastAtMs: number;
    recentTargets: {
        targetId: string;
        acceptedSequence: number;
    }[];
}
export interface RecallEvent {
    id: string;
    scopeVersion: string;
    acceptedSequence: number;
    questionKind: string | null;
    evidence: RecallEvidence[];
}
const validId = (id: string) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) && id !== '00000000-0000-0000-0000-000000000000';
const validTime = (at: number) => Number.isSafeInteger(at) && at >= 0 && at <= 253401091199999;
const conflict = () => new HttpError(409, 'PBE event conflict. Refresh and retry.');
const key = (ctx: RequestContext, season: string, id = '') => `${ctx.actor.userId.toLowerCase()}:${season.toLowerCase()}${id ? ':' + id.toLowerCase() : ''}`;
function scope(ctx: RequestContext, season: string) { if (!validId(ctx.orgId) || !validId(ctx.actor.userId) || !validId(season))
    throw new HttpError(400, 'Invalid PBE owner/season.'); }
function write(ctx: RequestContext, w: PbeWriteBatch, kind: string, id: string, value: unknown, prior: Stored<unknown> | null, season: string) {
    if (prior) {
        w.guards.push({ kind, id, revision: prior.revision });
        w.statements.push(ctx.store.update(kind, id, ctx.orgId, value, prior.revision));
    }
    else {
        // Convert first-writer races to the same atomic CHECK conflict as stale revisions.
        w.statements.push(ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) VALUES(?,?,?,?,?,?,1) ON CONFLICT(kind,id,org_id) DO UPDATE SET data='invalid-json'").bind(kind, id, ctx.orgId, season, ctx.actor.userId, JSON.stringify(value)));
    }
}
async function rows<T>(ctx: RequestContext, season: string, kind: string, ids: string[]): Promise<Stored<T>[]> {
    if (!ids.length)
        return [];
    const result = await ctx.env.DB.prepare('SELECT data,revision FROM Records WHERE org_id=? AND season_id=? AND owner_id=? AND kind=? AND id IN (SELECT value FROM json_each(?))').bind(ctx.orgId, season, ctx.actor.userId, kind, JSON.stringify(ids)).all<{
        data: string;
        revision: number;
    }>();
    return result.results.map(r => ({ value: JSON.parse(r.data), revision: r.revision }));
}
/** Prepares exactly one accepted attempt (all grouped target parts). Caller must append guards and writes to its attempt transaction, with fresh eligibility guards. */
export async function prepareRecallEvidence(ctx: RequestContext, seasonId: string, scopeVersion: string, evidence: RecallEvidence[], questionKind: string | null = null): Promise<PbeWriteBatch> {
    scope(ctx, seasonId);
    seasonId = seasonId.toLowerCase();
    if (questionKind !== null && !['ShortAnswer', 'List', 'ExactWords', 'TrueFalse'].includes(questionKind))
        throw new HttpError(400, 'Invalid accepted question kind.');
    if (!scopeVersion || scopeVersion.length > 1000 || !evidence.length || evidence.length > 8)
        throw new HttpError(400, 'Invalid PBE evidence.');
    const first = evidence[0];
    for (const e of evidence)
        if (!validId(e.attemptId) || !validId(e.targetId) || !validId(e.questionId) || !validTime(e.atMs) || !Number.isInteger(e.availablePoints) || e.availablePoints < 1 || e.availablePoints > 8 || !Number.isInteger(e.earnedPoints) || e.earnedPoints < 0 || e.earnedPoints > e.availablePoints || typeof e.unaided !== 'boolean' || typeof e.recall !== 'boolean' || e.attemptId.toLowerCase() !== first.attemptId.toLowerCase() || e.questionId.toLowerCase() !== first.questionId.toLowerCase() || e.atMs !== first.atMs || e.unaided !== first.unaided)
            throw new HttpError(400, 'Invalid grouped PBE evidence.');
    if (new Set(evidence.map(e => e.targetId.toLowerCase())).size !== evidence.length || evidence.reduce((n, e) => n + e.availablePoints, 0) > 8)
        throw new HttpError(400, 'Invalid grouped PBE points.');
    evidence = evidence.map(e => ({ attemptId: e.attemptId.toLowerCase(), targetId: e.targetId.toLowerCase(), questionId: e.questionId.toLowerCase(), atMs: e.atMs, earnedPoints: e.earnedPoints, availablePoints: e.availablePoints, unaided: e.unaided, recall: e.recall })).sort((a, b) => a.targetId < b.targetId ? -1 : 1);
    const id = key(ctx, seasonId, first.attemptId), existing = await ctx.store.get<RecallEvent>('pbe-recall-event', id, ctx.orgId);
    if (existing) {
        if (existing.value.questionKind !== questionKind || JSON.stringify(existing.value.evidence) !== JSON.stringify(evidence))
            throw conflict();
        return { statements: [], guards: [], acceptedSequence: existing.value.acceptedSequence, replayed: true };
    }
    const sid = key(ctx, seasonId), oldSequence = await ctx.store.get<Sequence>('pbe-recall-sequence', sid, ctx.orgId), previous = oldSequence?.value;
    if (previous && first.atMs < previous.lastAtMs)
        throw new HttpError(409, 'PBE chronological acceptance conflict.');
    const sequence = (previous?.acceptedSequence ?? 0) + 1;
    if (!Number.isSafeInteger(sequence))
        throw conflict();
    const old = await rows<ReviewProjection>(ctx, seasonId, 'pbe-target-review', evidence.map(e => key(ctx, seasonId, e.targetId))), w: PbeWriteBatch = { statements: [], guards: [], acceptedSequence: sequence, replayed: false };
    const recent = [...(previous?.recentTargets ?? []).filter(t => !evidence.some(e => e.targetId === t.targetId)), ...evidence.map(e => ({ targetId: e.targetId, acceptedSequence: sequence }))];
    // Three most recent distinct targets suffice to prove two targets after any failed sequence; ties retain their attempt grouping.
    recent.sort((a, b) => b.acceptedSequence - a.acceptedSequence || (a.targetId < b.targetId ? -1 : 1));
    write(ctx, w, 'pbe-recall-sequence', sid, { id: sid, acceptedSequence: sequence, lastAtMs: first.atMs, recentTargets: recent.slice(0, 3) }, oldSequence, seasonId);
    write(ctx, w, 'pbe-recall-event', id, { id, scopeVersion, acceptedSequence: sequence, questionKind, evidence }, null, seasonId);
    w.statements.push(bulkRefs(ctx,ctx.actor.userId,seasonId,evidenceRefs(ctx.actor.userId,seasonId,{id,scopeVersion,acceptedSequence:sequence,questionKind,evidence})));
    if(!previous)w.statements.push(ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) VALUES('pbe-evidence-index',?,?,?,?,?,1) ON CONFLICT(kind,id,org_id) DO NOTHING").bind(sid,ctx.orgId,seasonId,ctx.actor.userId,JSON.stringify({id:sid,ready:true,after:'',coveredLegacyEvents:0})));
    for (const e of evidence) {
        const pid = key(ctx, seasonId, e.targetId), prior = old.find(r => r.value.id === pid) ?? null, review = advanceReview(prior?.value.review ?? initialReview(e.targetId), e);
        const failed = e.recall && e.earnedPoints < e.availablePoints ? sequence : review.unresolved ? prior?.value.failedSequence ?? null : null;
        write(ctx, w, 'pbe-target-review', pid, { id: pid, targetId: e.targetId, review, provisional:prior?.value.provisional??false,pendingCount:prior?.value.pendingCount??0,evidenceGeneration:prior?.value.evidenceGeneration, acceptedSequence: sequence, failedSequence: failed, lastAnsweredQuestionId: e.questionId, lastAnsweredQuestionKind: questionKind }, prior, seasonId);
    }
    return w;
}
/** Prompt service identity is a saved card ID, never a refresh request ID. No recall evidence is written. */
export async function preparePbeService(ctx: RequestContext, seasonId: string, event: PbeServiceEvent): Promise<PbeWriteBatch> {
    scope(ctx, seasonId);
    seasonId = seasonId.toLowerCase();
    if (!validId(event.serviceId) || !validId(event.questionId) || !validTime(event.atMs) || !Array.isArray(event.targetIds) || !event.targetIds.length || event.targetIds.length > 8 || !event.targetIds.every(validId) || new Set(event.targetIds.map(t => t.toLowerCase())).size !== event.targetIds.length || !['ShortAnswer', 'List', 'ExactWords', 'TrueFalse'].includes(event.questionKind))
        throw new HttpError(400, 'Invalid PBE service.');
    event = { serviceId: event.serviceId.toLowerCase(), questionId: event.questionId.toLowerCase(), targetIds: event.targetIds.map(t => t.toLowerCase()).sort(), questionKind: event.questionKind, atMs: event.atMs };
    const id = key(ctx, seasonId, event.serviceId), existing = await ctx.store.get<{
        event: PbeServiceEvent;
    }>('pbe-service-event', id, ctx.orgId);
    if (existing) {
        if (JSON.stringify(existing.value.event) !== JSON.stringify(event))
            throw conflict();
        return { statements: [], guards: [], replayed: true };
    }
    const w: PbeWriteBatch = { statements: [], guards: [], replayed: false };
    write(ctx, w, 'pbe-service-event', id, { id, event }, null, seasonId);
    for (const [kind, subjects] of [['pbe-question-service', [event.questionId]], ['pbe-target-service', event.targetIds]] as const) {
        const prior = await rows<ServiceProjection>(ctx, seasonId, kind, subjects.map(s => key(ctx, seasonId, s)));
        for (const subjectId of subjects) {
            const pid = key(ctx, seasonId, subjectId), p = prior.find(r => r.value.id === pid) ?? null;
            if (p && event.atMs < p.value.lastServedAtMs)
                throw new HttpError(409, 'PBE service chronological conflict.');
            write(ctx, w, kind, pid, { id: pid, subjectId, servedCount: (p?.value.servedCount ?? 0) + 1, lastServedAtMs: event.atMs, lastQuestionId: event.questionId, lastQuestionKind: event.questionKind }, p, seasonId);
        }
    }
    return w;
}
/** IDs must come from a freshly authorized bank or immutable owned session eligibility. Excluded history stays stored, never returned implicitly. */
export async function loadPbeProjections(ctx: RequestContext, seasonId: string, targetIds: string[], questionIds: string[]) {
    scope(ctx, seasonId);
    seasonId = seasonId.toLowerCase();
    if (targetIds.length > 10000 || questionIds.length > 10000 || ![...targetIds, ...questionIds].every(validId))
        throw new HttpError(400, 'Invalid projection scope.');
    const [reviews, targets, questions, sequence] = await Promise.all([rows<ReviewProjection>(ctx, seasonId, 'pbe-target-review', targetIds.map(t => key(ctx, seasonId, t))), rows<ServiceProjection>(ctx, seasonId, 'pbe-target-service', targetIds.map(t => key(ctx, seasonId, t))), rows<ServiceProjection>(ctx, seasonId, 'pbe-question-service', questionIds.map(t => key(ctx, seasonId, t))), ctx.store.get<Sequence>('pbe-recall-sequence', key(ctx, seasonId), ctx.orgId)]);
    return { reviews: reviews.map(r => r.value), targets: targets.map(r => r.value), questions: questions.map(r => r.value), recentTargets: sequence?.value.recentTargets ?? [] };
}
