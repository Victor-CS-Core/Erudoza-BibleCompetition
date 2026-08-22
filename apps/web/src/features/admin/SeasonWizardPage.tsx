import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { ChapterTab } from "../../components/material/ChapterTab";
import { PaperSurface } from "../../components/material/PaperSurface";

export function SeasonWizardPage() {
  const { me } = useAuth();
  const { seasonId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const orgId = me!.organizationId;
  const [name, setName] = useState(`Season ${new Date().getFullYear()}`);
  const [yearLabel, setYearLabel] = useState(String(new Date().getFullYear()));
  const [bookKey, setBookKey] = useState("DAN");
  const [startVerse, setStartVerse] = useState(1);
  const [endVerse, setEndVerse] = useState(4);
  const [message, setMessage] = useState<string | null>(null);

  const packs = useQuery({ queryKey: ["packs", orgId], queryFn: () => api.contentPacks(orgId) });
  const students = useQuery({ queryKey: ["students", orgId], queryFn: () => api.students(orgId) });
  const season = useQuery({
    queryKey: ["season", orgId, seasonId],
    queryFn: () => api.season(orgId, seasonId!),
    enabled: !!seasonId,
  });
  const selectedPackId = packs.data?.[0]?.id ?? "";
  const selectedStudentId = students.data?.[0]?.userId ?? "";

  const create = useMutation({
    mutationFn: () => api.createSeason(orgId, { name, yearLabel, ruleProfileKey: "PBE_STYLE_V1" }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["seasons"] });
      navigate(`/admin/seasons/${created.id}`);
    },
  });

  const saveScope = useMutation({
    mutationFn: () =>
      api.defineScope(orgId, seasonId!, {
        contentPackId: selectedPackId,
        includes: [{ bookKey, startChapter: 1, startVerse, endChapter: 1, endVerse }],
        excludes: [],
      }),
    onSuccess: () => setMessage("Scope saved."),
  });

  const assign = useMutation({
    mutationFn: () =>
      api.assign(orgId, seasonId!, {
        studentUserId: selectedStudentId,
        type: "PrimarySpecialist",
        contentPackId: selectedPackId,
        range: { bookKey, startChapter: 1, startVerse, endChapter: 1, endVerse },
      }),
    onSuccess: () => setMessage("Assignment saved."),
  });

  const activate = useMutation({
    mutationFn: () => api.activate(orgId, seasonId!),
    onSuccess: (result) => {
      setMessage(result.activated ? "Season activated." : result.blockingProblems.join(" "));
      void queryClient.invalidateQueries({ queryKey: ["season", orgId, seasonId] });
    },
  });

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <ChapterTab label="Setup" active />
        <ChapterTab label="Roster" />
      </div>
      <PaperSurface>
        <h1 className="text-2xl font-semibold">{season.data?.name ?? "Create a season"}</h1>
        <p className="mt-1 text-sm text-[var(--er-muted-ink)]">
          Status: <span data-testid="season-status">{season.data?.status ?? "Draft"}</span>
        </p>
        {!seasonId ? (
          <form className="mt-5 grid gap-3" onSubmit={onCreate}>
            <label className="text-sm font-medium">
              Season name
              <input
                data-testid="season-name"
                className="mt-1 w-full rounded-[var(--er-radius-control)] border border-[var(--er-border)] px-3"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="text-sm font-medium">
              Year label
              <input
                className="mt-1 w-full rounded-[var(--er-radius-control)] border border-[var(--er-border)] px-3"
                value={yearLabel}
                onChange={(event) => setYearLabel(event.target.value)}
              />
            </label>
            <label className="text-sm font-medium">
              Rule profile
              <select data-testid="rule-profile" className="mt-1 w-full rounded-[var(--er-radius-control)] border border-[var(--er-border)] px-3" defaultValue="PBE_STYLE_V1">
                <option value="PBE_STYLE_V1">PBE_STYLE_V1</option>
              </select>
            </label>
            <button data-testid="save-season" className="rounded-[var(--er-radius-control)] bg-[var(--er-ink-navy)] text-[var(--er-card)]" type="submit">
              Save season
            </button>
          </form>
        ) : (
          <div className="mt-5 space-y-4">
            <label className="block text-sm font-medium">
              Content pack
              <select
                data-testid="select-content-pack"
                className="mt-1 w-full rounded-[var(--er-radius-control)] border border-[var(--er-border)] px-3"
                value={selectedPackId}
                onChange={() => undefined}
              >
                {packs.data?.map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.packKey} v{pack.version}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-sm font-medium">
                Book
                <input data-testid="scope-book" className="mt-1 w-full rounded-[var(--er-radius-control)] border px-3" value={bookKey} onChange={(e) => setBookKey(e.target.value)} />
              </label>
              <label className="text-sm font-medium">
                Start verse
                <input data-testid="scope-start" type="number" className="mt-1 w-full rounded-[var(--er-radius-control)] border px-3" value={startVerse} onChange={(e) => setStartVerse(Number(e.target.value))} />
              </label>
              <label className="text-sm font-medium">
                End verse
                <input data-testid="scope-end" type="number" className="mt-1 w-full rounded-[var(--er-radius-control)] border px-3" value={endVerse} onChange={(e) => setEndVerse(Number(e.target.value))} />
              </label>
            </div>
            <button data-testid="save-scope" type="button" className="rounded-[var(--er-radius-control)] border px-4" onClick={() => saveScope.mutate()}>
              Save scope
            </button>
            <label className="block text-sm font-medium">
              Assign student
              <select data-testid="assign-student-select" className="mt-1 w-full rounded-[var(--er-radius-control)] border px-3" value={selectedStudentId} onChange={() => undefined}>
                {students.data?.map((student) => (
                  <option key={student.userId} value={student.userId}>
                    {student.displayName}
                  </option>
                ))}
              </select>
            </label>
            <button data-testid="assign-student" type="button" className="rounded-[var(--er-radius-control)] border px-4" onClick={() => assign.mutate()}>
              Create specialist assignment
            </button>
            <button
              data-testid="activate-season"
              type="button"
              className="rounded-[var(--er-radius-control)] bg-[var(--er-success-ink)] px-4 text-white"
              onClick={() => activate.mutate()}
            >
              Activate season
            </button>
          </div>
        )}
        {message ? <p className="mt-4 text-sm text-[var(--er-success-ink)]">{message}</p> : null}
        <p className="mt-6 text-sm">
          <Link className="text-[var(--er-action-blue)]" to="/admin/seasons">
            All seasons
          </Link>
        </p>
      </PaperSurface>
    </div>
  );
}
