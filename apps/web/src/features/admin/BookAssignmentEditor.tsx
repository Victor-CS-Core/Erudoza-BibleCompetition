import { useEffect, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Assignment, Season, TrainingDifficulty } from "../../api/types";
import { api } from "../../api/client";
import { lifecycleApi } from "../../api/lifecycle";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, Input, LinkButton, LoadingState, Notice, Select } from "../../components/ui";
import { ConfirmationDialog } from "../../components/ui/ConfirmationDialog";
import { coordinates, scopePacks, withinRange } from "./passageRanges";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { chapterOptions, saveChapterAssignments, withAssignmentTimeout } from "./chapterAssignments";
import "../../styles/season-planner.css";

export function useSeasonBooks(seasonId: string) {
  const { me } = useAuth();
  const org = me!.organizationId;
  const scope = useQuery({ queryKey: ["season-scope", org, seasonId], queryFn: () => api.seasonScope(org, seasonId) });
  const library = useQuery({ queryKey: ["library", org], queryFn: () => api.library(org), retry: false });
  const packs = scopePacks(scope.data);
  const legacy = packs.filter(pack => !library.data?.books.some(book => book.contentPackId === pack.contentPackId));
  const sources = useQueries({ queries: legacy.map(pack => ({ queryKey: ["source-units", org, pack.contentPackId], queryFn: () => api.sourceUnits(org, pack.contentPackId), enabled: !library.isPending })) });
  const books = packs.map(pack => {
    const book = library.data?.books.find(book => book.contentPackId === pack.contentPackId);
    const all = book ? coordinates(book) : sources[legacy.indexOf(pack)]?.data ?? [];
    const units = all.filter(unit => pack.includes.some(range => withinRange(unit, range)) && !pack.excludes.some(range => withinRange(unit, range)));
    return { ...pack, name: book?.name ?? [...new Set(pack.includes.map(range => range.bookKey))].join(", "), all, units, restricted: units.length !== all.length };
  });
  return { scope, library, books, loading: scope.isPending || library.isPending || sources.some(source => source.isPending), error: scope.error ?? sources.find(source => source.isError)?.error, retry: () => { void scope.refetch(); void library.refetch(); sources.forEach(source => void source.refetch()); } };
}

