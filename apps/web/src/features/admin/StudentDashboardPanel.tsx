import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { SessionHistoryEntry, Student } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, LoadingState, Notice, Panel, ProgressMeter, WeeklyProgressStrip } from "../../components/ui";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { formatPassageCitation } from "./passageRanges";
import { StudentSessionRecapDialog } from "./StudentSessionRecapDialog";
import "../../styles/student-dashboard.css";

const assignmentTypeLabels: Record<string, string> = {
  PrimarySpecialist: "Specialist",
  RequiredCoverage: "Required coverage",
  OptionalReview: "Optional review",
};

function formatDateTime(value: string | null): string {
  if (!value) return "No activity yet";
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Paginated session history with per-session XP and a CSV export (§7c). */
function SessionHistory({ orgId, studentId, onViewRecap }: { orgId: string; studentId: string; onViewRecap(sessionId: string): void }) {
  const [sessions, setSessions] = useState<SessionHistoryEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setFailed(false); setSessions([]); setNextBefore(null);
    api.studentSessionHistory(orgId, studentId).then(page => {
      if (cancelled) return;
      setSessions(page.sessions); setNextBefore(page.nextBefore); setLoading(false);
    }).catch(() => { if (!cancelled) { setFailed(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [orgId, studentId]);
  async function loadMore() {
    if (!nextBefore || loading) return;
    setLoading(true);
    try {
      const page = await api.studentSessionHistory(orgId, studentId, nextBefore);
      setSessions(prev => [...prev, ...page.sessions]); setNextBefore(page.nextBefore);
    } catch { setFailed(true); }
    setLoading(false);
  }
  return <Panel data-testid="student-dashboard-history">
    <h2>Session history</h2>
    <p><a href={api.studentExportCsvUrl(orgId, studentId)} download={`student-history-${studentId}.csv`}>Download full history (CSV)</a></p>
    {loading && sessions.length === 0 && <LoadingState label="Loading session history…" />}
    {failed && sessions.length === 0 && <Notice tone="danger">Session history could not load. <Button variant="secondary" size="compact" onClick={() => { setFailed(false); setLoading(true); void loadMore(); }}>Try again</Button></Notice>}
    {sessions.length ? <ul className="ds-student-dashboard-list">{sessions.map(session =>
      <li key={session.sessionId}>{session.format === "Room" ? (
        // Room entries are plain labels: there is no coach-facing room recap
        // route, so they never open the solo recap dialog.
        <><div><strong>Team room · {session.teamFormat === "Pbe" ? "PBE" : "Arcade"}</strong><small><time dateTime={session.completedAtUtc ?? undefined}>{formatDateTime(session.completedAtUtc)}</time></small></div>
        <span>{session.attempted} answered · +{session.xpEarned} XP</span></>
      ) : (
        <button type="button" className="ds-student-dashboard-session" onClick={() => onViewRecap(session.sessionId)} aria-label={`View ${session.mode} session recap from ${formatDateTime(session.completedAtUtc)}`}>
        <div><strong>{session.mode} · {session.format}</strong><small><time dateTime={session.completedAtUtc ?? undefined}>{formatDateTime(session.completedAtUtc)}</time></small></div>
        <span>{session.correct === null ? `${session.attempted} attempted` : `${session.correct} / ${session.attempted} correct`} · +{session.xpEarned} XP</span></button>
      )}</li>)}
    </ul> : !loading && !failed && <p>No completed sessions yet.</p>}
    {nextBefore && <Button variant="secondary" size="compact" disabled={loading} onClick={() => void loadMore()}>{loading ? "Loading…" : "Load more sessions"}</Button>}
  </Panel>;
}

/** Coach slide-over with one student's effort, progress, mastery, assignments and recent activity. */
export function StudentDashboardPanel({ student, onClose }: { student: Student; onClose(): void }) {
  const { me } = useAuth();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const dashboard = useQuery({
    queryKey: ["student-dashboard", me?.organizationId, student.userId],
    queryFn: ({ signal }) => api.studentDashboard(me!.organizationId, student.userId, signal),
    enabled: !!me,
    staleTime: 30_000,
  });
  useEffect(() => {
    const element = dialog.current!;
    const trigger = document.activeElement as HTMLElement | null;
    element.showModal();
    element.querySelector<HTMLElement>("button, select, input, [tabindex]")?.focus();
    return () => { element.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  const data = dashboard.data;
  const [recapSessionId, setRecapSessionId] = useState<string | null>(null);
  const progressPercent = data && data.progress.eligibleCount > 0
    ? Math.round((data.progress.seenCount / data.progress.eligibleCount) * 100) : null;
  const streakHistoryCredited = data?.effort.streakHistory.filter(day => day.credited).length ?? 0;
  return <dialog
    ref={dialog}
    className="ds-dialog ds-student-dashboard"
    aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === dialog.current) onClose(); }}
    data-testid="student-dashboard-panel"
  >
    <header className="ds-student-dashboard-header">
      <ProfileAvatar userId={student.userId} displayName={student.displayName} />
      <div className="ds-student-dashboard-identity">
        <h2 id={titleId}>{student.displayName}</h2>
        <p>@{student.userName}</p>
      </div>
      <Badge tone={student.isActive === false ? "neutral" : "success"}>{student.isActive === false ? "Inactive" : "Active"}</Badge>
      <Button variant="ghost" aria-label={`Close ${student.displayName} dashboard`} onClick={onClose}>Close</Button>
    </header>
    <div className="ds-student-dashboard-body">
      {dashboard.isPending && <Panel aria-busy="true"><LoadingState label={`Loading ${student.displayName}'s dashboard…`} /></Panel>}
      {dashboard.isError && <Notice tone="danger">The dashboard could not load. <Button variant="secondary" size="compact" onClick={() => void dashboard.refetch()}>Try again</Button></Notice>}
      {data && <>
        <Panel data-testid="student-dashboard-effort">
          <h2>Effort this week</h2>
          <p>{data.season ? `${data.season.name} · ` : ""}{data.effort.completedDays} of {data.effort.weeklyTarget} study days</p>
          <WeeklyProgressStrip week={{ weekStartLocalDate: data.effort.weekStartLocalDate, timeZone: data.effort.timeZone, target: data.effort.weeklyTarget as 3 | 4 | 5, completedDays: data.effort.completedDays, days: data.effort.days }} />
          <dl className="ds-student-dashboard-metrics">
            <div><dt>Current streak</dt><dd>{data.effort.streakDays} {data.effort.streakDays === 1 ? "day" : "days"}</dd></div>
            <div><dt>Streak state</dt><dd>{data.effort.streakState === "active" ? "Active" : data.effort.streakState === "paused" ? "Paused" : "Not started"}</dd></div>
            <div><dt>Best streak</dt><dd>{data.effort.bestStreak} {data.effort.bestStreak === 1 ? "day" : "days"}</dd></div>
            <div><dt>Sessions, last 7 days</dt><dd>{data.effort.sessionsLast7Days}</dd></div>
            <div><dt>Last activity</dt><dd>{formatDateTime(data.effort.lastActivityAtUtc)}</dd></div>
          </dl>
          <h3>Practice history · last 90 days</h3>
          <div className="ds-streak-heatmap" role="img" aria-label={`Practice history: ${streakHistoryCredited} of the last 90 days credited`}>
            {data.effort.streakHistory.map(day => <span key={day.localDate}
              title={`${formatDate(day.localDate)}${day.credited ? " · practiced" : ""}`}
              className={`${day.credited ? "is-credited" : ""}${day.localDate === data.effort.days.find(d => d.isToday)?.localDate ? " is-today" : ""}`} />)}
          </div>
          <p><small>One missed day pauses the streak; two in a row restart it.</small></p>
        </Panel>
        <Panel data-testid="student-dashboard-social">
          <h2>Team &amp; social</h2>
          <dl className="ds-student-dashboard-metrics">
            <div><dt>Leaderboard</dt><dd>{data.social.leaderboardOptIn ? "Visible to teammates" : "Hidden from teammates"}</dd></div>
            <div><dt>Team Practice sessions</dt><dd>{data.social.teamPracticeSessions}</dd></div>
          </dl>
        </Panel>
        <Panel data-testid="student-dashboard-progress">
          <h2>Progress</h2>
          <dl className="ds-student-dashboard-metrics">
            <div><dt>Passages seen</dt><dd>{data.progress.seenCount} / {data.progress.eligibleCount}</dd></div>
            <div><dt>Strong or mastered</dt><dd>{data.progress.strongCount}</dd></div>
            <div><dt>Mastered</dt><dd>{data.progress.masteredCount}</dd></div>
            <div><dt>Reviews due</dt><dd>{data.progress.reviewDueCount}</dd></div>
            <div><dt>Attempts</dt><dd>{data.progress.attemptCount}</dd></div>
          </dl>
          {progressPercent !== null && <div className="ds-student-dashboard-overall"><ProgressMeter label="Assigned passages seen" value={progressPercent} max={100} /><span>{progressPercent}% seen</span></div>}
          <ul className="ds-student-dashboard-chapters">{data.progress.chapters.map(chapter => {
            const percent = chapter.eligibleCount ? Math.round((chapter.seenCount / chapter.eligibleCount) * 100) : 0;
            return <li key={`${chapter.bookKey}-${chapter.chapter}`}>
              <div><strong>{chapter.bookKey} {chapter.chapter}</strong><small>{chapter.masteredCount} mastered · {chapter.strongCount} strong</small></div>
              <ProgressMeter label={`${chapter.bookKey} chapter ${chapter.chapter} progress`} value={percent} max={100} />
            </li>;
          })}</ul>
        </Panel>
        <Panel data-testid="student-dashboard-mastery">
          <h2>Mastery</h2>
          <h3>Badges earned</h3>
          {data.mastery.badges.length ? <ul className="ds-student-dashboard-list">{data.mastery.badges.map(badge =>
            <li key={badge.key}><div><strong>{badge.title}</strong><small>Earned {formatDate(badge.earnedAtUtc!)}</small></div><Badge tone="success">Earned</Badge></li>)}
          </ul> : <p>No badges earned yet.</p>}
          <h3>Team awards</h3>
          {data.mastery.teamAwards.length ? <ul className="ds-student-dashboard-list">{data.mastery.teamAwards.map(award =>
            <li key={`${award.source}:${award.key}`}><div><strong>{award.title}</strong><small>{award.seasonName ?? "Unknown season"}{award.earnedAtUtc ? ` · Earned ${formatDate(award.earnedAtUtc)}` : ""}</small></div><Badge tone="info">{award.source === "honor" ? "Team honor" : "Room award"}</Badge></li>)}
          </ul> : <p>No team awards yet.</p>}
          <h3>Passage levels</h3>
          <ul className="ds-student-dashboard-list">{data.mastery.levelCounts.map(({ level, count }) =>
            <li key={level}><strong>{level}</strong><span>{count}</span></li>)}
          </ul>
        </Panel>
        <Panel data-testid="student-dashboard-assignments">
          <h2>Assignments</h2>
          {data.assignments.length ? <ul className="ds-student-dashboard-list">{data.assignments.map(assignment =>
            <li key={assignment.id}><div><strong>{formatPassageCitation(assignment)}</strong><small>{assignmentTypeLabels[assignment.type] ?? "Assigned study"} · {assignment.difficulty ?? "Standard"} difficulty</small></div></li>)}
          </ul> : <p>No assignments yet.</p>}
        </Panel>
        <Panel data-testid="student-dashboard-activity">
          <h2>Recent activity</h2>
          {data.recentActivity.length ? <ul className="ds-student-dashboard-list">{data.recentActivity.map(session =>
            <li key={session.sessionId}><button type="button" className="ds-student-dashboard-session" onClick={() => setRecapSessionId(session.sessionId)} aria-label={`View ${session.mode} session recap from ${formatDateTime(session.createdAtUtc)}`}>
              <div><strong>{session.mode} · {session.format}</strong><small><time dateTime={session.createdAtUtc}>{formatDateTime(session.createdAtUtc)}</time></small></div>
              <span>{session.correct === null ? `${session.attempted} attempted` : `${session.correct} / ${session.attempted} correct`}</span></button></li>)}
          </ul> : <p>No completed sessions yet.</p>}
        </Panel>
        {me?.organizationId && <SessionHistory orgId={me.organizationId} studentId={student.userId} onViewRecap={setRecapSessionId} />}
      </>}
    </div>
    {recapSessionId && me?.organizationId && <StudentSessionRecapDialog orgId={me.organizationId} studentId={student.userId} studentName={student.displayName} sessionId={recapSessionId} onClose={() => setRecapSessionId(null)} />}
  </dialog>;
}
