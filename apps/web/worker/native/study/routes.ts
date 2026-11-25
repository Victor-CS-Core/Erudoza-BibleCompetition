import { evaluateMissingWordAnswers, type MissingWordAnswer, type MissingWordResult } from './missing-word-answers';
import type { MissingWordAnswerPayload } from '../../../src/api/types';
import { resolvePbeSources } from '../pbe/sources';
import { startPbeSession, pbeSessionAction } from '../pbe/sessions';
import { trainingNow } from '../training/clock';
import { dailyActivityIncrement } from '../daily-activity';
import type { StartTrainingContext, SessionRecap, SkillScores } from '../../../src/api/trainingTypes';
import { applyAcceptedAttempt, prepareStart, makeRecap, recordPersonalBests, scopeVersion, startPayload, preference, resolvePreference } from '../training/store';
import type { SessionTraining, MissionRecord, Writes } from '../training/store';
import type { Stored } from '../store';
import { fullTargetReached } from '../training/rules';
import { resolveTrainingCalendar } from '../training/calendar';
import { awardXp, XP_VALUES, xpReward, type XpReward as XpRewardSnapshot } from '../training/xp';
import { sessionCompleteQuests, QUEST_DEFS } from '../training/quests';
import type { RequestContext } from '../types';
import { admin, body, HttpError, json, requiredString } from '../types';
import { atomic, contains, effectiveSources, fail, id, memberId, student, requireLearner } from '../application/model';
import type { Assignment, Membership, Season, Source } from '../application/model';
import { builtInContentSql, scopeEntriesSql } from '../application/library-access';
import { applyMastery, BLANK_SHUFFLE_LIMIT, chooseActivity, eligibleActivities, evaluateAnswer, generateActivity, isScoredMasteryVersion, MASTERY_VERSION, nextReview, normalizeDifficulty, scoredSkill, shuffleRandom, toCardDto } from './engine';
import type { GeneratedActivity, MasteryScores, RuleProfile, StudyMode } from './engine';

export interface Card extends GeneratedActivity { id: string; sequence: number; createdAtUtc: string; source: Source; answerSource: Source; blankShuffles?: number }
/** The one spelling second chance on a graded Fill in the Blank card:
 * the learner retyped only the blanks the grader flagged as spelling
 * slips. Stored on the attempt, apart from the first grading — the first
 * attempt's outcome fields are never rewritten. */
export interface SpellingFix { clientSubmissionId: string; answers: MissingWordAnswer[]; results: MissingWordResult[]; correctedCount: number; effectiveScore: number; xpEarned: number; xpReward?: XpRewardSnapshot; masteryLevel?: string; skillScore?: number; at: string }
export interface Result { submittedAnswer?: string; missingWordAnswers?: MissingWordAnswer[]; missingWordResults?: MissingWordResult[]; /** Blank indexes eligible for the spelling second chance (spelling slips only; stamped at grading from the same classifier that labels the feedback, and never in Simulation). */ spellingEligible?: number[]; attemptId: string; isCorrect: boolean; score: number; evaluationResult: string; canonicalAnswer: string; citation: string; sourceText: string; masteryLevel: string; exactWordingScore: number; skillKey: string; skillLabel: string; skillScore: number; reviewDueAtUtc: string; alreadyProcessed: boolean; /** XP this attempt actually earned (cap-aware session xpEarned delta, including any bonus the attempt triggered). */ xpEarned?: number; /** Trailing consecutive correct attempts in this session, including this one. */ sessionStreak?: number; /** Server-computed reward snapshot (earned XP + level state before/after) powering the per-answer XP animation; stored on the result so replays carry the same numbers. */ xpReward?: import('../training/xp').XpReward }
export interface Attempt { clientHintsUsed?: boolean; answerPayload?: MissingWordAnswerPayload; spellingFix?: SpellingFix; id: string; sessionId: string; cardId: string; studentUserId: string; seasonId: string; sourceUnitId: string; knowledgeUnitId: string; clientSubmissionId: string; submittedAnswer: string; responseTimeMs: number; hintsUsed: boolean; isCorrect: boolean; score: number; evaluationResult: string; activityType: string; at: string; result: Result; isLegacyDuplicate?: boolean; previousAttemptId?: string; before?: SkillScores; after?: SkillScores }
export interface Session { readerAssistedCardIds?: string[]; deckOrder?: string[]; memoryChallenge?: 'Warmup' | 'Advanced'; memoryChallengeRequest?: 'Warmup' | 'Advanced'; generatorVersion?: string; evidenceProfile?: import('./engine').MemoryEvidenceProfile; /** Passage-scoped start (from a passage CTA): the resolved knowledge-unit
   * set this session may draw cards from, plus the original request so a
   * replayed client start ID with a different scope is rejected. */
  passageScope?: { knowledgeUnitIds: string[] }; passageScopeRequest?: { assignmentId: string } | { knowledgeUnitId: string }; id: string; studentUserId: string; seasonId: string; status: string; mode: StudyMode; difficulty: string; targetCardCount: number; ruleProfile: RuleProfile & { showReference: boolean }; cards: Card[]; attempts: Attempt[]; createdAtUtc: string; completedAtUtc?: string; training?: SessionTraining; recap?: SessionRecap }
export interface Mastery extends MasteryScores { id: string; studentUserId: string; seasonId: string; sourceUnitId: string; knowledgeUnitId: string; algorithmVersion: string; reviewDueAt: string; lastSeenAt: string; lastAttemptId?: string; streak: number }
type Submission = import('../../../src/api/types').SubmitAttemptBody;
function validateSubmission(input: Submission) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('An answer object is required.');
  const legacy = Object.hasOwn(input, 'submittedAnswer'), slots = Object.hasOwn(input, 'missingWordAnswers');
  if (legacy === slots) fail('Provide exactly one answer representation.');
  if (legacy && typeof input.submittedAnswer !== 'string') fail('An answer is required.');
  if (slots) {
    requiredString(input.clientSubmissionId, 'Submission ID', 200);
    if (!Array.isArray(input.missingWordAnswers) || input.missingWordAnswers.some(a => !a || !Number.isSafeInteger(a.index) || typeof a.text !== 'string' || Object.keys(a).some(key=>key!=='index'&&key!=='text')) || new Set(input.missingWordAnswers.map(a=>a.index)).size !== input.missingWordAnswers.length || input.missingWordAnswers.reduce((size,a)=>size+a.text.length,0)>100000) fail('Invalid missing-word answers.');
  }
  if (!Number.isSafeInteger(input.responseTimeMs) || input.responseTimeMs < 0 || input.responseTimeMs > 2147483647 || typeof input.hintsUsed !== 'boolean') fail('A non-negative response time and hints indicator are required.');
}
function sameAnswer(existing: Attempt, input: Submission) {
  if (!existing.answerPayload) return input.missingWordAnswers === undefined && existing.submittedAnswer === input.submittedAnswer;
  const payload = existing.answerPayload, answers = input.missingWordAnswers;
  return payload.format === 'missing-words-slots/v1' && !!answers && answers.length === payload.answers.length && payload.answers.every(saved=>answers.some(answer=>answer.index===saved.index && answer.text===saved.text));
}
function structuredAnswer(card: Card, answers: MissingWordAnswer[]) {
  if (card.activityType !== 'MissingWords') return fail('Indexed answers are only valid for MissingWords.');
  try {
    const evaluation = evaluateMissingWordAnswers(card.payload.tokens, answers);
    const ordered = card.payload.tokens.filter(token=>token.hidden).map(token=>({index:token.index,text:answers.find(answer=>answer.index===token.index)!.text}));
    return {format:'missing-words-slots/v1' as const,answers:ordered,results:evaluation.results,score:evaluation.score,evaluationCode:evaluation.evaluationCode};
  } catch { return fail('Invalid missing-word answers.'); }
}
interface Guard { kind: string; id: string; revision: number }
const zero: MasteryScores = { recognition: 0, exactWording: 0, reference: 0, sequence: 0, factualRecall: 0, level: 'Unseen' };
const defaultRules = { studyAllowMultipleChoice: true, simulationAllowMultipleChoice: false, simulationAllowTrueFalse: true, trueFalseMaxRatio: 0.1, showReference: true };
const sourceUnit = (s: Source) => ({ id: s.id, citationLabel: s.citation, canonicalText: s.canonicalText });
/** New Testament book keys — the same set the client catalog uses
 * (src/components/scripture/BookBrowser.tsx); every other book key is Old
 * Testament. Used only to rank ReferenceMatch distractors by proximity. */
