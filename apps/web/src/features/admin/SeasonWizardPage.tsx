import { useEffect, useRef, useState } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { lifecycleApi } from "../../api/lifecycle";
import type { PackScope, Season } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, Input, LinkButton, LoadingState, Notice, PageHeader, Panel, Select } from "../../components/ui";
import { ConfirmationDialog } from "../../components/ui/ConfirmationDialog";
import { BookAssignmentEditor, useSeasonBooks } from "./BookAssignmentEditor";
import { coordinates, multiScope, segmentRanges } from "./passageRanges";
export { RangeFields } from "./RangeFields";
import "../../styles/season-planner.css";
import "./content-library.css";
import { BookBrowser } from "../../components/scripture/BookBrowser";

export function SeasonWizardPage() {
  const { seasonId } = useParams();
  return seasonId ? <SavedPlanner key={seasonId} seasonId={seasonId} /> : <NewPlanner />;
}
export function SeasonAssignmentEditor({ seasonId, studentId, onDirtyChange }: { seasonId: string; studentId: string; onDirtyChange?: (dirty: boolean) => void }) {
  const { me } = useAuth();
  const season = useQuery({ queryKey: ["season", me!.organizationId, seasonId], queryFn: () => api.season(me!.organizationId, seasonId) });
  const students = useQuery({ queryKey: ["students", me!.organizationId], queryFn: () => api.students(me!.organizationId) });
  if (season.isPending || students.isPending) return <LoadingState label="Loading assignments…" />;
  if (season.error || students.error) return <Notice tone="danger">Assignments could not load. <Button onClick={() => { void season.refetch(); void students.refetch(); }}>Try again</Button></Notice>;
  const student = students.data?.find(student => student.userId === studentId);
  if (!student && studentId !== me!.userId) return <Notice tone="danger">This student is unavailable.</Notice>;
  return <Panel><BookAssignmentEditor key={`${seasonId}-${studentId}`} season={season.data!} studentId={studentId} onDirtyChange={onDirtyChange} name={studentId === me!.userId ? "My assignments" : student!.displayName} /></Panel>;
}
function NewPlanner() {
  return <div className="season-planner"><LinkButton variant="ghost" size="compact" to="/admin/seasons">← All seasons</LinkButton><PageHeader title="New season" description="Choose the books. Assign your students now or later." action={<Badge>Draft</Badge>} /><BookDetails /></div>;
}
function BookDetails({ season, initialPacks = [], onDirtyChange }: { season?: Season; initialPacks?: PackScope[]; onDirtyChange?: (dirty: boolean) => void }) {
  const { me } = useAuth();
  const org = me!.organizationId, cache = useQueryClient(), navigate = useNavigate();
  const library = useQuery({ queryKey: ["library", org], queryFn: () => api.library(org), retry: false });
  const [name, setName] = useState(season?.name ?? "");
  const [year, setYear] = useState(season?.yearLabel ?? String(new Date().getFullYear()));
  const [packs, setPacks] = useState(initialPacks);
  const initial = useRef(initialPacks);
  useEffect(() => { onDirtyChange?.(JSON.stringify(packs) !== JSON.stringify(initial.current)); }, [packs, onDirtyChange]);
  const created = useRef<Season | null>(season ?? null);
  const locked = !!season && ["Active", "Completed", "Archived"].includes(season.status);
  const save = useMutation({ retry: false, mutationFn: async () => {
    created.current ??= await api.createSeason(org, { name: name.trim(), yearLabel: year.trim(), ruleProfileKey: "PBE_STYLE_V1" });
    if (!locked) await api.defineScope(org, created.current.id, multiScope(packs));
    return created.current;
  }, onSuccess: async result => {
    onDirtyChange?.(false);
    if (!locked) cache.setQueryData(["season-scope", org, result.id], multiScope(packs));
    await cache.invalidateQueries({ queryKey: ["seasons"] });
    navigate(`/admin/seasons/${result.id}?step=students`);
  } });
  const names = packs.map(pack => library.data?.books.find(book => book.contentPackId === pack.contentPackId)?.name ?? pack.includes[0]?.bookKey ?? "Saved book");
  return <form className="planner-columns" onSubmit={event => { event.preventDefault(); if (!save.isPending) save.mutate(); }}>
    <Panel><fieldset className="planner-fields" disabled={save.isPending}>
      <div className="planner-section-heading"><h2>01 <span>Season details</span></h2></div>
      <div className="planner-detail-fields"><label>Season name<Input required maxLength={160} value={name} readOnly={!!season || !!created.current} onChange={event => setName(event.target.value)} placeholder="e.g. Autumn Bible Experience" /></label><label>Year<Input required value={year} readOnly={!!season || !!created.current} onChange={event => setYear(event.target.value)} /></label><div><small>Competition format</small><p>Bible Experience</p></div></div>
      <div className="planner-divider" />
      <div className="planner-section-heading"><div><h2>Books for this season</h2><p>Choose one or more whole books from the library.</p></div></div>
      {library.isPending && <LoadingState label="Loading books…" />}
      {library.isError && <Notice tone="danger">The library could not load. <Button onClick={() => void library.refetch()}>Try again</Button></Notice>}
      {locked && <Notice>Season books are locked. You can still manage assignments in an active season.</Notice>}
      <BookBrowser books={library.data?.books ?? []} renderBook={book => <label className="ds-choice planner-book-choice" key={book.contentPackId}><Input type="checkbox" disabled={locked} checked={packs.some(pack => pack.contentPackId === book.contentPackId)} onChange={event => setPacks(event.target.checked ? [...packs, { contentPackId: book.contentPackId, includes: segmentRanges(coordinates(book), coordinates(book)), excludes: [] }] : packs.filter(pack => pack.contentPackId !== book.contentPackId))} /><span><strong>{book.name}</strong><small>{initialPacks.some(pack => pack.contentPackId === book.contentPackId) ? "Saved season selection retained" : "Whole book"}</small></span></label>} />
      {packs.filter(pack => !library.data?.books.some(book => book.contentPackId === pack.contentPackId)).map(pack => <div className="planner-saved-row" key={pack.contentPackId}><span>{pack.includes[0]?.bookKey} · Saved selection retained</span></div>)}
      {!!season && <p className="planner-caption">Existing custom selections are preserved unless you remove and reselect their book.</p>}
    </fieldset></Panel>
    <Panel as="aside" className="planner-summary"><h2>Season summary</h2><strong>{name || "Your new season"}</strong><p>{year} · Bible Experience</p><div className="planner-divider" /><ul>{names.map((name, i) => <li key={packs[i].contentPackId}>{name}</li>)}</ul>{!packs.length && <p>No books selected yet.</p>}<p>Save a draft, then assign students. You can finish later.</p>
      {save.error && <Notice tone="danger">{save.error.message}{created.current && " Your draft is saved; retry to save its books."}</Notice>}
      <Button type="submit" disabled={save.isPending || !name.trim() || !year.trim() || !packs.length || !library.isSuccess}>{save.isPending ? "Saving…" : "Save & assign students →"}</Button>
      {season ? <Button variant="ghost" disabled={save.isPending} onClick={() => setPacks(initial.current)}>Cancel changes</Button> : !save.isPending && <LinkButton variant="ghost" to="/admin/seasons">Cancel</LinkButton>}
    </Panel>
  </form>;
}
function SavedPlanner({ seasonId }: { seasonId: string }) {
  const { me } = useAuth();
  const org = me!.organizationId, cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const season = useQuery({ queryKey: ["season", org, seasonId], queryFn: () => api.season(org, seasonId) });
  const data = useSeasonBooks(seasonId);
  const students = useQuery({ queryKey: ["students", org], queryFn: () => api.students(org) });
  const assignments = useQuery({ queryKey: ["assignments", org, seasonId], queryFn: () => api.assignments(org, seasonId) });
  const [search, setSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const [switchTo, setSwitchTo] = useState<string | null>(null);
  const [confirmStart, setConfirmStart] = useState(false);
  const [lifecycle, setLifecycle] = useState<"close" | "archive" | null>(null);
  const busy = useIsMutating() > 0;
  const step = ["details", "passages"].includes(params.get("step") ?? "") ? 1 : 2;
  const selectedId = params.get("studentId") ?? students.data?.find(student => student.isActive !== false)?.userId ?? me!.userId;
  const selected = students.data?.find(student => student.userId === selectedId);
  const roster = (students.data ?? []).filter(student => `${student.displayName} ${student.userName}`.toLowerCase().includes(search.toLowerCase()));
  const nextStudent = selected ? students.data?.slice(students.data.indexOf(selected) + 1).find(student => student.isActive !== false) : undefined;
  const select = (id: string) => { setDirty(false); setParams(previous => { const next = new URLSearchParams(previous); next.set("studentId", id); next.set("step", "students"); return next; }); };
  const requestSelect = (id: string) => { if (id === selectedId) return; if (dirty) setSwitchTo(id); else select(id); };
  const assignedCount = students.data?.filter(student => assignments.data?.some(item => item.studentUserId === student.userId)).length ?? 0;
  const active = season.data?.status === "Active", closed = ["Completed", "Archived"].includes(season.data?.status ?? "");
  const activate = useMutation({ mutationFn: async () => { const result = await api.activate(org, seasonId); if (!result.activated) throw new Error(result.blockingProblems.join(" ")); }, onSuccess: async () => { setConfirmStart(false); await Promise.all(["season", "seasons", "assigned-seasons", "progress", "training-today", "training-journey"].map(key => cache.invalidateQueries({ queryKey: [key] }))); } });
  const changeLifecycle = useMutation({ mutationFn: () => lifecycleApi.transitionSeason(org, seasonId, lifecycle!), onSuccess: async () => { setLifecycle(null); await cache.invalidateQueries({ queryKey: ["season", org, seasonId] }); await cache.invalidateQueries({ queryKey: ["seasons"] }); } });
  if (season.isPending || students.isPending || assignments.isPending || data.loading) return <LoadingState label="Loading season…" />;
  if (season.error || students.error || assignments.error || data.error) return <Notice tone="danger">Season information could not load. <Button onClick={() => { void season.refetch(); void students.refetch(); void assignments.refetch(); data.retry(); }}>Try again</Button></Notice>;
  return <div className="season-planner"><LinkButton variant="ghost" size="compact" to="/admin/seasons">← All seasons</LinkButton><PageHeader title={season.data!.name} description="Your season books and assignments, in one place." action={<Badge tone={active ? "success" : "neutral"}>{season.data!.status === "ContentReady" ? "Books ready" : season.data!.status === "AssignmentsReady" ? "Plans ready" : season.data!.status}</Badge>} />
    <nav className="planner-steps" aria-label="Season setup"><Button variant={step === 1 ? "secondary" : "ghost"} disabled={busy || dirty} aria-current={step === 1 ? "step" : undefined} onClick={() => setParams({ step: "details" })}>1 · Season & books</Button><Button variant={step === 2 ? "secondary" : "ghost"} disabled={busy || dirty} aria-current={step === 2 ? "step" : undefined} onClick={() => setParams({ step: "students" })}>2 · Assignments</Button></nav>
    {step === 1 ? <BookDetails key={seasonId} onDirtyChange={setDirty} season={season.data} initialPacks={data.books.map(({ contentPackId, includes, excludes }) => ({ contentPackId, includes, excludes }))} /> : <>
      <Panel className="planner-season-strip"><div><strong>Season books</strong><p>{data.books.map(book => book.name).join(" · ") || "No books selected"}</p></div><Button variant="ghost" size="compact" disabled={busy || dirty} onClick={() => setParams({ step: "details" })}>{active || closed ? "View" : "Edit"} books</Button></Panel>
      <Panel><div className="planner-section-heading"><h2>Student assignments</h2><Badge>{assignedCount} / {students.data!.length} assigned</Badge></div>
        <div className="planner-roster-layout"><label className="planner-mobile-student">Student or coach<Select disabled={busy} value={selectedId} onChange={event => requestSelect(event.target.value)}><option value={me!.userId}>My assignments</option>{students.data!.map(student => <option key={student.userId} value={student.userId}>{student.displayName}{student.isActive === false ? " · Inactive" : ""}</option>)}</Select></label><aside className="planner-roster"><Button variant={selectedId === me!.userId ? "secondary" : "ghost"} disabled={busy} onClick={() => requestSelect(me!.userId)}>My assignments</Button><label className="planner-roster-search">Find a student<Input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>{roster.map(student => <Button key={student.userId} variant={selectedId === student.userId ? "secondary" : "ghost"} aria-pressed={selectedId === student.userId} disabled={busy} onClick={() => requestSelect(student.userId)}><span><strong>{student.displayName}</strong><small>{student.isActive === false ? "Inactive" : assignments.data!.some(item => item.studentUserId === student.userId) ? "Assigned" : "Needs a plan"}</small></span></Button>)}{!roster.length && <p>No students found.</p>}</aside>
          <div className="planner-editor">{selectedId !== me!.userId && !selected ? <Notice tone="danger">This student is unavailable. Choose another student.</Notice> : selected?.isActive === false ? <Notice>This student is inactive. Reactivate them in Students to edit assignments.</Notice> : <BookAssignmentEditor key={`${seasonId}-${selectedId}`} season={season.data!} studentId={selectedId} name={selectedId === me!.userId ? "My assignments" : selected!.displayName} nextStudent={nextStudent?.displayName} onNext={() => nextStudent && select(nextStudent.userId)} onDirtyChange={setDirty} />}</div>
        </div>
      </Panel>
      <div className="planner-finish"><div>{!dirty && !busy && <LinkButton variant="ghost" to="/admin/seasons">{active || closed ? "All seasons" : "Skip for now"}</LinkButton>}{dirty && <p>Save assignments before leaving, or choose another student to discard your edits.</p>}<p>{!active && !closed ? "Skipping keeps the season as a draft." : "Saved progress stays with this season."}</p></div>{!active && !closed && <div><Button disabled={busy || dirty || !data.books.length || !assignedCount} onClick={() => setConfirmStart(true)}>Start season</Button>{!assignedCount && <p>Assign at least one student before starting.</p>}</div>}</div>
    </>}
    {season.data!.status !== "Archived" && <div className="planner-actions">{active && <Button variant="ghost" disabled={busy || dirty} onClick={() => setLifecycle("close")}>Close season</Button>}<Button variant="ghost" disabled={busy || dirty} onClick={() => setLifecycle("archive")}>Archive season</Button></div>}
    {switchTo && <ConfirmationDialog title="Discard unsaved assignments?" description="Saved assignments are preserved. Your current unsaved choices will be cleared." confirmLabel="Discard changes" onCancel={() => setSwitchTo(null)} onConfirm={() => { select(switchTo); setSwitchTo(null); }} />}
    {confirmStart && <ConfirmationDialog title={`Start ${season.data!.name}?`} description={`${assignedCount} students have assignments. Starting opens training and locks the season books. Student plans can still be updated.`} confirmLabel="Start season" pending={activate.isPending} error={activate.error?.message} onCancel={() => setConfirmStart(false)} onConfirm={() => activate.mutate()} />}
    {lifecycle && <ConfirmationDialog title={`${lifecycle === "close" ? "Close" : "Archive"} season?`} description="Training will stop for this season. Assignments and progress are preserved. This cannot be reopened." confirmLabel={lifecycle === "close" ? "Close season" : "Archive season"} pending={changeLifecycle.isPending} error={changeLifecycle.error?.message} onCancel={() => setLifecycle(null)} onConfirm={() => changeLifecycle.mutate()} />}
  </div>;
}
