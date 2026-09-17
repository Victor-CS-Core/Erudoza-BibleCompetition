import { useEffect, useId, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge, Button, LoadingState, Notice } from "../../components/ui";
import "../../styles/student-dashboard.css";

const skillLabels: Record<string, string> = { exactWording: "Wording", reference: "Reference", sequence: "Sequence", recognition: "Recognition", factualRecall: "Recall" };

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Coach read-only drill-down into one student's completed study session. */
export function StudentSessionRecapDialog({ orgId, studentId, studentName, sessionId, onClose }: {
  orgId: string; studentId: string; studentName: string; sessionId: string; onClose(): void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const recap = useQuery({
    queryKey: ["student-session-recap", orgId, studentId, sessionId],
    queryFn: () => api.studentSessionRecap(orgId, studentId, sessionId),
  });
  useEffect(() => {
    const element = dialog.current!;
    const trigger = document.activeElement as HTMLElement | null;
    element.showModal();
    element.querySelector<HTMLElement>("button")?.focus();
    return () => { element.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  const data = recap.data;
  const personalBest = data?.personalBest ?? null;
  const weeklyGoalComplete = !!data?.weeklyGoalComplete;
  return <dialog
    ref={dialog}
    className="ds-dialog ds-student-dashboard"
    aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === dialog.current) onClose(); }}
    data-testid="student-session-recap-dialog"
  >
    <header className="ds-student-dashboard-header">
      <div className="ds-student-dashboard-identity">
        <h2 id={titleId}>{studentName}’s session recap</h2>
        <p>Completed {formatDateTime(data?.completedAtUtc ?? null)}</p>
      </div>
      <Button variant="ghost" aria-label="Close session recap" onClick={onClose}>Close</Button>
    </header>
    <div className="ds-student-dashboard-body">
      {recap.isPending && <LoadingState label="Loading session recap…" />}
      {recap.isError && <Notice tone="danger">This recap could not load. <Button variant="secondary" size="compact" onClick={() => void recap.refetch()}>Try again</Button></Notice>}
      {data && <>
        <dl className="ds-student-dashboard-metrics">
          <div><dt>Mode</dt><dd>{data.mode}</dd></div>
          <div><dt>Correct</dt><dd>{data.correct} / {data.attempted}</dd></div>
          <div><dt>Full target</dt><dd>{data.fullTargetReached ? "Reached" : `${data.targetCardCount} cards`}</dd></div>
        </dl>
        {personalBest && (personalBest.accuracyBeaten || personalBest.correctBeaten) && <Notice tone="success">
          Personal best: {personalBest.accuracyBeaten && personalBest.correctBeaten ? "best accuracy and most correct answers" : personalBest.accuracyBeaten ? "best accuracy" : "most correct answers"} in one session.
        </Notice>}
        {weeklyGoalComplete && <Notice tone="success">This session completed the student’s weekly practice goal.</Notice>}
        {!!data.earnedBadges.length && <>
          <h3>Milestones recorded</h3>
          <ul className="ds-student-dashboard-list">{data.earnedBadges.map(badge =>
            <li key={badge.key}><div><strong>{badge.title}</strong><small>{badge.scopeLabel}</small></div><Badge tone="success">Recorded</Badge></li>)}
          </ul>
        </>}
        {data.version === "pbe-daily-v2" && !!data.results?.length && <>
          <h3>Saved answers</h3>
          <ul className="ds-student-dashboard-list">{data.results.map((result, index) =>
            <li key={result.attemptId}><div><strong>Answer {index + 1}</strong></div><span>{result.earnedPoints} / {result.availablePoints} points</span></li>)}
          </ul>
        </>}
        {data.version !== "pbe-daily-v2" && data.version !== "legacy-counts" && !!data.passageChanges.length && <>
          <h3>Passage skill changes</h3>
          <ul className="ds-student-dashboard-list">{data.passageChanges.map(passage => {
            const deltas = (Object.entries(passage.delta) as [string, number][]).filter(([, value]) => value !== 0);
            return <li key={passage.knowledgeUnitId}><div><strong>{passage.title}</strong><small>{passage.events.length} accepted answer{passage.events.length === 1 ? "" : "s"}</small></div>
              <span>{deltas.length ? deltas.map(([skill, value]) => `${skillLabels[skill] ?? skill} ${value > 0 ? "+" : ""}${value}`).join(" · ") : "No skill change"}</span></li>;
          })}</ul>
        </>}
      </>}
    </div>
  </dialog>;
}
