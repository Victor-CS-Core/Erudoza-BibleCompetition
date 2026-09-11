import type { RequestContext } from '../types';
import { admin, body, HttpError, json, requiredString } from '../types';
import { atomic, contains, effectiveSources, fail, id, memberId, student } from '../application/model';
import type { Assignment, Membership, Season, Source } from '../application/model';
import { builtInContentSql, scopeEntriesSql } from '../application/library-access';
import { applyMastery, chooseActivity, eligibleActivities, evaluateAnswer, generateActivity, MASTERY_VERSION, nextReview, normalizeDifficulty, toCardDto } from './engine';
import type { GeneratedActivity, MasteryScores, RuleProfile, StudyMode } from './engine';

export interface Card extends GeneratedActivity { id: string; sequence: number; createdAtUtc: string; source: Source; answerSource: Source }
export interface Result { attemptId: string; isCorrect: boolean; evaluationResult: string; canonicalAnswer: string; citation: string; sourceText: string; masteryLevel: string; exactWordingScore: number; reviewDueAtUtc: string; alreadyProcessed: boolean }
export interface Attempt { id: string; sessionId: string; cardId: string; studentUserId: string; seasonId: string; sourceUnitId: string; knowledgeUnitId: string; clientSubmissionId: string; submittedAnswer: string; responseTimeMs: number; hintsUsed: boolean; isCorrect: boolean; evaluationResult: string; activityType: string; at: string; result: Result; isLegacyDuplicate?: boolean }
export interface Session { id: string; studentUserId: string; seasonId: string; status: string; mode: StudyMode; difficulty: string; targetCardCount: number; ruleProfile: RuleProfile & { showReference: boolean }; cards: Card[]; attempts: Attempt[]; createdAtUtc: string; completedAtUtc?: string }
export interface Mastery extends MasteryScores { id: string; studentUserId: string; seasonId: string; sourceUnitId: string; knowledgeUnitId: string; algorithmVersion: string; reviewDueAt: string; lastSeenAt: string }
interface Submission { clientSubmissionId: string; challengeCardId: string; submittedAnswer: string; responseTimeMs: number; hintsUsed: boolean }
interface Guard { kind: string; id: string; revision: number }
const zero: MasteryScores = { recognition: 0, exactWording: 0, reference: 0, sequence: 0, factualRecall: 0, level: 'Unseen' };
const defaultRules = { studyAllowMultipleChoice: true, simulationAllowMultipleChoice: false, simulationAllowTrueFalse: true, trueFalseMaxRatio: 0.1, showReference: true };
const sourceUnit = (s: Source) => ({ id: s.id, citationLabel: s.citation, canonicalText: s.canonicalText });
const knowledgeId = (s: Source) => s.knowledgeUnitId ?? s.id;
const sessionDto = (s: Session) => ({ id: s.id, seasonId: s.seasonId, status: s.status, mode: s.mode, targetCardCount: s.targetCardCount, difficulty: s.difficulty });
const cardDto = (s: Session, c: Card) => toCardDto(c, { id: c.id, sessionId: s.id, sequence: c.sequence, total: s.targetCardCount }, sourceUnit(c.source), s.mode !== 'Simulation' || s.ruleProfile.showReference, false);
const summary = (s: Session) => ({ sessionId: s.id, mode: s.mode, attempted: s.attempts.length, correct: s.attempts.filter(a => a.isCorrect).length, targetCardCount: s.targetCardCount, status: s.status });
const replay = (a: Attempt) => ({ ...a.result, alreadyProcessed: true });
function requireStudent(ctx: RequestContext) { if (ctx.actor.kind !== 'Student' || ctx.actor.role !== 'Student') throw new HttpError(403, 'Student access is required.'); }
async function listAll<T extends { id: string }>(ctx: RequestContext, kind: string, scope: { seasonId?: string; ownerId?: string } = {}) {
  const result: T[] = []; let after: string | undefined;
  for (;;) { const page = await ctx.store.list<T>(kind, ctx.orgId, { ...scope, after, limit: 5000 }); result.push(...page); if (page.length < 5000) return result; after = page.at(-1)!.id; }
}

