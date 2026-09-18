import { ProfileAvatar } from "../profile/ProfileAvatar";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { lifecycleApi } from "../../api/lifecycle";
import type { Student } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { Button, Input, LinkButton, Notice, PageHeader, Panel, Select, useToast } from "../../components/ui";
import { SeasonAssignmentEditor } from "./SeasonWizardPage";
import { ConfirmationDialog } from "../../components/ui/ConfirmationDialog";
import { StudentTable } from "./StudentTable";
import { StudentDashboardPanel } from "./StudentDashboardPanel";
import { EngagementTab } from "./EngagementTab";
import { SeasonStatusBadge } from "./SeasonStatusBadge";
import { formatPassageCitation } from "./passageRanges";

function QueryError({ retry, children }: { retry: () => void; children: string }) {
  return <Notice tone="danger">{children} <Button variant="secondary" onClick={retry}>Try again</Button></Notice>;
}

export function SeasonsListPage() {
  const { me } = useAuth();
  const seasons = useQuery({ queryKey: ["seasons", me?.organizationId], queryFn: () => api.seasons(me!.organizationId), enabled: !!me });
  return <div className="training-page">
    <PageHeader title="Seasons" description="Choose a season to manage passages and students." action={<LinkButton data-testid="create-season" to="/admin/seasons/new">Create season</LinkButton>} />
    {seasons.isPending && <p role="status">Loading seasons…</p>}
    {seasons.isError && <QueryError retry={() => void seasons.refetch()}>Unable to load seasons.</QueryError>}
    <ul className="training-list">{seasons.data?.map(season => <li key={season.id}>
      <Panel as="div" className="season-list-item"><Link className="training-season-card" to={`/admin/seasons/${season.id}`}>
        <div><h2>{season.name}</h2><p>{season.yearLabel} · {season.scopeUnitCount} verses · {season.assignmentCount} assignments</p></div>
        <SeasonStatusBadge status={season.status} />
      </Link></Panel></li>)}</ul>
    {seasons.data?.length === 0 && <Panel><p>No seasons yet. Create your first season to get started.</p></Panel>}
  </div>;
}

