import {prepareChapterProgressScope} from './chapter-progress';
import type {PbeResultOverlay} from './result-overlays';
import type { RequestContext } from '../types';
import { HttpError, json, requiredString } from '../types';
import { atomic, id } from '../application/model';
import { trainingNow } from '../training/clock';
import { guid, loadFromResolvedSources } from './bank';
import { resolvePbeSources, resolvePbeSessionSources, pbeAssignmentSetGuard } from './sources';
import { gradePbe, questionView } from './grading';
import { groupRecallEvidence } from './review';
import { loadPbeProjections, preparePbeService, prepareRecallEvidence } from './progress';
import { selectPbeQuestions } from './selection';
import { PBE_RULE_VERSION, PBE_SCORING_VERSION } from './rules';
import { rehearsalPoints } from './presentation';
import type { PbeQuestion, PbeTarget } from './types';
import { pbeMissionSteps, preparePbeEffort, preparePbeStartEffort, recordPbePersonalBests } from './effort';
import type { StartTrainingContext } from '../../../src/api/trainingTypes';
export interface PbeCard {
    id: string;
    question: PbeQuestion;
    targets: PbeTarget[];
    servedAtMs: number | null;
    assistedAtMs: number | null;
}
export interface PbeResult {
    attemptId: string;
    earnedPoints: number;
    availablePoints: number;
    expectedParts: string[];
    sourceEvidence: string;
    citation: string;
    unaided: boolean;
    acceptedAtUtc: string;
    acceptedSequence: number;
    alreadyProcessed: boolean;
}
export interface PbeAttempt {
    id: string;
    cardId: string;
    clientSubmissionId: string;
    answers: string[];
    hintsUsed: boolean;
    atMs: number;
    responseLockedAtMs?: number;
    result: PbeResult;
}
export interface PbeSession {
    id: string;
    format: 'Pbe';
    studentUserId: string;
    seasonId: string;
    mode: 'Practice' | 'Review' | 'Simulation';
    status: 'Created' | 'Active' | 'Completed';
    scopeVersion: string;
    ruleVersion: string;
    scoringVersion: string;
    selectionVersion: string;
    questionIds: string[];
    cards: PbeCard[];
    attempts: PbeAttempt[];
    createdAtUtc: string;
    completedAtUtc?: string;
    clientStartId?: string;
    startPayload: string;
    missionLocalDate: string | null;
    creditedLocalDate: string | null;
    newlyCreditedDay: boolean;
    /** True when this session completed the learner's weekly practice goal. */
    weeklyGoalComplete?: boolean;
    /** Set when this session set a personal best (computed once at completion). */
    personalBest?: { accuracyBeaten: boolean; correctBeaten: boolean } | null;
    /** Streak milestone badges earned by this session (PBE has no other badge pipeline). */
    earnedBadges?: import('../../../src/api/trainingTypes').BadgeProgress[];
}
interface Start {
    seasonId: string;
    format?: string;
    mode?: string;
    chapter?: {
        contentPackId: string;
        chapter: number;
    };
    targetIds?: string[];
    progressScope?: {key:string;scopeVersion:string};
    training?: StartTrainingContext;
}
interface Submission {
    clientSubmissionId: string;
    challengeCardId: string;
    answers: string[];
    hintsUsed: boolean;
}
const timedAuthority = Symbol('pbe-timed-authority');
interface TimedDecision { token: symbol; elapsedMs: number; lockedAtMs:number }
const conflict = (message = 'The assignment changed. Start a new PBE session.') => new HttpError(409, message);
export const pbeSessionDto = (s: PbeSession) => ({ id: s.id, format: s.format, seasonId: s.seasonId, mode: s.mode, status: s.status, targetCardCount: s.cards.length, ruleVersion: s.ruleVersion, scoringVersion: s.scoringVersion, selectionVersion: s.selectionVersion, ...(s.mode === 'Simulation' ? { rehearsalScope: 'ShortenedTimedPractice', eligibleCount: s.cards.length } : {}) });
const dto = (s: PbeSession, c: PbeCard) => ({ id: c.id, sessionId: s.id, format: 'Pbe', sequence: s.cards.indexOf(c) + 1, total: s.cards.length, question: questionView(c.question), assisted: c.assistedAtMs !== null });
const receipt = (result:PbeResult, alreadyProcessed:boolean) => ({ attemptId:result.attemptId,acceptedAtUtc:result.acceptedAtUtc,acceptedSequence:result.acceptedSequence,alreadyProcessed,feedbackDeferred:true });
export const pbeSummary=(s:PbeSession,interrupted=false,overlay?:PbeResultOverlay)=>{
 const results=s.attempts.map(a=>{const card=s.cards.find(c=>c.id===a.cardId)!,candidate=overlay?.entries[a.result.attemptId],dispute=candidate?.questionId===card.question.id&&candidate.questionVersion===card.question.version?candidate:null;return {attemptId:a.result.attemptId,questionId:card.question.id,earnedPoints:dispute?.pointsByPart?.reduce((n,p)=>n+p,0)??a.result.earnedPoints,originalEarnedPoints:a.result.earnedPoints,availablePoints:a.result.availablePoints,acceptedAtUtc:a.result.acceptedAtUtc,dispute};});
 const correct=results.filter(r=>r.earnedPoints===r.availablePoints).length,pendingCount=results.filter(r=>r.dispute?.status==='Pending').length,finalized=results.filter(r=>r.dispute?.status!=='Pending');
 const metrics={earnedPoints:results.reduce((n,r)=>n+r.earnedPoints,0),availablePoints:results.reduce((n,r)=>n+r.availablePoints,0),pendingCount,provisional:pendingCount>0,finalizedEarnedPoints:finalized.reduce((n,r)=>n+r.earnedPoints,0),finalizedAvailablePoints:finalized.reduce((n,r)=>n+r.availablePoints,0)};
 return {sessionId:s.id,format:s.format,mode:s.mode,attempted:s.attempts.length,correct,targetCardCount:s.cards.length,status:interrupted?'Interrupted':s.status,...metrics,results:s.mode==='Simulation'&&s.status==='Completed'?s.attempts.map((a,i)=>({...a.result,...results[i]})):results,recap:{version:'pbe-daily-v2',sessionId:s.id,seasonId:s.seasonId,mode:s.mode,completedAtUtc:s.completedAtUtc??null,attempted:s.attempts.length,correct,targetCardCount:s.cards.length,fullTargetReached:s.attempts.length===s.cards.length,newlyCreditedDay:s.newlyCreditedDay,missionLocalDate:s.missionLocalDate,creditedLocalDate:s.creditedLocalDate,weeklyGoalComplete:s.weeklyGoalComplete??false,personalBest:s.personalBest??null,missionSteps:pbeMissionSteps(s),earnedBadges:s.earnedBadges??[],passageChanges:[],interrupted,results,...metrics}};
};
export async function reviewedPbeSummary(ctx:Pick<RequestContext,'store'|'orgId'>,s:PbeSession,interrupted=false){const overlay=await ctx.store.get<PbeResultOverlay>('pbe-result-overlay',`Solo:${s.id}`,ctx.orgId);return pbeSummary(s,interrupted,overlay?.value);}

