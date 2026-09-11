import { useAuth } from "../../auth/AuthContext";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type { ChallengeCard, AttemptResult, Session } from "../../api/types";
import type { StartTrainingContext } from "../../api/trainingTypes";
import { Badge, Button, Input, LinkButton, Notice, PageHeader, Panel, Textarea } from "../../components/ui";
import {
  academyActivityName,
  academySessionKicker,
  academyTrackForMode,
  academyUnavailableCopy,
  canStartAcademyTrack,
} from "./academyTracks";
import "./student.css";
import { ScriptureReader } from "./ScriptureReader";

export function StudyPage() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedSessionId = params.get("sessionId");
  const requested = params.get("mode");
  const mode = requested === "Simulation" || requested === "Review" ? requested : "Practice";
  const track = academyTrackForMode(mode);
  const queryClient = useQueryClient();
  const selectedSeasonId = params.get("seasonId") || undefined;
  const missionId = params.get("missionId") || undefined;
  const missionRevision = params.get("missionRevision");
  const requestedStep = params.get("step");
  const step = requestedStep === "Review" || requestedStep === "Practice" ? requestedStep : undefined;
  const missionReview = step === "Review" && mode === "Review" && !!missionId;
  const startIntent = useRef<{ key: string; context: StartTrainingContext } | null>(null);
  const progress = useQuery({ queryKey: ["progress", selectedSeasonId, me?.organizationId, me?.userId], queryFn: () => api.progress(selectedSeasonId) });
  const trackReady = progress.isSuccess && (canStartAcademyTrack(track, progress.data) || (missionReview && progress.data.seasonStatus === "Active"));
  const [sessionId, setSessionId] = useState<string | null>(null);
  const loadedSession = useRef<string | null>(null);
  const [sessionSnapshot, setSessionSnapshot] = useState<Session | null>(null);
  const [restoredAttempt, setRestoredAttempt] = useState<{ cardId: string; result: AttemptResult } | null>(null);
  const resume = useMutation({ mutationFn: (id: string) => api.resumeSession(id) });
  const [startRetry, setStartRetry] = useState(0);
  const [answer, setAnswer] = useState("");
  const [chunks, setChunks] = useState<string[]>([]);
  const startedAt = useRef(Date.now());
  const pendingAttempt = useRef<Parameters<typeof api.submitAttempt>[1] | null>(null);

  const start = useMutation({
    mutationFn: (sessionMode: "Practice" | "Review" | "Simulation") => {
      const key = JSON.stringify([me?.organizationId, me?.userId, progress.data!.seasonId, sessionMode, missionId, missionRevision, step]);
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
      return api.startSession(progress.data!.seasonId, sessionMode, context);
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
    pendingAttempt.current = readPendingAttempt(sessionId!, card.data.id);
    submit.reset();
    if (card.data.activityType === "VerseBuilder") {
      const nextChunks = card.data.tokens.map((token) => token.display);
      setChunks(nextChunks);
      setAnswer(nextChunks.join(" "));
    } else {
      setChunks([]);
      setAnswer(pendingAttempt.current?.submittedAnswer ?? "");
    }
    // Reset from the newly drawn card identity only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.data?.id]);

  const submit = useMutation({
    mutationFn: () => {
      pendingAttempt.current ??= {
        clientSubmissionId: crypto.randomUUID(),
        challengeCardId: card.data!.id,
        submittedAnswer: answer,
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
    setChunks([]);
    submit.reset();
    complete.reset();
    if (requestedSessionId) {
      startIntent.current = null;
      void resume.mutateAsync(requestedSessionId).then((saved) => {
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
    } else if (progress.data?.seasonId && trackReady) {
      void start.mutateAsync(mode).then((session) => {
        if (cancelled) return;
        loadedSession.current = session.id;
        setSessionSnapshot(session);
        setSessionId(session.id);
        setParams({ sessionId: session.id, seasonId: session.seasonId, mode: session.mode }, { replace: true });
      }).catch(() => {});
    }
    return () => { cancelled = true; };
    // Navigation owns session identity; ignore late replies after switching modes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedSessionId, progress.data?.seasonId, trackReady, mode, missionId, missionRevision, step, startRetry]);

  const result = submit.data ?? (restoredAttempt?.cardId === card.data?.id ? restoredAttempt?.result : undefined);
  const accepted = !!result;
  const current = card.data;

  const moveChunk = (index: number, direction: -1 | 1) => {
    const next = [...chunks];
    const swap = index + direction;
    if (swap < 0 || swap >= next.length) {
      return;
    }
    [next[index], next[swap]] = [next[swap], next[index]];
    setChunks(next);
    setAnswer(next.join(" "));
  };

  const cover = (
    <div data-testid="study-page-title"><PageHeader title={current ? academyActivityName(current.activityType) : "Study"}
      description={<span data-testid="current-season">{progress.isPending ? "Loading your season…" : progress.data?.seasonName || "Your study section has not been assigned yet."}</span>}
      action={<Badge data-testid="academy-session-kicker">{academySessionKicker(mode)}</Badge>}>
      {sessionSnapshot?.difficulty && <p>Session difficulty: {sessionSnapshot.difficulty}</p>}
      {progress.isSuccess && !trackReady && <p data-testid="academy-track-unavailable">{academyUnavailableCopy(track, progress.data)}</p>}
    </PageHeader></div>
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

  return (
    <div className="er-study-stage space-y-4">
      {cover}
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
        <p className="er-scripture mt-6 text-2xl leading-relaxed" data-testid="challenge-prompt">
          {current?.prompt ?? "Drawing today's challenge card…"}
        </p>
        {current ? (
          <ChallengeInput
            card={current}
            answer={answer}
            chunks={chunks}
            onAnswer={setAnswer}
            onMove={moveChunk}
            locked={accepted || submit.isPending || submit.isError || !!pendingAttempt.current}
            allowChoices={mode !== "Simulation"}
          />
        ) : null}
        {pendingAttempt.current && !accepted && <Notice className="mt-4" data-testid="pending-answer"><p className="font-medium">Saved answer awaiting confirmation</p><p className="mt-2 whitespace-pre-wrap">{pendingAttempt.current.submittedAnswer}</p><p className="mt-2 text-sm">Retry sends this exact saved answer.</p></Notice>}
        {current?.debugAnswer ? (
          <p className="sr-only" data-testid="debug-answer">
            {current.debugAnswer}
          </p>
        ) : null}
      {result ? (
        <div className="student-feedback" data-testid="challenge-feedback" role="status" aria-live="polite">
          {result.isCorrect ? <Badge tone="success">Correct</Badge> : <Badge tone="warning">Needs another pass</Badge>}
          <h2 className="mt-3">{result.isCorrect ? "Well remembered" : "Read it once more"}</h2>
          <p className="mt-2 text-sm" data-testid="feedback-citation">
            {result.citation}
          </p>
          <p className="er-scripture mt-2" data-testid="feedback-source">
            {result.sourceText}
          </p>
          <p className="mt-3 text-sm text-[var(--er-success-ink)]" data-testid="mastery-impact">
            Mastery {result.masteryLevel} · exact wording {result.exactWordingScore} / 100
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
            disabled={!current || submit.isPending || accepted || !answer.trim()}
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
      {current && sessionSnapshot && mode !== "Simulation" && <ScriptureReader
        key={sessionSnapshot.seasonId}
        seasonId={sessionSnapshot.seasonId}
        citation={current.citation}
        onRead={() => {
          if (!accepted && !submit.isPending && pendingAttempt.current?.challengeCardId !== current.id)
            sessionStorage.setItem(`erudoza:attempt:read:${sessionId}:${current.id}`, "true");
        }}
      />}
    </div>
  );
}

function ChallengeInput({
  card,
  answer,
  chunks,
  onAnswer,
  onMove,
  locked,
  allowChoices,
}: {
  card: ChallengeCard;
  answer: string;
  chunks: string[];
  onAnswer: (value: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  locked: boolean;
  allowChoices: boolean;
}) {
  if (card.activityType === "VerseBuilder") {
    return (
      <div className="mt-6 space-y-2" aria-label="Verse builder">
        <p className="text-sm font-medium">Put the phrases in order using Up and Down.</p>
        {chunks.map((chunk, index) => (
          <div key={`${chunk}-${index}`} className="student-builder-row">
            <p className="er-scripture student-builder-phrase">{chunk}</p>
            <Button type="button" size="compact" variant="secondary" onClick={() => onMove(index, -1)} disabled={locked || index === 0} aria-label={`Move phrase ${index + 1} up`}>
              Up
            </Button>
            <Button type="button" size="compact" variant="secondary" onClick={() => onMove(index, 1)} disabled={locked || index === chunks.length - 1} aria-label={`Move phrase ${index + 1} down`}>
              Down
            </Button>
          </div>
        ))}
      </div>
    );
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
          : card.activityType === "MissingWords"
            ? "Type the missing phrase"
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

function readPendingAttempt(sessionId: string, cardId: string): Parameters<typeof api.submitAttempt>[1] | null {
  try {
    const stored = sessionStorage.getItem("erudoza:attempt:" + sessionId);
    if (!stored) return null;
    const value = JSON.parse(stored) as Parameters<typeof api.submitAttempt>[1];
    return value.challengeCardId === cardId && typeof value.clientSubmissionId === "string" && typeof value.submittedAnswer === "string" ? value : null;
  } catch { return null; }
}