const NEW_TESTAMENT_BOOK_KEYS = new Set('MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'.split(' '));
const testamentOf = (bookKey: string) => NEW_TESTAMENT_BOOK_KEYS.has(bookKey) ? 'New' : 'Old';
/** ReferenceMatch distractors ordered by proximity to the target source:
 * tier 1 same book + same chapter, tier 2 same book, tier 3 same testament,
 * tier 4 everything else; within a tier by chapter distance, then ordinal.
 * Deterministic; the target's own citation is excluded, as before. */
export function orderDistractorCitations(sources: Source[], target: Source): string[] {
  const tier = (s: Source) => s.bookKey === target.bookKey && s.chapter === target.chapter ? 1 : s.bookKey === target.bookKey ? 2 : testamentOf(s.bookKey) === testamentOf(target.bookKey) ? 3 : 4;
  const ordered = sources.filter(s => s.citation !== target.citation).sort((a, b) => tier(a) - tier(b) || Math.abs(a.chapter - target.chapter) - Math.abs(b.chapter - target.chapter) || a.ordinal - b.ordinal || a.id.localeCompare(b.id));
  return [...new Set(ordered.map(s => s.citation))].slice(0, 6);
}
/** The TrueFalse fallback alternate: the CLOSEST same-chapter source by
 * ordinal distance, then the closest same-book source, then the first
 * other source — a neighboring verse reads as a far more plausible false
 * statement than an arbitrary one. */
export function closestAlternateSource(sources: Source[], target: Source): Source | undefined {
  const tier = (s: Source) => s.bookKey === target.bookKey && s.chapter === target.chapter ? 0 : s.bookKey === target.bookKey ? 1 : 2;
  return sources.filter(s => s.id !== target.id).sort((a, b) => tier(a) - tier(b) || Math.abs(a.ordinal - target.ordinal) - Math.abs(b.ordinal - target.ordinal) || a.ordinal - b.ordinal || a.id.localeCompare(b.id))[0];
}
const knowledgeId = (s: Source) => s.knowledgeUnitId ?? s.id;
const sessionDto = (s: Session) => ({ id: s.id, seasonId: s.seasonId, status: s.status, mode: s.mode, targetCardCount: s.targetCardCount, difficulty: s.difficulty, memoryChallenge:s.memoryChallenge,generatorVersion:s.generatorVersion,evidenceProfile:s.evidenceProfile });
const cardDto = (s: Session, c: Card) => { const dto = toCardDto(c, { id: c.id, sessionId: s.id, sequence: c.sequence, total: s.targetCardCount }, sourceUnit(c.source), s.mode !== 'Simulation' || s.ruleProfile.showReference, false); return c.activityType === 'MissingWords' ? { ...dto, blankShuffles: c.blankShuffles ?? 0, blankShuffleLimit: BLANK_SHUFFLE_LIMIT } : dto; };
const summary = (s: Session) => ({ sessionId: s.id, mode: s.mode, attempted: s.attempts.filter(a => !a.isLegacyDuplicate).length, correct: s.attempts.filter(a => !a.isLegacyDuplicate && a.isCorrect).length, targetCardCount: s.targetCardCount, status: s.status, ...(s.recap ? { recap: s.recap } : {}) });
/** The client-facing summary of a stored spelling fix (rides on replayed
 * results so a restored attempt renders its post-fix state). */
const spellingFixSummary = (fix: SpellingFix) => ({ answers: fix.answers, results: fix.results, correctedCount: fix.correctedCount, effectiveScore: fix.effectiveScore, xpEarned: fix.xpEarned, ...(fix.xpReward ? { xpReward: fix.xpReward } : {}), ...(fix.masteryLevel ? { masteryLevel: fix.masteryLevel } : {}), ...(fix.skillScore !== undefined ? { skillScore: fix.skillScore } : {}) });
const replay = (a: Attempt) => ({ ...a.result, submittedAnswer: a.result.submittedAnswer ?? a.submittedAnswer, alreadyProcessed: true, ...(a.spellingFix ? { spellingFix: spellingFixSummary(a.spellingFix) } : {}) });

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
  return { sources, guards: [...rows.results, { kind: '@active-learner', id: studentId, revision: 0 }] };
}
async function sessionScope(ctx: RequestContext, session: Session, persistInvalidation = false) {
  try {
    const scope = await activeScope(ctx, session.seasonId, session.studentUserId);
    if(session.training?.missionId){
      const prior=await ctx.store.require<MissionRecord>('daily-mission',session.training.missionId,ctx.orgId),mission=prior.value;
      if(mission.invalidated||mission.revision!==session.training.missionRevision||mission.scopeVersion!==await scopeVersion(scope.sources)){
        if(persistInvalidation&&!mission.invalidated){const invalidated={...mission,invalidated:true};await atomic(ctx,'training.mission.invalidate',[ctx.store.update('daily-mission',mission.id,ctx.orgId,invalidated,prior.revision)],[{kind:'daily-mission',id:mission.id,revision:prior.revision}]);}
        throw new HttpError(409,'The assignment changed. Reload Training HQ and start a new mission.');
      }
    }
    return scope;
  }
  catch (error) {
    if (!session.training?.missionId || !(error instanceof HttpError) || error.status !== 400) throw error;
    const prior = await ctx.store.get<MissionRecord>('daily-mission',session.training.missionId,ctx.orgId);
    if(persistInvalidation&&prior&&!prior.value.invalidated){const mission={...prior.value,invalidated:true};await atomic(ctx,'training.mission.invalidate',[ctx.store.update('daily-mission',mission.id,ctx.orgId,mission,prior.revision)],[{kind:'daily-mission',id:mission.id,revision:prior.revision}]);}
    throw new HttpError(409,'The season or assignment changed. Reload Training HQ.');
  }
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
  const s=stored.value;
  if(s.memoryChallenge!==undefined||s.generatorVersion!==undefined||s.evidenceProfile!==undefined){
    if(s.generatorVersion!=='memory-v3'||!['Warmup','Advanced'].includes(s.memoryChallenge??'')||s.evidenceProfile!==(s.memoryChallenge==='Warmup'?'memory-cued-v3':'memory-honor-v2')||s.memoryChallenge==='Advanced'&&s.difficulty!=='Advanced')fail('The saved Memory purpose is invalid.');
  }
  return stored;
}
function validateCardSnapshot(session: Session, card: Card) {
  const versioned = session.memoryChallenge !== undefined || session.generatorVersion !== undefined || session.evidenceProfile !== undefined;
  const generator = card.payload?.generatorVersion, profile = card.payload?.evidenceProfile;
  if (!versioned) {
    if (generator !== undefined || profile !== undefined) fail('The saved Memory card snapshot is invalid.');
    return;
  }
  if (generator !== 'memory-v3' || profile !== session.evidenceProfile) fail('The saved Memory card snapshot is invalid.');
}
/** Practice sessions draw verses from a persisted shuffled deck (random,
 * PBE-competition-style order) instead of walking the scope in verse order.
 * The remaining queue lives on the session record (deckOrder), so the order
 * survives refresh and is shared by every draw; when a full pass through the
 * scope completes, the next draw starts a fresh shuffle. Mutates
 * session.deckOrder; the caller persists the session. */