export function BookAssignmentEditor({ season, studentId, name, nextStudent, onNext, onDirtyChange, showTrainingLink = true }: {
  season: Season; studentId: string; name: string; nextStudent?: string; onNext?: () => void; onDirtyChange?: (dirty: boolean) => void; showTrainingLink?: boolean;
}) {
  const { me } = useAuth();
  const org = me!.organizationId, self = studentId === me!.userId;
  const cache = useQueryClient();
  const data = useSeasonBooks(season.id);
  const read = (signal?: AbortSignal) => self ? api.myAssignments(org, season.id, signal) : api.assignments(org, season.id, signal);
  const queryKey = self ? ["my-assignments", org, studentId, season.id] : ["assignments", org, season.id];
  const query = useQuery({ queryKey, queryFn: ({ signal }) => read(signal) });
  const saved = (query.data ?? []).filter(item => item.studentUserId === studentId);
  const [selected, setSelected] = useState<string[]>([]);
  const [role, setRole] = useState("PrimarySpecialist");
  const [difficultyEdit, setDifficulty] = useState<TrainingDifficulty | null>(null);
  const difficulty = difficultyEdit ?? saved[0]?.difficulty ?? "Standard";
  const [message, setMessage] = useState("");
  const [saveProgress, setSaveProgress] = useState({ completed: 0, total: 0 });
  const [removing, setRemoving] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const closed = ["Completed", "Archived"].includes(season.status);
  const dirty = selected.length > 0 || !!difficultyEdit && difficultyEdit !== saved[0]?.difficulty;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const refresh = async () => { await Promise.all(["assignments", "my-assignments", "season", "seasons", "coverage", "assigned-seasons", "progress", "training-today", "training-honors", "training-journey"].map(key => cache.invalidateQueries({ queryKey: [key] }))); };
  const save = useMutation({
    retry: false,
    mutationFn: async () => {
      setMessage("");
      setSaveProgress({ completed: 0, total: selected.length });
      let completed = 0;
      for (const packId of [...new Set(selected.map(key => key.split("/")[0]))]) {
        const book = data.books.find(book => book.contentPackId === packId)!;
        let confirmedDifficulty: TrainingDifficulty | undefined;
        const result = await saveChapterAssignments({ selectedChapters: selected.filter(key => key.startsWith(`${packId}/`)).map(key => Number(key.split("/")[1])), eligible: book.units, all: book.all,
          context: { studentId, contentPackId: packId, type: role }, readAssignments: read,
          assign: async (range, signal) => {
            const created = await (self ? api.assignMyself(org, season.id, { contentPackId: packId, range, type: role, difficulty }, signal) : api.assign(org, season.id, { studentUserId: studentId, contentPackId: packId, range, type: role, difficulty }, signal));
            confirmedDifficulty = created.difficulty;
            return created;
          },
          onProgress: progress => setSaveProgress({ completed: completed + progress.completedChapters.length, total: selected.length }),
        });
        if (result.assignments) {
          // Publish confirmed coverage before refreshing so a slow read cannot lock season actions.
          await cache.cancelQueries({ queryKey, exact: true });
          cache.setQueryData(queryKey, result.assignments.map(item => item.studentUserId === studentId && confirmedDifficulty ? { ...item, difficulty: confirmedDifficulty } : item));
        }
        completed += result.completedChapters.length;
        setSaveProgress({ completed, total: selected.length });
        if (result.error || result.remainingChapters.length) throw result.error ?? new Error("Some chapters could not be saved. Retry to finish this book.");
      }
      if (!self && saved.length && difficultyEdit) {
        const updated = await withAssignmentTimeout(signal => api.setDifficulty(org, season.id, studentId, difficulty, signal));
        await cache.cancelQueries({ queryKey, exact: true });
        cache.setQueryData<Assignment[]>(queryKey, current => current?.map(item => item.studentUserId === studentId ? { ...item, difficulty: updated.difficulty } : item));
      }
    },
    onSuccess: (_, advance: boolean) => { setSelected([]); setDifficulty(null); setMessage("Assignments saved."); onDirtyChange?.(false); void refresh(); if (advance) onNext?.(); },
    onError: () => { void refresh(); },
  });
  const remove = useMutation({ retry: false, mutationFn: async (packId: string) => {
    // Read again on every retry so a partial removal never repeats a successful deletion.
    const current = await read();
    for (const item of current.filter(item => item.studentUserId === studentId && (item.contentPackId === packId || !item.contentPackId && data.books.find(book => book.contentPackId === packId)?.includes.some(range => range.bookKey === item.bookKey)))) {
      if (self) await api.removeMyAssignment(org, season.id, item.id); else await lifecycleApi.removeAssignment(org, season.id, item.id);
    }
  }, onSuccess: async () => { setRemoving(null); setMessage("Assignment removed. Previous progress is preserved."); await refresh(); }, onError: refresh });
  const pending = save.isPending || remove.isPending;
  const complete = (book: typeof data.books[number], assignments: Assignment[], type = role) => book.units.length > 0 && chapterOptions(book.units, book.all, assignments, { studentId, contentPackId: book.contentPackId, type }).every(chapter => !chapter.remaining.length);
  if (data.loading || query.isPending) return <LoadingState label="Loading assignments…" />;
  if (data.error || (query.error && !query.data)) return <Notice tone="danger">Assignments could not load. <Button onClick={() => { data.retry(); void query.refetch(); }}>Try again</Button></Notice>;
  return <div className="book-assignment-editor">
    <div className="planner-section-heading"><div><div className="planner-person-heading"><ProfileAvatar userId={studentId} displayName={self ? me!.displayName : name} size={40} /><h2 ref={heading} tabIndex={-1}>{name}</h2></div><p>{self ? "Your assigned chapters power your activities in Student Mode." : "Choose chapters from the season books for this student."}</p></div><Badge>{saved.length ? "Assigned" : "Not assigned yet"}</Badge></div>
    {message && <Notice tone="success">{message}</Notice>}
    {save.isPending && <Notice>{saveProgress.total ? `Saving chapters · ${saveProgress.completed} of ${saveProgress.total} confirmed. Keep this page open.` : "Saving plan settings…"}</Notice>}
    {save.isError && <Notice tone="danger">{save.error.message} Saved assignments are preserved. Retry to finish.</Notice>}
    {closed && <Notice>This season is closed. Assignments and progress are preserved.</Notice>}
    {!data.books.length && <Notice>Choose the season books first.</Notice>}
    <fieldset className="planner-fields" disabled={closed || pending}>
      <legend>Chapters to assign</legend>
      <div className="planner-book-list">{data.books.map(book => {
        const options = chapterOptions(book.units, book.all, saved, { studentId, contentPackId: book.contentPackId, type: role });
        const available = options.filter(option => option.remaining.length).map(option => `${book.contentPackId}/${option.chapter}`);
        const allSelected = options.length > 0 && available.every(key => selected.includes(key));
        const change = (keys: string[], checked: boolean) => { save.reset(); setMessage(""); setSelected(current => checked ? [...new Set([...current, ...keys])] : current.filter(key => !keys.includes(key))); };
        return <fieldset className="planner-chapter-book" key={book.contentPackId}><legend>{book.name}</legend>
          <label className="ds-choice planner-book-choice"><Input type="checkbox" checked={allSelected} disabled={!available.length} onChange={event => change(available, event.target.checked)} /><span>Select all chapters in {book.name}</span></label>
          {book.restricted && <p className="planner-caption">Only the saved season selection is available.</p>}
          <div className="planner-chapter-grid">{options.map(option => {
            const key = `${book.contentPackId}/${option.chapter}`, assigned = !option.remaining.length;
            return <label className="ds-choice planner-chapter-choice" key={key}><Input type="checkbox" aria-label={`Chapter ${option.chapter}`} checked={assigned || selected.includes(key)} disabled={assigned} onChange={event => change([key], event.target.checked)} /><span>Chapter {option.chapter}<small>{assigned ? "Assigned" : option.partial ? "Season selection" : option.remaining.length < option.available.length ? "Partly assigned" : ""}</small></span></label>;
          })}</div>
        </fieldset>;
      })}</div>
      <details className="planner-settings"><summary>Plan settings · {difficulty}</summary><div className="planner-pair">
        <label>Assignment role<Select value={role} onChange={event => { setRole(event.target.value); setSelected([]); }}><option value="PrimarySpecialist">Specialist study</option><option value="RequiredCoverage">Required coverage</option>{self && <option value="OptionalReview">Optional review</option>}</Select></label>
        <label>Training difficulty<Select value={difficulty} onChange={event => setDifficulty(event.target.value as TrainingDifficulty)}>{["Foundation", "Standard", "Advanced"].map(value => <option key={value}>{value}</option>)}</Select></label>
      </div><p>Difficulty applies to future sessions. {self && "Save it together with a chapter assignment."}</p></details>
      <div className="planner-actions"><Button disabled={!selected.length && (self || !saved.length || !difficultyEdit)} onClick={() => save.mutate(false)}>{save.isPending && saveProgress.total ? `Saving ${saveProgress.completed} of ${saveProgress.total}…` : pending ? "Saving…" : "Save assignments"}</Button>{nextStudent && <Button variant="secondary" disabled={!selected.length && !(!self && saved.length && difficultyEdit)} onClick={() => save.mutate(true)}>Save & next student →</Button>}</div>
      {nextStudent && <p className="planner-caption">Next: {nextStudent}</p>}
    </fieldset>
    {!!saved.length && <div className="planner-saved"><h3>Saved books</h3>{data.books.filter(book => saved.some(item => item.contentPackId === book.contentPackId || !item.contentPackId && book.includes.some(range => range.bookKey === item.bookKey))).map(book => <div className="planner-saved-row" key={book.contentPackId}><div><strong>{book.name}</strong><small>{complete(book, saved) ? "Assigned" : `Chapters ${[...new Set(saved.filter(item => item.contentPackId === book.contentPackId || !item.contentPackId && book.includes.some(range => range.bookKey === item.bookKey)).flatMap(item => Array.from({ length: item.endChapter - item.startChapter + 1 }, (_, index) => item.startChapter + index)))].sort((a, b) => a - b).join(", ")} · saved assignments`}</small></div>{!closed && <Button size="compact" variant="ghost" disabled={pending} onClick={() => { remove.reset(); setRemoving(book.contentPackId); }}>Remove<span className="sr-only"> {book.name}</span></Button>}</div>)}</div>}
    {self && showTrainingLink && !dirty && !pending && <LinkButton variant="secondary" to={`/student?seasonId=${encodeURIComponent(season.id)}`}>Open Student Mode</LinkButton>}
    {removing && <ConfirmationDialog title="Remove book assignments?" description="Remove this book from this person's plan. Previous attempts and progress are preserved." confirmLabel="Remove assignments" pending={remove.isPending} error={remove.error?.message} onCancel={() => setRemoving(null)} onConfirm={() => remove.mutate(removing)} />}
  </div>;
}
