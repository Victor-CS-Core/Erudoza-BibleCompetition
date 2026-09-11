import { useAuth } from "../../auth/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { Badge, Button, LinkButton, LoadingState, Notice, PageHeader, Panel, Select } from "../../components/ui";
import { AppIcon } from "../../components/AppIcon";
import { canStartAcademyTrack, academyUnavailableCopy } from "./academyTracks";
import "./student.css";

export function StudentHomePage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const selectedSeasonId = params.get("seasonId") || undefined;
  const seasons = useQuery({ queryKey: ["assigned-seasons", me?.organizationId, me?.userId], queryFn: () => api.assignedSeasons() });
  const progress = useQuery({ queryKey: ["progress", selectedSeasonId, me?.organizationId, me?.userId], queryFn: () => api.progress(selectedSeasonId) });
  const seasonLink = (path: string) => selectedSeasonId ? path + (path.includes("?") ? "&" : "?") + "seasonId=" + encodeURIComponent(selectedSeasonId) : path;
  const data = progress.data;
  const assignment = data?.assignments[0];
  return <div className="training-dashboard student-home">
    <PageHeader title="Training HQ" description="Build knowledge. Grow faith. Make an impact." action={data && <div className="training-season" data-testid="current-season"><small>Current season</small><strong>{data.seasonName || "Not assigned"}</strong><Badge tone={data.seasonStatus === "Active" ? "success" : "neutral"}>{data.seasonStatus === "None" ? "Awaiting assignment" : data.seasonStatus}</Badge></div>} />
    {seasons.data && seasons.data.length > 1 && <Panel><label>Assigned season <Select value={selectedSeasonId ?? data?.seasonId ?? ""} onChange={(event) => setParams({ seasonId: event.target.value })}>{seasons.data.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}</Select></label></Panel>}
    {seasons.isError && <Notice tone="danger">Assigned seasons could not load. <Button variant="secondary" onClick={() => void seasons.refetch()}>Retry seasons</Button></Notice>}
    <section className="training-banner"><div><p>Know the passage.<br />Own the moment.</p><span>FIELD GUIDE ACADEMY</span></div></section>
    {progress.isPending ? <Panel aria-busy="true"><LoadingState label="Loading your training plan…" /></Panel> : progress.isError ? <Notice tone="danger"><h2>Your training plan could not load.</h2><Button variant="secondary" onClick={() => void progress.refetch()}>Try again</Button></Notice> : <>
      <div className={`training-dashboard-grid${!assignment && !data?.attemptCount ? " student-home-unassigned" : ""}`}>
        <Panel className=" training-next"><div className="training-panel-title"><span className="training-icon-tile"><AppIcon name="book" /></span><h2>Continue your training</h2></div><p className="training-assignment" data-testid="assignment-range">{assignment ? `${assignment.bookKey} ${assignment.startChapter}:${assignment.startVerse}–${assignment.endChapter}:${assignment.endVerse}` : "Your next chapter starts here"}</p><p>Build exact recall with Scripture memory activities.</p>{assignment?.difficulty && <p>Training difficulty: {assignment.difficulty}</p>}{canStartAcademyTrack("learner", data) && assignment ? <LinkButton to={seasonLink("/student/study")} data-testid="start-todays-deck">Continue study <AppIcon name="arrow" /></LinkButton> : <p className="training-empty" data-testid="academy-track-unavailable">{assignment ? academyUnavailableCopy("learner", data) : "Your coach will add your study assignment here."}</p>}<div className="training-next-meta"><AppIcon name="flag" /><span>{data?.assignments.length ?? 0} assigned {data?.assignments.length === 1 ? "passage" : "passages"}</span><Link to={seasonLink("/student/progress")}>View progress →</Link></div></Panel>
        {(assignment || !!data?.attemptCount) && <div className="training-side-panels"><Panel className=""><h2>Your progress</h2><div className="training-mastery-summary"><div className="training-mastery-count" data-testid="mastered-count">{data?.masteredCount ?? 0}</div><div><strong>Verses mastered</strong><p>{data?.attemptCount ?? 0} {data?.attemptCount === 1 ? "attempt" : "attempts"} recorded</p><small>Every passage is a step forward.</small></div></div></Panel>
          <Panel as="div" className="training-action-row"><span className="training-icon-tile training-due"><AppIcon name="review" /></span><div><h3>Review due</h3><p>{data?.reviewDueCount ?? 0} {data?.reviewDueCount === 1 ? "verse" : "verses"}</p></div>{canStartAcademyTrack("review", data) ? <LinkButton variant="secondary" to={seasonLink("/student/study?mode=Review")} aria-label="Start due reviews" data-testid="start-reviews"><AppIcon name="arrow" /></LinkButton> : <span className="training-action-note">{data?.seasonStatus !== "Active" ? "Season not active" : "Up to date"}</span>}</Panel>
          <Panel as="div" className="training-action-row"><span className="training-icon-tile"><AppIcon name="flag" /></span><div><h3>Competition rehearsal</h3><p>Competition-style practice</p></div>{canStartAcademyTrack("rehearsal", data) ? <LinkButton variant="secondary" to={seasonLink("/student/study?mode=Simulation")} aria-label="Start rehearsal" data-testid="start-simulation"><AppIcon name="arrow" /></LinkButton> : <span className="training-action-note">Opens when active</span>}</Panel>
        </div>}
      </div>
      {assignment && <Panel className=" training-milestones"><div><h2>Training milestones</h2><p>Small steps. Lasting knowledge.</p></div><Link to={seasonLink("/student/progress")}><span className="training-badge-art" aria-hidden="true" /><div><strong>Exact recall</strong><small>Track your wording accuracy</small></div></Link><Link to={seasonLink("/student/progress")}><span className="training-badge-art training-badge-reference" aria-hidden="true" /><div><strong>Reference ready</strong><small>Follow your passage progress</small></div></Link></Panel>}
      {!!data && data.assignments.length > 1 && <Panel className="student-assignment-list"><h2>Your assigned passages</h2><p>Your coach sets the difficulty for each assignment.</p><ul className="student-progress-records">{data.assignments.map(item => <li key={item.id}><strong>{item.bookKey} {item.startChapter}:{item.startVerse}–{item.endChapter}:{item.endVerse}</strong>{item.difficulty && <Badge>{item.difficulty}</Badge>}</li>)}</ul></Panel>}
    </>}
  </div>;
}