function drawPracticeSource(session: Session, eligible: Source[]): Source {
  if (!session.deckOrder) {
    // Sessions started before deck randomization: seed the queue from the
    // sources not yet drawn in this session.
    const drawn = new Set(session.cards.map(c => c.sourceUnitId));
    session.deckOrder = shuffleRandom(eligible.filter(s => !drawn.has(s.id)).map(s => s.id));
  }
  // Drop queue entries that left the scope since the deck was built.
  session.deckOrder = session.deckOrder.filter(id => eligible.some(s => s.id === id));
  if (!session.deckOrder.length) session.deckOrder = shuffleRandom(eligible.map(s => s.id));
  const nextId = session.deckOrder.shift()!;
  return eligible.find(s => s.id === nextId)!;
}
/** A passage CTA start request: exactly one of the student's own assignment
 * (the whole passage range) or a single knowledge unit (one verse). */
type PassageScopeRequest = { assignmentId: string } | { knowledgeUnitId: string };
function normalizePassageScope(raw: unknown): PassageScopeRequest | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Choose a valid passage.');
  const value = raw as { assignmentId?: unknown; knowledgeUnitId?: unknown };
  const hasAssignment = typeof value.assignmentId === 'string' && value.assignmentId.length > 0;
  const hasUnit = typeof value.knowledgeUnitId === 'string' && value.knowledgeUnitId.length > 0;
  if (hasAssignment === hasUnit) fail('Choose a valid passage.');
  return hasAssignment ? { assignmentId: value.assignmentId as string } : { knowledgeUnitId: value.knowledgeUnitId as string };
}
async function start(ctx: RequestContext, input: { seasonId: string; mode?: StudyMode; training?: StartTrainingContext; memoryChallenge?: 'Warmup' | 'Advanced'; passageScope?: unknown }) {
  const seasonId = requiredString(input.seasonId, 'Season'), mode = input.mode ?? 'Practice';
  if (!['Practice', 'Review', 'Simulation'].includes(mode)) fail('Choose Practice, Review, or Simulation.');
  if(input.memoryChallenge!==undefined&&!['Warmup','Advanced'].includes(input.memoryChallenge))fail('Choose Warmup or Advanced.');
  const scopeRequest = normalizePassageScope(input.passageScope);
  if (scopeRequest && mode === 'Simulation') fail('Passage practice is not available for Simulation. Start the passage from Practice or Review.');
  return retry(async () => {
    if (input.training?.clientStartId && typeof input.training.clientStartId === 'string') {
      const row = await ctx.env.DB.prepare("SELECT data FROM Records WHERE kind='session' AND org_id=? AND owner_id=? AND json_extract(data,'$.training.clientStartId')=? LIMIT 1").bind(ctx.orgId,ctx.actor.userId,input.training.clientStartId).first<{data:string}>();
      if(row){const existing=JSON.parse(row.data) as Session;if(existing.memoryChallengeRequest!==input.memoryChallenge||existing.training?.startPayload!==startPayload(seasonId,mode,input.training)||JSON.stringify(existing.passageScopeRequest ?? null)!==JSON.stringify(scopeRequest ?? null))fail('This start ID was already used with a different payload.');return json(sessionDto(existing));}
    }
    const scope = await activeScope(ctx, seasonId, ctx.actor.userId);
    // Passage-scoped starts narrow the card sources to the chosen passage;
    // every other session semantic (missions, XP, reader stamping) is
    // unchanged because the scope only filters which sources may be drawn.
    let cardSources = scope.sources;
    if (scopeRequest) {
      if ('assignmentId' in scopeRequest) {
        const assignments = await listAll<Assignment>(ctx, 'assignment', { seasonId, ownerId: ctx.actor.userId });
        const assignment = assignments.find(a => a.id === scopeRequest.assignmentId) ?? fail('That assignment is not part of your season.');
        cardSources = scope.sources.filter(s => assignment.contentPackId === s.contentPackId && contains(assignment, s));
      } else {
        cardSources = scope.sources.filter(s => knowledgeId(s) === scopeRequest.knowledgeUnitId);
      }
      if (!cardSources.length) fail('That passage is not in your assigned material.');
    }
    const member = await ctx.store.get<Membership>('membership', memberId(seasonId, ctx.actor.userId), ctx.orgId);
    let targetCardCount = mode === 'Simulation' ? 10 : 8;
    if (mode === 'Review' && !input.training?.step) {
      const mastery = await listAll<Mastery>(ctx, 'mastery', { seasonId, ownerId: ctx.actor.userId });
      const due = mastery.filter(m => Date.parse(m.reviewDueAt) <= Date.now() && cardSources.some(s => knowledgeId(s) === m.knowledgeUnitId));
      if (!due.length) fail('There are no passages due for review.');
      targetCardCount = Math.min(8, due.length);
    }
    const session: Session = { id: id(), studentUserId: ctx.actor.userId, seasonId, status: 'Created', mode, difficulty: member?.value.difficulty ?? 'Standard', targetCardCount, ruleProfile: { ...defaultRules }, cards: [], attempts: [], createdAtUtc: trainingNow(), ...(scopeRequest ? { passageScope: { knowledgeUnitIds: [...new Set(cardSources.map(knowledgeId))] }, passageScopeRequest: scopeRequest } : {}) };
    const season=await ctx.store.require<Season>('season',seasonId,ctx.orgId);
    if(input.memoryChallenge!==undefined&&season.value.pbeEnabled!==true)fail('Memory study aids are not enabled for this season.');
    if(input.memoryChallenge==='Advanced'&&session.difficulty!=='Advanced')fail('Your coach must set Advanced difficulty before this challenge.');
    if(season.value.pbeEnabled===true){session.memoryChallenge=input.memoryChallenge??'Warmup';session.memoryChallengeRequest=input.memoryChallenge;session.generatorVersion='memory-v3';session.evidenceProfile=session.memoryChallenge==='Advanced'?'memory-honor-v2':'memory-cued-v3';}
    // Practice draws verses in random order (like the PBE draw), not
    // verse-by-verse: persist a shuffled deck of the scope at start. A
    // passage-scoped start decks only that passage's verses.
    if (mode === 'Practice') session.deckOrder = shuffleRandom(cardSources.map(s => s.id));
    const trainingWrites = await prepareStart(ctx,session,scope.sources,input.training);
    await atomic(ctx, 'study.session.start', [...trainingWrites.statements,ctx.store.insertion('session', session.id, ctx.orgId, session, { seasonId, ownerId: ctx.actor.userId })], [...trainingWrites.guards,...selectedGuards(scope.guards)]);
    return json(sessionDto(session));
  });
}
async function next(ctx: RequestContext, sessionId: string) {
  return retry(async () => {
    const stored = await loadSession(ctx, sessionId), session = stored.value;
    if (['Completed', 'Abandoned'].includes(session.status)) fail('The study session is already complete.');
    const scope = await sessionScope(ctx, session);
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
    let frozen: Set<string> | null = null;
    if(session.training?.missionId) {
      const storedMission=await ctx.store.require<MissionRecord>('daily-mission',session.training.missionId,ctx.orgId),mission=storedMission.value;
      if(mission.invalidated||mission.revision!==session.training.missionRevision||mission.scopeVersion!==await scopeVersion(scope.sources)) {

        throw new HttpError(409,'The assignment changed. Reload Training HQ and start a new mission.');
      }
      if(session.mode==='Review')frozen=new Set(session.training.reviewKnowledgeUnitIds.filter(id=>!mission.acceptedReviewKnowledgeUnitIds.includes(id)));
    }
    // A passage-scoped session draws only from its passage: the eligible set
    // and the WhatComesNext chain stay inside the stored knowledge-unit set.
    // Distractor citations and the TrueFalse word pool below deliberately
    // keep the full scope — they are activity aids, not cards.
    const inPassage = (s: Source) => !session.passageScope || session.passageScope.knowledgeUnitIds.includes(knowledgeId(s));
    const eligible = scope.sources.filter(s => inPassage(s) && (session.mode !== 'Review' || (frozen?frozen.has(knowledgeId(s)):due.has(knowledgeId(s)))));
    if (!eligible.length) fail('There are no passages due for review.');
    // Practice draws from the session's shuffled deck; Review keeps its
    // due-order selection and Simulation its balanced deterministic order.
    const source = session.mode === 'Practice' ? drawPracticeSource(session, eligible) : eligible.sort((a, b) => count(session.cards, a) - count(session.cards, b) || (exposure.get(a.id)?.count ?? 0) - (exposure.get(b.id)?.count ?? 0) || Number(due.has(knowledgeId(b))) - Number(due.has(knowledgeId(a))) || Number(primary(b)) - Number(primary(a)) || last(a) - last(b) || a.ordinal - b.ordinal || knowledgeId(a).localeCompare(knowledgeId(b)))[0];
    const nextSource = scope.sources.find(s => s.contentPackId === source.contentPackId && s.ordinal === source.ordinal + 1 && inPassage(s) && (!frozen || frozen.has(knowledgeId(s))));
    const alternate = closestAlternateSource(scope.sources, source), sequence = session.cards.length + 1;
    const trueFalseWordPool = [...new Set(scope.sources.filter(s => s.id !== source.id && s.bookKey === source.bookKey && s.chapter === source.chapter).flatMap(s => s.canonicalText.split(' ')).map(w => w.trim()).filter(Boolean))];
    const request = { generatorVersion:session.generatorVersion,evidenceProfile:session.evidenceProfile,sourceUnit: sourceUnit(source), knowledgeUnitId: knowledgeId(source), sessionId, sequence, difficulty: normalizeDifficulty(session.difficulty), mode: session.mode, ruleProfile: session.ruleProfile, nextSourceUnit: nextSource ? sourceUnit(nextSource) : null, nextKnowledgeUnitId: nextSource ? knowledgeId(nextSource) : null, alternateSourceUnit: alternate ? sourceUnit(alternate) : null, trueFalseWordPool, distractorCitations: orderDistractorCitations(scope.sources, source), usedActivityTypes: session.cards.map(c => c.activityType), targetCardCount: session.targetCardCount };
    const activity = chooseActivity(eligibleActivities(request), request.usedActivityTypes, sequence);
    if (!activity) return fail('No practice activity is available for these passages right now.');
    const generated = generateActivity(activity, request);
    const card: Card = { ...generated, id: id(), sequence, createdAtUtc: trainingNow(), source: { ...source }, answerSource: { ...(generated.answerSourceUnitId ? nextSource! : source) } };
    session.cards.push(card); session.status = 'Active';
    await atomic(ctx, 'study.card.create', [ctx.store.update('session', sessionId, ctx.orgId, session, stored.revision)], [{ kind: 'session', id: sessionId, revision: stored.revision }, ...selectedGuards(scope.guards, [source.id, card.answerSource.id, ...(alternate ? [alternate.id] : [])])]);
    return json(cardDto(session, card));
  });
}
/** Reshuffle a Practice session's remaining deck. Only the not-yet-drawn
 * queue is reordered: answered cards stay in history, and the card currently
 * on screen was already drawn from the deck, so it is not part of the queue
 * and stays exactly as presented. */
