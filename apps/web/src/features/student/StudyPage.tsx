import { useAuth } from "../../auth/AuthContext";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type { ChallengeCard, AttemptResult, Session } from "../../api/types";
import type { StartTrainingContext } from "../../api/trainingTypes";
import { Badge, Button, Input, LinkButton, Notice, PageHeader, Panel, Textarea } from "../../components/ui";
import { AppIcon } from "../../components/AppIcon";
import {
  academyActivityName,
  academyModeRules,
  academySessionKicker,
  academyTrackForMode,
  academyUnavailableCopy,
  canStartAcademyTrack,
  resolveStudyFormat,
  studySessionFraming,
} from "./academyTracks";
import "./student.css";
import { MissingWordsInput } from './MissingWordsInput';
import { VerseBuilderInput } from "./VerseBuilderInput";
import { ScriptureReader } from "./ScriptureReader";
import { PbeStudyPage, reviewReturnDetail } from './PbeStudyPage';
import { StudyModeSelect } from './StudyModeSelect';
import { trainingApi } from '../../api/training';
import { LoadingState } from '../../components/ui';
import { ContentPage } from "../admin/ContentPage";
import type { PbeResumedSession } from '../../api/pbeTypes';
import type { ResumedSession } from '../../api/types';

export type StudyMode = "Practice" | "Review" | "Simulation" | "Library";
export function parseStudyMode(value: string | null): StudyMode {
  return value === "Review" || value === "Simulation" || value === "Library" ? value : "Practice";
}

