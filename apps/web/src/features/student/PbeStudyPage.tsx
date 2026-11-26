import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api, ApiError } from '../../api/client';
import type { Progress, Session, BoardAvatar } from '../../api/types';
import { useProfileIdentity } from '../profile/profile';
import { usePhoneLayout } from '../../hooks/useMediaQuery';
import { XpRewardOverlay, useXpReward } from '../../components/game/XpReward';
import type { PbeAttemptResult, PbeBreakState, PbePresentationState, PbeResumedSession, PbeSessionCard, PbeSubmission, PbeTimedReceipt } from '../../api/pbeTypes';
import { isTimedPbeMode, type PbeMode } from '../../api/pbeTypes';
import { Badge, Button, LinkButton, LoadingState, Notice, PageHeader, Panel } from '../../components/ui';
import { AppIcon } from '../../components/AppIcon';
import { academyModeRules, studySessionFraming } from './academyTracks';
import { diffWords, type DiffToken } from './wordDiff';
import { PbeAnswerInput } from './PbeAnswerInput';
import { PbePresentation } from '../study/PbePresentation';
import './student.css';
import './pbe-review.css';
function pending(sessionId: string, cardId: string): PbeSubmission | null {
    try {
        const value = JSON.parse(sessionStorage.getItem(`erudoza:pbe-attempt:${sessionId}`) ?? 'null') as PbeSubmission | null;
        return value?.challengeCardId === cardId && typeof value.clientSubmissionId === 'string' && Array.isArray(value.answers) && value.answers.every(a => typeof a === 'string') ? value : null;
    }
    catch {
        return null;
    }
}
/** Moved from StudyPage.tsx: shared by the review-return banner on both study pages. */
function relativeDays(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days)) return '';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
/** The most recent attempt whose passage title matches a due review item. */
function latestMatchingAttempt(progress: Progress | undefined, citation: string) {
  const normalized = citation.trim().toLowerCase();
  if (!normalized) return null;
  const attempts = progress?.recentAttempts ?? [];
  const exact = attempts.filter((attempt) => attempt.title.trim().toLowerCase() === normalized);
  const loose = exact.length === 0
    ? attempts.filter((attempt) => {
      const title = attempt.title.trim().toLowerCase();
      return title.includes(normalized) || normalized.includes(title);
    })
    : [];
  return [...exact, ...loose].sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc))[0] ?? null;
}
/** Plain-language reason a passage returned to the due queue. */
export function reviewReturnDetail(progress: Progress | undefined, citation: string): string | null {
  const normalized = citation.trim().toLowerCase();
  if (!normalized) return null;
  const mastery = progress?.mastery?.find((entry) => entry.title.trim().toLowerCase() === normalized);
  const last = latestMatchingAttempt(progress, citation);
  const parts: string[] = [];
  const practiced = last ? relativeDays(last.createdAtUtc) : '';
  if (practiced) parts.push(`last practiced ${practiced}`);
  if (mastery) parts.push(`last score ${mastery.exactWordingScore}%`);
  else if (last) parts.push(last.isCorrect ? 'last attempt correct' : 'last attempt needs another pass');
  return parts.length > 0 ? parts.join(' · ') : null;
}
/** Same highlighted-token rendering the Memory track's answer diff uses. */
function DiffTokens({ tokens }: { tokens: DiffToken[] }) {
    return <>{tokens.map((token, index) => <span key={index}>{index > 0 ? ' ' : ''}<span className={`diff-token diff-${token.status}`}>{token.text}</span></span>)}</>;
}
/**
 * One expected part in PBE feedback, shown against what the student typed
 * (B2): the shared word diff keeps the correct wording fully readable while
 * missed/extra/spelling differences are highlighted in place, with the same
 * summary language as Memory feedback. PBE answers are typed, so spelling
 * near-misses keep the spelling treatment (diffWords' default). A part with
 * no submitted answer renders the expected text plainly with a "No answer"
 * state instead of an all-missed diff, which would read as an attempt.
 */
function PbePartFeedback({ expected, submitted, points, index }: { expected: string; submitted: string; points?: number; index: number }) {
    const weight = points !== undefined ? <p className="text-sm">Part {index + 1} · {points} {points === 1 ? 'point' : 'points'}</p> : null;
    if (!submitted.trim())
        return <li data-testid={`pbe-part-feedback-${index}`}>{weight}<p>{expected}</p><p className="mt-1 text-sm">No answer — this part earned no points.</p></li>;
    const diff = diffWords(expected, submitted);
    if (diff.missed === 0 && diff.extra === 0 && diff.spelling === 0)
        return <li data-testid={`pbe-part-feedback-${index}`}>{weight}<p>{expected}</p></li>;
    return <li data-testid={`pbe-part-feedback-${index}`}>{weight}
        <p><DiffTokens tokens={diff.expected} /></p>
        <p className="mt-1 text-sm"><span className="font-semibold">Your answer: </span><DiffTokens tokens={diff.submitted} /></p>
        <p className="mt-1 text-sm">{[
            diff.missed ? `${diff.missed} missed ${diff.missed === 1 ? 'word is' : 'words are'} underlined in the expected answer.` : '',
            diff.extra ? `${diff.extra} extra ${diff.extra === 1 ? 'word is' : 'words are'} struck through in your answer.` : '',
            ...diff.spellingPairs.map(pair => `Spelling: you wrote “${pair.submitted}” for “${pair.expected}” — a spelling slip, not a wrong word; in PBE a misspelling can still earn credit.`),
        ].filter(Boolean).join(' ')}</p>
    </li>;
}
/**
 * Card 50: every PBE card names its kind and what that kind expects before
 * the learner answers — presentation only; grading and scoring are the
 * server's and do not change. List framing covers order in words because
 * the question view does not carry the rubric's ordered flag.
 */
