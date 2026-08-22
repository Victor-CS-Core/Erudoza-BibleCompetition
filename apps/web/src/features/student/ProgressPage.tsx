import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "react-router-dom";
import { api } from "../../api/client";
import type { SessionSummary } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { PaperSurface } from "../../components/material/PaperSurface";
import { Stamp } from "../../components/material/Stamp";

export function ProgressPage() {
  const { me } = useAuth();
  const { seasonId, studentId } = useParams();
  const coachView = !!seasonId && !!studentId;
  const progress = useQuery({
    queryKey: ["progress", seasonId, studentId],
    queryFn: () =>
      coachView ? api.studentProgress(me!.organizationId, seasonId!, studentId!) : api.progress(),
    enabled: !coachView || !!me,
  });
  const data = progress.data;
  const summary = useLocation().state as SessionSummary | null;
  const recent = data?.recentAttempts ?? [];

  return (
    <PaperSurface>
      <h1 className="text-2xl font-semibold">{coachView ? "Student progress" : "Progress"}</h1>
      <p className="mt-2 text-[var(--er-muted-ink)]" data-testid="progress-student">
        {data?.studentDisplayName ? `${data.studentDisplayName} · ` : null}
        {data?.seasonName}
      </p>
      {summary ? (
        <p className="mt-3 text-sm" data-testid="session-summary">
          Last {summary.mode.toLowerCase()} session: {summary.correct} / {summary.attempted} exact
        </p>
      ) : null}
      <dl className="mt-5 grid gap-3 md:grid-cols-3">
        <div>
          <dt className="text-sm text-[var(--er-muted-ink)]">Attempts</dt>
          <dd data-testid="progress-attempts" className="text-2xl font-semibold">
            {data?.attemptCount ?? 0}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--er-muted-ink)]">Due reviews</dt>
          <dd data-testid="progress-reviews" className="text-2xl font-semibold">
            {data?.reviewDueCount ?? 0}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--er-muted-ink)]">Strong passages</dt>
          <dd className="text-2xl font-semibold">{data?.masteredCount ?? 0}</dd>
        </div>
      </dl>
      <ul className="mt-6 space-y-3" data-testid="progress-mastery">
        {data?.mastery.map((item) => (
          <li key={item.knowledgeUnitId} className="flex items-center justify-between gap-3 border-t border-[var(--er-border)] pt-3">
            <div>
              <p className="font-medium">{item.title}</p>
              <p className="text-sm text-[var(--er-muted-ink)]">Exact wording {item.exactWordingScore}</p>
            </div>
            <Stamp label={item.level} tone={item.level === "Review" ? "review" : "mastered"} />
          </li>
        ))}
      </ul>
      <div className="mt-8">
        <h2 className="text-xl font-semibold">Recent attempts</h2>
        <ul className="mt-3 space-y-3" data-testid="recent-attempts">
          {recent.length ? (
            recent.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 border-t border-[var(--er-border)] pt-3">
                <div>
                  <p className="font-medium">
                    {item.title} · {item.activityType}
                  </p>
                  <p className="mt-1 text-sm text-[var(--er-graphite)]">{item.submittedAnswer || "—"}</p>
                </div>
                <Stamp label={item.isCorrect ? "Exact" : "Miss"} tone={item.isCorrect ? "mastered" : "due"} />
              </li>
            ))
          ) : (
            <li className="text-sm text-[var(--er-graphite)]">No attempts yet.</li>
          )}
        </ul>
      </div>
    </PaperSurface>
  );
}
