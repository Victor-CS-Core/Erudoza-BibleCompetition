import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import type { ChallengeCard } from "../../api/types";
import { PaperSurface } from "../../components/material/PaperSurface";
import { Stamp } from "../../components/material/Stamp";
import { StudyCard } from "../../components/material/StudyCard";
import {
  academySessionKicker,
  academyTrackForMode,
  academyUnavailableCopy,
  canStartAcademyTrack,
} from "./academyTracks";

export function StudyPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requested = params.get("mode");
  const mode = requested === "Simulation" || requested === "Review" ? requested : "Practice";
  const track = academyTrackForMode(mode);
  const queryClient = useQueryClient();
  const progress = useQuery({ queryKey: ["progress"], queryFn: () => api.progress() });
  const trackReady = progress.isSuccess && canStartAcademyTrack(track, progress.data);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [chunks, setChunks] = useState<string[]>([]);
  const startedAt = useRef(Date.now());

  const start = useMutation({
    mutationFn: (sessionMode: "Practice" | "Review" | "Simulation") =>
      api.startSession(progress.data!.seasonId, sessionMode),
  });

  const card = useQuery({
    queryKey: ["card", sessionId],
    queryFn: () => api.nextCard(sessionId!),
    enabled: !!sessionId,
    retry: false,
  });

  useEffect(() => {
    if (!card.data) {
      return;
    }
    startedAt.current = Date.now();
    if (card.data.activityType === "VerseBuilder") {
      const nextChunks = card.data.tokens.map((token) => token.display);
      setChunks(nextChunks);
      setAnswer(nextChunks.join(" "));
    } else {
      setChunks([]);
      setAnswer("");
    }
    // Reset from the newly drawn card identity only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.data?.id]);

  const submit = useMutation({
    mutationFn: () =>
      api.submitAttempt(sessionId!, {
        clientSubmissionId: crypto.randomUUID(),
        challengeCardId: card.data!.id,
        submittedAnswer: answer,
        responseTimeMs: Date.now() - startedAt.current,
        hintsUsed: false,
      }),
  });

  const complete = useMutation({
    mutationFn: () => api.completeSession(sessionId!),
    onSuccess: (summary) => {
      void queryClient.invalidateQueries({ queryKey: ["progress"] });
      navigate("/student/progress", { state: summary });
    },
  });

  useEffect(() => {
    let cancelled = false;
    setSessionId(null);
    setAnswer("");
    setChunks([]);
    if (!progress.data?.seasonId || !trackReady) {
      return;
    }
    void start.mutateAsync(mode).then((session) => {
      if (cancelled) {
        return;
      }
      setSessionId(session.id);
      void queryClient.invalidateQueries({ queryKey: ["card"] });
    });
    return () => {
      cancelled = true;
    };
    // Start once per honest mode after progress is known; ignore stale starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.data?.seasonId, trackReady, mode]);

  const result = submit.data;
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

  if (progress.isSuccess && !canStartAcademyTrack(track, progress.data)) {
    return (
      <div className="space-y-4">
        <PaperSurface>
          <p className="text-sm uppercase tracking-wide text-[var(--er-muted-ink)]">
            <span data-testid="academy-session-kicker">{academySessionKicker(mode)}</span>
          </p>
          <p className="mt-4 text-[var(--er-graphite)]" data-testid="academy-track-unavailable">
            {academyUnavailableCopy(track)}
          </p>
        </PaperSurface>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StudyCard>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm uppercase tracking-wide text-[var(--er-muted-ink)]">
            <span data-testid="academy-session-kicker">{academySessionKicker(mode)}</span>
            {" · "}
            {current?.activityType ?? "MissingWords"} · {current?.citation ?? "Loading"}
          </p>
          <div className="flex items-center gap-2">
            <p data-testid="card-progress">{current ? `${current.sequence} / ${current.total}` : "…"}</p>
          </div>
        </div>
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
            locked={submit.isSuccess}
            allowChoices={mode !== "Simulation"}
          />
        ) : null}
        {current?.debugAnswer ? (
          <p className="sr-only" data-testid="debug-answer">
            {current.debugAnswer}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            data-testid="submit-answer"
            type="button"
            className="rounded-[var(--er-radius-control)] bg-[var(--er-ink-navy)] px-5 text-[var(--er-card)]"
            onClick={() => submit.mutate()}
            disabled={!current || submit.isPending}
          >
            Submit
          </button>
          <button
            data-testid="next-card"
            type="button"
            className="rounded-[var(--er-radius-control)] border px-5"
            onClick={() => {
              submit.reset();
              void queryClient.invalidateQueries({ queryKey: ["card", sessionId] });
            }}
            disabled={!submit.isSuccess}
          >
            Next card
          </button>
          <button
            data-testid="complete-session"
            type="button"
            className="rounded-[var(--er-radius-control)] border px-5"
            onClick={() => complete.mutate()}
            disabled={!submit.isSuccess}
          >
            Finish session
          </button>
        </div>
      </StudyCard>
      {result ? (
        <PaperSurface data-testid="challenge-feedback">
          {result.isCorrect ? <Stamp label="Exact match" tone="mastered" /> : <Stamp label="Needs another pass" tone="review" />}
          <p className="mt-3 font-medium">{result.isCorrect ? "Exact match." : "This one needs another pass."}</p>
          <p className="mt-2 text-sm" data-testid="feedback-citation">
            {result.citation}
          </p>
          <p className="er-scripture mt-2" data-testid="feedback-source">
            {result.sourceText}
          </p>
          <p className="mt-3 text-sm text-[var(--er-success-ink)]" data-testid="mastery-impact">
            Mastery {result.masteryLevel} · exact wording {result.exactWordingScore}
          </p>
        </PaperSurface>
      ) : null}
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
        <p className="text-sm font-medium">Use the buttons to place each phrase. Drag is not required.</p>
        {chunks.map((chunk, index) => (
          <div key={`${chunk}-${index}`} className="flex items-center gap-2">
            <p className="er-scripture flex-1 rounded-[var(--er-radius-control)] border bg-white px-3 py-2">{chunk}</p>
            <button type="button" className="rounded-[var(--er-radius-control)] border px-3" onClick={() => onMove(index, -1)} disabled={locked || index === 0} aria-label={`Move phrase ${index + 1} up`}>
              Up
            </button>
            <button type="button" className="rounded-[var(--er-radius-control)] border px-3" onClick={() => onMove(index, 1)} disabled={locked || index === chunks.length - 1} aria-label={`Move phrase ${index + 1} down`}>
              Down
            </button>
          </div>
        ))}
      </div>
    );
  }

  if (card.activityType === "TrueFalse") {
    return (
      <div className="mt-6 flex flex-wrap gap-3" aria-label="True or false">
        {["True", "False"].map((choice) => (
          <button
            key={choice}
            type="button"
            data-testid={`true-false-${choice.toLowerCase()}`}
            className={`rounded-[var(--er-radius-control)] border px-5 ${answer === choice ? "bg-[var(--er-ink-navy)] text-[var(--er-card)]" : ""}`}
            onClick={() => onAnswer(choice)}
            disabled={locked}
          >
            {choice}
          </button>
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
            <label key={choice} className="flex items-center gap-3">
              <input type="radio" name="reference" value={choice} checked={answer === choice} onChange={() => onAnswer(choice)} disabled={locked} />
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
          : card.activityType === "ShortAnswer"
            ? "Type the short answer"
            : "Type the missing phrase"}
      <input
        data-testid="missing-words-answer"
        className="mt-2 w-full rounded-[var(--er-radius-control)] border border-[var(--er-border)] bg-white px-3"
        value={answer}
        onChange={(event) => onAnswer(event.target.value)}
        disabled={!card || locked}
      />
    </label>
  );
}
