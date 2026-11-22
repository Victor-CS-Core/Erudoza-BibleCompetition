import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, LinkButton, LoadingState, Notice, PageHeader, Panel } from "../../components/ui";
import { academyActivityName, academyRecentExactPercent, canStartAcademyTrack } from "./academyTracks";
import { HonorsPage } from "./HonorsPage";
import { PassageBrowser } from "./PassageBrowser";
import { rankWorthAnotherLook } from "./worthAnotherLook";
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
  // Needs attention: the shared "worth another look" ranking (due reviews
  // first, then the lowest-scoring unmastered passages).
  const needsAttention = rankWorthAnotherLook(data?.mastery, Date.now(), 5);
  const studyHref = (mode: "Practice" | "Review") => `/student/study?mode=${mode}${data?.seasonId ? `&seasonId=${encodeURIComponent(data.seasonId)}` : ""}`;
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
      <Panel data-testid="progress-top-folio"><h2>Your activity so far</h2><dl className="student-progress-metrics">
        <div><dt>Attempts</dt><dd data-testid="progress-attempts">{data.attemptCount}</dd></div>
        <div><dt>Verses mastered</dt><dd>{data.masteredCount}</dd></div>
        <div><dt>Due reviews</dt><dd data-testid="progress-reviews">{data.reviewDueCount}</dd></div>
        <div><dt>Recent correct</dt><dd data-testid="progress-recent">{academyRecentExactPercent(data.recentAttempts)}</dd></div>
      </dl>{data.reviewDueCount > 0 && <div className="student-progress-next"><Badge tone="warning" aria-label="DUE">{data.reviewDueCount} {data.reviewDueCount === 1 ? "review" : "reviews"} due</Badge>{!coachView && canStartAcademyTrack("review", data) && <LinkButton size="compact" to={`/student/study?mode=Review&seasonId=${encodeURIComponent(data.seasonId)}`}>Start due reviews</LinkButton>}</div>}</Panel>
      {needsAttention.length > 0 && !coachView && <Panel data-testid="progress-needs-attention">
        <h2>Worth another look</h2>
        <p>Passages that are due, or could use a little more practice.</p>
        <ul className="training-list student-progress-records">
          {needsAttention.map(({ item, due }) => (
            <li key={item.knowledgeUnitId}>
              <div>
                <h3>{item.title}</h3>
                <p>{due ? "Review due" : "Needs practice"} · Wording score: {item.exactWordingScore} / 100</p>
              </div>
              <LinkButton size="compact" to={studyHref(due ? "Review" : "Practice")}>{due ? "Review" : "Practice"}</LinkButton>
            </li>
          ))}
        </ul>
      </Panel>}
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