async function shufflePracticeDeck(ctx: RequestContext, sessionId: string) {
  return retry(async () => {
    const stored = await loadSession(ctx, sessionId), session = stored.value;
    if (['Completed', 'Abandoned'].includes(session.status)) fail('The study session is already complete.');
    if (session.mode !== 'Practice') fail('Only Practice sessions can be shuffled.');
    const scope = await sessionScope(ctx, session);
    if (!session.deckOrder) {
      const drawn = new Set(session.cards.map(c => c.sourceUnitId));
      session.deckOrder = scope.sources.filter(s => !drawn.has(s.id)).map(s => s.id);
    }
    session.deckOrder = shuffleRandom(session.deckOrder.filter(id => scope.sources.some(s => s.id === id)));
    await atomic(ctx, 'study.session.shuffle', [ctx.store.update('session', sessionId, ctx.orgId, session, stored.revision)], [{ kind: 'session', id: sessionId, revision: stored.revision }]);
    return json({ sessionId, remaining: session.deckOrder.length });
  });
}
/** Re-deal the blank pattern of the Fill in the Blank card currently on
 * screen: same verse, same card, same blank count (the generator's own
 * difficulty/profile rules), a new hidden-word selection. The stored card
 * payload and answer key are replaced in place, so the eventual submit is
 * graded against the pattern the student actually answered — answers keyed
 * to the old pattern no longer validate. Shuffling blanks is a practice
 * action, not reader assistance: readerAssistedCardIds is never touched
 * here. Bounded per card (BLANK_SHUFFLE_LIMIT) so repeated re-deals cannot
 * cycle the whole verse into view, and unavailable in Simulation, where
 * exam conditions stay fixed. The client clears the typed draft on success
 * (mirroring the read-passage reset), because the draft was written against
 * the old pattern. */
async function reblankCard(ctx: RequestContext, sessionId: string, input: { challengeCardId?: unknown }) {
  const challengeCardId = requiredString(input?.challengeCardId, 'Challenge card');
  return retry(async () => {
    const stored = await loadSession(ctx, sessionId), session = stored.value;
    if (['Completed', 'Abandoned'].includes(session.status)) fail('The study session is already complete.');
    if (session.mode === 'Simulation') fail('Blanks stay fixed in Simulation.');
    const card = session.cards.find(c => c.id === challengeCardId);
    if (!card) return fail('Challenge card does not belong to this session.');
    if (card.activityType !== 'MissingWords') fail('Only Fill in the Blank cards can shuffle their blanks.');
    const current = session.cards.find(c => !session.attempts.some(a => a.cardId === c.id));
    if (!current || current.id !== card.id) fail('This card has already been answered.');
    if ((card.blankShuffles ?? 0) >= BLANK_SHUFFLE_LIMIT) fail('This card has been shuffled the maximum number of times.');
    validateCardSnapshot(session, card);
    const scope = await sessionScope(ctx, session); cardInScope(card, scope.sources);
    const hiddenOf = (tokens: { hidden: boolean; index: number }[]) => tokens.filter(t => t.hidden).map(t => t.index).sort((a, b) => a - b).join(',');
    const before = hiddenOf(card.payload.tokens);
    let replacement: Card | null = null;
    for (let salt = 1; salt <= 8 && !replacement; salt++) {
      const generated = generateActivity('MissingWords', { generatorVersion: session.generatorVersion, evidenceProfile: session.evidenceProfile, sourceUnit: sourceUnit(card.source), knowledgeUnitId: card.knowledgeUnitId, knowledgeUnitKind: 'ExactVerseText', sessionId, sequence: card.sequence + salt * 1009, difficulty: card.payload.difficulty, mode: session.mode, ruleProfile: session.ruleProfile });
      if (hiddenOf(generated.payload.tokens) !== before) replacement = { ...generated, id: card.id, sequence: card.sequence, createdAtUtc: card.createdAtUtc, source: card.source, answerSource: card.answerSource, blankShuffles: (card.blankShuffles ?? 0) + 1 };
    }
    if (!replacement) return fail('Every word that can be blanked is already blanked in this verse.');
    session.cards = session.cards.map(c => c.id === card.id ? replacement! : c);
    await atomic(ctx, 'study.card.reblank', [ctx.store.update('session', sessionId, ctx.orgId, session, stored.revision)], [{ kind: 'session', id: sessionId, revision: stored.revision }, ...selectedGuards(scope.guards, [card.sourceUnitId, card.answerSource.id])]);
    return json(cardDto(session, replacement));
  });
}
const spellingFixResponse = (attempt: Attempt, alreadyProcessed: boolean) => { const fix = attempt.spellingFix!; return { attemptId: attempt.id, cardId: attempt.cardId, ...spellingFixSummary(fix), alreadyProcessed }; };
function validateSpellingFix(input: { challengeCardId?: unknown; clientSubmissionId?: unknown; answers?: unknown }) {
  const challengeCardId = requiredString(input?.challengeCardId, 'Challenge card');
  const clientSubmissionId = requiredString(input?.clientSubmissionId, 'Submission ID', 200);
  const answers = input?.answers;
  if (!Array.isArray(answers) || !answers.length || answers.some(a => !a || !Number.isSafeInteger(a.index) || typeof a.text !== 'string' || Object.keys(a).some(key => key !== 'index' && key !== 'text')) || new Set(answers.map(a => a.index)).size !== answers.length || answers.reduce((size, a) => size + a.text.length, 0) > 100000) fail('Invalid spelling fix answers.');
  return { challengeCardId, clientSubmissionId, answers: answers as MissingWordAnswer[] };
}
/** Spelling second chance (Fill in the Blank, Memory sessions): after
 * grading, the learner may retype ONLY the blanks the grader flagged as
 * spelling slips — the same classifier output that drives the feedback
 * label (MissingWordResult.spelling), read back from the stored attempt
 * payload, so eligibility and feedback can never disagree. One fix per
 * card, priced as partial credit: each corrected blank earns half of its
 * share of the attempt's full XP value (the full value follows the first
 * grading's own assistance pricing — hints rate when the attempt was
 * assisted — and the total is floored once, the PBE partial precedent in
 * pbeAttemptXp). Mastery is re-derived for this attempt alone: the
 * attempt's stored `before` snapshot is re-run through applyMastery with
 * the post-fix effective score (corrected blanks count half), so the fix
 * strengthens the card's evidence as partial recall — never as a clean
 * correct answer, and never as a second stacked attempt. The first
 * attempt's recorded outcome is never rewritten; the fix lives on the
 * attempt as its own record. Simulation cards stay exactly as graded. */
