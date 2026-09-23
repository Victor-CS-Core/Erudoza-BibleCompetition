import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api, ApiError } from '../../api/client';
import type { Progress, Session } from '../../api/types';
import type { PbeAttemptResult, PbePresentationState, PbeResumedSession, PbeSessionCard, PbeSubmission, PbeTimedReceipt } from '../../api/pbeTypes';
import { Badge, Button, LinkButton, LoadingState, Notice, PageHeader, Panel } from '../../components/ui';
import { AppIcon } from '../../components/AppIcon';
import { academyModeRules, studySessionFraming } from './academyTracks';
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
export function PbeStudyPage({ saved, seasonId, seasonName, unavailable }: {
    saved?: PbeResumedSession;
    seasonId: string;
    seasonName: string;
    unavailable?: string;
}) {
    const [params, setParams] = useSearchParams(), navigate = useNavigate(), queries = useQueryClient();
    const { me } = useAuth();
    const mode = saved?.session.mode ?? params.get('mode') ?? 'Practice';
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
    const warned=useRef(''), serverClock=useRef<{server:number;observed:number}|null>(null);
    const frozen = useRef<PbeSubmission | null>(saved?.card ? pending(saved.session.id, saved.card.id) : null), startId = useRef(params.get('startId') ?? crypto.randomUUID());
    const recapped = useRef(false);
    const complete = useMutation({ mutationFn: () => api.completeSession(session!.id), onSuccess: () => { for (const key of ['progress', 'training-today', 'training-journey', 'training-honors', 'pbe-chapters', 'pbe-cooperation'])
            void queries.invalidateQueries({ queryKey: [key] }); navigate(`/student/sessions/${session!.id}/recap?seasonId=${session!.seasonId}`); } });
    const next = useMutation({ mutationFn: (id: string) => api.nextPbeCard(id), onSuccess: c => { setCard(c); setResult(null); setTimedReceipt(null); setPresentation(null); frozen.current = pending(c.sessionId, c.id); setAnswers(frozen.current?.answers ?? c.question.partPoints.map(() => '')); aid.reset(); } });
    const start = useMutation({ mutationFn: () => {
            const training = { clientStartId: startId.current, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
            return selection ? api.startSession(seasonId, mode as 'Practice' | 'Review' | 'Simulation', training, 'Pbe', undefined, selection) : api.startSession(seasonId, mode as 'Practice' | 'Review' | 'Simulation', training, 'Pbe');
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
            return mode === 'Simulation' ? api.pbeTimed(session!.id, { action: 'submit', questionId: card!.id, revision: presentation!.revision, answers: frozen.current.answers, clientSubmissionId: frozen.current.clientSubmissionId }) : api.submitPbeAttempt(session!.id, frozen.current);
        }, onSuccess: r => { if (mode === 'Simulation') { setTimedReceipt(r as PbeTimedReceipt); if (card!.sequence === card!.total) complete.mutate(); else next.mutate(session!.id); } else setResult(r as PbeAttemptResult); sessionStorage.removeItem(`erudoza:pbe-attempt:${session!.id}`); frozen.current = null; } });
    useEffect(() => {
        if (saved?.summary && !recapped.current) {
            if (saved.interruption) return;
            recapped.current = true;
            navigate(`/student/sessions/${saved.session.id}/recap?seasonId=${saved.session.seasonId}`, { replace: true });
            return;
        }
        if (saved) {
            if (saved.session.mode === 'Simulation' && saved.card && saved.attempt && 'feedbackDeferred' in saved.attempt && saved.attempt.questionId===saved.card.id) {
                if (saved.card.sequence === saved.card.total) complete.mutate();
                else next.mutate(saved.session.id);
            } else if (saved.session.mode === 'Simulation' && saved.card) {
                void api.pbeTimedStatus(saved.session.id,saved.card!.id).then(value => {
                    if ('attemptId' in value) { if(value.questionId===saved.card!.id){setTimedReceipt(value); if (saved.card!.sequence === saved.card!.total) complete.mutate(); else next.mutate(saved.session.id);} }
                    else if (value.status === 'Interrupted') setInterruptionSummary(value.summary??null);
                    else if ('questionId' in value && value.status !== 'NotPresented') { serverClock.current={server:Date.parse(value.serverNow),observed:performance.now()}; setPresentation(value); }
                }).catch(error => setTimingError(error instanceof Error ? error.message : 'Timed rehearsal unavailable.'));
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
    useEffect(() => { if (mode !== 'Simulation' || !presentation?.responseEndsAtMs) return; const timer = window.setInterval(() => setTick(value => value + 1), 250); return () => window.clearInterval(timer); }, [mode, presentation?.responseEndsAtMs]);
    useEffect(() => { if (mode !== 'Simulation' || !presentation || !card || !session || !answers.length) return; const timer = window.setTimeout(() => { void api.pbeTimed(session.id, { action: 'draft', questionId: card.id, revision: presentation.revision, answers }).catch(() => {}); }, 300); return () => window.clearTimeout(timer); }, [answers, mode, presentation, card, session]);
    void tick;
    const displayedNow=serverClock.current?serverClock.current.server+performance.now()-serverClock.current.observed:Date.now();
    const remaining = presentation?.responseEndsAtMs ? Math.max(0, Math.ceil((presentation.responseEndsAtMs - displayedNow) / 1000)) : null;
    useEffect(() => {
        if (mode !== 'Simulation' || remaining !== 0 || !session || !card || timedReceipt) return;
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
                setTimingError(error instanceof Error?error.message:'Timed rehearsal unavailable.');
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
    const framingMode = mode === 'Review' ? 'Review' : mode === 'Simulation' ? 'Simulation' : 'Practice';
    const framing = studySessionFraming(framingMode);
    const entryHref = `/student/study?seasonId=${encodeURIComponent(seasonId)}&format=Pbe`;
    const error = start.error ?? next.error ?? submit.error ?? aid.error ?? complete.error;
    const staleScope = start.error instanceof ApiError && ['PBE_CHAPTER_SCOPE_STALE', 'PBE_CHAPTER_CURSOR_STALE'].includes(start.error.code ?? '');
    const locked = !!result || submit.isPending || !!frozen.current;
    if (showReviewEntry) {
        const progressData = reviewProgress.data;
        const dueItems = (progressData?.mastery ?? [])
            .filter((entry) => entry.reviewDueAtUtc && Date.parse(entry.reviewDueAtUtc) <= Date.now())
            .sort((a, b) => Date.parse(a.reviewDueAtUtc!) - Date.parse(b.reviewDueAtUtc!) || a.title.localeCompare(b.title));
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
        if (unavailable || entryOverride === 'noQuestions')
            return <div className="er-study-stage space-y-4 pbe-review">{hero}
                <div className="pbe-review-empty">
                    <div className="pbe-review-empty-art" aria-hidden="true"><AppIcon name="book" /></div>
                    <h2>No PBE questions to review</h2>
                    <p>{unavailable ?? 'No eligible published questions are available.'} Ask your coach to publish questions for this season’s assignments — or choose Memory to keep practicing.</p>
                    <div className="pbe-review-empty-actions">
                        <LinkButton to={memory}>Choose Memory</LinkButton>
                        <LinkButton variant="ghost" to={entryHref}>Back to training</LinkButton>
                    </div>
                </div>
            </div>;
        if (progressScopeIncomplete)
            return <div className="er-study-stage space-y-4 pbe-review">{hero}<Panel><Notice tone="danger">This chapter-practice link is incomplete. Return to chapter progress and choose Practice or Review again.</Notice></Panel></div>;
        if (reviewProgress.isPending)
            return <div className="er-study-stage space-y-4 pbe-review">{hero}<LoadingState label="Loading your due reviews…" /></div>;
        if (reviewProgress.isError)
            return <div className="er-study-stage space-y-4 pbe-review">{hero}<Notice tone="danger" role="alert">Your due reviews could not load.<Button variant="secondary" onClick={() => void reviewProgress.refetch()}>Try again</Button></Notice></div>;
        if (entryOverride === 'caughtUp' || dueItems.length === 0)
            return <div className="er-study-stage space-y-4 pbe-review">{hero}
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
        return <div className="er-study-stage space-y-4 pbe-review">{hero}
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
    return <div className="er-study-stage space-y-4">
    <p className="study-eyebrow">{framing.eyebrow}</p>
    <PageHeader title={framingMode === 'Simulation' ? 'PBE rehearsal' : framingMode === 'Review' ? 'PBE review' : 'PBE practice'} description={<span><span>{seasonName}</span><span className="study-blurb">{framing.blurb}</span></span>} action={<span className="study-cover-actions"><Badge>{mode === 'Simulation' ? 'Shortened timed practice' : `Untimed ${mode.toLowerCase()}`}</Badge></span>}/>
    {framingMode === 'Simulation' && <div className="study-exam-banner" data-testid="exam-mode-banner"><AppIcon name="flag" /><div><strong>Exam mode</strong><p>Shortened timed practice. Answers freeze when time ends and feedback waits until the finish.</p><ul className="study-rules" aria-label="Exam rules">{academyModeRules('rehearsal', 'Pbe').map(rule => <li key={rule}>{rule}</li>)}</ul></div></div>}
    {framingMode === 'Review' && card && <div className="study-return-banner" data-testid="review-return-banner"><AppIcon name="review" /><div><strong>Back for another pass</strong><span>{card.question.reference} · {reviewReturnDetail(reviewProgress.data, card.question.reference) ?? 'due for review'} · no source aid in Review</span></div></div>}
  {unavailable || progressScopeIncomplete ? <Panel><Notice tone={progressScopeIncomplete ? 'danger' : 'info'}>{progressScopeIncomplete ? 'This chapter-practice link is incomplete. Return to chapter progress and choose Practice or Review again.' : unavailable}</Notice></Panel> : <>
   {error && <Notice tone="danger">{staleScope ? <>This chapter action is out of date. Load current progress and choose Practice or Review again.<LinkButton variant="secondary" to={`/student/progress?seasonId=${encodeURIComponent(seasonId)}`}>Return to chapter progress</LinkButton></> : <>{error.message}{start.isError && <Button variant="secondary" onClick={() => start.mutate()}>Retry start</Button>}{next.isError && session && <Button variant="secondary" onClick={() => next.mutate(session.id)}>Retry next card</Button>}</>}</Notice>}
   {timingError && <Notice tone="danger">{timingError}<Button variant="secondary" onClick={() => { setTimingError(''); setPresentation(null); }}>Retry presentation</Button></Notice>}
   {interruptionSummary && <Panel><Notice tone="info">This shortened timed practice was interrupted. Earlier accepted answers are retained.</Notice>{interruptionSummary.results?.map(savedResult=><p key={savedResult.attemptId}>{savedResult.earnedPoints} / {savedResult.availablePoints} points</p>)}<LinkButton variant="secondary" to={`/student/sessions/${session?.id??saved?.session.id}/recap?seasonId=${encodeURIComponent(session?.seasonId??seasonId)}`}>View partial recap</LinkButton><LinkButton variant="primary" to={practice.replace('mode=Practice','mode=Simulation')}>Start another shortened timed practice</LinkButton></Panel>}
   {!card && !start.isError && !next.isError && <LoadingState label="Loading your saved PBE questions…"/>}
   {card && !interruptionSummary && mode === 'Simulation' && !presentation && <PbePresentation key={card.id} text={`For ${card.question.points} ${card.question.points === 1 ? 'point' : 'points'}. ${card.question.reference}. ${card.question.prompt}`} onReady={async delivery => { try { const shown = await api.pbeTimed(session!.id, { action: 'present', delivery }) as PbePresentationState; const armed = await api.pbeTimed(session!.id, { action: 'ack', questionId: card.id, revision: shown.revision, delivery }) as PbePresentationState; serverClock.current={server:Date.parse(armed.serverNow),observed:performance.now()}; setPresentation(armed); } catch(error) { setTimingError(error instanceof Error ? error.message : 'Timed rehearsal unavailable.'); throw error; } }}/>}
   {card && (mode !== 'Simulation' || presentation) && <Panel className="student-challenge" data-testid="challenge-card"><div className="flex flex-wrap items-center justify-between gap-3"><p>{card.question.reference}</p><Badge>{card.question.points} points</Badge><p data-testid="card-progress">{card.sequence} / {card.total}</p></div><progress className="training-session-progress" aria-label="Study session progress" value={card.sequence} max={card.total}/><h2 className="mt-6" data-testid="challenge-prompt">{card.question.prompt}</h2>
    {mode === 'Simulation' && presentation && <><p role="timer">{presentation.responseStartsAtMs && displayedNow < presentation.responseStartsAtMs ? 'Response starts shortly' : `${remaining} seconds remaining`}</p>{warned.current === card.id && remaining !== null && remaining <= 10 && <Notice>Ten seconds remain.</Notice>}</>}
    {card.question.kind === 'TrueFalse' ? <div className="mt-6 flex flex-wrap gap-3" aria-label="True or false">{['True', 'False'].map(value => <Button key={value} aria-pressed={answers[0] === value} variant={answers[0] === value ? 'primary' : 'secondary'} disabled={locked} onClick={() => setAnswers([value])}>{value}</Button>)}</div> : <PbeAnswerInput partPoints={card.question.partPoints} answers={answers} onChange={setAnswers} disabled={locked}/>}
    {frozen.current && !result && <Notice className="mt-4">Saved answer awaiting confirmation. Retry sends these exact answers.</Notice>}
    {result && mode !== 'Simulation' && <div className="student-feedback" role="status" data-testid="challenge-feedback"><Badge tone={result.earnedPoints === result.availablePoints ? 'success' : 'warning'}>{result.earnedPoints} / {result.availablePoints} points</Badge><h3 className="mt-3">Expected answers</h3><ol>{result.expectedParts.map((part, i) => <li key={i}>{part}</li>)}</ol><p className="mt-3">{result.citation}</p><p className="er-scripture" data-testid="feedback-source">{result.sourceEvidence}</p><p className="mt-3">{result.unaided ? 'Unaided answer saved. Missed targets remain due for review.' : 'Practice with assistance saved. This answer does not establish unaided recall.'}</p></div>}
    <div className="student-study-actions"><Button data-testid="submit-answer" disabled={!!result || submit.isPending || !answers.some(a => a.trim()) || mode === 'Simulation' && (!presentation?.responseStartsAtMs || displayedNow < presentation.responseStartsAtMs)} onClick={() => submit.mutate()}>{submit.isPending ? 'Saving…' : timedReceipt ? 'Answer saved' : result ? 'Answer checked' : frozen.current ? 'Retry saved answer' : 'Check answer'}</Button>{result && card.sequence < card.total && <Button data-testid="next-card" disabled={next.isPending} onClick={() => { submit.reset(); next.mutate(session!.id); }}>Next card</Button>}<Button data-testid="complete-session" variant={result && card.sequence === card.total ? 'primary' : 'ghost'} disabled={!result || complete.isPending} onClick={() => complete.mutate()}>Finish session</Button></div>
    {!result && mode === 'Practice' && <div className="mt-4"><Button variant="secondary" disabled={aid.isPending || locked} onClick={() => aid.mutate()}>Read source with assistance</Button>{card.assisted && <p>Source assistance is recorded for this card.</p>}{aid.data && <div className="mt-3">{aid.data.sources.map((source, i) => <div key={i}><h3>{source.citation}</h3><p className="er-scripture">{source.canonicalText}</p></div>)}</div>}</div>}
   </Panel>}
  </>}
  <div className="flex flex-wrap gap-3"><LinkButton variant="secondary" to={home}>Back to Training HQ</LinkButton><LinkButton variant="ghost" to={memory}>Choose Memory</LinkButton>{mode === 'Review' && <LinkButton variant="secondary" to={practice}>Choose Practice</LinkButton>}</div>
 </div>;
}
