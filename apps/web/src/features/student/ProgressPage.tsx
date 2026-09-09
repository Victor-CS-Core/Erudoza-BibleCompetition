import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "react-router-dom";
import { api } from "../../api/client";
import type { SessionSummary } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { FieldGuideChrome } from "../../components/material/FieldGuideChrome";
import { FieldGuideCover } from "../../components/material/FieldGuideCover";
import { Stamp } from "../../components/material/Stamp";
import { academyActivityName, academyRecentExactPercent, academySessionSummaryCopy } from "./academyTracks";

const pathwayNodes = ["Observe", "Identify", "Record", "Interpret", "Apply", "Reflect"] as const;

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
  const due = (data?.reviewDueCount ?? 0) > 0;

  return (
    <div className="er-progress-stage space-y-4">
      <FieldGuideChrome testId="progress-field-guide-chrome" />
      <section className="er-top-folio" data-testid="progress-top-folio">
        <p className="er-top-folio-label">TOP FOLIO</p>
        <dl className="er-top-folio-stats">
          <div>
            <dt>Attempts</dt>
            <dd data-testid="progress-attempts">{data?.attemptCount ?? 0}</dd>
          </div>
          <div>
            <dt>Due reviews</dt>
            <dd data-testid="progress-reviews">{data?.reviewDueCount ?? 0}</dd>
          </div>
          <div>
            <dt>Recent</dt>
            <dd data-testid="progress-recent">{academyRecentExactPercent(data?.recentAttempts)}</dd>
          </div>
        </dl>
      </section>
      <FieldGuideCover folio stamp={due ? <Stamp label="DUE" tone="due" /> : null}>
        {coachView ? <h2 className="mt-5 text-xl font-semibold">Student progress</h2> : null}
        <p className="mt-2 text-[var(--er-muted-ink)]" data-testid="progress-student">
          {data?.studentDisplayName ? `${data.studentDisplayName} · ` : null}
          {data?.seasonName}
        </p>
        {summary ? (
          <p className="mt-3 text-sm" data-testid="session-summary">
            {academySessionSummaryCopy(summary)}
          </p>
        ) : null}
        <div className="er-mastery-pathway" data-testid="progress-mastery-pathway" data-aspirational="true">
          <h2 className="er-mastery-pathway-title">
            {data?.seasonName ? `${data.seasonName} progress` : "Progress"} — Field Guide Mastery Pathway
          </h2>
          <p className="er-mastery-pathway-quote">
            “Study to show yourself approved.” — 2 Timothy 2:15
          </p>
          <div className="er-pathway-orbit" aria-hidden="true">
            <span className="er-pathway-core">
              <img src="/brand/erudoza-mark.png" alt="" width={48} height={48} />
            </span>
            {pathwayNodes.map((label, index) => (
              <span key={label} className={`er-pathway-node er-pathway-node-${index}`}>
                {label}
              </span>
            ))}
          </div>
          <p className="er-mastery-pathway-note">
            Comp mastery ring — product uses attempts/due until API-backed
          </p>
        </div>
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
                      {item.title} · {academyActivityName(item.activityType)}
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
      </FieldGuideCover>
    </div>
  );
}