async function spellingFix(ctx: RequestContext, sessionId: string, input: { challengeCardId?: unknown; clientSubmissionId?: unknown; answers?: unknown }) {
  const { challengeCardId, clientSubmissionId, answers } = validateSpellingFix(input ?? {});
  return retry(async () => {
    const stored = await loadSession(ctx, sessionId), session = stored.value;
    if (['Completed', 'Abandoned'].includes(session.status)) fail('The study session is already complete.');
    if (session.mode === 'Simulation') fail('Spelling fixes are not available in Simulation.');
    const card = session.cards.find(c => c.id === challengeCardId);
    if (!card) return fail('Challenge card does not belong to this session.');
    if (card.activityType !== 'MissingWords') fail('Only Fill in the Blank cards can fix spelling.');
    const attempt = session.attempts.find(a => a.cardId === card.id && !a.isLegacyDuplicate);
    if (!attempt) return fail('This card has not been answered yet.');
    if (!attempt.answerPayload) return fail('This card has not been answered yet.');
    if (attempt.spellingFix) {
      const prior = attempt.spellingFix;
      const same = prior.clientSubmissionId === clientSubmissionId && prior.answers.length === answers.length && prior.answers.every(saved => answers.some(answer => answer.index === saved.index && answer.text === saved.text));
      if (same) return json(spellingFixResponse(attempt, true));
      throw new HttpError(409, 'This card’s spelling fix was already used.');
    }
    const eligible = attempt.answerPayload.results.filter(r => !r.isCorrect && r.spelling).map(r => r.index);
    if (!eligible.length) fail('This card has no spelling slips to fix.');
    const eligibleSet = new Set(eligible);
    if (answers.length !== eligible.length || answers.some(a => !eligibleSet.has(a.index))) fail('Fix only the spelling blanks highlighted on this card.');
    validateCardSnapshot(session, card);
    const scope = await sessionScope(ctx, session); cardInScope(card, scope.sources);
    // Grade the merged answer set with the very evaluator that graded the
    // first attempt, so a "corrected" verdict means exactly what a correct
    // first answer would have meant.
    const merged = attempt.answerPayload.answers.map(a => { const fix = answers.find(f => f.index === a.index); return fix ? { index: a.index, text: fix.text } : a; });
    let evaluation: ReturnType<typeof evaluateMissingWordAnswers>;
    try { evaluation = evaluateMissingWordAnswers(card.payload.tokens, merged); } catch { return fail('Invalid spelling fix answers.'); }
    const results = evaluation.results.filter(r => eligibleSet.has(r.index));
    const corrected = results.filter(r => r.isCorrect);
    const totalBlanks = attempt.answerPayload.results.length;
    const correctBefore = attempt.answerPayload.results.filter(r => r.isCorrect).length;
    const effectiveScore = Math.round((correctBefore + corrected.length / 2) / totalBlanks * 100);
    const now = trainingNow();
    const w: Writes = { statements: [], guards: [] };
    const full = attempt.hintsUsed ? XP_VALUES.attemptCorrectHints : XP_VALUES.attemptCorrectNoHints;
    const delta = Math.floor(corrected.length * full / (2 * totalBlanks));
    let xpEarned = 0, reward: XpRewardSnapshot | undefined;
    if (delta > 0) {
      const pref = await preference(ctx), p = resolvePreference(ctx, pref, now), cal = resolveTrainingCalendar(now, p);
      const awarded = await awardXp(ctx, w, { seasonId: session.seasonId, localDate: cal.localDate, atUtc: now, events: [{ kind: 'attempt', amount: delta }] });
      xpEarned = awarded.awarded;
      if (xpEarned > 0) reward = xpReward(awarded.totalBefore, awarded.totalAfter);
      if (session.training) {
        session.training.xpEarned = (session.training.xpEarned ?? 0) + xpEarned;
        if (awarded.leveledUp) session.training.leveledUp = { from: session.training.leveledUp?.from ?? awarded.leveledUp.from, to: awarded.leveledUp.to };
      }
    }
    // Mastery re-derivation, only while this attempt is still the verse's
    // latest evidence and its before snapshot survives; a superseded or
    // legacy attempt keeps its mastery exactly as recorded.
    let masteryStored: Stored<Mastery> | null = null, masteryUpdated: Mastery | null = null;
    if (corrected.length && attempt.before) {
      const priorId = await ctx.env.DB.prepare("SELECT id FROM Records WHERE kind='mastery' AND org_id=? AND season_id=? AND owner_id=? AND json_extract(data,'$.knowledgeUnitId')=? LIMIT 1").bind(ctx.orgId, session.seasonId, session.studentUserId, card.knowledgeUnitId).first<{ id: string }>();
      const masteryId = priorId?.id ?? `${session.seasonId}:${session.studentUserId}:${card.knowledgeUnitId}`;
      masteryStored = await ctx.store.get<Mastery>('mastery', masteryId, ctx.orgId);
      if (masteryStored && masteryStored.value.lastAttemptId === attempt.id) {
        // attempt.before is the pre-attempt MasteryScores snapshot (level
        // included at runtime; the Attempt type keeps the SkillScores view).
        const beforeScores: MasteryScores = { recognition: attempt.before.recognition, exactWording: attempt.before.exactWording, reference: attempt.before.reference, sequence: attempt.before.sequence, factualRecall: attempt.before.factualRecall, level: (attempt.before as MasteryScores).level ?? 'Unseen' };
        const scores = applyMastery(beforeScores, { isCorrect: false, score: effectiveScore }, attempt.hintsUsed, card.activityType, card.answerMode, card.payload.difficulty, card.payload.evidenceProfile);
        masteryUpdated = { ...masteryStored.value, ...scores, reviewDueAt: nextReview(now, effectiveScore, masteryStored.value.streak ?? 0), lastSeenAt: now };
      } else masteryStored = null;
    }
    const skill = scoredSkill(card.activityType, card.answerMode);
    attempt.spellingFix = { clientSubmissionId, answers: [...answers].sort((a, b) => a.index - b.index), results, correctedCount: corrected.length, effectiveScore, xpEarned, ...(reward ? { xpReward: reward } : {}), ...(masteryUpdated ? { masteryLevel: masteryUpdated.level, skillScore: masteryUpdated[skill.key] } : {}), at: now };
    // The attempt also lives as its own record (the row reports read);
    // it gets the same object, so both copies carry the fix and neither
    // rewrites the first grading.
    const attemptRow = await ctx.store.get<Attempt>('attempt', attempt.id, ctx.orgId);
    const statements = [...w.statements, ctx.store.update('session', sessionId, ctx.orgId, session, stored.revision)];
    const guards: Guard[] = [...w.guards, { kind: 'session', id: sessionId, revision: stored.revision }];
    if (attemptRow) { statements.push(ctx.store.update('attempt', attempt.id, ctx.orgId, attempt, attemptRow.revision)); guards.push({ kind: 'attempt', id: attempt.id, revision: attemptRow.revision }); }
    if (masteryUpdated && masteryStored) { statements.push(ctx.store.update('mastery', masteryUpdated.id, ctx.orgId, masteryUpdated, masteryStored.revision)); guards.push({ kind: 'mastery', id: masteryUpdated.id, revision: masteryStored.revision }); }
    await atomic(ctx, 'study.spelling-fix', statements, guards);
    return json(spellingFixResponse(attempt, false));
  });
}
async function submit(ctx: RequestContext, sessionId: string, input: Submission) {
  validateSubmission(input);
  return retry(async () => {
    const stored = await loadSession(ctx, sessionId), session = stored.value;
    // Migrated duplicate attempts intentionally stay outside accepted session history.
    // Submission identity must still replay their own original evidence before card fallback.
    const persisted = typeof input.clientSubmissionId === 'string' ? await ctx.env.DB.prepare("SELECT data FROM Records WHERE kind='attempt' AND org_id=? AND season_id=? AND owner_id=? AND json_extract(data,'$.sessionId')=? AND json_extract(data,'$.clientSubmissionId')=? LIMIT 1").bind(ctx.orgId, session.seasonId, session.studentUserId, sessionId, input.clientSubmissionId).first<{ data: string }>() : null;
    const existing = persisted ? JSON.parse(persisted.data) as Attempt : session.attempts.find(a => a.clientSubmissionId === input.clientSubmissionId);
    if (existing) {
      if (existing.cardId !== input.challengeCardId || !sameAnswer(existing,input) || existing.responseTimeMs !== input.responseTimeMs || (existing.clientHintsUsed ?? existing.hintsUsed) !== input.hintsUsed) {
        if (existing.answerPayload || input.missingWordAnswers) throw new HttpError(409,'This submission ID was already used with a different answer payload.');
        fail('This submission ID was already used with a different answer payload.');
      }
      return json(replay(existing));
    }
    if (typeof input.submittedAnswer === 'string' && input.submittedAnswer.length > 100000) fail('An answer up to 100000 characters is required.');
    const card = session.cards.find(c => c.id === input.challengeCardId);
    if (!card) return fail('Challenge card does not belong to this session.');
    const answerPayload = input.missingWordAnswers ? structuredAnswer(card,input.missingWordAnswers) : undefined;
    const submittedAnswer = answerPayload ? answerPayload.answers.map(answer=>answer.text).join(' ') : input.submittedAnswer!;
    const answered = session.attempts.find(a => a.cardId === input.challengeCardId);
    if (answered) return json(replay(answered));
    if (['Completed', 'Abandoned'].includes(session.status)) fail('The study session is already complete.');
    requiredString(input.clientSubmissionId, 'Submission ID', 200);
    if (session.mode === 'Simulation' && input.hintsUsed) fail('Hints are not permitted in simulation.');
    // Assistance truth is server-stamped, not client-claimed: if the
    // assigned-scripture endpoint was read while this card was the active
    // unanswered card, the attempt counts as assisted (mirrors the PBE
    // source aid's assistedAtMs) even when the client reports no hints.
    const hintsUsed = input.hintsUsed || (session.readerAssistedCardIds?.includes(card.id) ?? false);
    validateCardSnapshot(session, card);
    const scope = await sessionScope(ctx, session, true); cardInScope(card, scope.sources);
    const evaluation = answerPayload ? { isCorrect: answerPayload.results.every(result => result.isCorrect), score: answerPayload.score, evaluationCode: answerPayload.evaluationCode } : evaluateAnswer(submittedAnswer, card.answerKey.canonicalAnswer, card.activityType, card.answerMode), now = trainingNow();
    const priorId = await ctx.env.DB.prepare("SELECT id FROM Records WHERE kind='mastery' AND org_id=? AND season_id=? AND owner_id=? AND json_extract(data,'$.knowledgeUnitId')=? LIMIT 1").bind(ctx.orgId, session.seasonId, session.studentUserId, card.knowledgeUnitId).first<{ id: string }>();
    const masteryId = priorId?.id ?? `${session.seasonId}:${session.studentUserId}:${card.knowledgeUnitId}`;
    const previous = await ctx.store.get<Mastery>('mastery', masteryId, ctx.orgId);
    // Priors on either scored version (v2 or v3) carry forward at face value —
    // every consumer counts those records as-is, so rebuilding them by replay
    // would make a verse's mastery jump on its next attempt. The replay below
    // is only for genuinely legacy (pre-skill-evidence) records.
    let priorScores = isScoredMasteryVersion(previous?.value.algorithmVersion) ? previous!.value : zero;
    let priorStreak = isScoredMasteryVersion(previous?.value.algorithmVersion) ? previous!.value.streak ?? 0 : 0;
    if (previous && !isScoredMasteryVersion(previous.value.algorithmVersion)) {
      const rows = await ctx.env.DB.prepare(`SELECT a.data,
        (SELECT c.value FROM json_each(s.data,'$.cards') c WHERE json_extract(c.value,'$.id')=json_extract(a.data,'$.cardId') LIMIT 1) AS card
        FROM Records a LEFT JOIN Records s ON s.kind='session' AND s.id=json_extract(a.data,'$.sessionId') AND s.org_id=a.org_id AND s.season_id=a.season_id AND s.owner_id=a.owner_id
        WHERE a.kind='attempt' AND a.org_id=? AND a.season_id=? AND a.owner_id=? AND json_extract(a.data,'$.knowledgeUnitId')=? AND coalesce(json_extract(a.data,'$.isLegacyDuplicate'),0)=0
        ORDER BY json_extract(a.data,'$.at'),a.id`).bind(ctx.orgId, session.seasonId, session.studentUserId, card.knowledgeUnitId).all<{ data: string; card: string | null }>();
      for (const row of rows.results) {
        const evidence = JSON.parse(row.data) as Attempt;
        const historicalCard = row.card ? JSON.parse(row.card) as Card : undefined;
        if (evidence.activityType === 'WhatComesNext' && !historicalCard?.answerSourceUnitId) continue;
        const credit = { isCorrect: evidence.isCorrect, score: evidence.score ?? (evidence.isCorrect ? 100 : 0) };
        priorScores = applyMastery(priorScores, credit, evidence.hintsUsed, evidence.activityType, historicalCard?.answerMode ?? 'SelectedChoice', historicalCard?.payload.difficulty ?? 1, historicalCard?.payload.evidenceProfile);
        priorStreak = evidence.isCorrect ? priorStreak + 1 : 0;
      }
    }
    const scores = applyMastery(priorScores, { isCorrect: evaluation.isCorrect, score: evaluation.score }, hintsUsed, card.activityType, card.answerMode, card.payload.difficulty, card.payload.evidenceProfile);
    const streak = evaluation.isCorrect ? priorStreak + 1 : 0;
    const mastery: Mastery = { ...scores, id: masteryId, studentUserId: session.studentUserId, seasonId: session.seasonId, sourceUnitId: card.answerSource.id, knowledgeUnitId: card.knowledgeUnitId, algorithmVersion: MASTERY_VERSION, reviewDueAt: nextReview(now, evaluation.score, streak), lastSeenAt: now, streak };
    const attemptId = id(); mastery.lastAttemptId = attemptId;
    const skill = scoredSkill(card.activityType, card.answerMode);
    const result: Result = { ...(answerPayload?{missingWordAnswers:answerPayload.answers,missingWordResults:answerPayload.results}:{}), submittedAnswer, attemptId, isCorrect: evaluation.isCorrect, score: evaluation.score, evaluationResult: evaluation.evaluationCode, canonicalAnswer: card.answerKey.canonicalAnswer, citation: card.answerSource.citation, sourceText: card.answerSource.canonicalText, masteryLevel: mastery.level, exactWordingScore: mastery.exactWording, skillKey: skill.key, skillLabel: skill.label, skillScore: scores[skill.key], reviewDueAtUtc: mastery.reviewDueAt, alreadyProcessed: false };
    // Spelling second chance eligibility is stamped here, from the same
    // per-blank classifier that labels the feedback (MissingWordResult.
    // spelling) — the two can never disagree. Simulation cards stay fixed.
    if (answerPayload && session.mode !== 'Simulation') {
      const eligible = answerPayload.results.filter(r => !r.isCorrect && r.spelling).map(r => r.index);
      if (eligible.length) result.spellingEligible = eligible;
    }
    const attempt: Attempt = { ...(answerPayload?{answerPayload}:{}), id: attemptId, sessionId, cardId: card.id, studentUserId: session.studentUserId, seasonId: session.seasonId, sourceUnitId: card.answerSource.id, knowledgeUnitId: card.knowledgeUnitId, clientSubmissionId: input.clientSubmissionId, submittedAnswer, responseTimeMs: input.responseTimeMs, clientHintsUsed: input.hintsUsed, hintsUsed, isCorrect: evaluation.isCorrect, score: evaluation.score, evaluationResult: evaluation.evaluationCode, activityType: card.activityType, at: now, result, previousAttemptId: previous?.value.lastAttemptId, before: { ...priorScores }, after: { ...scores } };
    session.attempts.push(attempt); session.status = 'Active';
    const recordScope = { seasonId: session.seasonId, ownerId: session.studentUserId };
    const xpBefore = session.training?.xpEarned ?? 0;
    const trainingWrites = await applyAcceptedAttempt(ctx,session,attempt,scope.sources,mastery,previous?.value.reviewDueAt);
    // Per-attempt game feedback: the XP this attempt actually earned is the
    // cap-aware session total's delta across the accepted-attempt write
    // (attempt XP plus any quest/milestone bonus this attempt triggered),
    // and the session streak counts trailing correct attempts including
    // this one. Both ride on the stored result, so replays keep them.
    result.xpEarned = (session.training?.xpEarned ?? 0) - xpBefore;
    let sessionStreak = 0; for (let i = session.attempts.length - 1; i >= 0 && session.attempts[i].isCorrect; i--) sessionStreak++;
    result.sessionStreak = sessionStreak;
    await atomic(ctx, 'study.attempt', [...trainingWrites.statements,ctx.store.update('session', sessionId, ctx.orgId, session, stored.revision), previous ? ctx.store.update('mastery', masteryId, ctx.orgId, mastery, previous.revision) : ctx.store.insertion('mastery', masteryId, ctx.orgId, mastery, recordScope), ctx.store.insertion('attempt', attemptId, ctx.orgId, attempt, recordScope)], [...trainingWrites.guards,{ kind: 'session', id: sessionId, revision: stored.revision }, ...(previous ? [{ kind: 'mastery', id: masteryId, revision: previous.revision }] : []), ...selectedGuards(scope.guards, [card.sourceUnitId, card.answerSource.id])]);
    return json(result);
  });
}
async function progress(ctx: RequestContext, studentId: string, requested: string | null) {
  const user = ctx.actor.userId === studentId && ctx.actor.kind === 'Adult' ? { displayName: ctx.actor.displayName } : await student(ctx, studentId);
  const assignments = await listAll<Assignment>(ctx, 'assignment', { ownerId: studentId });
  const seasons = await listAll<Season & { activatedAtUtc?: string }>(ctx, 'season');
  const intros=await listAll<Assignment>(ctx,'pbe-introduction-assignment',{ownerId:studentId});
  const assignedSeasons = seasons.filter(s => assignments.some(a => a.seasonId === s.id)||s.pbeEnabled&&intros.some(a=>a.seasonId===s.id));
  const byRecent = (a: Season & { activatedAtUtc?: string }, b: Season & { activatedAtUtc?: string }) => (b.activatedAtUtc ?? b.createdAtUtc ?? '').localeCompare(a.activatedAtUtc ?? a.createdAtUtc ?? '');
  const season = assignedSeasons.filter(s => requested ? s.id === requested : s.status === 'Active').sort(byRecent)[0]
    // Fallback (no explicit season requested): surface the student's
    // assigned-but-not-started season with its real status instead of
    // reporting "no season", so the Study page can explain that training
    // opens when the season is Active. Start gates still require Active.
    ?? (requested ? undefined : assignedSeasons.sort(byRecent)[0]);
  const empty = { seasonId: '00000000-0000-0000-0000-000000000000', seasonName: '', seasonStatus: 'None', assignments: [], masteredCount: 0, reviewDueCount: 0, attemptCount: 0, mastery: [], studentUserId: studentId, studentDisplayName: user.displayName, recentAttempts: [] };
  if (!season) return json(empty);
  const sources = await effectiveSources(ctx, season.id, studentId), byKnowledge = new Map(sources.map(s => [knowledgeId(s), s]));
  const states = (await listAll<Mastery>(ctx, 'mastery', { seasonId: season.id, ownerId: studentId })).filter(m => byKnowledge.has(m.knowledgeUnitId));
  // Read only the 20 most recent attempts in SQL instead of downloading the
  // student's entire attempt history to show 20 rows. Attempts grow unboundedly.
  const notDuplicate = `coalesce(json_extract(data,'$.isLegacyDuplicate'),0)=0`;
  const attemptCount = (await ctx.env.DB.prepare(`SELECT count(*) AS n FROM Records INDEXED BY Records_training_scope WHERE kind='attempt' AND org_id=? AND season_id=? AND owner_id=? AND ${notDuplicate}`).bind(ctx.orgId, season.id, studentId).first<{ n: number }>())?.n ?? 0;
  const recentAttempts = (await ctx.env.DB.prepare(`SELECT data FROM Records INDEXED BY Records_training_scope WHERE kind='attempt' AND org_id=? AND season_id=? AND owner_id=? AND ${notDuplicate} ORDER BY json_extract(data,'$.at') DESC, id ASC LIMIT 20`).bind(ctx.orgId, season.id, studentId).all<{ data: string }>()).results.map(r => JSON.parse(r.data) as Attempt);
  const member = await ctx.store.get<Membership>('membership', memberId(season.id, studentId), ctx.orgId);
  return json({ ...empty, pbeEnabled:season.pbeEnabled===true, seasonId: season.id, seasonName: season.name, seasonStatus: season.status, assignments: assignments.filter(a => a.seasonId === season.id).map(a => ({ ...a, difficulty: member?.value.difficulty ?? 'Standard' })), masteredCount: states.filter(m => m.level === 'Mastered' && isScoredMasteryVersion(m.algorithmVersion)).length, reviewDueCount: Math.min(8, new Set(states.filter(m => Date.parse(m.reviewDueAt) <= Date.now()).map(m => m.knowledgeUnitId)).size), attemptCount, mastery: states.map(m => ({ knowledgeUnitId: m.knowledgeUnitId, title: byKnowledge.get(m.knowledgeUnitId)?.citation ?? 'Passage', level: m.level, exactWordingScore: m.exactWording, recognitionScore: m.recognition, referenceScore: m.reference, sequenceScore: m.sequence, factualRecallScore: m.factualRecall, bookKey: byKnowledge.get(m.knowledgeUnitId)?.bookKey, chapter: byKnowledge.get(m.knowledgeUnitId)?.chapter, verse: byKnowledge.get(m.knowledgeUnitId)?.verse, algorithmVersion: m.algorithmVersion, reviewDueAtUtc: m.reviewDueAt })), recentAttempts: recentAttempts.map(a => ({ id: a.id, title: a.result?.citation ?? byKnowledge.get(a.knowledgeUnitId)?.citation ?? 'Passage', activityType: a.activityType, isCorrect: a.isCorrect, submittedAnswer: a.submittedAnswer, evaluationResult: a.evaluationResult, createdAtUtc: a.at })) });
}
export async function handleStudy(ctx: RequestContext): Promise<Response | null> {
  const { path, request } = ctx, method = request.method;
  if (ctx.orgId !== ctx.actor.organizationId) throw new HttpError(403, 'Organization access denied.');
  const coachProgress = path.match(/^\/seasons\/([^/]+)\/students\/([^/]+)\/progress$/);
  if (coachProgress && method === 'GET') { admin(ctx.actor); await student(ctx,coachProgress[2]); return progress(ctx, coachProgress[2], coachProgress[1]); }
  if (!/^\/api\/v1\/(study|progress)(\/|$)/.test(path)) return null;
  if (path === '/api/v1/progress/me' && method === 'GET') {
    if (ctx.actor.kind !== 'Student') admin(ctx.actor);
    return progress(ctx, ctx.actor.userId, new URL(request.url).searchParams.get('seasonId'));
  }
  await requireLearner(ctx);
  if (path === '/api/v1/progress/me/seasons' && method === 'GET') {
    const assignments = await listAll<Assignment>(ctx, 'assignment', { ownerId: ctx.actor.userId });
    const seasons = await listAll<Season>(ctx, 'season');
    const intros=await listAll<Assignment>(ctx,'pbe-introduction-assignment',{ownerId:ctx.actor.userId});
    const discovered:{id:string;name:string}[]=[];
    for(const s of seasons.filter(s=>s.status==='Active')){
      if(assignments.some(a=>a.seasonId===s.id))discovered.push({id:s.id,name:s.name});
      else if(s.pbeEnabled&&intros.some(a=>a.seasonId===s.id)){const scope=await resolvePbeSources(ctx,{organizationId:ctx.orgId,seasonId:s.id,studentId:ctx.actor.userId});if(scope.sources.length&&scope.guards.some(g=>g.kind==='membership'))discovered.push({id:s.id,name:s.name});}
    }
    return json(discovered);
  }
  if (path === '/api/v1/study/sessions' && method === 'POST') { const input = await body<{seasonId:string;format?:string;mode?:StudyMode;progressScope?:unknown;passageScope?:unknown}>(request); if(!input||typeof input!=='object'||Array.isArray(input))throw new HttpError(400,'Provide a study request.'); if(input.mode!==undefined&&!['Practice','Review','Simulation'].includes(input.mode))throw new HttpError(400,'Choose a valid study mode.'); if(input.format === 'Pbe') return startPbeSession(ctx,input as Parameters<typeof startPbeSession>[1]); if(input.progressScope!==undefined)throw new HttpError(400,'Progress scope requires Pbe.'); if(input.format!==undefined&&input.format!=='Memory')throw new HttpError(400,'Choose Memory or Pbe.'); return start(ctx,input); }
  const match = path.match(/^\/api\/v1\/study\/sessions\/([^/]+)(?:\/(next|attempts|complete|source|shuffle|reblank|spelling-fix))?$/);
  if (!match) return null;
  const sessionId = match[1], action = match[2];
  if((!action||action==='next')&&method==='GET'||['attempts','complete','source'].includes(action)&&method==='POST'){const response=await pbeSessionAction(ctx,sessionId,action,method==='POST'&&action!=='complete'?await body(request.clone() as Request):undefined);if(response)return response;}
  if (action === 'next' && method === 'GET') return next(ctx, sessionId);
  if (action === 'shuffle' && method === 'POST') return shufflePracticeDeck(ctx, sessionId);
  if (action === 'reblank' && method === 'POST') return reblankCard(ctx, sessionId, await body<{ challengeCardId?: unknown }>(request));
  if (action === 'spelling-fix' && method === 'POST') return spellingFix(ctx, sessionId, await body(request));
  if (action === 'attempts' && method === 'POST') return submit(ctx, sessionId, await body(request));
  if (action === 'complete' && method === 'POST') return retry(async () => {
    const stored = await loadSession(ctx, sessionId), session = stored.value;
    if (!session.attempts.length) fail('A session cannot be completed without a persisted attempt.');
    if (session.status !== 'Completed') { session.status = 'Completed'; session.completedAtUtc ??= trainingNow();
      // Daily bonus quests: sharpshooter / marathon land at completion.
      const qw: Writes = { statements: [], guards: [] };
      const pref = await preference(ctx), pcal = resolveTrainingCalendar(session.completedAtUtc, resolvePreference(ctx, pref, session.completedAtUtc));
      session.training ??= { missionId: null, missionRevision: null, missionLocalDate: null, timeZone: pcal.timeZone, reviewKnowledgeUnitIds: [], creditedLocalDate: null, newlyCreditedDay: false, earnedBadges: [] };
      const qLocalDate = session.training.creditedLocalDate ?? pcal.localDate;
      const qAttempts = session.attempts.filter(a => !a.isLegacyDuplicate), qCorrect = qAttempts.filter(a => a.isCorrect).length;
      const questRes = await sessionCompleteQuests(ctx, qw, { localDate: qLocalDate, timeZone: pcal.timeZone, seasonId: session.seasonId, atUtc: session.completedAtUtc }, { mode: session.mode, accuracy: qAttempts.length ? qCorrect / qAttempts.length * 100 : 0, fullTargetReached: fullTargetReached(session.targetCardCount, session.attempts) });
      const questXp = questRes.xpEvents;
      // Finish-line quests merge with any completed mid-session (recorded on
      // the training record as attempts landed) so the recap lists them all.
      const mergedQuests = new Map((session.training.questsCompleted ?? []).map(q => [q.key, q] as const));
      for (const key of questRes.completedNow)
        if (!mergedQuests.has(key))
          mergedQuests.set(key, { key, title: QUEST_DEFS[key].title });
      session.training.questsCompleted = [...mergedQuests.values()];
      let completionXpTotal: number | undefined;
      if (questXp.length) {
        const awarded = await awardXp(ctx, qw, { seasonId: session.seasonId, localDate: qLocalDate, atUtc: session.completedAtUtc, events: questXp });
        session.training.xpEarned = (session.training.xpEarned ?? 0) + awarded.awarded;
        completionXpTotal = awarded.totalAfter;
        if (awarded.leveledUp) session.training.leveledUp = { from: session.training.leveledUp?.from ?? awarded.leveledUp.from, to: awarded.leveledUp.to };
      }
      session.recap ??= await makeRecap(ctx,session,completionXpTotal); const bests = await recordPersonalBests(ctx, session); if (bests.beaten.accuracyBeaten || bests.beaten.correctBeaten) session.recap.personalBest = bests.beaten; await atomic(ctx, 'study.session.complete', [ctx.store.update('session', sessionId, ctx.orgId, session, stored.revision), ...bests.writes.statements, ...qw.statements, dailyActivityIncrement(ctx.env.DB, qLocalDate, ctx.orgId)], [{ kind: 'session', id: sessionId, revision: stored.revision }, ...bests.writes.guards, ...qw.guards]); }
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