export const PBE_KIND_FRAMING: Record<PbeSessionCard['question']['kind'], { label: string; framing: string }> = {
    ShortAnswer: { label: 'Short answer', framing: 'Answer with the key facts — your own words are fine.' },
    List: { label: 'List', framing: 'Give every part. When the parts come in an order, keep that order.' },
    ExactWords: { label: 'Exact words', framing: 'Give the verse’s exact wording.' },
    TrueFalse: { label: 'True or false', framing: 'Decide whether the statement is true or false.' },
};
/**
 * Card 52: the who/what/where/when framing — a mechanical reading aid
 * derived from the authored prompt's opening word, shown beside the
 * kind framing. "Name…", "List…" and "Give…" prompts ask for a thing,
 * so they read as "Asks what". No match, no chip: the framing never
 * guesses at a prompt it cannot parse.
 */
export function pbeAskType(prompt: string): string | null {
    const first = prompt.trim().split(/\s+/)[0]?.replace(/[^A-Za-z]/g, '').toLowerCase() ?? '';
    if (first === 'who' || first === 'whom' || first === 'whose') return 'Asks who';
    if (first === 'where') return 'Asks where';
    if (first === 'when') return 'Asks when';
    if (first === 'what' || first === 'name' || first === 'list' || first === 'give') return 'Asks what';
    return null;
}
/**
 * Card 52: post-answer study templates over the existing kinds —
 * unscored cover-and-recall self-checks built only from this card's
 * own graded result. They never change points, XP, or the stored
 * attempt; server grading stays authoritative and untouched.
 * "Turn it around" is the answer→reference template; "What comes
 * next" is the continuation/sequence template (List: finish the
 * list; Exact words: continue the wording). Introduction/context
 * recall is not templated here: solo cards carry no introduction
 * marker, and book introductions already have their own licensed
 * surface in chapter progress.
 */