export function StudyPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const modeParam = params.get("mode");
  const sessionMode = modeParam === "Practice" || modeParam === "Review" || modeParam === "Simulation" ? modeParam : null;
  const libraryMode = modeParam === "Library";
  const sessionId = params.get('sessionId'), seasonId = params.get('seasonId') || undefined;
  const formatParam = params.get('format');
  const saved = useQuery({queryKey:['study-resume-format',sessionId,me?.organizationId,me?.userId],queryFn:()=>api.resumeSession(sessionId!),enabled:!!sessionId,retry:false,staleTime:Infinity,gcTime:0});
  const progress = useQuery({queryKey:['progress',seasonId,me?.organizationId,me?.userId],queryFn:()=>api.progress(seasonId),enabled:!!sessionMode&&!sessionId&&formatParam!=='Memory'});
  const format = resolveStudyFormat(formatParam, progress.data?.pbeEnabled);
  const candidate = !!sessionMode && !sessionId && format === 'Pbe';
  const today = useQuery({queryKey:['training-today',seasonId,me?.organizationId,me?.userId],queryFn:()=>trainingApi.today(seasonId),enabled:!!candidate,retry:false});
  let body: ReactNode;
  if (libraryMode) {
    body = <ContentPage />;
  } else if(sessionId){
    if(saved.isPending)body=<LoadingState label="Loading your saved session…"/>;
    else if(saved.isError)body=<Notice tone="danger">Your saved session is unavailable. <Button onClick={()=>void saved.refetch()}>Retry saved session</Button><Button variant="secondary" onClick={()=>setParams(seasonId?{seasonId}:{})}>Start a new session</Button></Notice>;
    else body=saved.data.session.format==='Pbe'?<PbeStudyPage key={sessionId} saved={saved.data as unknown as PbeResumedSession} seasonId={saved.data.session.seasonId} seasonName="Saved PBE session"/>:<MemoryStudyPage initialSaved={saved.data}/>;
  }
  else if(sessionMode){
    if(candidate){
      if(today.isPending)body=<LoadingState label="Loading your PBE assignment…"/>;
      else if(today.isError)body=<Notice tone="danger">Your PBE assignment could not load. <Button onClick={()=>void today.refetch()}>Try again</Button><LinkButton to={`/student/study?seasonId=${encodeURIComponent(seasonId??'')}&format=Memory`}>Choose Memory</LinkButton></Notice>;
      else body=<PbeStudyPage key={`${today.data.seasonId}:${sessionMode}:Pbe`} seasonId={today.data.seasonId??seasonId??''} seasonName={today.data.seasonName} unavailable={today.data.mission.status==='Unavailable'?today.data.mission.explanation??'No eligible published questions are available.':undefined}/>;
    }
    else if(formatParam!=='Memory'&&progress.isPending)body=<LoadingState label="Loading your season…"/>;
    else body=<MemoryStudyPage/>;
  }
  else {
    body = <StudyModeSelect />;
  }
  return <>{body}</>;
}
function MemoryStudyPage({initialSaved}:{initialSaved?:ResumedSession}) {
  const { me } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedSessionId = params.get("sessionId");
  const requested = params.get("mode");
  const mode = requested === "Simulation" || requested === "Review" ? requested : "Practice";
  const track = academyTrackForMode(mode);
  const framing = studySessionFraming(mode);
  const queryClient = useQueryClient();
  const selectedSeasonId = params.get("seasonId") || undefined;
  const missionId = params.get("missionId") || undefined;  const missionRevision = params.get("missionRevision");
  const requestedStep = params.get("step");
  const entryHref = (() => {
    const entryParams = new URLSearchParams();
    if (selectedSeasonId) entryParams.set("seasonId", selectedSeasonId);
    const formatParam = params.get("format");
    if (formatParam) entryParams.set("format", formatParam);
    return `/student/study${entryParams.toString() ? `?${entryParams}` : ""}`;
  })();
  const step = requestedStep === "Review" || requestedStep === "Practice" ? requestedStep : undefined;
  const missionReview = step === "Review" && mode === "Review" && !!missionId;
  const startIntent = useRef<{ key: string; context: StartTrainingContext } | null>(null);
  const progress = useQuery({ queryKey: ["progress", selectedSeasonId, me?.organizationId, me?.userId], queryFn: () => api.progress(selectedSeasonId) });
  const game = useQuery({ queryKey: ["training-today", selectedSeasonId, me?.organizationId, me?.userId], queryFn: () => trainingApi.today(selectedSeasonId), retry: false, staleTime: 60_000 });
  const [purposeChoice,setPurposeChoice]=useState<{seasonId:string;purpose:"Warmup"|"Advanced"}|null>(null);
  const memoryChallenge=purposeChoice?.seasonId===progress.data?.seasonId?purposeChoice?.purpose:undefined;
  const choosePurpose=!!progress.data?.pbeEnabled&&!requestedSessionId&&!memoryChallenge;
  const trackReady = progress.isSuccess && (canStartAcademyTrack(track, progress.data) || (missionReview && progress.data.seasonStatus === "Active"));
  const [sessionId, setSessionId] = useState<string | null>(null);
  const loadedSession = useRef<string | null>(null);
  const [sessionSnapshot, setSessionSnapshot] = useState<Session | null>(null);
  const [restoredAttempt, setRestoredAttempt] = useState<{ cardId: string; result: AttemptResult } | null>(null);
  const resume = useMutation({ mutationFn: (id: string) => api.resumeSession(id) });
  const [startRetry, setStartRetry] = useState(0);
  const [answer, setAnswer] = useState("");
  const [slotValues, setSlotValues] = useState<Record<number, string>>({});
  const [chunks, setChunks] = useState<number[]>([]);
  const [readerOpened, setReaderOpened] = useState(false);
  const startedAt = useRef(Date.now());
  const pendingAttempt = useRef<Parameters<typeof api.submitAttempt>[1] | null>(null);

  const start = useMutation({
    mutationFn: (sessionMode: "Practice" | "Review" | "Simulation") => {
      const key = JSON.stringify([me?.organizationId, me?.userId, progress.data!.seasonId, sessionMode, missionId, missionRevision, step, memoryChallenge]);
      if (startIntent.current?.key !== key) {
        startIntent.current = { key, context: {
          clientStartId: params.get("startId") || crypto.randomUUID(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...(step ? { step } : {}),
          ...(missionId ? { missionId, missionRevision: missionRevision === null ? undefined : Number(missionRevision) } : {}),
        } };
      }
      const context = startIntent.current.context;
      if (!params.get("startId")) {
        const nextParams = new URLSearchParams(params);
        nextParams.set("startId", context.clientStartId);
        setParams(nextParams, { replace: true });
      }
      return memoryChallenge ? api.startSession(progress.data!.seasonId, sessionMode, context, "Memory", memoryChallenge) : api.startSession(progress.data!.seasonId, sessionMode, context);
    },
  });

  const card = useQuery({
    queryKey: ["card", sessionId, me?.organizationId, me?.userId],
    queryFn: () => api.nextCard(sessionId!),
    enabled: !!sessionId,
    retry: false,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (!card.data) {
      return;
    }
    startedAt.current = Date.now();
    pendingAttempt.current = readPendingAttempt(sessionId!, card.data);
    submit.reset();
    setChunks([]);
    setAnswer(pendingAttempt.current?.submittedAnswer ?? "");
    setSlotValues(Object.fromEntries(pendingAttempt.current?.missingWordAnswers?.map(slot => [slot.index, slot.text]) ?? []));
    setReaderOpened(sessionStorage.getItem(`erudoza:attempt:read:${sessionId}:${card.data.id}`) === "true");
    // Reset from the newly drawn card identity only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.data?.id]);

  const submit = useMutation({
    mutationFn: () => {
      pendingAttempt.current ??= {
        clientSubmissionId: crypto.randomUUID(),
        challengeCardId: card.data!.id,
        ...(card.data!.activityType === 'MissingWords' ? { missingWordAnswers: card.data!.tokens.filter(token => token.hidden).map(token => ({index:token.index,text:slotValues[token.index] ?? ''})) } : { submittedAnswer: answer }),
        responseTimeMs: Date.now() - startedAt.current,
        hintsUsed: sessionStorage.getItem(`erudoza:attempt:read:${sessionId}:${card.data!.id}`) === "true",
      };
      sessionStorage.setItem("erudoza:attempt:" + sessionId, JSON.stringify(pendingAttempt.current));
      return api.submitAttempt(sessionId!, pendingAttempt.current);
    },
    onSuccess: () => {
      sessionStorage.removeItem("erudoza:attempt:" + sessionId);
      sessionStorage.removeItem(`erudoza:attempt:read:${sessionId}:${card.data!.id}`);
    },
  });

  const complete = useMutation({
    mutationFn: () => api.completeSession(sessionId!),
    onSuccess: (summary) => {
      for (const key of ["progress", "training-today", "training-honors", "training-journey"]) void queryClient.invalidateQueries({ queryKey: [key] });
      navigate("/student/sessions/" + encodeURIComponent(summary.sessionId) + "/recap?seasonId=" + encodeURIComponent(sessionSnapshot?.seasonId ?? progress.data!.seasonId));
    },
  });

  useEffect(() => {
    if (requestedSessionId && loadedSession.current === requestedSessionId) return;
    let cancelled = false;
    setSessionId(null);
    setSessionSnapshot(null);
    setRestoredAttempt(null);
    setAnswer("");
    setSlotValues({});
    setChunks([]);
    submit.reset();
    complete.reset();
    if (requestedSessionId) {
      startIntent.current = null;
      void (initialSaved ? Promise.resolve(initialSaved) : resume.mutateAsync(requestedSessionId)).then((saved) => {
        if (cancelled) return;
        if (saved.summary) {
          navigate("/student/sessions/" + encodeURIComponent(saved.session.id) + "/recap?seasonId=" + encodeURIComponent(saved.session.seasonId), { replace: true });
          return;
        }
        loadedSession.current = saved.session.id;
        setSessionSnapshot(saved.session);
        if (saved.card) queryClient.setQueryData(["card", saved.session.id, me?.organizationId, me?.userId], saved.card);
        if (saved.card && saved.attempt) {
          setRestoredAttempt({ cardId: saved.card.id, result: saved.attempt });
          sessionStorage.removeItem("erudoza:attempt:" + saved.session.id);
        }
        setSessionId(saved.session.id);
        setParams({ sessionId: saved.session.id, seasonId: saved.session.seasonId, mode: saved.session.mode }, { replace: true });
      }).catch(() => {});
    } else if (progress.data?.seasonId && trackReady && !choosePurpose) {
      void start.mutateAsync(mode).then((session) => {
        if (cancelled) return;
        queryClient.setQueryData(["study-resume-format",session.id,me?.organizationId,me?.userId],{session,card:null,attempt:null,summary:null});
        loadedSession.current = session.id;
        setSessionSnapshot(session);
        setSessionId(session.id);
        setParams({ sessionId: session.id, seasonId: session.seasonId, mode: session.mode }, { replace: true });
      }).catch(() => {});
    }
    return () => { cancelled = true; };
    // Navigation owns session identity; ignore late replies after switching modes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedSessionId, progress.data?.seasonId, trackReady, mode, missionId, missionRevision, step, startRetry, choosePurpose, memoryChallenge]);

  const result = submit.data ?? (restoredAttempt?.cardId === card.data?.id ? restoredAttempt?.result : undefined);
  const accepted = !!result;
  const current = card.data;
  const quest = game.data?.quests?.find((item) => !item.completed);
  const returnDetail = mode === "Review" && current ? reviewReturnDetail(progress.data, current.citation) : null;
  const sessionMeta = game.data?.streak && game.data?.xp ? (
    <div className="study-session-meta" aria-label="Training progress">
      <span className="study-meta-chip"><AppIcon name="flame" />{game.data.streak.current}-day streak</span>
      <span className="study-meta-chip">Rank {game.data.xp.level} · {game.data.xp.levelName}</span>
      {quest && <span className="study-meta-chip">Quest: {quest.title} · +{quest.xpReward ?? 25} XP</span>}
    </div>
  ) : null;
  const dueLabel = mode === "Review" && current ? (
    <p className="study-due-label" data-testid="study-due-label">Due passage {current.sequence} of {current.total}</p>
  ) : null;
  const returnBanner = mode === "Review" && current ? (
    <div className="study-return-banner" data-testid="review-return-banner">
      <AppIcon name="review" />
      <div>
        <strong>Back for another pass</strong>
        <span>{current.citation}{returnDetail ? ` · ${returnDetail}` : " · due for review"}</span>
      </div>
    </div>
  ) : null;
  const examBanner = mode === "Simulation" ? (
    <div className="study-exam-banner" data-testid="exam-mode-banner">
      <AppIcon name="flag" />
      <div>
        <strong>Exam mode</strong>
        <p>Typed answers only — no choices, reader, recitation, or hints. Each answer is checked as you go.</p>
        <ul className="study-rules" aria-label="Exam rules">
          {academyModeRules("rehearsal", "Memory").map((rule) => <li key={rule}>{rule}</li>)}
        </ul>
      </div>
    </div>
  ) : null;

  const chooseChunks = (ids: number[]) => {
    setChunks(ids);
    setAnswer(ids.map(id => current?.tokens.find(token => token.index === id)?.display ?? "").join(" "));
  };

  const cover = (
    <div data-testid="study-page-title">
      <p className="study-eyebrow">{framing.eyebrow}</p>
      <PageHeader title={current ? academyActivityName(current.activityType) : "Study"}
        description={<span><span data-testid="current-season">{progress.isPending ? "Loading your season…" : progress.data?.seasonName || "Your study section has not been assigned yet."}</span><span className="study-blurb">{framing.blurb}</span></span>}
        action={<span className="study-cover-actions"><Badge data-testid="academy-session-kicker">{academySessionKicker(mode)}</Badge><LinkButton variant="ghost" to={entryHref}>Back to training</LinkButton></span>}>
        {sessionSnapshot?.difficulty && <p>Session difficulty: {sessionSnapshot.difficulty}</p>}
        <p>Memory activities are study aids. Verse Builder practices sequence, not exact-word recall.</p>
        {sessionSnapshot?.memoryChallenge && <p>{sessionSnapshot.memoryChallenge === 'Warmup' ? 'Varied-gap warmup · supported wording evidence up to 70, within your difficulty ceiling.' : 'Advanced mastery challenge · recall from memory with fewer clues.'}</p>}
        {progress.isSuccess && !trackReady && <p data-testid="academy-track-unavailable">{academyUnavailableCopy(track, progress.data)}</p>}
      </PageHeader>
    </div>
  );

  if ([start.error, card.error, submit.error, resume.error, complete.error].some(error => error instanceof ApiError && error.status === 409)) {
    return <div className="er-study-stage space-y-4">{cover}<Notice tone="info">Your assignment or session changed. Return to Training HQ to continue with your current plan. Accepted answers remain saved.</Notice><LinkButton to={`/student?seasonId=${encodeURIComponent(sessionSnapshot?.seasonId ?? selectedSeasonId ?? progress.data?.seasonId ?? "")}`} onClick={() => {
      for (const key of ["progress", "training-today", "training-honors", "training-journey"]) void queryClient.invalidateQueries({ queryKey: [key] });
    }}>Return to Training HQ</LinkButton></div>;
  }

  if (!requestedSessionId && progress.isSuccess && !trackReady) {
    return (
      <div className="er-study-stage space-y-4">
        {cover}
        <LinkButton variant="secondary" to={`/student${selectedSeasonId ? `?seasonId=${encodeURIComponent(selectedSeasonId)}` : ""}`}>Back to training</LinkButton>
      </div>
    );
  }

  if (choosePurpose && trackReady) return <div className="er-study-stage space-y-4">{cover}<Panel>
    <h2>Choose your Memory practice</h2><p>Warmups use varied gaps and phrase building. Advanced mastery challenges require coach-set Advanced difficulty.</p>
    <div className="student-study-actions">
      <Button onClick={()=>setPurposeChoice({seasonId:progress.data!.seasonId,purpose:'Warmup'})}>Start Memory warmup</Button>
      {progress.data?.assignments.some(a=>a.difficulty==='Advanced') && <Button variant="secondary" onClick={()=>setPurposeChoice({seasonId:progress.data!.seasonId,purpose:'Advanced'})}>Start Advanced mastery challenge</Button>}
    </div>
  </Panel></div>;

  return (
    <div className="er-study-stage space-y-4">
      {cover}
      {dueLabel}
      {returnBanner}
      {examBanner}
      {sessionMeta}
      {resume.isError && <Notice tone="danger">Your saved session is unavailable. <Button variant="secondary" onClick={() => setStartRetry((value) => value + 1)}>Retry saved session</Button><Button variant="secondary" onClick={() => { loadedSession.current = null; resume.reset(); setParams({ mode, ...(selectedSeasonId ? { seasonId: selectedSeasonId } : {}) }); }}>Start a new session</Button></Notice>}
      {(progress.isError || start.isError || card.isError) && <Notice tone="danger">This study session could not load. <Button variant="secondary" onClick={() => { if (progress.isError) void progress.refetch(); else if (start.isError) setStartRetry((value) => value + 1); else void card.refetch(); }}>Try again</Button></Notice>}
      <Panel className="student-challenge" data-testid="challenge-card">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm">
            <span data-testid="academy-activity-name">
              {current ? academyActivityName(current.activityType) : "Loading"}
            </span>
            {" · "}
            {current ? current.citation : "Loading"}
          </p>
          <div className="flex items-center gap-2">
            <p data-testid="card-progress">{current ? `${current.sequence} / ${current.total}` : "…"}</p>
          </div>
        </div>
        {current && <progress className="training-session-progress" value={current.sequence} max={current.total || 1} aria-label="Study session progress" />}
        {current?.activityType !== "MissingWords" && <h2 className="er-scripture mt-6 text-2xl leading-relaxed" data-testid="challenge-prompt">
          {current?.prompt ?? "Loading your next practice question…"}
        </h2>}
        {current ? (
          current.activityType === 'MissingWords' ? <MissingWordsInput
            key={current.id} tokens={current.tokens} values={result?.missingWordAnswers ? Object.fromEntries(result.missingWordAnswers.map(slot => [slot.index,slot.text])) : slotValues} onChange={setSlotValues}
            disabled={accepted || submit.isPending || submit.isError || !!pendingAttempt.current}
            results={result?.missingWordResults}
          /> : <ChallengeInput
            card={current}
            answer={answer}
            chunks={chunks}
            onAnswer={setAnswer}
            onChunks={chooseChunks}
            locked={accepted || submit.isPending || submit.isError || !!pendingAttempt.current}
            allowChoices={mode !== "Simulation"}
          />
        ) : null}
        {pendingAttempt.current && !accepted && <Notice className="mt-4" data-testid="pending-answer"><p className="font-medium">Saved answer awaiting confirmation</p><p className="mt-2 whitespace-pre-wrap">{pendingAttempt.current.submittedAnswer ?? pendingAttempt.current.missingWordAnswers?.map((slot, index) => `Blank ${index + 1}: ${slot.text || '(empty)'}`).join('\n')}</p><p className="mt-2 text-sm">Retry sends this exact saved answer.</p></Notice>}
        {current?.debugAnswer ? (
          <p className="sr-only" data-testid="debug-answer">
            {current.debugAnswer}
          </p>
        ) : null}
      {result ? (
        <div className="student-feedback" data-testid="challenge-feedback" role="status" aria-live="polite">
          {result.isCorrect ? <Badge tone="success">Correct</Badge> : <Badge tone="warning">Needs another pass</Badge>}
          <p className="mt-3 text-lg font-semibold text-[var(--er-ink-navy)]">{result.isCorrect ? "Well remembered" : "Read it once more"}</p>
          <p className="mt-2 text-sm" data-testid="feedback-citation">
            {result.citation}
          </p>
          <p className="er-scripture mt-2" data-testid="feedback-source">
            {result.sourceText}
          </p>
          <p className="mt-3 text-sm text-[var(--er-success-ink)]" data-testid="mastery-impact">
            Mastery {result.masteryLevel} · {result.skillLabel ?? "Exact wording"} {result.skillScore ?? result.exactWordingScore} / 100
          </p>
          <p className="mt-2 text-sm" data-testid="assistance-note">
            {readerOpened
              ? "Assisted attempt — the passage reader was opened, so this does not establish unaided recall."
              : "No reader assistance used on this attempt."}
          </p>
        </div>
      ) : null}
        <div className="student-study-actions">
          <Button
            data-testid="submit-answer"
            type="button"
            variant={accepted ? "secondary" : "primary"}
            size={accepted ? "compact" : "default"}
            onClick={() => submit.mutate()}
            disabled={!current || submit.isPending || accepted || (current.activityType !== 'MissingWords' && !answer.trim())}
          >
            {submit.isPending ? "Checking…" : accepted ? "Answer checked" : pendingAttempt.current ? "Retry saved answer" : "Check answer"}
          </Button>
          {accepted && current && current.sequence < current.total && <Button
            data-testid="next-card"
            type="button"
            variant={accepted ? "primary" : "secondary"}
            onClick={() => {
              void card.refetch();
            }}
            disabled={!accepted || complete.isPending || card.isFetching}
          >
            {card.isFetching ? "Loading…" : card.isError ? "Retry next card" : "Next card"}
          </Button>}
          <Button
            data-testid="complete-session"
            type="button"
            variant={accepted && current?.sequence === current?.total ? "primary" : "ghost"}
            onClick={() => complete.mutate()}
            disabled={!accepted || complete.isPending}
          >
            {complete.isPending ? "Finishing…" : "Finish session"}
          </Button>
        </div>
        {(submit.isError || complete.isError) && <p role="alert">{submit.isError ? "Your answer could not be saved. Please try again." : "The session could not be finished. Please try again."}</p>}
      </Panel>
      {current && mode !== "Simulation" && <section aria-label="Learning aids" className="study-aids">
        <Panel><details key={current.id}><summary>Optional full-verse recitation</summary><p>Recite aloud or type from memory, then compare with the passage reader. This private practice is not scored and does not earn mastery evidence.</p><label>Your private recitation practice<Textarea rows={4} className="mt-2 w-full" /></label></details></Panel>
        {sessionSnapshot && <ScriptureReader
          key={sessionSnapshot.seasonId}
          seasonId={sessionSnapshot.seasonId}
          citation={current.citation}
          onRead={() => {
            setReaderOpened(true);
            if (!accepted && !submit.isPending && pendingAttempt.current?.challengeCardId !== current.id)
              sessionStorage.setItem(`erudoza:attempt:read:${sessionId}:${current.id}`, "true");
          }}
        />}
      </section>}
    </div>
  );
}

function ChallengeInput({
  card,
  answer,
  chunks,
  onAnswer,
  onChunks,
  locked,
  allowChoices,
}: {
  card: ChallengeCard;
  answer: string;
  chunks: number[];
  onAnswer: (value: string) => void;
  onChunks: (ids: number[]) => void;
  locked: boolean;
  allowChoices: boolean;
}) {
  if (card.activityType === "VerseBuilder") {
    return <VerseBuilderInput tokens={card.tokens} selected={chunks} onChange={onChunks} disabled={locked}/>;
  }

  if (card.activityType === "TrueFalse") {
    return (
      <div className="mt-6 flex flex-wrap gap-3" aria-label="True or false">
        {["True", "False"].map((choice) => (
          <Button
            key={choice}
            type="button"
            data-testid={`true-false-${choice.toLowerCase()}`}
            variant={answer === choice ? "primary" : "secondary"}
            aria-pressed={answer === choice}
            onClick={() => onAnswer(choice)}
            disabled={locked}
          >
            {choice}
          </Button>
        ))}
      </div>
    );
  }

  if (allowChoices && card.choices && card.choices.length > 0) {
    return (
      <fieldset className="mt-6">
        <legend className="text-sm font-medium">Choose the reference</legend>
        <div className="mt-3 space-y-2">
          {card.choices.map((choice) => (
            <label key={choice} className="student-answer-choice">
              <Input type="radio" name="reference" value={choice} checked={answer === choice} onChange={() => onAnswer(choice)} disabled={locked} />
              <span>{choice}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <label className="mt-6 block text-sm font-medium">
      {card.activityType === "WhatComesNext"
        ? "Type the next verse"
        : card.activityType === "ReferenceMatch"
          ? "Type the reference"
          : "Type your answer"}
      {card.activityType === "ReferenceMatch" ? <Input
        data-testid="missing-words-answer"
        className="mt-2 w-full"
        value={answer}
        placeholder="Book chapter:verse"
        autoComplete="off"
        onChange={(event) => onAnswer(event.target.value)}
        disabled={locked}
      /> : <Textarea
        data-testid="missing-words-answer"
        className="mt-2 w-full"
        rows={card.activityType === "WhatComesNext" ? 4 : 3}
        value={answer}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onAnswer(event.target.value)}
        disabled={locked}
      />}
    </label>
  );
}

function readPendingAttempt(sessionId: string, card: ChallengeCard): Parameters<typeof api.submitAttempt>[1] | null {
  try {
    const stored = sessionStorage.getItem("erudoza:attempt:" + sessionId);
    if (!stored) return null;
    const value = JSON.parse(stored) as Parameters<typeof api.submitAttempt>[1];
    if (!value || value.challengeCardId !== card.id || typeof value.clientSubmissionId !== 'string' ||
      !Number.isSafeInteger(value.responseTimeMs) || value.responseTimeMs < 0 || typeof value.hintsUsed !== 'boolean') return null;
    if (Object.hasOwn(value, 'submittedAnswer')) return typeof value.submittedAnswer === 'string' && !Object.hasOwn(value, 'missingWordAnswers') ? value : null;
    if (card.activityType !== 'MissingWords' || !Array.isArray(value.missingWordAnswers)) return null;
    const hidden = card.tokens.filter(token => token.hidden);
    const slots = value.missingWordAnswers;
    return slots.length === hidden.length && new Set(slots.map(slot => slot?.index)).size === hidden.length &&
      slots.every(slot => slot && Number.isInteger(slot.index) && typeof slot.text === 'string' && hidden.some(token => token.index === slot.index)) ? value : null;
  } catch { return null; }
}