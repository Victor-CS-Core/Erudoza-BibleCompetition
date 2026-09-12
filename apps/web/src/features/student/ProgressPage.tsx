import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, LinkButton, LoadingState, Notice, PageHeader, Panel } from "../../components/ui";
import { academyActivityName, academyRecentExactPercent, canStartAcademyTrack } from "./academyTracks";
import { PassageJourney } from "./PassageJourney";
import { SeasonCoveragePanel } from "./SeasonCoverage";
import "./student.css";

export function ProgressPage() {
  const { me } = useAuth();
  const { seasonId, studentId } = useParams();
  const [params] = useSearchParams();
  const selectedSeasonId = params.get("seasonId") || undefined;
  const coachView = !!seasonId && !!studentId;
  const progress = useQuery({ queryKey: ["progress", seasonId ?? selectedSeasonId, studentId, me?.organizationId, me?.userId],
    queryFn: () => coachView ? api.studentProgress(me!.organizationId, seasonId!, studentId!) : api.progress(selectedSeasonId), enabled: !coachView || !!me });
  const data = progress.data;
  const recent = data?.recentAttempts ?? [];
  return <div className="training-dashboard student-progress">
    <PageHeader title={coachView ? "Student progress" : "Your progress"} description={<span data-testid="progress-student">{data?.studentDisplayName ? `${data.studentDisplayName} · ` : ""}{data?.seasonName || "Recorded practice and passage progress"}</span>}
      action={<LinkButton variant="secondary" to={coachView ? `/admin/assignments?studentId=${encodeURIComponent(studentId!)}&seasonId=${encodeURIComponent(seasonId!)}` : `/student${selectedSeasonId ? `?seasonId=${encodeURIComponent(selectedSeasonId)}` : ""}`}>{coachView ? "Back to assignments" : "Back to training"}</LinkButton>} />
    {progress.isPending && <Panel aria-busy="true"><LoadingState label="Loading progress…" /></Panel>}
    {progress.isError && <Notice tone="danger">Progress could not load. <Button variant="secondary" onClick={() => void progress.refetch()}>Try again</Button></Notice>}
    {data && <>
      {!coachView && !!data.seasonId && <PassageJourney seasonId={data.seasonId} format={data.pbeEnabled ? 'Pbe' : 'Memory'} />}
      {!!data.seasonId && data.pbeEnabled && <SeasonCoveragePanel seasonId={data.seasonId} audience={coachView ? 'coach' : 'student'} organizationId={coachView ? me?.organizationId : undefined} />}
      <Panel data-testid="progress-top-folio"><h2>Recorded activity</h2><dl className="student-progress-metrics">
        <div><dt>Attempts</dt><dd data-testid="progress-attempts">{data.attemptCount}</dd></div>
        <div><dt>Verses mastered</dt><dd>{data.masteredCount}</dd></div>
        <div><dt>Due reviews</dt><dd data-testid="progress-reviews">{data.reviewDueCount}</dd></div>
        <div><dt>Recent correct</dt><dd data-testid="progress-recent">{academyRecentExactPercent(data.recentAttempts)}</dd></div>
      </dl>{data.reviewDueCount > 0 && <div className="student-progress-next"><Badge tone="warning" aria-label="DUE">{data.reviewDueCount} {data.reviewDueCount === 1 ? "review" : "reviews"} due</Badge>{!coachView && canStartAcademyTrack("review", data) && <LinkButton size="compact" to={`/student/study?mode=Review&seasonId=${encodeURIComponent(data.seasonId)}`}>Start due reviews</LinkButton>}</div>}</Panel>
      <Panel><h2>Passage progress</h2><p>See which passages need practice and which are mastered.</p>
        <p>Coach-set difficulty: {data.assignments.find(a=>a.difficulty)?.difficulty ?? 'Not available'}</p>
        <p>Foundation wording evidence stops at 40, Standard at 70. Memory warmups stop at 70 within those ceilings; Verse Builder records sequence practice.</p>
        <p>Advanced mastery challenges require coach-set Advanced difficulty. Your difficulty does not change automatically. Honors also require their listed passage, skill and delayed-recall evidence. PBE questions use their authored answer requirements at every Memory difficulty.</p>
        <ul className="training-list student-progress-records" data-testid="progress-mastery">{data.mastery.length ? data.mastery.map(item => <li key={item.knowledgeUnitId}>
          <div><h3>{item.title}</h3>{(item.algorithmVersion ?? "v1-scaffold") !== "v2-skill-evidence" && <p>Legacy scoring</p>}<p>Exact wording score: {item.exactWordingScore} / 100</p></div>
          <Badge tone={item.level === "Mastered" ? "success" : item.level === "Review" ? "warning" : "neutral"}>{item.level}</Badge>
        </li>) : <li>No passage progress yet. Complete a study activity to begin recording progress.</li>}</ul>
      </Panel>
      <Panel><h2>Recent attempts</h2><ul className="training-list student-progress-records" data-testid="recent-attempts">{recent.length ? recent.map(item => <li key={item.id}>
        <div><h3>{item.title}</h3><p>{academyActivityName(item.activityType)} · <time dateTime={item.createdAtUtc}>{new Date(item.createdAtUtc).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></p><p className="er-scripture">{item.submittedAnswer || "—"}</p></div>
        <Badge tone={item.isCorrect ? "success" : "warning"}>{item.isCorrect ? "Correct" : "Keep practicing"}</Badge>
      </li>) : <li><div><p>No attempts yet.</p>{!coachView && canStartAcademyTrack("learner", data) && data.assignments.length > 0 && <LinkButton size="compact" to={`/student/study?seasonId=${encodeURIComponent(data.seasonId)}`}>Start your first study session</LinkButton>}</div></li>}</ul></Panel>
    </>}
  </div>;
}