function PbeStudyTemplates({ kind, result }: { kind: PbeSessionCard['question']['kind']; result: PbeAttemptResult }) {
    const [referenceShown, setReferenceShown] = useState(false), [nextShown, setNextShown] = useState(false);
    const words = kind === 'ExactWords' ? (result.expectedParts[0] ?? '').split(/\s+/).filter(Boolean) : [];
    const continuation = kind === 'List' && result.expectedParts.length >= 2
        ? { lead: result.expectedParts.slice(0, -1).join(', '), hidden: result.expectedParts[result.expectedParts.length - 1], prompt: 'Finish the list — say the part that is still missing, then uncover it.' }
        : kind === 'ExactWords' && words.length >= 4
            ? { lead: words.slice(0, Math.ceil(words.length / 2)).join(' '), hidden: words.slice(Math.ceil(words.length / 2)).join(' '), prompt: 'Continue the verse — say the rest of the wording, then uncover it.' }
            : null;
    return <div className="mt-4" data-testid="pbe-study-templates">
        <h3>Study this card</h3>
        <p className="text-sm">Two quick self-checks from this card's own answers. They are practice only — they never change your points.</p>
        <div className="mt-3">
            <p><strong>Turn it around.</strong> The answer was “{result.expectedParts.join(', ')}”. Which passage is it from? Say the reference out loud, then uncover it.</p>
            {referenceShown ? <p className="mt-2" data-testid="pbe-template-reference">{result.citation}</p> : <Button className="mt-2" variant="secondary" onClick={() => setReferenceShown(true)}>Uncover the reference</Button>}
        </div>
        {continuation && <div className="mt-3">
            <p><strong>What comes next.</strong> {continuation.prompt}</p>
            <p className="mt-2 er-scripture">{continuation.lead} …</p>
            {nextShown ? <p className="mt-2" data-testid="pbe-template-next">{continuation.hidden}</p> : <Button className="mt-2" variant="secondary" onClick={() => setNextShown(true)}>Uncover what comes next</Button>}
        </div>}
    </div>;
}
type DueKind = 'Scheduled' | 'Refresh' | 'Retry';
const DUE_KIND_COPY: Record<DueKind, { lead: string; fallback: string; tone: 'info' | 'warning' }> = {
  Scheduled: { lead: 'Review window reached', fallback: 'ready for a scheduled check-in', tone: 'info' },
  Refresh: { lead: 'Recall needs attention', fallback: 'the latest practice result slipped', tone: 'warning' },
  Retry: { lead: 'Recent miss', fallback: 'one question is ready for another try', tone: 'warning' },
};
/** Why a due mastery entry is in the review queue. */
function dueItemKind(progress: Progress | undefined, entry: Progress['mastery'][number]): DueKind {
  const last = latestMatchingAttempt(progress, entry.title);
  if (last && !last.isCorrect) return 'Retry';
  if (entry.level === 'Learning' || entry.level === 'Review') return 'Refresh';
  return 'Scheduled';
}
export function PbeStudyPage({ saved, seasonId, unavailable }: {
    saved?: PbeResumedSession;
    seasonId: string;
    /** Accepted for call-site compatibility; season details are not shown on
     * activity screens (the header carries the mode framing only). */
    seasonName: string;
    unavailable?: string;
}) {
    const [params, setParams] = useSearchParams(), navigate = useNavigate(), queries = useQueryClient();
    const { me } = useAuth();
    const phone = usePhoneLayout();
    const mode = saved?.session.mode ?? params.get('mode') ?? 'Practice';
    const timed = isTimedPbeMode(mode);
    const isReviewMode = mode === 'Review';
    const progressScopeKey = params.get('progressScopeKey'), progressScopeVersion = params.get('progressScopeVersion');
    const progressScopeIncomplete = !saved && (!!progressScopeKey !== !!progressScopeVersion);
    const selection = !saved && progressScopeKey && progressScopeVersion ? { progressScope: { key: progressScopeKey, scopeVersion: progressScopeVersion } } : undefined;
    const needsReviewEntry = isReviewMode && !selection && !saved;
    // The due queue is derived from stored progress; the server's 409 codes stay authoritative at start.
    const reviewProgress = useQuery({ queryKey: ['progress', seasonId, me?.organizationId, me?.userId], queryFn: () => api.progress(seasonId), enabled: isReviewMode, retry: false });
    const [entryOverride, setEntryOverride] = useState<'caughtUp' | 'noQuestions' | null>(null);
    const [session, setSession] = useState<Session | null>(saved?.session ?? null), [card, setCard] = useState<PbeSessionCard | null>(saved?.card ?? null), [result, setResult] = useState<PbeAttemptResult | null>(saved?.attempt && 'earnedPoints' in saved.attempt ? saved.attempt : null);
    const [answers, setAnswers] = useState<string[]>(() => saved?.card ? pending(saved.session.id, saved.card.id)?.answers ?? saved.card.question.partPoints.map(() => '') : []);
    const [presentation,setPresentation]=useState<PbePresentationState|null>(null),[timedReceipt,setTimedReceipt]=useState<PbeTimedReceipt|null>(saved?.attempt && 'feedbackDeferred' in saved.attempt && saved.attempt.questionId===saved.card?.id ? saved.attempt : null),[interruptionSummary,setInterruptionSummary]=useState(saved?.interruption?saved.summary:null),[timingError,setTimingError]=useState(''),[tick,setTick]=useState(0);
    // MockFull halftime (card 51): a pending break carried by the session
    // (or returned by `next` after attempt 45) pauses the run here.
    const [breakState,setBreakState]=useState<PbeBreakState|null>(saved?.session.break && !saved.session.break.resumedAtMs ? saved.session.break : null);
    const warned=useRef(''), serverClock=useRef<{server:number;observed:number}|null>(null);
    // XP reward animation: fired from the submit success path only (never
    // for restored/replayed results or Simulation's deferred receipts), with
    // the student's real profile identity.
    const xpReward = useXpReward();
    const identity = useProfileIdentity(me?.userId ?? "");
    const rewardAvatar: BoardAvatar | null = identity.data ? {
        avatarKind: identity.data.avatarKind ?? (identity.data.avatarHonorKey ? "honor" : "initials"),
        avatarHonorKey: identity.data.avatarHonorKey,
        character: identity.data.character ?? null,
    } : null;
    const feedbackRef = useRef<HTMLDivElement>(null);
    const frozen = useRef<PbeSubmission | null>(saved?.card ? pending(saved.session.id, saved.card.id) : null), startId = useRef(params.get('startId') ?? crypto.randomUUID());
    const recapped = useRef(false);
    const complete = useMutation({ mutationFn: () => api.completeSession(session!.id), onSuccess: () => { for (const key of ['progress', 'training-today', 'training-journey', 'training-honors', 'pbe-chapters', 'pbe-cooperation'])
            void queries.invalidateQueries({ queryKey: [key] }); navigate(`/student/sessions/${session!.id}/recap?seasonId=${session!.seasonId}`); } });
    const applyCard = (c: PbeSessionCard) => { setCard(c); setResult(null); setTimedReceipt(null); setPresentation(null); frozen.current = pending(c.sessionId, c.id); setAnswers(frozen.current?.answers ?? c.question.partPoints.map(() => '')); aid.reset(); };
    const next = useMutation({ mutationFn: (id: string) => api.nextPbeCard(id), onSuccess: c => { if ('break' in c) { setBreakState(c.break); setCard(null); setResult(null); setTimedReceipt(null); setPresentation(null); } else applyCard(c); } });
    const resumeBreak = useMutation({ mutationFn: () => api.resumePbeBreak(session!.id), onSuccess: c => { setBreakState(null); applyCard(c); } });
    const start = useMutation({ mutationFn: () => {
            const training = { clientStartId: startId.current, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
            return selection ? api.startSession(seasonId, mode as PbeMode, training, 'Pbe', undefined, selection) : api.startSession(seasonId, mode as PbeMode, training, 'Pbe');
        }, onSuccess: s => { setSession(s); setParams({ sessionId: s.id, seasonId: s.seasonId, mode: s.mode, format: 'Pbe' }, { replace: true }); },
        onError: error => {
            if (error instanceof ApiError && error.status === 409) {
                if (error.code === 'PBE_NOTHING_DUE') setEntryOverride('caughtUp');
                else if (error.code === 'PBE_COVERAGE_UNAVAILABLE') setEntryOverride('noQuestions');
            }
        } });
    const aid = useMutation({ mutationFn: () => api.pbeSource(session!.id, card!.id), onSuccess: () => setCard(c => c ? { ...c, assisted: true } : c) });
    const submit = useMutation<PbeAttemptResult | PbeTimedReceipt | PbePresentationState>({ mutationFn: () => {
            frozen.current ??= { clientSubmissionId: crypto.randomUUID(), challengeCardId: card!.id, answers: [...answers], hintsUsed: card!.assisted };
            sessionStorage.setItem(`erudoza:pbe-attempt:${session!.id}`, JSON.stringify(frozen.current));
            return timed ? api.pbeTimed(session!.id, { action: 'submit', questionId: card!.id, revision: presentation!.revision, answers: frozen.current.answers, clientSubmissionId: frozen.current.clientSubmissionId }) : api.submitPbeAttempt(session!.id, frozen.current);
        }, onSuccess: r => { if (timed) { setTimedReceipt(r as PbeTimedReceipt); if (card!.sequence === card!.total) complete.mutate(); else next.mutate(session!.id); } else { const pbeResult = r as PbeAttemptResult; setResult(pbeResult); // Full or partial credit only (scoreless answers trigger nothing), fresh results only — replays keep their stored numbers without re-animating.
            if (pbeResult.earnedPoints > 0 && !pbeResult.alreadyProcessed) xpReward.fire(pbeResult.xpReward); } sessionStorage.removeItem(`erudoza:pbe-attempt:${session!.id}`); frozen.current = null; } });
    useEffect(() => {
        if (saved?.summary && !recapped.current) {
            if (saved.interruption) return;
            recapped.current = true;
            navigate(`/student/sessions/${saved.session.id}/recap?seasonId=${saved.session.seasonId}`, { replace: true });
            return;
        }
        if (saved) {
            if (saved.session.break && !saved.session.break.resumedAtMs) return;
            if (isTimedPbeMode(saved.session.mode) && saved.card && saved.attempt && 'feedbackDeferred' in saved.attempt && saved.attempt.questionId===saved.card.id) {
                if (saved.card.sequence === saved.card.total) complete.mutate();
                else next.mutate(saved.session.id);
            } else if (isTimedPbeMode(saved.session.mode) && saved.card) {
                void api.pbeTimedStatus(saved.session.id,saved.card!.id).then(value => {
                    if ('attemptId' in value) { if(value.questionId===saved.card!.id){setTimedReceipt(value); if (saved.card!.sequence === saved.card!.total) complete.mutate(); else next.mutate(saved.session.id);} }
                    else if (value.status === 'Interrupted') setInterruptionSummary(value.summary??null);
                    else if ('questionId' in value && value.status !== 'NotPresented') { serverClock.current={server:Date.parse(value.serverNow),observed:performance.now()}; setPresentation(value); }
                }).catch(error => setTimingError(error instanceof Error ? error.message : 'The timed rehearsal could not start.'));
            } else if (!saved.card)
                next.mutate(saved.session.id);
            return;
        }
        if (unavailable || progressScopeIncomplete || needsReviewEntry)
            return;
        if (!params.get('startId')) {
            const p = new URLSearchParams(params);
            p.set('startId', startId.current);
            setParams(p, { replace: true });
        }
        start.mutate();
        // This component is keyed by the server session or a new-session intent.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    /** Review starts from the entry screen's single action, so the intent is retried with one startId. */
    const beginReview = () => {
        if (!params.get('startId')) {
            const nextParams = new URLSearchParams(params);
            nextParams.set('startId', startId.current);
            setParams(nextParams, { replace: true });
        }
        start.mutate();
    };
    const showReviewEntry = needsReviewEntry && !session;
    useEffect(() => { if (!timed || !presentation?.responseEndsAtMs) return; const timer = window.setInterval(() => setTick(value => value + 1), 250); return () => window.clearInterval(timer); }, [timed, presentation?.responseEndsAtMs]);
    useEffect(() => { if (!timed || !presentation || !card || !session || !answers.length) return; const timer = window.setTimeout(() => { void api.pbeTimed(session.id, { action: 'draft', questionId: card.id, revision: presentation.revision, answers }).catch(() => {}); }, 300); return () => window.clearTimeout(timer); }, [answers, timed, presentation, card, session]);
    void tick;
    const displayedNow=serverClock.current?serverClock.current.server+performance.now()-serverClock.current.observed:Date.now();
    const remaining = presentation?.responseEndsAtMs ? Math.max(0, Math.ceil((presentation.responseEndsAtMs - displayedNow) / 1000)) : null;
    useEffect(() => {
        if (!timed || remaining !== 0 || !session || !card || timedReceipt) return;
        let active=true,timer:number;
        const poll=async()=>{
            try {
                const value=await api.pbeTimedStatus(session.id,card.id);
                if(!active)return;
                if('attemptId' in value){
                    if(!value.questionId||value.questionId===card.id){
                        setTimingError('');setTimedReceipt(value);
                        if(card.sequence===card.total)complete.mutate();else next.mutate(session.id);
                        return;
                    }
                    timer=window.setTimeout(()=>void poll(),500);
                    return;
                }
                if(value.status==='Interrupted'){setInterruptionSummary(value.summary??null);return;}
                if('questionId' in value&&value.status==='Armed')setPresentation(value);
                timer=window.setTimeout(()=>void poll(),500);
            } catch(error) {
                if(!active)return;
                setTimingError(error instanceof Error?error.message:'The timed rehearsal could not start.');
                timer=window.setTimeout(()=>void poll(),500);
            }
        };
        timer=window.setTimeout(()=>void poll(),250);
        return()=>{active=false;window.clearTimeout(timer);};
    // Mutation functions are stable; mutation objects would restart this poll on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    },[remaining,mode,session,card,timedReceipt]);
    if (card && remaining !== null && remaining <= 10 && warned.current !== card.id) warned.current = card.id;
    const home = `/student?seasonId=${encodeURIComponent(session?.seasonId ?? seasonId)}`, practice = `/student/study?seasonId=${encodeURIComponent(seasonId)}&mode=Practice&format=Pbe`, memory = `/student/study?seasonId=${encodeURIComponent(seasonId)}&mode=Practice&format=Memory`;
    const framingMode = mode === 'Review' ? 'Review' : timed ? 'Simulation' : 'Practice';
    const framing = studySessionFraming(framingMode, 'Pbe');
    const entryHref = `/student/study?seasonId=${encodeURIComponent(seasonId)}&format=Pbe`;
    const error = start.error ?? next.error ?? submit.error ?? aid.error ?? complete.error ?? resumeBreak.error;
    const staleScope = start.error instanceof ApiError && ['PBE_CHAPTER_SCOPE_STALE', 'PBE_CHAPTER_CURSOR_STALE'].includes(start.error.code ?? '');
    const locked = !!result || submit.isPending || !!frozen.current;
    if (showReviewEntry) {
        const progressData = reviewProgress.data;
        // Mirror the daily mission review set (training/store.ts): distinct
        // due knowledge units, earliest due first (unit id breaks ties),
        // capped at 8 — the same population Progress.reviewDueCount counts.
        // The uncapped list promised passages no review session would serve.
        const dueItems = [...new Map((progressData?.mastery ?? [])
            .filter((entry) => entry.reviewDueAtUtc && Date.parse(entry.reviewDueAtUtc) <= Date.now())
            .sort((a, b) => Date.parse(a.reviewDueAtUtc!) - Date.parse(b.reviewDueAtUtc!) || a.knowledgeUnitId.localeCompare(b.knowledgeUnitId))
            .map((entry) => [entry.knowledgeUnitId, entry] as const)).values()].slice(0, 8);
        const hero = <header className="pbe-review-hero">
            <p className="pbe-review-crumb"><AppIcon name="review" />{framing.eyebrow}</p>
            <h1>Protect what you’ve learned</h1>
            <p>Only passages ready for another pass appear here. Work through them without a clock — there is no timer, and you’ll see feedback right after each answer.</p>
            <ul className="pbe-review-rules" aria-label="Review rules">
                <li>Untimed</li>
                <li>Immediate feedback</li>
                <li>PBE questions</li>
            </ul>
        </header>;
        const startError = start.isError && !entryOverride ? <Notice tone="danger" role="alert">{start.error instanceof Error ? start.error.message : 'Review could not start.'}<Button variant="secondary" onClick={beginReview}>Retry start</Button></Notice> : null;
        if (unavailable || entryOverride === 'noQuestions') {
            // The server's unavailable explanation already ends with the
            // coach/Memory guidance; append the local guidance only when the
            // explanation does not carry it, so it renders exactly once.
            const explanation = unavailable ?? 'No questions are ready for this yet.';
            const guidance = /ask your coach/i.test(explanation) ? '' : ' Ask your coach to add questions for this season — or switch to Memory to keep practicing.';
            return <div className="er-study-stage pbe-review">{hero}
                <div className="pbe-review-empty">
                    <div className="pbe-review-empty-art" aria-hidden="true"><AppIcon name="book" /></div>
                    <h2>No PBE questions to review</h2>
                    <p>{explanation}{guidance}</p>
                    <div className="pbe-review-empty-actions">
                        <LinkButton to={memory}>Choose Memory</LinkButton>
                        <LinkButton variant="ghost" to={entryHref}>Back to training</LinkButton>
                    </div>
                </div>
            </div>;
        }
        if (progressScopeIncomplete)
            return <div className="er-study-stage pbe-review">{hero}<Panel><Notice tone="danger">This chapter-practice link is incomplete. Return to chapter progress and choose Practice or Review again.</Notice></Panel></div>;
        if (reviewProgress.isPending)
            return <div className="er-study-stage pbe-review">{hero}<LoadingState label="Loading your due reviews…" /></div>;
        if (reviewProgress.isError)
            return <div className="er-study-stage pbe-review">{hero}<Notice tone="danger" role="alert">Your due reviews could not load.<Button variant="secondary" onClick={() => void reviewProgress.refetch()}>Try again</Button></Notice></div>;
        if (entryOverride === 'caughtUp' || dueItems.length === 0)
            return <div className="er-study-stage pbe-review">{hero}
                <div className="pbe-review-empty">
                    <div className="pbe-review-empty-art" aria-hidden="true"><AppIcon name="check" /></div>
                    <h2>You’ve all caught up</h2>
                    <p>{progressData?.seasonStatus === 'Active' ? 'Nothing is due for another pass right now. Review will become available again when a passage reaches its next review window.' : 'Reviews open when this season is Active.'}</p>
                    <div className="pbe-review-next">
                        <strong>What can I do now?</strong>
                        <span>Choose Learn for today’s assigned material or Rehearse for competition-style practice.</span>
                    </div>
                    <div className="pbe-review-empty-actions">
                        <Button disabled className="pbe-review-disabled-start">Nothing due to review</Button>
                        <LinkButton variant="ghost" to={entryHref}>Back to training</LinkButton>
                    </div>
                </div>
            </div>;
        const dueCount = dueItems.length;
        return <div className="er-study-stage pbe-review">{hero}
            {startError}
            <div className="pbe-review-body">
                <section aria-label="Due passages">
                    <div className="pbe-review-queue-head">
                        <div>
                            <h2>Due for review</h2>
                            <p>A short, focused queue — not another assignment list.</p>
                        </div>
                        <p className="pbe-review-count"><strong>{dueCount}</strong><span>{dueCount === 1 ? 'passage' : 'passages'} due</span></p>
                    </div>
                    <ul className="pbe-review-queue" aria-label="Due passages">
                        {dueItems.map((item, index) => {
                            const kind = dueItemKind(progressData, item);
                            const copy = DUE_KIND_COPY[kind];
                            return <li key={item.knowledgeUnitId} className="pbe-review-due-card">
                                <span className="pbe-review-due-number" aria-hidden="true">{index + 1}</span>
                                <div className="pbe-review-due-copy">
                                    <h3>{item.title}</h3>
                                    <p className="pbe-review-reason"><AppIcon name="review" /><span><b>{copy.lead}</b>{' · '}{reviewReturnDetail(progressData, item.title) ?? copy.fallback}</span></p>
                                </div>
                                <Badge tone={copy.tone}>{kind}</Badge>
                            </li>;
                        })}
                    </ul>
                </section>
                <div className="pbe-review-start">
                    <div>
                        <h2>Ready for a quick review?</h2>
                        <p>{dueCount} due {dueCount === 1 ? 'passage' : 'passages'}. No timer. Feedback appears after every answer.</p>
                    </div>
                    <Button data-testid="start-due-reviews" disabled={start.isPending} onClick={beginReview}>{start.isPending ? 'Starting…' : 'Start due reviews'}</Button>
                </div>
                <p className="pbe-review-quiet"><AppIcon name="check" /><span>Review never adds unrelated assignments. When the due queue is empty, starting is disabled.</span></p>
                <div className="pbe-review-foot"><LinkButton variant="ghost" to={entryHref}>Back to training</LinkButton></div>
            </div>
        </div>;
    }
    // Session actions, defined once: on phones the trio (check / next /
    // finish) rides the bottom action dock; on desktop it sits in the same
    // in-flow row as before. Identical elements either way.
    const sessionActions = <><Button data-testid="submit-answer" disabled={!!result || submit.isPending || !answers.some(a => a.trim()) || timed && (!presentation?.responseStartsAtMs || displayedNow < presentation.responseStartsAtMs)} onClick={() => submit.mutate()}>{submit.isPending ? 'Saving…' : timedReceipt ? 'Answer saved' : result ? 'Answer checked' : frozen.current ? 'Retry saved answer' : 'Check answer'}</Button>{result && card && card.sequence < card.total && <Button data-testid="next-card" disabled={next.isPending} onClick={() => { submit.reset(); next.mutate(session!.id); }}>Next card</Button>}<Button data-testid="complete-session" variant={result && card && card.sequence === card.total ? 'primary' : 'ghost'} disabled={!result || complete.isPending} onClick={() => complete.mutate()}>Finish session</Button></>;
    return <div className="er-study-stage" data-session-active="true">
    <p className="study-eyebrow">{framing.eyebrow}</p>
    <PageHeader title={mode === 'Checkpoint' ? 'PBE checkpoint' : mode === 'Rescue' ? 'PBE rescue' : mode === 'MockFull' ? 'PBE full mock' : mode === 'MockHalf' ? 'PBE half mock' : framingMode === 'Simulation' ? 'PBE rehearsal' : framingMode === 'Review' ? 'PBE review' : 'PBE practice'} description={<span className="study-blurb">{framing.blurb}</span>} action={<span className="study-cover-actions"><Badge>{mode === 'Simulation' ? 'Shortened timed practice' : mode === 'Checkpoint' ? 'Timed checkpoint · official clock' : mode === 'MockFull' ? 'Full mock · 90 questions · official clock' : mode === 'MockHalf' ? 'Half mock · 45 questions · official clock' : mode === 'Rescue' ? 'Untimed rescue' : `Untimed ${mode.toLowerCase()}`}</Badge></span>}/>
    {framingMode === 'Simulation' && <div className="study-exam-banner" data-testid="exam-mode-banner"><AppIcon name="flag" /><div><strong>Challenge mode</strong><p>{mode === 'Simulation' ? 'Shortened timed practice. Answers freeze when time ends and feedback waits until the finish.' : 'Timed run on the official clock: 20 seconds plus 5 seconds for each point a question is worth. Answers freeze when time ends and feedback waits until the finish.'}</p><ul className="study-rules" aria-label="Challenge rules">{academyModeRules('rehearsal', 'Pbe').map(rule => <li key={rule}>{mode !== 'Simulation' && rule === 'Shortened timed practice' ? 'Official timing — 20 seconds plus 5 for each point' : rule}</li>)}</ul></div></div>}
    {framingMode === 'Review' && card && <div className="study-return-banner" data-testid="review-return-banner"><AppIcon name="review" /><div><strong>Back for another pass</strong><span>{card.question.reference} · {reviewReturnDetail(reviewProgress.data, card.question.reference) ?? 'due for review'} · no source aid in Review</span></div></div>}
  {unavailable || progressScopeIncomplete ? <Panel><Notice tone={progressScopeIncomplete ? 'danger' : 'info'}>{progressScopeIncomplete ? 'This link is missing a piece. Head back to your chapter progress and tap Practice or Review again.' : unavailable}</Notice></Panel> : <>
   {error && <Notice tone="danger">{staleScope ? <>This chapter action is out of date. Load current progress and choose Practice or Review again.<LinkButton variant="secondary" to={`/student?seasonId=${encodeURIComponent(seasonId)}`}>Return to chapter progress</LinkButton></> : <>{error.message}{start.isError && <Button variant="secondary" onClick={() => start.mutate()}>Retry start</Button>}{next.isError && session && <Button variant="secondary" onClick={() => next.mutate(session.id)}>Retry next card</Button>}</>}</Notice>}
   {timingError && <Notice tone="danger">{timingError}<Button variant="secondary" onClick={() => { setTimingError(''); setPresentation(null); }}>Retry presentation</Button></Notice>}
   {interruptionSummary && <Panel><Notice tone="info">{mode === 'Simulation' ? 'This shortened timed practice was interrupted. Earlier accepted answers are retained.' : 'This timed run was interrupted. Earlier accepted answers are retained.'}</Notice>{interruptionSummary.results?.map(savedResult=><p key={savedResult.attemptId}>{savedResult.earnedPoints} / {savedResult.availablePoints} points</p>)}<LinkButton variant="secondary" to={`/student/sessions/${session?.id??saved?.session.id}/recap?seasonId=${encodeURIComponent(session?.seasonId??seasonId)}`}>View partial recap</LinkButton><LinkButton variant="primary" to={practice.replace('mode=Practice',`mode=${mode}`)}>{mode === 'Simulation' ? 'Start another shortened timed practice' : mode === 'Checkpoint' ? 'Start another checkpoint' : mode === 'MockHalf' || mode === 'MockFull' ? 'Start another mock round' : 'Start another timed run'}</LinkButton></Panel>}
   {breakState && session && !interruptionSummary && <Panel data-testid="pbe-break"><Badge tone="info">Halftime</Badge><h2 className="mt-3">You’re halfway there</h2><p className="mt-2">You’ve answered {breakState.afterAttempts} of {session.targetCardCount} questions. Take a breather — the clock is paused and your answers so far are saved. When you’re ready, question {breakState.afterAttempts + 1} opens the second half.</p><div className="mt-4"><Button data-testid="resume-after-break" disabled={resumeBreak.isPending} onClick={() => resumeBreak.mutate()}>{resumeBreak.isPending ? 'Continuing…' : `Continue to question ${breakState.afterAttempts + 1}`}</Button></div></Panel>}
   {!card && !breakState && !start.isError && !next.isError && <LoadingState label="Loading your saved PBE questions…"/>}
   {card && !breakState && !interruptionSummary && timed && !presentation && <PbePresentation key={card.id} text={`For ${card.question.points} ${card.question.points === 1 ? 'point' : 'points'}. ${card.question.reference}. ${card.question.prompt}`} onReady={async delivery => { try { const shown = await api.pbeTimed(session!.id, { action: 'present', delivery }) as PbePresentationState; const armed = await api.pbeTimed(session!.id, { action: 'ack', questionId: card.id, revision: shown.revision, delivery }) as PbePresentationState; serverClock.current={server:Date.parse(armed.serverNow),observed:performance.now()}; setPresentation(armed); } catch(error) { setTimingError(error instanceof Error ? error.message : 'The timed rehearsal could not start.'); throw error; } }}/>}
   {card && (!timed || presentation) && <Panel className="student-challenge" data-testid="challenge-card"><div className="flex flex-wrap items-center justify-between gap-3"><p className="study-card-reference">{card.question.reference}</p><Badge>{card.question.points} points</Badge><p data-testid="card-progress">{card.sequence} / {card.total}</p></div><progress className="training-session-progress" aria-label="Study session progress" value={card.sequence} max={card.total}/><p className="mt-4 flex flex-wrap items-center gap-2" data-testid="pbe-kind"><Badge tone="info">{PBE_KIND_FRAMING[card.question.kind].label}</Badge>{pbeAskType(card.question.prompt) && <Badge data-testid="pbe-ask">{pbeAskType(card.question.prompt)}</Badge>}<span className="text-sm">{PBE_KIND_FRAMING[card.question.kind].framing}</span></p><h2 className="mt-4" data-testid="challenge-prompt">{card.question.prompt}</h2>
    {timed && presentation && <><p role="timer">{presentation.responseStartsAtMs && displayedNow < presentation.responseStartsAtMs ? 'Response starts shortly' : `${remaining} seconds remaining`}</p>{warned.current === card.id && remaining !== null && remaining <= 10 && <Notice>Ten seconds remain.</Notice>}</>}
    {card.question.kind === 'TrueFalse' ? <div className="mt-6 flex flex-wrap gap-3" aria-label="True or false">{['True', 'False'].map(value => <Button key={value} aria-pressed={answers[0] === value} variant={answers[0] === value ? 'primary' : 'secondary'} disabled={locked} onClick={() => setAnswers([value])}>{value}</Button>)}</div> : <PbeAnswerInput partPoints={card.question.partPoints} answers={answers} onChange={setAnswers} disabled={locked}/>}
    {frozen.current && !result && <Notice className="mt-4">Saved answer awaiting confirmation. Retry sends these exact answers.</Notice>}
    {result && !timed && <div className="student-feedback" role="status" data-testid="challenge-feedback" ref={feedbackRef}><Badge tone={result.earnedPoints === result.availablePoints ? 'success' : 'warning'}>{result.earnedPoints} / {result.availablePoints} points</Badge><h3 className="mt-3">Expected answers</h3><ol className="space-y-3">{result.expectedParts.map((part, i) => <PbePartFeedback key={i} index={i} expected={part} submitted={answers[i] ?? ''} points={card.question.partPoints[i]} />)}</ol><p className="mt-3">{result.citation}</p><p className="er-scripture" data-testid="feedback-source">{result.sourceEvidence}</p><p className="mt-3">{result.unaided ? 'Unaided answer saved. Missed targets remain due for review.' : 'Practice with assistance saved. This answer does not establish unaided recall.'}</p><PbeStudyTemplates kind={card.question.kind} result={result} /></div>}
    {phone ? <div className="student-study-actions mobile-action-dock" role="region" aria-label="Session actions">{sessionActions}</div> : <div className="student-study-actions">{sessionActions}</div>}
    {!result && mode === 'Practice' && <div className="mt-4"><Button variant="secondary" disabled={aid.isPending || locked} onClick={() => aid.mutate()}>Read source with assistance</Button>{card.assisted && <p>Source assistance is recorded for this card.</p>}{aid.data && <div className="mt-3">{aid.data.sources.map((source, i) => <div key={i}><h3>{source.citation}</h3><p className="er-scripture">{source.canonicalText}</p></div>)}</div>}</div>}
   </Panel>}
  </>}
  <div className="flex flex-wrap gap-3"><LinkButton variant="secondary" to={home}>Back to Training HQ</LinkButton><LinkButton variant="ghost" to={memory}>Choose Memory</LinkButton>{mode === 'Review' && <LinkButton variant="secondary" to={practice}>Choose Practice</LinkButton>}</div>
  <XpRewardOverlay reward={xpReward.reward} name={me?.displayName ?? "You"} avatar={rewardAvatar} getAnchor={() => feedbackRef.current} />
 </div>;
}
