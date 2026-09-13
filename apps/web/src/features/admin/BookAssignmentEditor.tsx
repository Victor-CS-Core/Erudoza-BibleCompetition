import { useEffect, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Assignment, Season, TrainingDifficulty } from "../../api/types";
import { api } from "../../api/client";
import { lifecycleApi } from "../../api/lifecycle";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, Input, LinkButton, LoadingState, Notice, Select } from "../../components/ui";
import { ConfirmationDialog } from "../../components/ui/ConfirmationDialog";
import { coordinates, scopePacks, withinRange } from "./passageRanges";
import { chapterOptions, saveChapterAssignments } from "./chapterAssignments";
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
  const read = () => self ? api.myAssignments(org, season.id) : api.assignments(org, season.id);
  const query = useQuery({ queryKey: self ? ["my-assignments", org, studentId, season.id] : ["assignments", org, season.id], queryFn: read });
  const saved = (query.data ?? []).filter(item => item.studentUserId === studentId);
  const [selected, setSelected] = useState<string[]>([]);
  const [role, setRole] = useState("PrimarySpecialist");
  const [difficultyEdit, setDifficulty] = useState<TrainingDifficulty | null>(null);
  const difficulty = difficultyEdit ?? saved[0]?.difficulty ?? "Standard";
  const [message, setMessage] = useState("");
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
      for (const packId of selected) {
        const book = data.books.find(book => book.contentPackId === packId)!;
        const result = await saveChapterAssignments({ selectedChapters: [...new Set(book.units.map(unit => unit.chapter))], eligible: book.units, all: book.all,
          context: { studentId, contentPackId: packId, type: role }, readAssignments: read,
          assign: range => self ? api.assignMyself(org, season.id, { contentPackId: packId, range, type: role, difficulty }) : api.assign(org, season.id, { studentUserId: studentId, contentPackId: packId, range, type: role, difficulty }),
        });
        if (result.error || result.remainingChapters.length) throw result.error ?? new Error("Some chapters could not be saved. Retry to finish this book.");
      }
      if (!self && saved.length && difficultyEdit) await api.setDifficulty(org, season.id, studentId, difficulty);
    },
    onSuccess: async (_, advance: boolean) => { setSelected([]); setDifficulty(null); setMessage("Assignments saved."); onDirtyChange?.(false); await refresh(); if (advance) onNext?.(); },
    onError: async () => { await refresh(); },
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
  if (data.error || query.error) return <Notice tone="danger">Assignments could not load. <Button onClick={() => { data.retry(); void query.refetch(); }}>Try again</Button></Notice>;
  return <div className="book-assignment-editor">
    <div className="planner-section-heading"><div><h2 ref={heading} tabIndex={-1}>{name}</h2><p>{self ? "Your books power your activities in Student Mode." : "Choose the books this student will study."}</p></div><Badge>{saved.length ? "Assigned" : "Not assigned yet"}</Badge></div>
    {message && <Notice tone="success">{message}</Notice>}
    {save.isError && <Notice tone="danger">{save.error.message} Saved assignments are preserved. Retry to finish.</Notice>}
    {closed && <Notice>This season is closed. Assignments and progress are preserved.</Notice>}
    {!data.books.length && <Notice>Choose the season books first.</Notice>}
    <fieldset className="planner-fields" disabled={closed || pending}>
      <legend>Books to assign</legend>
      <div className="planner-book-list">{data.books.map(book => <label className="ds-choice planner-book-choice" key={book.contentPackId}>
        <Input type="checkbox" checked={selected.includes(book.contentPackId)} disabled={!book.units.length || complete(book, saved)} onChange={event => { save.reset(); setMessage(""); setSelected(event.target.checked ? [...selected, book.contentPackId] : selected.filter(id => id !== book.contentPackId)); }} />
        <span><strong>{book.name}</strong><small>{complete(book, saved) ? "Assigned" : book.restricted ? "Saved season selection · partial book" : "Whole book"}</small></span>
      </label>)}</div>
      <details className="planner-settings"><summary>Plan settings · {difficulty}</summary><div className="planner-pair">
        <label>Assignment role<Select value={role} onChange={event => { setRole(event.target.value); setSelected([]); }}><option value="PrimarySpecialist">Specialist study</option><option value="RequiredCoverage">Required coverage</option>{self && <option value="OptionalReview">Optional review</option>}</Select></label>
        <label>Training difficulty<Select value={difficulty} onChange={event => setDifficulty(event.target.value as TrainingDifficulty)}>{["Foundation", "Standard", "Advanced"].map(value => <option key={value}>{value}</option>)}</Select></label>
      </div><p>Difficulty applies to future sessions. {self && "Save it together with a book assignment."}</p></details>
      <div className="planner-actions"><Button disabled={!selected.length && (self || !saved.length || !difficultyEdit)} onClick={() => save.mutate(false)}>{pending ? "Saving…" : "Save assignments"}</Button>{nextStudent && <Button variant="secondary" disabled={!selected.length && !(!self && saved.length && difficultyEdit)} onClick={() => save.mutate(true)}>Save & next student →</Button>}</div>
      {nextStudent && <p className="planner-caption">Next: {nextStudent}</p>}
    </fieldset>
    {!!saved.length && <div className="planner-saved"><h3>Saved books</h3>{data.books.filter(book => saved.some(item => item.contentPackId === book.contentPackId || !item.contentPackId && book.includes.some(range => range.bookKey === item.bookKey))).map(book => <div className="planner-saved-row" key={book.contentPackId}><div><strong>{book.name}</strong><small>{complete(book, saved) ? "Assigned" : "Saved assignments · partial book or another role"}</small></div>{!closed && <Button size="compact" variant="ghost" disabled={pending} onClick={() => { remove.reset(); setRemoving(book.contentPackId); }}>Remove<span className="sr-only"> {book.name}</span></Button>}</div>)}</div>}
    {self && showTrainingLink && !dirty && !pending && <LinkButton variant="secondary" to={`/student?seasonId=${encodeURIComponent(season.id)}`}>Open Student Mode</LinkButton>}
    {removing && <ConfirmationDialog title="Remove book assignments?" description="Remove this book from this person's plan. Previous attempts and progress are preserved." confirmLabel="Remove assignments" pending={remove.isPending} error={remove.error?.message} onCancel={() => setRemoving(null)} onConfirm={() => remove.mutate(removing)} />}
  </div>;
}
