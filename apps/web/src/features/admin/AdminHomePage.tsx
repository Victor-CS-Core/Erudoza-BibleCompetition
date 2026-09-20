import { ProfileAvatar } from "../profile/ProfileAvatar";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { trainingApi } from "../../api/training";
import { useAuth } from "../../auth/AuthContext";
import { AppIcon } from "../../components/AppIcon";
import type { IconName } from "../../components/AppIcon";
import { Badge, Button, LinkButton, Notice, PageHeader, Panel, Select } from "../../components/ui";
import { SeasonStatusBadge } from "./SeasonStatusBadge";
import { formatPassageCitation } from "./passageRanges";

const localDayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

type AttentionItem = { key: string; icon: IconName; text: string };

export function AdminHomePage() {
  const { me } = useAuth();
  const [selectedId, setSelectedId] = useState("");
  const orgId = me?.organizationId ?? "";
  const seasons = useQuery({ queryKey: ["seasons", orgId], queryFn: () => api.seasons(orgId), enabled: !!orgId });
  const selected = seasons.data?.find((s) => s.id === selectedId) ?? seasons.data?.find((s) => s.status === "Active") ?? seasons.data?.[0];
  const coverage = useQuery({ queryKey: ["coverage", orgId, selected?.id], queryFn: () => api.coverage(orgId, selected!.id), enabled: !!orgId && !!selected });
  const rows = coverage.data?.students ?? [];
  const studentCount = new Set(rows.map((s) => s.studentUserId)).size;
  const reviewStudentIds = new Set(rows.filter((s) => s.reviewDueCount > 0).map((s) => s.studentUserId));
  const notStartedStudents = rows.filter((s) => s.attemptCount === 0);
  const seasonStudentIds = new Set(rows.map((s) => s.studentUserId));
  const engagement = useQuery({
    queryKey: ["engagement", orgId],
    queryFn: () => api.engagement(orgId),
    enabled: !!orgId && rows.length > 0,
    staleTime: 30_000,
  });
  const seasonEngagement = (engagement.data ?? []).filter((row) => seasonStudentIds.has(row.studentId));
  const idleStudents = seasonEngagement.filter((row) => row.practiceDaysThisWeek === 0);
  const today = localDayKey();
  const practicedToday = seasonEngagement.filter((row) => row.lastActiveAtUtc?.slice(0, 10) === today).length;
  const practicedThisWeek = seasonEngagement.filter((row) => row.practiceDaysThisWeek > 0).length;
  const training = useQuery({ queryKey: ["coach-training", orgId, me?.userId], queryFn: () => trainingApi.today(), enabled: !!me, staleTime: 60_000 });
  const myStreak = training.data?.streak;
  const myXp = training.data?.xp;
  const formatName = !selected || selected.pbeEnabled ? "PBE" : "Memory";

  const attention: AttentionItem[] = [];
  if (reviewStudentIds.size) attention.push({ key: "review", icon: "review", text: `${reviewStudentIds.size} of ${studentCount} ${studentCount === 1 ? "student has" : "students have"} passages due for review.` });
  if (idleStudents.length) attention.push({ key: "idle", icon: "users", text: `${idleStudents.length} ${idleStudents.length === 1 ? "student hasn't" : "students haven't"} practiced this week.` });
  if (notStartedStudents.length) attention.push({ key: "not-started", icon: "flag", text: `${notStartedStudents.length} ${notStartedStudents.length === 1 ? "student hasn't" : "students haven't"} started the assigned passage yet.` });

  return <div>
    <PageHeader title="Season overview" description={`Manage your ${formatName} season and see which students need practice.`} action={<LinkButton data-testid="create-season" to="/admin/seasons/new">Create season</LinkButton>} />
    {seasons.isPending ? <Notice>Loading seasons…</Notice> : seasons.isError ? <Notice tone="danger"><p>Seasons could not load.</p><Button variant="secondary" onClick={() => void seasons.refetch()}>Try again</Button></Notice> : !selected ? <Panel className="training-empty"><h2>Your team’s season</h2><p>No seasons yet. Create a season to define Scripture scope and assign your students.</p></Panel> : <>
      <div className="training-season-toolbar"><label className="training-season-picker" htmlFor="overview-season"><span>Season</span><Select id="overview-season" value={selected.id} onChange={(e) => setSelectedId(e.target.value)}>{seasons.data?.map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}</Select></label><div className="training-season-meta"><SeasonStatusBadge status={selected.status} /><Link to={`/admin/seasons/${selected.id}`}>Manage season →</Link></div></div>
      {coverage.isError ? <Notice tone="danger"><p>Student progress could not load.</p><Button variant="secondary" onClick={() => void coverage.refetch()}>Retry progress</Button></Notice> : coverage.isPending ? <Notice>Loading student progress…</Notice> : <>
        <div className="training-stats"><Panel as="div"><span className="training-icon-tile"><AppIcon name="users" /></span><div><strong>{studentCount}</strong><small>Assigned students</small></div></Panel><Link to="/admin/students" className="ds-panel training-stat-link" aria-label={`${reviewStudentIds.size} ${reviewStudentIds.size === 1 ? "student needs" : "students need"} review — open the student directory`}><span className="training-icon-tile training-due"><AppIcon name="review" /></span><div><strong>{reviewStudentIds.size}</strong><small>Need review</small></div></Link><Link to={`/admin/seasons/${selected.id}?step=students`} className="ds-panel training-stat-link" aria-label={`${selected.assignmentCount} ${selected.assignmentCount === 1 ? "assignment" : "assignments"} — open the assignment editor`}><span className="training-icon-tile"><AppIcon name="book" /></span><div><strong>{selected.assignmentCount}</strong><small>Assignments</small></div></Link></div>
        {(attention.length > 0 || engagement.data) && <Panel className="training-attention">
          <div className="training-panel-title"><h2>Needs attention</h2></div>
          {attention.length > 0 ? <ul>{attention.map(item => <li key={item.key}><span className="training-icon-tile training-due"><AppIcon name={item.icon} /></span><p>{item.text}</p></li>)}</ul> : <p className="training-attention-clear">Everyone is practicing and up to date.</p>}
          <div className="training-attention-footer">
            {engagement.data && seasonEngagement.length > 0 && <small>This week {practicedThisWeek} of {seasonEngagement.length} practiced{practicedToday > 0 && <> · {practicedToday} today</>}</small>}
            <Link to="/admin/students">Open student directory →</Link>
          </div>
        </Panel>}
        <Panel><div className="training-section-heading"><h2>Student progress</h2><Link to="/admin/students">Student directory →</Link></div>{rows.length ? <div className="training-table-scroll"><table className="training-table training-progress-table"><thead><tr><th>Student</th><th>Assigned passage</th><th>Mastery</th><th>Review</th></tr></thead><tbody>{rows.map((s, index) => {
          const percent = s.eligibleUnitCount > 0 ? Math.min(100, Math.round(s.masteredCount / s.eligibleUnitCount * 100)) : null;
          return <tr key={`${s.studentUserId}-${index}`}><td><Link className="training-student-link" to={`/admin/seasons/${selected.id}/students/${s.studentUserId}/progress`}><ProfileAvatar userId={s.studentUserId} displayName={s.displayName} /><strong>{s.displayName}</strong></Link></td><td data-label="Assigned passage">{formatPassageCitation(s)}</td><td data-label="Mastery"><div className="training-table-mastery"><strong>{percent === null ? "—" : `${percent}%`}</strong>{percent !== null && <progress value={percent} max={100} aria-label={`${s.displayName} assigned passage mastery`} />}</div><small>{s.masteredCount} / {s.eligibleUnitCount} verses</small></td><td data-label="Review"><Badge tone={s.reviewDueCount ? "warning" : "neutral"}>{s.reviewDueCount ? `${s.reviewDueCount} due` : s.attemptCount ? "Up to date" : "Not started"}</Badge></td></tr>;
        })}</tbody></table></div> : <div className="training-empty"><p>No students assigned to this season yet.</p><Link to={`/admin/seasons/${selected.id}?step=students`}>Assign your first passage →</Link></div>}</Panel>
      </>}
      <div className="training-coach-actions"><div className="training-controls"><LinkButton to={`/admin/seasons/${selected.id}?step=students`}>Manage assignments <AppIcon name="arrow" /></LinkButton><LinkButton variant="secondary" to="/admin/practice">Plan team practice <AppIcon name="arrow" /></LinkButton></div></div>
      <Panel as="div" className="training-your-training"><span className="training-icon-tile"><AppIcon name="flame" /></span><div><strong>Your training</strong><small>{myStreak && myStreak.current > 0 && myXp ? `${myStreak.current}-day streak · Rank ${myXp.level} · ${myXp.total} XP` : "Practice in student mode to keep your own streak."}</small></div><Link to="/student">Open your Training HQ →</Link></Panel>
    </>}
  </div>;
}
