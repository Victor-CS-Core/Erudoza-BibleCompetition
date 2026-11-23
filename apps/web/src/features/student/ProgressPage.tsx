import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, LinkButton, LoadingState, Notice, PageHeader, Panel } from "../../components/ui";
import { StatTile } from "../../components/game/GameLayer";
import { academyActivityName, academyRecentExactPercent, canStartAcademyTrack } from "./academyTracks";
import { HonorsPage } from "./HonorsPage";
import { PassageBrowser } from "./PassageBrowser";
import { PbeJourney } from "./PassageJourney";
import { SeasonCoveragePanel } from "./SeasonCoverage";
import "./student.css";

export function ProgressPage() {
  const { me } = useAuth();
  const { seasonId, studentId } = useParams();
  const [params] = useSearchParams();
  const selectedSeasonId = params.get("seasonId") || undefined;
  const coachView = !!seasonId && !!studentId;
  // Honors lives as a tab inside Progress for students; coaches keep the plain progress view.
  const tab = !coachView && params.get("tab") === "honors" ? "honors" : "overview";
  const tabHref = (target: "overview" | "honors") => {
    const next = new URLSearchParams();
    if (target !== "overview") next.set("tab", target);
    if (selectedSeasonId) next.set("seasonId", selectedSeasonId);
    const query = next.toString();
    return `/student/progress${query ? `?${query}` : ""}`;
  };
  const progress = useQuery({ queryKey: ["progress", seasonId ?? selectedSeasonId, studentId, me?.organizationId, me?.userId],
    queryFn: () => coachView ? api.studentProgress(me!.organizationId, seasonId!, studentId!) : api.progress(selectedSeasonId), enabled: (!coachView || !!me) && tab !== "honors" });
  const data = progress.data;
  const recent = data?.recentAttempts ?? [];
  return <div className="training-dashboard student-progress">
    <PageHeader title={coachView ? "Student progress" : "Your progress"} description={<span data-testid="progress-student">{data?.studentDisplayName ? `${data.studentDisplayName} · ` : ""}{data?.seasonName || "How you are doing, passage by passage"}</span>}
      action={<LinkButton variant="secondary" to={coachView ? `/admin/assignments?studentId=${encodeURIComponent(studentId!)}&seasonId=${encodeURIComponent(seasonId!)}` : `/student${selectedSeasonId ? `?seasonId=${encodeURIComponent(selectedSeasonId)}` : ""}`}>{coachView ? "Back to assignments" : "Back to training"}</LinkButton>} />
    {!coachView && <nav className="study-mode-tabs" aria-label="Progress views">
      <Link to={tabHref("overview")} data-testid="progress-tab-overview" aria-current={tab === "overview" ? "page" : undefined} className={tab === "overview" ? "is-active" : undefined}>Overview</Link>
      <Link to={tabHref("honors")} data-testid="progress-tab-honors" aria-current={tab === "honors" ? "page" : undefined} className={tab === "honors" ? "is-active" : undefined}>Achievement patches</Link>
    </nav>}
    {tab === "honors" ? <HonorsPage hideHeader /> : <>
    {progress.isPending && <Panel aria-busy="true"><LoadingState label="Loading progress…" /></Panel>}
    {progress.isError && <Notice tone="danger">Progress could not load. <Button variant="secondary" onClick={() => void progress.refetch()}>Try again</Button></Notice>}
    {data && <>
      {!coachView && !!data.seasonId && data.pbeEnabled && <PbeJourney seasonId={data.seasonId} preview={false} />}
      {!!data.seasonId && data.pbeEnabled && <SeasonCoveragePanel seasonId={data.seasonId} audience={coachView ? 'coach' : 'student'} organizationId={coachView ? me?.organizationId : undefined} />}
      <Panel data-testid="progress-top-folio"><h2>Your activity so far</h2><dl className="game-stat-grid">
        <StatTile label="Attempts" value={data.attemptCount} testId="progress-attempts" />
        <StatTile label="Verses mastered" value={data.masteredCount} />
        <StatTile label="Due reviews" value={data.reviewDueCount} testId="progress-reviews" />
        <StatTile label="Recent correct" value={academyRecentExactPercent(data.recentAttempts)} testId="progress-recent" />
      </dl>{data.reviewDueCount > 0 && <div className="student-progress-next"><Badge tone="warning" aria-label="DUE">{data.reviewDueCount} {data.reviewDueCount === 1 ? "review" : "reviews"} due</Badge>{!coachView && canStartAcademyTrack("review", data) && <LinkButton size="compact" to={`/student/study?mode=Review&seasonId=${encodeURIComponent(data.seasonId)}`}>Start due reviews</LinkButton>}</div>}</Panel>
      <Panel>
        <PassageBrowser mastery={data.mastery} difficulty={data.assignments.find(a => a.difficulty)?.difficulty} />
      </Panel>
      <Panel>
        <details className="progress-disclosure">
          <summary><h2>Recent attempts</h2></summary>
          <ul className="training-list student-progress-records" data-testid="recent-attempts">{recent.length ? recent.map(item => <li key={item.id}>
            <div><h3>{item.title}</h3><p>{academyActivityName(item.activityType)} · <time dateTime={item.createdAtUtc}>{new Date(item.createdAtUtc).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></p><p className="er-scripture">{item.submittedAnswer || "—"}</p></div>
            <Badge tone={item.isCorrect ? "success" : "warning"}>{item.isCorrect ? "Correct" : "Keep practicing"}</Badge>
          </li>) : <li><div><p>Nothing here yet — your answers show up after your first session.</p>{!coachView && canStartAcademyTrack("learner", data) && data.assignments.length > 0 && <LinkButton size="compact" to={`/student/study?seasonId=${encodeURIComponent(data.seasonId)}`}>Start your first study session</LinkButton>}</div></li>}</ul>
        </details>
      </Panel>
    </>}
    </>}
  </div>;
}