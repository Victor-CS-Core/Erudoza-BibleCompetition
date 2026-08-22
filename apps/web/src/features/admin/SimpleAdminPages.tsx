import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { PaperSurface } from "../../components/material/PaperSurface";

export function SeasonsListPage() {
  const { me } = useAuth();
  const seasons = useQuery({
    queryKey: ["seasons", me?.organizationId],
    queryFn: () => api.seasons(me!.organizationId),
    enabled: !!me,
  });

  return (
    <PaperSurface>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Seasons</h1>
        <Link data-testid="create-season" to="/admin/seasons/new" className="rounded-[var(--er-radius-control)] bg-[var(--er-ink-navy)] px-4 text-[var(--er-card)]">
          Create season
        </Link>
      </div>
      <ul className="mt-4 space-y-2">
        {seasons.data?.map((season) => (
          <li key={season.id}>
            <Link className="text-[var(--er-action-blue)]" to={`/admin/seasons/${season.id}`}>
              {season.name} · {season.ruleProfileKey} · {season.status}
            </Link>
          </li>
        ))}
      </ul>
    </PaperSurface>
  );
}

export function StudentsPage() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [userName, setUserName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("DevStudent!234");
  const students = useQuery({
    queryKey: ["students", me?.organizationId],
    queryFn: () => api.students(me!.organizationId),
    enabled: !!me,
  });
  const create = useMutation({
    mutationFn: () => api.createStudent(me!.organizationId, { userName, displayName, password }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["students"] }),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <PaperSurface>
      <h1 className="text-2xl font-semibold">Students</h1>
      <ul className="mt-4 space-y-1" data-testid="student-list">
        {students.data?.map((student) => (
          <li key={student.userId}>
            {student.displayName} · {student.userName}
          </li>
        ))}
      </ul>
      <form className="mt-6 grid gap-3" onSubmit={onSubmit}>
        <input className="rounded-[var(--er-radius-control)] border px-3" placeholder="Username" value={userName} onChange={(e) => setUserName(e.target.value)} />
        <input className="rounded-[var(--er-radius-control)] border px-3" placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <input className="rounded-[var(--er-radius-control)] border px-3" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="rounded-[var(--er-radius-control)] bg-[var(--er-ink-navy)] text-[var(--er-card)]" type="submit">
          Add student
        </button>
      </form>
    </PaperSurface>
  );
}