/** Read revisions before computing eligibility, so concurrent scope or licensing changes invalidate the write. */
async function activeScope(ctx: RequestContext, seasonId: string, studentId: string) {
  const rows = await ctx.env.DB.prepare(`WITH selected AS (SELECT json_extract(p.value,'$.contentPackId') AS id FROM Records sc,json_each(${scopeEntriesSql('sc')}) p WHERE sc.kind='scope' AND sc.id=? AND sc.org_id=?),
    selected_packs AS (SELECT r.kind,r.id,r.org_id,r.revision FROM selected CROSS JOIN Records r ON r.kind='pack' AND r.id=selected.id WHERE r.org_id=? OR ${builtInContentSql('r')})
    SELECT kind,id,revision FROM Records WHERE org_id=? AND kind IN ('season','scope') AND id=?
    UNION ALL SELECT kind,id,revision FROM Records WHERE org_id=? AND kind IN ('assignment','membership') AND season_id=? AND owner_id=?
    UNION ALL SELECT kind,id,revision FROM selected_packs
    UNION ALL SELECT r.kind,r.id,r.revision FROM selected_packs p CROSS JOIN Records r INDEXED BY Records_owner ON r.kind='source' AND r.owner_id=p.id AND r.org_id=p.org_id WHERE p.org_id=?`).bind(seasonId, ctx.orgId, ctx.orgId, ctx.orgId, seasonId, ctx.orgId, seasonId, studentId, ctx.orgId).all<Guard>();
  // Built-in verses are immutable. Guard their pack plus private season/assignment
  // revisions; do not read all 31,102 source revisions for a small study selection.
  const season = await ctx.store.require<Season>('season', seasonId, ctx.orgId);
  if (season.value.status !== 'Active') fail('The season must be active for study.');
  const sources = await effectiveSources(ctx, seasonId, studentId);
  if (!sources.length) fail('The student has no assigned study scope.');
  return { sources, guards: [...rows.results, { kind: '@active-user', id: studentId, revision: 0 }] };
}
function cardInScope(card: Card, sources: Source[]) {
  if (![card.sourceUnitId, card.answerSourceUnitId ?? card.sourceUnitId].every(id => sources.some(s => s.id === id))) fail('This card is no longer within the student assignment. Start a new session.');
}
function selectedGuards(guards: Guard[], sources: string[] = []) { return guards.filter(g => g.kind !== 'source' || sources.includes(g.id)); }
async function retry<T>(run: () => Promise<T>): Promise<T> {
  for (let count = 0; ; count++) {
    try { return await run(); }
    catch (error) { if (count >= 4 || !(error instanceof HttpError && error.status === 409 || String(error).includes('UNIQUE constraint failed'))) throw error; }
  }
}
async function loadSession(ctx: RequestContext, sessionId: string) {
  const stored = await ctx.store.require<Session>('session', sessionId, ctx.orgId);
  if (stored.value.studentUserId !== ctx.actor.userId) throw new HttpError(404, 'Study session was not found.');
  return stored;
}
async function start(ctx: RequestContext, input: { seasonId: string; mode?: StudyMode }) {
  const seasonId = requiredString(input.seasonId, 'Season'), mode = input.mode ?? 'Practice';
  if (!['Practice', 'Review', 'Simulation'].includes(mode)) fail('Choose Practice, Review, or Simulation.');
  return retry(async () => {
    const scope = await activeScope(ctx, seasonId, ctx.actor.userId);
    const member = await ctx.store.get<Membership>('membership', memberId(seasonId, ctx.actor.userId), ctx.orgId);
    let targetCardCount = mode === 'Simulation' ? 10 : 8;
    if (mode === 'Review') {
      const mastery = await listAll<Mastery>(ctx, 'mastery', { seasonId, ownerId: ctx.actor.userId });
      const due = mastery.filter(m => Date.parse(m.reviewDueAt) <= Date.now() && scope.sources.some(s => knowledgeId(s) === m.knowledgeUnitId));
      if (!due.length) fail('There are no passages due for review.');
      targetCardCount = Math.min(8, due.length);
    }
    const session: Session = { id: id(), studentUserId: ctx.actor.userId, seasonId, status: 'Created', mode, difficulty: member?.value.difficulty ?? 'Standard', targetCardCount, ruleProfile: { ...defaultRules }, cards: [], attempts: [], createdAtUtc: new Date().toISOString() };
    await atomic(ctx, 'study.session.start', [ctx.store.insertion('session', session.id, ctx.orgId, session, { seasonId, ownerId: ctx.actor.userId })], selectedGuards(scope.guards));
    return json(sessionDto(session));
  });
}
async function next(ctx: RequestContext, sessionId: string) {
  return retry(async () => {
    const stored = await loadSession(ctx, sessionId), session = stored.value;
    if (['Completed', 'Abandoned'].includes(session.status)) fail('The study session is already complete.');
    const scope = await activeScope(ctx, session.seasonId, session.studentUserId);
    const unanswered = session.cards.find(c => !session.attempts.some(a => a.cardId === c.id));
    if (unanswered) { cardInScope(unanswered, scope.sources); return json(cardDto(session, unanswered)); }
    if (session.cards.length >= session.targetCardCount) fail('The session target has been reached.');
    const mastery = await listAll<Mastery>(ctx, 'mastery', { seasonId: session.seasonId, ownerId: session.studentUserId });
    const due = new Set(mastery.filter(m => Date.parse(m.reviewDueAt) <= Date.now()).map(m => m.knowledgeUnitId));
    const exposures = await ctx.env.DB.prepare(`SELECT json_extract(card.value,'$.sourceUnitId') AS sourceId,count(*) AS count,max(json_extract(card.value,'$.createdAtUtc')) AS lastAt FROM Records s,json_each(s.data,'$.cards') card WHERE s.kind='session' AND s.org_id=? AND s.season_id=? AND s.owner_id=? GROUP BY json_extract(card.value,'$.sourceUnitId')`).bind(ctx.orgId, session.seasonId, session.studentUserId).all<{ sourceId: string; count: number; lastAt: string }>();
    const exposure = new Map(exposures.results.map(e => [e.sourceId, e]));
    const assignments = await listAll<Assignment>(ctx, 'assignment', { seasonId: session.seasonId, ownerId: session.studentUserId });
    const primary = (s: Source) => assignments.some(a => a.type === 'PrimarySpecialist' && a.contentPackId === s.contentPackId && contains(a, s));
    const count = (cards: Card[], s: Source) => cards.filter(c => c.sourceUnitId === s.id).length;
    const last = (s: Source) => Date.parse(exposure.get(s.id)?.lastAt ?? '0001-01-01T00:00:00Z');
    const eligible = scope.sources.filter(s => session.mode !== 'Review' || due.has(knowledgeId(s)));
    if (!eligible.length) fail('There are no passages due for review.');
    const source = eligible.sort((a, b) => count(session.cards, a) - count(session.cards, b) || (exposure.get(a.id)?.count ?? 0) - (exposure.get(b.id)?.count ?? 0) || Number(due.has(knowledgeId(b))) - Number(due.has(knowledgeId(a))) || Number(primary(b)) - Number(primary(a)) || last(a) - last(b) || a.ordinal - b.ordinal || knowledgeId(a).localeCompare(knowledgeId(b)))[0];
    const nextSource = scope.sources.find(s => s.contentPackId === source.contentPackId && s.ordinal === source.ordinal + 1);
    const alternate = scope.sources.find(s => s.id !== source.id), sequence = session.cards.length + 1;
    const request = { sourceUnit: sourceUnit(source), knowledgeUnitId: knowledgeId(source), sessionId, sequence, difficulty: normalizeDifficulty(session.difficulty), mode: session.mode, ruleProfile: session.ruleProfile, nextSourceUnit: nextSource ? sourceUnit(nextSource) : null, nextKnowledgeUnitId: nextSource ? knowledgeId(nextSource) : null, alternateSourceUnit: alternate ? sourceUnit(alternate) : null, distractorCitations: [...new Set(scope.sources.filter(s => s.citation !== source.citation).map(s => s.citation))].slice(0, 6), usedActivityTypes: session.cards.map(c => c.activityType), targetCardCount: session.targetCardCount };
    const activity = chooseActivity(eligibleActivities(request), request.usedActivityTypes, sequence);
    if (!activity) return fail('No activity provider is available for the current rule profile and mode.');
    const generated = generateActivity(activity, request);
    const card: Card = { ...generated, id: id(), sequence, createdAtUtc: new Date().toISOString(), source: { ...source }, answerSource: { ...(generated.answerSourceUnitId ? nextSource! : source) } };
    session.cards.push(card); session.status = 'Active';
    await atomic(ctx, 'study.card.create', [ctx.store.update('session', sessionId, ctx.orgId, session, stored.revision)], [{ kind: 'session', id: sessionId, revision: stored.revision }, ...selectedGuards(scope.guards, [source.id, card.answerSource.id, ...(alternate ? [alternate.id] : [])])]);
    return json(cardDto(session, card));
  });
}
async function submit(ctx: RequestContext, sessionId: string, input: Submission) {
  return retry(async () => {
    const stored = await loadSession(ctx, sessionId), session = stored.value;
    // Migrated duplicate attempts intentionally stay outside accepted session history.
    // Submission identity must still replay their own original evidence before card fallback.
    const persisted = typeof input.clientSubmissionId === 'string' ? await ctx.env.DB.prepare("SELECT data FROM Records WHERE kind='attempt' AND org_id=? AND season_id=? AND owner_id=? AND json_extract(data,'$.sessionId')=? AND json_extract(data,'$.clientSubmissionId')=? LIMIT 1").bind(ctx.orgId, session.seasonId, session.studentUserId, sessionId, input.clientSubmissionId).first<{ data: string }>() : null;
    const existing = persisted ? JSON.parse(persisted.data) as Attempt : session.attempts.find(a => a.clientSubmissionId === input.clientSubmissionId);
    if (existing) {
      if (existing.cardId !== input.challengeCardId || existing.submittedAnswer !== input.submittedAnswer || existing.responseTimeMs !== input.responseTimeMs || existing.hintsUsed !== input.hintsUsed) fail('This submission ID was already used with a different answer payload.');
      return json(replay(existing));
    }
    const answered = session.attempts.find(a => a.cardId === input.challengeCardId);
    if (answered) return json(replay(answered));
    if (['Completed', 'Abandoned'].includes(session.status)) fail('The study session is already complete.');
    requiredString(input.clientSubmissionId, 'Submission ID', 200);
    if (!Number.isSafeInteger(input.responseTimeMs) || input.responseTimeMs < 0 || input.responseTimeMs > 2147483647 || typeof input.submittedAnswer !== 'string' || input.submittedAnswer.length > 100000 || typeof input.hintsUsed !== 'boolean') fail('An answer, non-negative response time and hints indicator are required.');
    if (session.mode === 'Simulation' && input.hintsUsed) fail('Hints are not permitted in simulation.');
    const card = session.cards.find(c => c.id === input.challengeCardId);
    if (!card) return fail('Challenge card does not belong to this session.');
    const scope = await activeScope(ctx, session.seasonId, session.studentUserId); cardInScope(card, scope.sources);
    const evaluation = evaluateAnswer(input.submittedAnswer, card.answerKey.canonicalAnswer), now = new Date().toISOString();
    const priorId = await ctx.env.DB.prepare("SELECT id FROM Records WHERE kind='mastery' AND org_id=? AND season_id=? AND owner_id=? AND json_extract(data,'$.knowledgeUnitId')=? LIMIT 1").bind(ctx.orgId, session.seasonId, session.studentUserId, card.knowledgeUnitId).first<{ id: string }>();
    const masteryId = priorId?.id ?? `${session.seasonId}:${session.studentUserId}:${card.knowledgeUnitId}`;
    const previous = await ctx.store.get<Mastery>('mastery', masteryId, ctx.orgId);
    let priorScores = previous?.value.algorithmVersion === MASTERY_VERSION ? previous.value : zero;
    if (previous && previous.value.algorithmVersion !== MASTERY_VERSION) {
      const rows = await ctx.env.DB.prepare(`SELECT a.data,
        (SELECT c.value FROM json_each(s.data,'$.cards') c WHERE json_extract(c.value,'$.id')=json_extract(a.data,'$.cardId') LIMIT 1) AS card
        FROM Records a LEFT JOIN Records s ON s.kind='session' AND s.id=json_extract(a.data,'$.sessionId') AND s.org_id=a.org_id AND s.season_id=a.season_id AND s.owner_id=a.owner_id
        WHERE a.kind='attempt' AND a.org_id=? AND a.season_id=? AND a.owner_id=? AND json_extract(a.data,'$.knowledgeUnitId')=? AND coalesce(json_extract(a.data,'$.isLegacyDuplicate'),0)=0
        ORDER BY json_extract(a.data,'$.at'),a.id`).bind(ctx.orgId, session.seasonId, session.studentUserId, card.knowledgeUnitId).all<{ data: string; card: string | null }>();
      for (const row of rows.results) {
        const evidence = JSON.parse(row.data) as Attempt;
        const historicalCard = row.card ? JSON.parse(row.card) as Card : undefined;
        if (evidence.activityType === 'WhatComesNext' && !historicalCard?.answerSourceUnitId) continue;
        priorScores = applyMastery(priorScores, evidence.isCorrect, evidence.hintsUsed, evidence.activityType, historicalCard?.answerMode ?? 'SelectedChoice', historicalCard?.payload.difficulty ?? 1);
      }
    }
    const scores = applyMastery(priorScores, evaluation.isCorrect, input.hintsUsed, card.activityType, card.answerMode, card.payload.difficulty);
    const mastery: Mastery = { ...scores, id: masteryId, studentUserId: session.studentUserId, seasonId: session.seasonId, sourceUnitId: card.answerSource.id, knowledgeUnitId: card.knowledgeUnitId, algorithmVersion: MASTERY_VERSION, reviewDueAt: nextReview(now, evaluation.isCorrect), lastSeenAt: now };
    const attemptId = id();
    const result: Result = { attemptId, isCorrect: evaluation.isCorrect, evaluationResult: evaluation.evaluationCode, canonicalAnswer: card.answerKey.canonicalAnswer, citation: card.answerSource.citation, sourceText: card.answerSource.canonicalText, masteryLevel: mastery.level, exactWordingScore: mastery.exactWording, reviewDueAtUtc: mastery.reviewDueAt, alreadyProcessed: false };
    const attempt: Attempt = { id: attemptId, sessionId, cardId: card.id, studentUserId: session.studentUserId, seasonId: session.seasonId, sourceUnitId: card.answerSource.id, knowledgeUnitId: card.knowledgeUnitId, clientSubmissionId: input.clientSubmissionId, submittedAnswer: input.submittedAnswer, responseTimeMs: input.responseTimeMs, hintsUsed: input.hintsUsed, isCorrect: evaluation.isCorrect, evaluationResult: evaluation.evaluationCode, activityType: card.activityType, at: now, result };
    session.attempts.push(attempt); session.status = 'Active';
    const recordScope = { seasonId: session.seasonId, ownerId: session.studentUserId };
    await atomic(ctx, 'study.attempt', [ctx.store.update('session', sessionId, ctx.orgId, session, stored.revision), previous ? ctx.store.update('mastery', masteryId, ctx.orgId, mastery, previous.revision) : ctx.store.insertion('mastery', masteryId, ctx.orgId, mastery, recordScope), ctx.store.insertion('attempt', attemptId, ctx.orgId, attempt, recordScope)], [{ kind: 'session', id: sessionId, revision: stored.revision }, ...(previous ? [{ kind: 'mastery', id: masteryId, revision: previous.revision }] : []), ...selectedGuards(scope.guards, [card.sourceUnitId, card.answerSource.id])]);
    return json(result);
  });
}
async function progress(ctx: RequestContext, studentId: string, requested: string | null) {
  const user = ctx.actor.userId === studentId && ctx.actor.kind === 'Adult' ? { displayName: ctx.actor.displayName } : await student(ctx, studentId);
  const assignments = await listAll<Assignment>(ctx, 'assignment', { ownerId: studentId });
  const seasons = await listAll<Season & { activatedAtUtc?: string }>(ctx, 'season');
  const season = seasons.filter(s => assignments.some(a => a.seasonId === s.id) && (requested ? s.id === requested : s.status === 'Active')).sort((a, b) => (b.activatedAtUtc ?? b.createdAtUtc ?? '').localeCompare(a.activatedAtUtc ?? a.createdAtUtc ?? ''))[0];
  const empty = { seasonId: '00000000-0000-0000-0000-000000000000', seasonName: '', seasonStatus: 'None', assignments: [], masteredCount: 0, reviewDueCount: 0, attemptCount: 0, mastery: [], studentUserId: studentId, studentDisplayName: user.displayName, recentAttempts: [] };
  if (!season) return json(empty);
  const sources = await effectiveSources(ctx, season.id, studentId), byKnowledge = new Map(sources.map(s => [knowledgeId(s), s]));
  const states = (await listAll<Mastery>(ctx, 'mastery', { seasonId: season.id, ownerId: studentId })).filter(m => byKnowledge.has(m.knowledgeUnitId));
  const attempts = (await listAll<Attempt>(ctx, 'attempt', { seasonId: season.id, ownerId: studentId })).filter(a => !a.isLegacyDuplicate);
  const member = await ctx.store.get<Membership>('membership', memberId(season.id, studentId), ctx.orgId);
  return json({ ...empty, seasonId: season.id, seasonName: season.name, seasonStatus: season.status, assignments: assignments.filter(a => a.seasonId === season.id).map(a => ({ ...a, difficulty: member?.value.difficulty ?? 'Standard' })), masteredCount: states.filter(m => m.level === 'Mastered' && m.algorithmVersion === MASTERY_VERSION).length, reviewDueCount: states.filter(m => Date.parse(m.reviewDueAt) <= Date.now()).length, attemptCount: attempts.length, mastery: states.map(m => ({ knowledgeUnitId: m.knowledgeUnitId, title: byKnowledge.get(m.knowledgeUnitId)?.citation ?? 'Passage', level: m.level, exactWordingScore: m.exactWording, recognitionScore: m.recognition, algorithmVersion: m.algorithmVersion, reviewDueAtUtc: m.reviewDueAt })), recentAttempts: attempts.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20).map(a => ({ id: a.id, title: a.result?.citation ?? byKnowledge.get(a.knowledgeUnitId)?.citation ?? 'Passage', activityType: a.activityType, isCorrect: a.isCorrect, submittedAnswer: a.submittedAnswer, evaluationResult: a.evaluationResult, createdAtUtc: a.at })) });
}
export async function handleStudy(ctx: RequestContext): Promise<Response | null> {
  const { path, request } = ctx, method = request.method;
  if (ctx.orgId !== ctx.actor.organizationId) throw new HttpError(403, 'Organization access denied.');
  const coachProgress = path.match(/^\/seasons\/([^/]+)\/students\/([^/]+)\/progress$/);
  if (coachProgress && method === 'GET') { admin(ctx.actor); return progress(ctx, coachProgress[2], coachProgress[1]); }
  if (!/^\/api\/v1\/(study|progress)(\/|$)/.test(path)) return null;
  if (path === '/api/v1/progress/me' && method === 'GET') {
    if (ctx.actor.kind !== 'Student') admin(ctx.actor);
    return progress(ctx, ctx.actor.userId, new URL(request.url).searchParams.get('seasonId'));
  }
  requireStudent(ctx);
  if (path === '/api/v1/progress/me/seasons' && method === 'GET') {
    const assignments = await listAll<Assignment>(ctx, 'assignment', { ownerId: ctx.actor.userId });
    const seasons = await listAll<Season>(ctx, 'season');
    return json(seasons.filter(s => s.status === 'Active' && assignments.some(a => a.seasonId === s.id)).map(s => ({ id: s.id, name: s.name })));
  }
  if (path === '/api/v1/study/sessions' && method === 'POST') return start(ctx, await body(request));
  const match = path.match(/^\/api\/v1\/study\/sessions\/([^/]+)(?:\/(next|attempts|complete))?$/);
  if (!match) return null;
  const sessionId = match[1], action = match[2];
  if (action === 'next' && method === 'GET') return next(ctx, sessionId);
  if (action === 'attempts' && method === 'POST') return submit(ctx, sessionId, await body(request));
  if (action === 'complete' && method === 'POST') return retry(async () => {
    const stored = await loadSession(ctx, sessionId), session = stored.value;
    if (!session.attempts.length) fail('A session cannot be completed without a persisted attempt.');
    if (session.status !== 'Completed') { session.status = 'Completed'; session.completedAtUtc ??= new Date().toISOString(); await atomic(ctx, 'study.session.complete', [ctx.store.update('session', sessionId, ctx.orgId, session, stored.revision)], [{ kind: 'session', id: sessionId, revision: stored.revision }]); }
    return json(summary(session));
  });
  if (!action && method === 'GET') {
    const session = (await loadSession(ctx, sessionId)).value, card = session.cards.at(-1);
    const attempt = card ? session.attempts.find(a => a.cardId === card.id) : undefined;
    if (card && !attempt && session.status !== 'Completed') cardInScope(card, (await activeScope(ctx, session.seasonId, session.studentUserId)).sources);
    return json({ session: sessionDto(session), card: card ? cardDto(session, card) : null, attempt: attempt ? replay(attempt) : null, summary: session.status === 'Completed' ? summary(session) : null });
  }
  return null;
}
