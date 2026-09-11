import { ProfileAvatar } from "../profile/ProfileAvatar";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { AppIcon } from "../../components/AppIcon";
import { Badge, Button, LinkButton, Notice, PageHeader, Panel, Select } from "../../components/ui";
import { SeasonStatusBadge } from "./SeasonStatusBadge";

export function AdminHomePage() {
  const { me } = useAuth();
  const [selectedId, setSelectedId] = useState("");
  const orgId = me?.organizationId ?? "";
  const seasons = useQuery({ queryKey: ["seasons", orgId], queryFn: () => api.seasons(orgId), enabled: !!orgId });
  const selected = seasons.data?.find((s) => s.id === selectedId) ?? seasons.data?.find((s) => s.status === "Active") ?? seasons.data?.[0];
  const coverage = useQuery({ queryKey: ["coverage", orgId, selected?.id], queryFn: () => api.coverage(orgId, selected!.id), enabled: !!orgId && !!selected });
  const rows = coverage.data?.students ?? [];
  const studentCount = new Set(rows.map((s) => s.studentUserId)).size;
  const needReview = new Set(rows.filter((s) => s.reviewDueCount > 0).map((s) => s.studentUserId)).size;
  return <div>
    <PageHeader title="Season overview" description="Equip your team. See what needs attention." action={<LinkButton data-testid="create-season" to="/admin/seasons/new">Create season</LinkButton>} />
    {seasons.isPending ? <Notice>Loading seasons…</Notice> : seasons.isError ? <Notice tone="danger"><p>Seasons could not load.</p><Button variant="secondary" onClick={() => void seasons.refetch()}>Try again</Button></Notice> : !selected ? <Panel className="training-empty"><h2>Your team’s next chapter</h2><p>No seasons yet. Create a season to define Scripture scope and assign your students.</p></Panel> : <>
      <div className="training-season-toolbar"><label htmlFor="overview-season">Season <Select id="overview-season" value={selected.id} onChange={(e) => setSelectedId(e.target.value)}>{seasons.data?.map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}</Select></label><SeasonStatusBadge status={selected.status} /><Link to={`/admin/seasons/${selected.id}`}>Manage season →</Link></div>
      {coverage.isError ? <Notice tone="danger"><p>Student progress could not load.</p><Button variant="secondary" onClick={() => void coverage.refetch()}>Retry progress</Button></Notice> : coverage.isPending ? <Notice>Loading student progress…</Notice> : <>
        <div className="training-stats"><Panel as="div"><span className="training-icon-tile"><AppIcon name="users" /></span><div><strong>{studentCount}</strong><small>Assigned students</small></div></Panel><Panel as="div"><span className="training-icon-tile training-due"><AppIcon name="review" /></span><div><strong>{needReview}</strong><small>Need review</small></div></Panel><Panel as="div"><span className="training-icon-tile"><AppIcon name="book" /></span><div><strong>{selected.assignmentCount}</strong><small>Assignments</small></div></Panel></div>
        <Panel><div className="training-section-heading"><h2>Student progress</h2><Link to="/admin/students">Student directory →</Link></div>{rows.length ? <div className="training-table-scroll"><table className="training-table training-progress-table"><thead><tr><th>Student</th><th>Assigned passage</th><th>Mastery</th><th>Review</th></tr></thead><tbody>{rows.map((s, index) => {
          const percent = s.eligibleUnitCount > 0 ? Math.min(100, Math.round(s.masteredCount / s.eligibleUnitCount * 100)) : null;
          return <tr key={`${s.studentUserId}-${index}`}><td><Link className="training-student-link" to={`/admin/seasons/${selected.id}/students/${s.studentUserId}/progress`}><ProfileAvatar userId={s.studentUserId} displayName={s.displayName} /><strong>{s.displayName}</strong></Link></td><td data-label="Assigned passage">{s.bookKey} {s.startChapter}:{s.startVerse}–{s.endChapter}:{s.endVerse}</td><td data-label="Mastery"><div className="training-table-mastery"><strong>{percent === null ? "—" : `${percent}%`}</strong>{percent !== null && <progress value={percent} max={100} aria-label={`${s.displayName} assigned passage mastery`} />}</div><small>{s.masteredCount} / {s.eligibleUnitCount} verses</small></td><td data-label="Review"><Badge tone={s.reviewDueCount ? "warning" : "neutral"}>{s.reviewDueCount ? `${s.reviewDueCount} due` : s.attemptCount ? "Up to date" : "Not started"}</Badge></td></tr>;
        })}</tbody></table></div> : <div className="training-empty"><p>No students assigned to this season yet.</p><Link to={`/admin/seasons/${selected.id}?step=students`}>Assign your first passage →</Link></div>}</Panel>
      </>}
      <div className="training-coach-actions"><LinkButton to={`/admin/seasons/${selected.id}?step=students`}>Manage assignments <AppIcon name="arrow" /></LinkButton><p>Disciplined today.<br /><em>Prepared for tomorrow.</em></p></div>
    </>}
  </div>;
}