export function AssignmentsPage() {
  const { me } = useAuth();
  const seasons = useQuery({
    queryKey: ["seasons", me?.organizationId],
    queryFn: () => api.seasons(me!.organizationId),
    enabled: !!me,
  });
  const season = seasons.data?.find((item) => item.status === "Active") ?? seasons.data?.[0];
  const coverage = useQuery({
    queryKey: ["coverage", me?.organizationId, season?.id],
    queryFn: () => api.coverage(me!.organizationId, season!.id),
    enabled: !!me && !!season,
  });

  return (
    <PaperSurface>
      <h1 className="text-2xl font-semibold">Coverage</h1>
      <p className="mt-2 text-[var(--er-graphite)]">
        {coverage.data
          ? `${coverage.data.seasonName} · ${coverage.data.seasonStatus}`
          : "Open a season to create specialist and required coverage assignments."}
      </p>
      {coverage.data?.students.length ? (
        <table className="mt-4 w-full text-left text-sm" data-testid="coverage-table">
          <thead>
            <tr className="border-b border-[var(--er-border)]">
              <th className="py-2">Student</th>
              <th>Assignment</th>
              <th>Scope</th>
              <th>Mastered</th>
              <th>Due</th>
              <th>Attempts</th>
            </tr>
          </thead>
          <tbody>
            {coverage.data.students.map((student) => (
              <tr key={student.studentUserId} className="border-b border-[var(--er-border)]">
                <td className="py-2">
                  {season ? (
                    <Link className="text-[var(--er-action-blue)]" to={`/admin/seasons/${season.id}/students/${student.studentUserId}/progress`}>
                      {student.displayName} · {student.userName}
                    </Link>
                  ) : (
                    <>
                      {student.displayName} · {student.userName}
                    </>
                  )}
                </td>
                <td>{student.assignmentType}</td>
                <td>
                  {student.bookKey} {student.startChapter}:{student.startVerse}–{student.endChapter}:{student.endVerse} · {student.eligibleUnitCount} units
                </td>
                <td>{student.masteredCount}</td>
                <td>{student.reviewDueCount}</td>
                <td>{student.attemptCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-4 text-[var(--er-graphite)]">No assigned students yet.</p>
      )}
    </PaperSurface>
  );
}

export function QuestionsPage() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const seasons = useQuery({
    queryKey: ["seasons", me?.organizationId],
    queryFn: () => api.seasons(me!.organizationId),
    enabled: !!me,
  });
  const season = seasons.data?.find((item) => item.status === "Active") ?? seasons.data?.[0];
  const questions = useQuery({
    queryKey: ["questions", me?.organizationId, season?.id],
    queryFn: () => api.questions(me!.organizationId, season!.id),
    enabled: !!me && !!season,
  });
  const jobs = useQuery({
    queryKey: ["generation-jobs", me?.organizationId, season?.id],
    queryFn: () => api.generationJobs(me!.organizationId, season!.id),
    enabled: !!me && !!season,
  });
  const generate = useMutation({
    mutationFn: () => api.runGenerationJob(me!.organizationId, season!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["questions"] });
      void queryClient.invalidateQueries({ queryKey: ["generation-jobs"] });
    },
  });
  const approve = useMutation({
    mutationFn: (candidateId: string) => api.approveQuestion(me!.organizationId, candidateId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["questions"] }),
  });
  const reject = useMutation({
    mutationFn: (candidateId: string) => api.rejectQuestion(me!.organizationId, candidateId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["questions"] }),
  });

  return (
    <PaperSurface>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Question review</h1>
          <p className="mt-2 text-[var(--er-graphite)]">
            {season ? `${season.name} · generated questions stay off the study path until you approve them.` : "Create a season to generate review questions."}
          </p>
        </div>
        <button
          type="button"
          data-testid="run-generation"
          className="rounded-[var(--er-radius-control)] bg-[var(--er-ink-navy)] px-4 text-[var(--er-card)]"
          onClick={() => generate.mutate()}
          disabled={!season || generate.isPending}
        >
          Generate candidates
        </button>
      </div>
      {jobs.data?.[0] ? (
        <p className="mt-4 text-sm text-[var(--er-muted-ink)]" data-testid="generation-job-status">
          Last job {jobs.data[0].status} · {jobs.data[0].candidateCount} stored
        </p>
      ) : null}
      <ul className="mt-6 space-y-4" data-testid="question-review-list">
        {questions.data?.map((question) => (
          <li key={question.id} className="border-t border-[var(--er-border)] pt-4">
            <p className="font-medium">{question.prompt}</p>
            <p className="mt-1 text-sm text-[var(--er-muted-ink)]">
              {question.status} · {question.questionType} · {question.canonicalAnswer}
            </p>
            {question.evidence.map((item) => (
              <p key={item.sourceUnitId} className="er-scripture mt-2 text-sm">
                {item.citation}: {item.evidenceText}
              </p>
            ))}
            {question.status === "Validated" ? (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  data-testid="approve-question"
                  className="rounded-[var(--er-radius-control)] bg-[var(--er-success-ink)] px-3 text-white"
                  onClick={() => approve.mutate(question.id)}
                >
                  Approve
                </button>
                <button
                  type="button"
                  data-testid="reject-question"
                  className="rounded-[var(--er-radius-control)] border px-3"
                  onClick={() => reject.mutate(question.id)}
                >
                  Reject
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {questions.data && questions.data.length === 0 ? (
        <p className="mt-4 text-[var(--er-graphite)]">No candidates yet. Generate from the stored season scope.</p>
      ) : null}
    </PaperSurface>
  );
}