export function StudentsPage() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [userName, setUserName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [resetStudentId, setResetStudentId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [stateStudent, setStateStudent] = useState<Student | null>(null);
  const [dashboardStudent, setDashboardStudent] = useState<Student | null>(null);
  const [tab, setTab] = useState<"directory" | "engagement">("directory");
  const location = useLocation();
  // The context links "Student directory" / "Add student" navigate to
  // #student-directory / #add-student. Those panels only exist on the
  // Directory tab, so sync the tab when the hash targets them — otherwise
  // the tap appears to do nothing while the Engagement tab is showing.
  useEffect(() => {
    const targetId = location.hash === "#student-directory" || location.hash === "#add-student"
      ? location.hash.slice(1)
      : null;
    if (!targetId) return;
    setTab("directory");
    // The tab switch unmounts the Engagement tab and mounts the panels, so
    // wait a frame before scrolling to the revealed panel.
    const frame = requestAnimationFrame(() => {
      const panel = document.getElementById(targetId);
      if (!panel) return;
      if (typeof panel.scrollIntoView === "function") panel.scrollIntoView({ behavior: "smooth", block: "start" });
      panel.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.hash]);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const students = useQuery({ queryKey: ["students", me?.organizationId], queryFn: () => api.students(me!.organizationId), enabled: !!me });
  const create = useMutation({
    mutationFn: () => api.createStudent(me!.organizationId, { userName: userName.trim(), displayName: displayName.trim(), password }),
    onSuccess: () => { setError(null); toast.success("Student added."); setUserName(""); setDisplayName(""); setPassword(""); void queryClient.invalidateQueries({ queryKey: ["students"] }); },
    onError: err => setError(err instanceof Error ? err.message : "Unable to add student."),
  });
  const reset = useMutation({
    mutationFn: () => api.resetStudentPassword(me!.organizationId, resetStudentId!, resetPassword),
    onSuccess: () => { setError(null); toast.success("Password updated."); setResetStudentId(null); setResetPassword(""); },
    onError: err => setError(err instanceof Error ? err.message : "Unable to reset password."),
  });
  const canCreate = !!userName.trim() && !!displayName.trim() && password.length >= 8;
  const changeState = useMutation({
    mutationFn: () => lifecycleApi.setStudentActive(me!.organizationId, stateStudent!.userId, stateStudent!.isActive === false),
    onSuccess: () => { toast.success(stateStudent!.isActive === false ? "Student reactivated." : "Student deactivated. Study history is preserved."); setStateStudent(null); void queryClient.invalidateQueries({ queryKey: ["students"] }); },
  });
  function onSubmit(event: FormEvent) { event.preventDefault(); if (!canCreate || create.isPending) return; setError(null); create.mutate(); }

  return <div className="training-page">
    <PageHeader title="Students" description="Add students and manage their sign-in details." />

    {error && !resetStudentId && <Notice tone="danger">{error}</Notice>}
    <div role="tablist" aria-label="Students views" className="ds-tablist">
      <Button variant={tab === "directory" ? "primary" : "secondary"} size="compact" role="tab" aria-selected={tab === "directory"} onClick={() => setTab("directory")}>Directory</Button>
      <Button variant={tab === "engagement" ? "primary" : "secondary"} size="compact" role="tab" aria-selected={tab === "engagement"} onClick={() => setTab("engagement")}>Engagement</Button>
    </div>
    {tab === "directory" ? <>
    <Panel id="student-directory" tabIndex={-1}><h2>Student directory</h2>
      {students.isPending && <p role="status">Loading students…</p>}
      {students.isError && <QueryError retry={() => void students.refetch()}>Unable to load students.</QueryError>}
      {students.data && <StudentTable students={students.data} renderActions={student => <>

        <Button size="compact" variant="secondary" onClick={() => setDashboardStudent(student)}>Dashboard<span className="sr-only"> for {student.displayName}</span></Button>
        <LinkButton size="compact" variant="secondary" to={`/admin/assignments?studentId=${encodeURIComponent(student.userId)}`}>Manage assignments<span className="sr-only"> for {student.displayName}</span></LinkButton>
        <Button size="compact" variant="ghost" disabled={changeState.isPending} onClick={() => { changeState.reset(); setStateStudent(student); }}>{student.isActive === false ? "Reactivate" : "Deactivate"}<span className="sr-only"> {student.displayName}</span></Button>
        <Button size="compact" type="button" data-testid={`reset-password-${student.userName}`} variant="ghost" disabled={reset.isPending}
          onClick={() => { setResetStudentId(student.userId); setResetPassword(""); setError(null); }}>Reset password<span className="sr-only"> for {student.displayName}</span></Button>
      </>} />}
      {stateStudent && <ConfirmationDialog title={`${stateStudent.isActive === false ? "Reactivate" : "Deactivate"} ${stateStudent.displayName}?`}
        description={stateStudent.isActive === false ? "The student can sign in again using their existing password. Saved assignments and progress remain available." : "The student will be signed out and cannot sign in or study. Their assignments, attempts and progress are preserved. You can reactivate them later."}
        confirmLabel={stateStudent.isActive === false ? "Reactivate student" : "Deactivate student"} pending={changeState.isPending} error={changeState.error?.message}
        onCancel={() => setStateStudent(null)} onConfirm={() => changeState.mutate()} />}
      {resetStudentId && <ConfirmationDialog title={`Reset password for ${students.data?.find(student => student.userId === resetStudentId)?.displayName ?? "student"}?`}
        description="The student will need the new password the next time they sign in." confirmLabel="Save password"
        pending={reset.isPending} disabled={resetPassword.length < 8} error={error}
        onCancel={() => { setResetStudentId(null); setResetPassword(""); setError(null); }}
        onConfirm={() => { setError(null); reset.mutate(); }}>
        <label className="mt-3 block">New password for {students.data?.find(student => student.userId === resetStudentId)?.displayName}
          <Input data-testid="reset-password-input" type="password" autoComplete="new-password" required minLength={8} value={resetPassword} onChange={e => setResetPassword(e.target.value)} disabled={reset.isPending} /></label>
      </ConfirmationDialog>}
      {dashboardStudent && <StudentDashboardPanel student={dashboardStudent} onClose={() => setDashboardStudent(null)} />}
    </Panel>
    <Panel id="add-student" tabIndex={-1}><h2>Add a student</h2><p>Students sign in with a username. Passwords need at least 8 characters.</p>
      <form className="training-directory-form" onSubmit={onSubmit}>
        <label>Username<Input data-testid="student-username" autoComplete="off" required value={userName} onChange={e => setUserName(e.target.value)} disabled={create.isPending} /></label>
        <label>Display name<Input data-testid="student-display-name" required value={displayName} onChange={e => setDisplayName(e.target.value)} disabled={create.isPending} /></label>
        <label>Password<Input data-testid="student-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} disabled={create.isPending} /></label>
        <Button data-testid="add-student" type="submit" disabled={!canCreate || create.isPending}>{create.isPending ? "Adding student…" : "Add student"}</Button>
      </form>
    </Panel>
    </> : <EngagementTab />}
  </div>;
}

const assignmentLabels: Record<string, string> = { PrimarySpecialist: "Specialist", RequiredCoverage: "Required coverage", OptionalReview: "Optional review" };

export function AssignmentsPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [dirty, setDirty] = useState(false);
  const [pendingContext, setPendingContext] = useState<{ key: string; value: string } | null>(null);
  const applyContext = (key: string, value: string) => { setDirty(false); setParams(previous => { const next = new URLSearchParams(previous); next.set(key, value); return next; }); };
  const changeContext = (key: string, value: string) => { if (dirty) setPendingContext({ key, value }); else applyContext(key, value); };
  const seasons = useQuery({ queryKey: ["seasons", me?.organizationId], queryFn: () => api.seasons(me!.organizationId), enabled: !!me });
  const requestedId = params.get("seasonId");
  const studentId = params.get("studentId");
  const saving = useIsMutating() > 0;
  const students = useQuery({ queryKey: ["students", me?.organizationId], queryFn: () => api.students(me!.organizationId), enabled: !!me });
  const selectedStudent = students.data?.find(student => student.userId === studentId);
  const season = requestedId ? seasons.data?.find(item => item.id === requestedId) : seasons.data?.find(item => item.status === "Active") ?? seasons.data?.[0];
  useEffect(() => { if (!requestedId && season) setParams(previous => { const next = new URLSearchParams(previous); next.set("seasonId", season.id); return next; }, { replace: true }); }, [requestedId, season, setParams]);
  const coverage = useQuery({ queryKey: ["coverage", me?.organizationId, season?.id], queryFn: () => api.coverage(me!.organizationId, season!.id), enabled: !!me && !!season && !studentId });
  return <div className="training-page assignment-overview">
    <PageHeader title={selectedStudent ? `${selectedStudent.displayName}’s assignments` : "Assignments"} description="Choose a student and season, then assign their books." action={<LinkButton size="compact" variant="secondary" to="/admin/students">Back to students</LinkButton>} />
    {students.isPending && <p role="status">Loading students…</p>}
    {students.isError && <QueryError retry={() => void students.refetch()}>Unable to load students.</QueryError>}
    <div className="assignment-context">
      {students.data && <label>Student<Select disabled={saving} value={selectedStudent?.userId ?? ""} onChange={event => changeContext("studentId", event.target.value)}><option value="">Choose a student</option>{students.data.map(student => <option key={student.userId} value={student.userId}>{student.displayName} ({student.userName})</option>)}</Select></label>}
    {seasons.isPending && <p role="status">Loading seasons…</p>}
    {seasons.isError && <QueryError retry={() => void seasons.refetch()}>Unable to load seasons.</QueryError>}
    {!!seasons.data?.length && <label>Season <Select disabled={saving} value={season?.id ?? ""} onChange={event => changeContext("seasonId", event.target.value)}>
      {!season && <option value="" disabled>Choose a season</option>}{seasons.data.map(item => <option value={item.id} key={item.id}>{item.name}{item.status === "Completed" || item.status === "Archived" ? " · Read-only" : ""}</option>)}</Select></label>}
    </div>
    {studentId && students.isSuccess && !selectedStudent && <Notice tone="danger">This student is unavailable. Choose another student.</Notice>}
    {students.data?.length === 0 && <Panel><p>No students yet.</p><LinkButton to="/admin/students">Add a student</LinkButton></Panel>}
    {requestedId && seasons.isSuccess && !season && <Notice tone="danger">This season is unavailable. Choose another season.</Notice>}
    {seasons.data?.length === 0 && <Panel><p>No seasons yet.</p><LinkButton to="/admin/seasons/new">Create season</LinkButton></Panel>}
    {season && selectedStudent && <SeasonAssignmentEditor seasonId={season.id} studentId={selectedStudent.userId} onDirtyChange={setDirty} />}
    {season && !studentId && <Panel><h2>Assigned passages · {season.name}</h2>
      {coverage.isPending && <p role="status">Loading assignments…</p>}
      {coverage.isError && <QueryError retry={() => void coverage.refetch()}>Unable to load assignments.</QueryError>}
      {coverage.data?.students.length === 0 && <p>No assigned students yet. Choose a student above to assign their first passage.</p>}
      {!!coverage.data?.students.length && <div className="training-table-scroll assignment-coverage-scroll" role="region" aria-label="Assigned passage coverage" tabIndex={0}><table className="training-table" data-testid="coverage-table"><thead><tr><th>Student</th><th>Assignment</th><th>Passages</th><th>Mastered</th><th>Due</th><th>Attempts</th><th>Actions</th></tr></thead><tbody>
        {coverage.data.students.filter(student => !studentId || student.studentUserId === studentId).map((student, index) => <tr key={`${student.studentUserId}-${student.assignmentType}-${student.bookKey}-${student.startChapter}-${student.startVerse}-${student.endChapter}-${student.endVerse}-${index}`}>
          <td><span className="profile-person"><ProfileAvatar userId={student.studentUserId} displayName={student.displayName} /><span><Link to={`/admin/seasons/${season.id}/students/${student.studentUserId}/progress`}>{student.displayName}</Link><p>{student.userName}</p></span></span></td>
          <td>{assignmentLabels[student.assignmentType] ?? "Assigned study"}</td><td>{formatPassageCitation(student)}<p>{student.eligibleUnitCount} verses</p></td>
          <td>{student.masteredCount}</td><td>{student.reviewDueCount}</td><td>{student.attemptCount}</td><td><LinkButton size="compact" variant="secondary" to={`?seasonId=${encodeURIComponent(season.id)}&studentId=${encodeURIComponent(student.studentUserId)}`}>Manage assignments<span className="sr-only"> for {student.displayName}</span></LinkButton></td>
        </tr>)}
      </tbody></table></div>}
    </Panel>}
    {pendingContext && <ConfirmationDialog title="Discard unsaved assignments?" description="Saved assignments are preserved. Unsaved book choices will be cleared." confirmLabel="Discard changes" onCancel={() => setPendingContext(null)} onConfirm={() => { applyContext(pendingContext.key, pendingContext.value); setPendingContext(null); }} />}
  </div>;
}