async function eligible(ctx: RequestContext, s: PbeSession) { const scope = await resolvePbeSessionSources(ctx, s.id); if (!scope.guards.some(g => g.kind === 'membership') || scope.eligibility !== s.scopeVersion || !scope.sources.length)
    throw conflict(); return scope; }
export async function startPbeSession(ctx: RequestContext, input: Start) {
    if (input.mode !== undefined && !['Practice', 'Review', 'Simulation'].includes(input.mode))
        throw new HttpError(400, 'Choose Practice or Review.');
    const seasonId = guid(input.seasonId), mode = input.mode ?? 'Practice';
    if (mode !== 'Practice' && mode !== 'Review' && mode !== 'Simulation')
        throw new HttpError(400, 'Choose Practice, Review, or Simulation.');
    if (input.training)
        requiredString(input.training.clientStartId, 'Training start ID', 200);
    if (input.training?.step && input.training.step !== mode)
        throw new HttpError(400, 'Choose a matching training step.');
    if (input.training?.missionRevision !== undefined && !input.training.missionId || input.training?.missionId && (input.training.missionRevision !== 1 || input.training.step !== mode))
        throw new HttpError(400, 'Choose a matching mission revision and step.');
    let progressScope:{key:string;scopeVersion:string}|undefined;
    if(input.progressScope!==undefined){
        if(input.format!==undefined&&input.format!=='Pbe'||input.chapter!==undefined||input.targetIds!==undefined||!input.progressScope||typeof input.progressScope!=='object'||Array.isArray(input.progressScope))throw new HttpError(400,'Choose one PBE progress selector.');
        progressScope={key:requiredString(input.progressScope.key,'Progress key',1000),scopeVersion:requiredString(input.progressScope.scopeVersion,'Progress scope version',200)};
    }
    const payload = JSON.stringify({ seasonId, mode, format: 'Pbe', ...(progressScope?{progressScope}:{}), chapter: input.chapter ? { contentPackId: input.chapter.contentPackId, chapter: input.chapter.chapter } : null, targetIds: input.targetIds ?? null, training: input.training ? { clientStartId: input.training.clientStartId, timeZone: input.training.timeZone ?? null, missionId: input.training.missionId ?? null, missionRevision: input.training.missionRevision ?? null, step: input.training.step ?? null } : null });
    const startKey = input.training?.clientStartId ? `${ctx.actor.userId}:${seasonId}:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.training.clientStartId))), b => b.toString(16).padStart(2, '0')).join('')}` : null;
    if (input.training?.clientStartId) {
        const row = await ctx.store.get<{
            sessionId: string;
        }>('pbe-session-start', startKey!, ctx.orgId);
        if (row) {
            const saved = (await ctx.store.require<PbeSession>('pbe-session', row.value.sessionId, ctx.orgId)).value;
            if (saved.startPayload !== payload)
                throw conflict('This start ID was already used with a different payload.');
            await eligible(ctx, saved);
            return json(pbeSessionDto(saved));
        }
    }
    const prepared=progressScope?await prepareChapterProgressScope(ctx,seasonId,progressScope):null;
    const scope = prepared?.scope ?? await resolvePbeSources(ctx, { organizationId: ctx.orgId, seasonId, studentId: ctx.actor.userId });
    if (!scope.guards.some(g => g.kind === 'membership'))
        throw new HttpError(403, 'Current season membership required.');
    if (input.training?.missionId)
        throw conflict('Resume the saved session for this mission, or reload Training HQ.');
    let sources = scope.sources;
    if (input.chapter) {
        const pack = guid(input.chapter.contentPackId);
        if (!Number.isInteger(input.chapter.chapter) || input.chapter.chapter < 1)
            throw new HttpError(400, 'Choose a valid chapter.');
        sources = sources.filter(s => s.contentPackId === pack && s.chapter === input.chapter!.chapter);
    }
    const bank = await loadFromResolvedSources(ctx, { organizationId: ctx.orgId, seasonId, studentId: ctx.actor.userId, sourceUnitIds: sources.map(s => s.id) }, scope, true);
    const selectedTargets=prepared?.targetIds??input.targetIds;
    if(prepared&&!selectedTargets?.length)return json({code:'PBE_COVERAGE_UNAVAILABLE',message:'No eligible published questions are available for this progress group.',format:'Pbe'},409);
    if (selectedTargets !== undefined) {
        if (!Array.isArray(selectedTargets) || !selectedTargets.length)
            throw new HttpError(400, 'Choose assigned targets.');
        const ids = new Set(selectedTargets.map(guid));
        if ([...ids].some(id => !bank.targets.some(t => t.id === id)))
            throw new HttpError(403, 'Choose assigned targets.');
        bank.questions = bank.questions.filter(q => q.parts.some(p => ids.has(p.targetId)));
    }
    const now = trainingNow(), atMs = Date.parse(now), sessionId = id(), p = await loadPbeProjections(ctx, seasonId, bank.targets.map(t => t.id), bank.questions.map(q => q.id));
    const reviews = new Map(p.reviews.map(r => [r.targetId, r])), services = new Map(p.questions.map(q => [q.subjectId, q])), targets = new Map(p.targets.map(t => [t.subjectId, t]));
    const groups = new Map<number, Set<string>>();
    for (const entry of [...p.recentTargets, ...p.reviews.flatMap(r => r.review.unresolved && r.failedSequence !== null ? [{ targetId: r.targetId, acceptedSequence: r.failedSequence }] : [])]) {
        const set = groups.get(entry.acceptedSequence) ?? new Set<string>();
        set.add(entry.targetId);
        groups.set(entry.acceptedSequence, set);
    }
    const selected = selectPbeQuestions({ sessionId, count: mode === 'Simulation' ? 10 : 8, mode, trueFalseMaxRatio: 0.1, usedQuestionIds: [], usedTargetIds: [], acceptedTargetGroups: [...groups].sort(([a], [b]) => a - b).map(([, ids]) => [...ids]), candidates: bank.questions.map(q => {
            const targetIds = [...new Set(q.parts.map(part => part.targetId))], rs = targetIds.flatMap(id => reviews.has(id) ? [reviews.get(id)!] : []), failed = rs.filter(r => r.review.unresolved), served = services.get(q.id);
            return { questionId: q.id, targetIds, sourceUnitIds: q.sourceUnitIds, sourceKind: q.sourceKind, kind: q.kind, servedCount: served?.servedCount ?? 0, lastServedAtMs: served?.lastServedAtMs ?? null, targetServedCount: Math.min(...targetIds.map(id => targets.get(id)?.servedCount ?? 0)), due: rs.some(r => r.review.unresolved || r.review.intervalIndex >= 0 && r.review.dueAtMs <= atMs), repairEligible: failed.length > 0, repairTargetIds: failed.length ? failed.map(r => r.targetId) : undefined, spacedRepair: failed.length > 0 && failed.every(r => p.recentTargets.filter(t => t.targetId !== r.targetId && t.acceptedSequence > (r.failedSequence ?? Number.MAX_SAFE_INTEGER)).length >= 2), lastQuestionId: rs.some(r => r.lastAnsweredQuestionId === q.id) ? q.id : null, alternateForm: rs.some(r => r.lastAnsweredQuestionKind !== null && r.lastAnsweredQuestionKind !== q.kind) };
        }) });
    if (!selected.length)
        return json({ code: bank.questions.length && mode === 'Review' ? 'PBE_NOTHING_DUE' : 'PBE_COVERAGE_UNAVAILABLE', message: bank.questions.length && mode === 'Review' ? 'No targets are due. Choose Practice.' : 'No published questions are available for your assignment. Ask your coach to add questions, or choose Memory.', format: 'Pbe' }, 409);
    const cards = selected.map(qid => { const question = bank.questions.find(q => q.id === qid)!; return { id: id(), question, targets: bank.targets.filter(t => question.parts.some(p => p.targetId === t.id)), servedAtMs: null, assistedAtMs: null }; });
    const s: PbeSession = { id: sessionId, format: 'Pbe', studentUserId: ctx.actor.userId, seasonId, mode, status: 'Created', scopeVersion: scope.eligibility, ruleVersion: PBE_RULE_VERSION, scoringVersion: PBE_SCORING_VERSION, selectionVersion: 'pbe-selection-v1', questionIds: selected, cards, attempts: [], createdAtUtc: now, clientStartId: input.training?.clientStartId, startPayload: payload, missionLocalDate: null, creditedLocalDate: null, newlyCreditedDay: false };
    const effort = mode === 'Simulation' ? { statements: [], guards: [] } : await preparePbeStartEffort(ctx, s, input.training?.timeZone);
    if (s.clientStartId)
        effort.statements.push(ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) VALUES('pbe-session-start',?,?,?,?,?) ON CONFLICT(kind,id,org_id) DO UPDATE SET data='invalid-json'").bind(startKey!, ctx.orgId, seasonId, ctx.actor.userId, JSON.stringify({ sessionId: s.id, format:s.format, ruleVersion:s.ruleVersion, scoringVersion:s.scoringVersion, selectionVersion:s.selectionVersion })));
    try { await atomic(ctx, 'pbe.session.start', [...(prepared?[prepared.inputGuard]:[]), pbeAssignmentSetGuard(ctx, scope), ...effort.statements, ctx.store.insertion('pbe-session', s.id, ctx.orgId, s, { seasonId, ownerId: ctx.actor.userId })], [...scope.guards, ...effort.guards,...(prepared?[prepared.pointerGuard]:[])]); } catch(error) { if(prepared&&error instanceof HttpError&&error.status===409)throw new HttpError(409,'PBE_CHAPTER_SCOPE_STALE');throw error; }
    return json(pbeSessionDto(s));
}
export async function submitTimedPbeSession(ctx: RequestContext, sessionId: string, input: unknown, elapsedMs: number, lockedAtMs:number) {
    return pbeSessionAction(ctx, sessionId, 'attempts', input, { token: timedAuthority, elapsedMs, lockedAtMs });
}
export async function pbeSessionAction(ctx: RequestContext, sessionId: string, action: string | undefined, input?: unknown, timed?: TimedDecision): Promise<Response | null> {
    const stored = await ctx.store.get<PbeSession>('pbe-session', sessionId, ctx.orgId);
    if (!stored)
        return null;
    const s = stored.value;
    if (s.studentUserId !== ctx.actor.userId)
        throw new HttpError(404, 'Study session was not found.');
    const interruption = s.mode === 'Simulation' ? await ctx.store.get<{status:string;restartAllowed:boolean}>('pbe-solo-interruption',s.id,ctx.orgId) : null;
    if (interruption) {
        if (!action) return json({session:{...pbeSessionDto(s),status:'Interrupted'},card:null,attempt:null,summary:await reviewedPbeSummary(ctx,s,true),interruption:interruption.value});
        throw conflict('This rehearsal was interrupted. Start another shortened timed practice.');
    }
    const persist = async (scope: Awaited<ReturnType<typeof eligible>>, w: {
        statements: Parameters<typeof atomic>[2];
        guards: Parameters<typeof atomic>[3];
    } = { statements: [], guards: [] }) => atomic(ctx, 'pbe.session.' + (action ?? 'resume'), [pbeAssignmentSetGuard(ctx, scope), ...w.statements, ctx.store.update('pbe-session', s.id, ctx.orgId, s, stored.revision)], [...scope.guards, ...w.guards!, { kind: 'pbe-session', id: s.id, revision: stored.revision }]);
    if (!action && s.status === 'Completed')
        return json({ session: pbeSessionDto(s), card: null, attempt: null, summary: await reviewedPbeSummary(ctx,s) });
    const scope = await eligible(ctx, s);
    if (action === 'attempts') {
        const submission = input as Submission;
        if (!submission || typeof submission.hintsUsed !== 'boolean' || !Array.isArray(submission.answers) || submission.answers.some(a => typeof a !== 'string' || a.length > 10000))
            throw new HttpError(400, 'Provide text answers and a hints indicator.');
        requiredString(submission.clientSubmissionId, 'Submission ID', 200);
        if (s.mode === 'Simulation' && (timed?.token !== timedAuthority || !Number.isFinite(timed.elapsedMs) || timed.elapsedMs < 0 || !Number.isSafeInteger(timed.lockedAtMs) || timed.lockedAtMs < 0))
            throw conflict('Timed rehearsal answers must use the authoritative response window.');
        const previous = s.attempts.find(a => a.clientSubmissionId === submission.clientSubmissionId);
        if (previous) {
            if (previous.cardId !== submission.challengeCardId || previous.hintsUsed !== submission.hintsUsed || JSON.stringify(previous.answers) !== JSON.stringify(submission.answers))
                throw conflict('This submission ID was already used with a different answer payload.');
            return json(s.mode === 'Simulation' ? receipt(previous.result, true) : { ...previous.result, alreadyProcessed: true });
        }
        const card = s.cards[s.attempts.length];
        if (s.status === 'Completed' || !card || card.id !== submission.challengeCardId || card.servedAtMs === null)
            throw conflict('Answer the active saved card.');
        if (submission.answers.length !== card.question.parts.length)
            throw new HttpError(400, 'Provide one answer per requested part.');
        const atMs = Date.parse(trainingNow()), attemptId = id(), unaided = card.assistedAtMs === null && !submission.hintsUsed;
        const grade = gradePbe(card.question, submission.answers);
        if (s.mode === 'Simulation') grade.earnedPoints = rehearsalPoints(grade.earnedPoints, timed!.elapsedMs, grade.availablePoints);
        const evidence = groupRecallEvidence(card.question, card.targets, submission.answers, attemptId, atMs, unaided), progress = await prepareRecallEvidence(ctx, s.seasonId, s.scopeVersion, evidence, card.question.kind, {questionVersion:card.question.version,responseLockedAtMs:s.mode==='Simulation'?timed!.lockedAtMs:atMs});
        const result: PbeResult = { attemptId, earnedPoints: grade.earnedPoints, availablePoints: grade.availablePoints, expectedParts: card.question.parts.map(p => p.acceptedAnswers[0]), sourceEvidence: card.question.evidence, citation: card.question.reference, unaided, acceptedAtUtc: new Date(atMs).toISOString(), acceptedSequence: progress.acceptedSequence!, alreadyProcessed: false };
        const attempt: PbeAttempt = { id: attemptId, cardId: card.id, clientSubmissionId: submission.clientSubmissionId, answers: [...submission.answers], hintsUsed: submission.hintsUsed, atMs, ...(s.mode === 'Simulation' ? { responseLockedAtMs: timed!.lockedAtMs } : {}), result };
        s.attempts.push(attempt);
        s.status = 'Active';
        const effort = s.mode === 'Simulation' ? { statements: [], guards: [] } : await preparePbeEffort(ctx, s, result.acceptedAtUtc);
        await persist(scope, { statements: [...progress.statements, ...effort.statements, ctx.store.insertion('pbe-attempt', attempt.id, ctx.orgId, { ...attempt, sessionId: s.id, format: 'Pbe', ruleVersion: s.ruleVersion, scoringVersion: s.scoringVersion, selectionVersion: s.selectionVersion }, { seasonId: s.seasonId, ownerId: s.studentUserId })], guards: [...progress.guards, ...effort.guards] });
        return json(s.mode === 'Simulation' ? receipt(result, false) : result);
    }
    if (action === 'complete') {
        if (!s.attempts.length)
            throw new HttpError(400, 'A session cannot be completed without an accepted answer.');
        if (s.mode === 'Simulation' && s.attempts.length !== s.cards.length)
            throw conflict('Finish every frozen rehearsal question before completing.');
        if (s.status !== 'Completed') {
            s.status = 'Completed';
            s.completedAtUtc = trainingNow();
            const bests = await recordPbePersonalBests(ctx, s);
            if (bests.beaten.accuracyBeaten || bests.beaten.correctBeaten)
                s.personalBest = bests.beaten;
            await persist(scope, { statements: bests.writes.statements, guards: bests.writes.guards });
        }
        return json(await reviewedPbeSummary(ctx,s));
    }
    if (action === 'source') {
        const card = s.cards[s.attempts.length];
        if (s.status === 'Completed' || !card || card.servedAtMs === null || (input as {
            challengeCardId?: string;
        })?.challengeCardId !== card.id)
            throw conflict('Choose the active saved card.');
        if (s.mode !== 'Practice')
            throw new HttpError(400, 'Source assistance is available in Practice.');
        if (card.assistedAtMs === null) {
            card.assistedAtMs = Date.parse(trainingNow());
            await persist(scope);
        }
        return json({ challengeCardId: card.id, assisted: true, sources: card.question.sourceUnitIds.map(id => scope.sources.find(s => s.id === id)) });
    }
    if (action === 'next') {
        const card = s.cards[s.attempts.length];
        if (s.status === 'Completed' || !card)
            throw new HttpError(400, 'The session target has been reached.');
        if (card.servedAtMs === null) {
            card.servedAtMs = Date.parse(trainingNow());
            s.status = 'Active';
            const service = await preparePbeService(ctx, s.seasonId, { serviceId: card.id, questionId: card.question.id, targetIds: card.targets.map(t => t.id), questionKind: card.question.kind, atMs: card.servedAtMs });
            await persist(scope, service);
        }
        return json(dto(s, card));
    }
    if (!action) {
        const card = s.cards.filter(c => c.servedAtMs !== null).at(-1), attempt = card ? s.attempts.find(a => a.cardId === card.id) : undefined;
        return json({ session: pbeSessionDto(s), card: card ? dto(s, card) : null, attempt: attempt ? s.mode === 'Simulation' ? { attemptId: attempt.result.attemptId, acceptedAtUtc: attempt.result.acceptedAtUtc, acceptedSequence: attempt.result.acceptedSequence, alreadyProcessed: true, feedbackDeferred: true, questionId:attempt.cardId } : { ...attempt.result, alreadyProcessed: true } : null, summary: null });
    }
    return null;
}
