import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Session } from '../../api/types';
import type { PbeAttemptResult, PbePresentationState, PbeResumedSession, PbeSessionCard, PbeSubmission, PbeTimedReceipt } from '../../api/pbeTypes';
import { Badge, Button, LinkButton, LoadingState, Notice, PageHeader, Panel } from '../../components/ui';
import { PbeAnswerInput } from './PbeAnswerInput';
import { PbePresentation } from '../study/PbePresentation';
import './student.css';
function pending(sessionId: string, cardId: string): PbeSubmission | null {
    try {
        const value = JSON.parse(sessionStorage.getItem(`erudoza:pbe-attempt:${sessionId}`) ?? 'null') as PbeSubmission | null;
        return value?.challengeCardId === cardId && typeof value.clientSubmissionId === 'string' && Array.isArray(value.answers) && value.answers.every(a => typeof a === 'string') ? value : null;
    }
    catch {
        return null;
    }
}
export function PbeStudyPage({ saved, seasonId, seasonName, unavailable }: {
    saved?: PbeResumedSession;
    seasonId: string;
    seasonName: string;
    unavailable?: string;
}) {
    const [params, setParams] = useSearchParams(), navigate = useNavigate(), queries = useQueryClient();
    const mode = saved?.session.mode ?? params.get('mode') ?? 'Practice';
    const [session, setSession] = useState<Session | null>(saved?.session ?? null), [card, setCard] = useState<PbeSessionCard | null>(saved?.card ?? null), [result, setResult] = useState<PbeAttemptResult | null>(saved?.attempt && 'earnedPoints' in saved.attempt ? saved.attempt : null);
    const [answers, setAnswers] = useState<string[]>(() => saved?.card ? pending(saved.session.id, saved.card.id)?.answers ?? saved.card.question.partPoints.map(() => '') : []);
    const [presentation,setPresentation]=useState<PbePresentationState|null>(null),[timedReceipt,setTimedReceipt]=useState<PbeTimedReceipt|null>(saved?.attempt && 'feedbackDeferred' in saved.attempt ? saved.attempt : null),[tick,setTick]=useState(0);
    const warned=useRef(''), serverClock=useRef<{server:number;observed:number}|null>(null);
    const frozen = useRef<PbeSubmission | null>(saved?.card ? pending(saved.session.id, saved.card.id) : null), startId = useRef(params.get('startId') ?? crypto.randomUUID());
    const recapped = useRef(false);
    const complete = useMutation({ mutationFn: () => api.completeSession(session!.id), onSuccess: () => { for (const key of ['progress', 'training-today', 'training-journey', 'training-honors'])
            void queries.invalidateQueries({ queryKey: [key] }); navigate(`/student/sessions/${session!.id}/recap?seasonId=${session!.seasonId}`); } });
    const next = useMutation({ mutationFn: (id: string) => api.nextPbeCard(id), onSuccess: c => { setCard(c); setResult(null); setTimedReceipt(null); setPresentation(null); frozen.current = pending(c.sessionId, c.id); setAnswers(frozen.current?.answers ?? c.question.partPoints.map(() => '')); aid.reset(); } });
    const start = useMutation({ mutationFn: () => api.startSession(seasonId, mode as 'Practice' | 'Review' | 'Simulation', { clientStartId: startId.current, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }, 'Pbe'), onSuccess: s => { setSession(s); setParams({ sessionId: s.id, seasonId: s.seasonId, mode: s.mode, format: 'Pbe' }, { replace: true }); } });
    const aid = useMutation({ mutationFn: () => api.pbeSource(session!.id, card!.id), onSuccess: () => setCard(c => c ? { ...c, assisted: true } : c) });
    const submit = useMutation<PbeAttemptResult | PbeTimedReceipt | PbePresentationState>({ mutationFn: () => {
            frozen.current ??= { clientSubmissionId: crypto.randomUUID(), challengeCardId: card!.id, answers: [...answers], hintsUsed: card!.assisted };
            sessionStorage.setItem(`erudoza:pbe-attempt:${session!.id}`, JSON.stringify(frozen.current));
            return mode === 'Simulation' ? api.pbeTimed(session!.id, { action: 'submit', questionId: card!.id, revision: presentation!.revision, answers: frozen.current.answers, clientSubmissionId: frozen.current.clientSubmissionId }) : api.submitPbeAttempt(session!.id, frozen.current);
        }, onSuccess: r => { if (mode === 'Simulation') { setTimedReceipt(r as PbeTimedReceipt); if (card!.sequence === card!.total) complete.mutate(); else next.mutate(session!.id); } else setResult(r as PbeAttemptResult); sessionStorage.removeItem(`erudoza:pbe-attempt:${session!.id}`); frozen.current = null; } });
    useEffect(() => {
        if (saved?.summary && !recapped.current) {
            recapped.current = true;
            navigate(`/student/sessions/${saved.session.id}/recap?seasonId=${saved.session.seasonId}`, { replace: true });
            return;
        }
        if (saved) {
            if (saved.session.mode === 'Simulation' && saved.card && saved.attempt && 'feedbackDeferred' in saved.attempt) {
                if (saved.card.sequence === saved.card.total) complete.mutate();
                else next.mutate(saved.session.id);
            } else if (!saved.card)
                next.mutate(saved.session.id);
            return;
        }
        if (unavailable)
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
    useEffect(() => { if (mode !== 'Simulation' || !presentation?.responseEndsAtMs) return; const timer = window.setInterval(() => setTick(value => value + 1), 250); return () => window.clearInterval(timer); }, [mode, presentation?.responseEndsAtMs]);
    useEffect(() => { if (mode !== 'Simulation' || !presentation || !card || !session || !answers.length) return; const timer = window.setTimeout(() => { void api.pbeTimed(session.id, { action: 'draft', questionId: card.id, revision: presentation.revision, answers }).catch(() => {}); }, 300); return () => window.clearTimeout(timer); }, [answers, mode, presentation, card, session]);
    void tick;
    const displayedNow=serverClock.current?serverClock.current.server+performance.now()-serverClock.current.observed:Date.now();
    const remaining = presentation?.responseEndsAtMs ? Math.max(0, Math.ceil((presentation.responseEndsAtMs - displayedNow) / 1000)) : null;
    if (card && remaining !== null && remaining <= 10 && warned.current !== card.id) warned.current = card.id;
    const home = `/student?seasonId=${encodeURIComponent(session?.seasonId ?? seasonId)}`, practice = `/student/study?seasonId=${encodeURIComponent(seasonId)}&mode=Practice&format=Pbe`, memory = `/student/study?seasonId=${encodeURIComponent(seasonId)}&mode=Practice&format=Memory`;
    const error = start.error ?? next.error ?? submit.error ?? aid.error ?? complete.error;
    const locked = !!result || submit.isPending || !!frozen.current;
    return <div className="er-study-stage space-y-4"><PageHeader title="PBE practice" description={seasonName} action={<Badge>{mode === 'Simulation' ? 'Shortened timed practice' : `Untimed ${mode.toLowerCase()}`}</Badge>}/>
  {unavailable ? <Panel><Notice>{unavailable}</Notice></Panel> : <>
   {error && <Notice tone="danger">{error.message}{start.isError && <Button variant="secondary" onClick={() => start.mutate()}>Retry start</Button>}{next.isError && session && <Button variant="secondary" onClick={() => next.mutate(session.id)}>Retry next card</Button>}</Notice>}
   {!card && !start.isError && !next.isError && <LoadingState label="Loading your saved PBE questions…"/>}
   {card && mode === 'Simulation' && !presentation && <PbePresentation key={card.id} text={`For ${card.question.points} ${card.question.points === 1 ? 'point' : 'points'}. ${card.question.reference}. ${card.question.prompt}`} onReady={async delivery => { const shown = await api.pbeTimed(session!.id, { action: 'present', delivery }) as PbePresentationState; const armed = await api.pbeTimed(session!.id, { action: 'ack', questionId: card.id, revision: shown.revision, delivery }) as PbePresentationState; serverClock.current={server:Date.parse(armed.serverNow),observed:performance.now()}; setPresentation(armed); }}/>}
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
