import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { PaperSurface } from "../../components/material/PaperSurface";
import { Stamp } from "../../components/material/Stamp";
import { StudyCard } from "../../components/material/StudyCard";

export function StudyPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const progress = useQuery({ queryKey: ["progress"], queryFn: () => api.progress() });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const started = useRef(false);
  const startedAt = useRef(Date.now());

  const start = useMutation({
    mutationFn: () => api.startSession(progress.data!.seasonId),
    onSuccess: async (session) => {
      setSessionId(session.id);
      await queryClient.invalidateQueries({ queryKey: ["card"] });
    },
  });

  const card = useQuery({
    queryKey: ["card", sessionId],
    queryFn: () => api.nextCard(sessionId!),
    enabled: !!sessionId,
    retry: false,
  });

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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["progress"] });
      navigate("/student/progress");
    },
  });

  useEffect(() => {
    if (progress.data?.seasonId && !started.current) {
      started.current = true;
      start.mutate();
    }
    // Intentionally start once when the active season is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.data?.seasonId]);

  const result = submit.data;

  return (
    <div className="space-y-4">
      <StudyCard>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm uppercase tracking-wide text-[var(--er-muted-ink)]">
            {card.data?.activityType ?? "MissingWords"} · {card.data?.citation ?? "Loading"}
          </p>
          <p data-testid="card-progress">
            {card.data ? `${card.data.sequence} / ${card.data.total}` : "…"}
          </p>
        </div>
        <p className="er-scripture mt-6 text-2xl leading-relaxed" data-testid="challenge-prompt">
          {card.data?.prompt ?? "Drawing today's challenge card…"}
        </p>
        <label className="mt-6 block text-sm font-medium">
          Type the missing phrase
          <input
            data-testid="missing-words-answer"
            className="mt-2 w-full rounded-[var(--er-radius-control)] border border-[var(--er-border)] bg-white px-3"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            disabled={!card.data || submit.isSuccess}
          />
        </label>
        {card.data?.debugAnswer ? (
          <p className="sr-only" data-testid="debug-answer">
            {card.data.debugAnswer}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            data-testid="submit-answer"
            type="button"
            className="rounded-[var(--er-radius-control)] bg-[var(--er-ink-navy)] px-5 text-[var(--er-card)]"
            onClick={() => submit.mutate()}
            disabled={!card.data || submit.isPending}
          >
            Submit
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
          {result.isCorrect ? (
            <Stamp label="Exact match" tone="mastered" />
          ) : (
            <Stamp label="Needs another pass" tone="review" />
          )}
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
