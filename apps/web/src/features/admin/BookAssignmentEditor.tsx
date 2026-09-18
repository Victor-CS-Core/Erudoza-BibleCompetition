import { useEffect, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Assignment, Season, TrainingDifficulty } from "../../api/types";
import { api } from "../../api/client";
import { lifecycleApi } from "../../api/lifecycle";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, LinkButton, LoadingState, Notice, Select, useToast } from "../../components/ui";
import { ConfirmationDialog } from "../../components/ui/ConfirmationDialog";
import { coordinates, scopePacks, withinRange } from "./passageRanges";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { chapterOptions, describeAssignmentRanges, mergeVerseRanges, saveChapterAssignments, withAssignmentTimeout, type VerseSelection } from "./chapterAssignments";
import { VerseRefine } from "./VerseRefine";
import { ChapterStrip } from "./ChapterStrip";
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
  const [verseRanges, setVerseRanges] = useState<({ packId: string } & VerseSelection)[]>([]);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [role, setRole] = useState("PrimarySpecialist");
  const [difficultyEdit, setDifficulty] = useState<TrainingDifficulty | null>(null);
  const difficulty = difficultyEdit ?? saved[0]?.difficulty ?? "Standard";
  const toast = useToast();
  const [saveProgress, setSaveProgress] = useState({ completed: 0, total: 0 });
  const [removing, setRemoving] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const closed = ["Completed", "Archived"].includes(season.status);
  const dirty = selected.length > 0 || verseRanges.length > 0 || !!difficultyEdit && difficultyEdit !== saved[0]?.difficulty;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const addVerseRange = (packId: string, range: VerseSelection) => {
    setVerseRanges(current => {
      const others = current.filter(item => item.packId !== packId);
      const merged = mergeVerseRanges([...current.filter(item => item.packId === packId), range]);
      return [...others, ...merged.map(item => ({ ...item, packId }))];
    });
  };
  const removeVerseRange = (packId: string, range: VerseSelection) => {
    setVerseRanges(current => current.filter(item => !(item.packId === packId && item.chapter === range.chapter && item.startVerse === range.startVerse && item.endVerse === range.endVerse)));
  };
  const refresh = async () => { await Promise.all(["assignments", "my-assignments", "season", "seasons", "coverage", "assigned-seasons", "progress", "training-today", "training-honors", "training-journey"].map(key => cache.invalidateQueries({ queryKey: [key] }))); };
  const save = useMutation({
    retry: false,
    mutationFn: async () => {
      setSaveProgress({ completed: 0, total: selected.length });
      let completed = 0;
      for (const packId of [...new Set(selected.map(key => key.split("/")[0]))]) {
        const book = data.books.find(book => book.contentPackId === packId)!;
        let confirmedDifficulty: TrainingDifficulty | undefined;
        const result = await saveChapterAssignments({ selectedChapters: selected.filter(key => key.startsWith(`${packId}/`)).map(key => Number(key.split("/")[1])), verseSelections: verseRanges.filter(item => item.packId === packId), eligible: book.units, all: book.all,
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
    onSuccess: (_, advance: boolean) => { setSelected([]); setVerseRanges([]); setDifficulty(null); toast.success("Assignments saved."); onDirtyChange?.(false); void refresh(); if (advance) onNext?.(); },
    onError: () => { void refresh(); },
  });
  const remove = useMutation({ retry: false, mutationFn: async (packId: string) => {
    // Read again on every retry so a partial removal never repeats a successful deletion.
    const current = await read();
    for (const item of current.filter(item => item.studentUserId === studentId && (item.contentPackId === packId || !item.contentPackId && data.books.find(book => book.contentPackId === packId)?.includes.some(range => range.bookKey === item.bookKey)))) {
      if (self) await api.removeMyAssignment(org, season.id, item.id); else await lifecycleApi.removeAssignment(org, season.id, item.id);
    }
  }, onSuccess: async () => { setRemoving(null); toast.success("Assignment removed. Previous progress is preserved."); await refresh(); }, onError: refresh });
  const pending = save.isPending || remove.isPending;
  const complete = (book: typeof data.books[number], assignments: Assignment[], type = role) => book.units.length > 0 && chapterOptions(book.units, book.all, assignments, { studentId, contentPackId: book.contentPackId, type }).every(chapter => !chapter.remaining.length);
  if (data.loading || query.isPending) return <LoadingState label="Loading assignments…" />;
  if (data.error || (query.error && !query.data)) return <Notice tone="danger">Assignments could not load. <Button onClick={() => { data.retry(); void query.refetch(); }}>Try again</Button></Notice>;
  // One book visible at a time: with several season books the editor would
  // otherwise become a long scroll of strips. Selection state is per book, so
  // switching tabs never loses work.
  const activeBook = data.books.find(book => book.contentPackId === activeBookId) ?? data.books[0];
  const activeOptions = activeBook ? chapterOptions(activeBook.units, activeBook.all, saved, { studentId, contentPackId: activeBook.contentPackId, type: role }) : [];
  const activeRefined = activeBook ? activeOptions.filter(option => selected.includes(`${activeBook.contentPackId}/${option.chapter}`)) : [];
  const change = (keys: string[], checked: boolean) => { save.reset(); setSelected(current => checked ? [...new Set([...current, ...keys])] : current.filter(key => !keys.includes(key))); if (!checked) setVerseRanges(current => current.filter(item => !keys.includes(`${item.packId}/${item.chapter}`))); };
  const chaptersOf = (book: typeof data.books[number]) => selected.filter(key => key.startsWith(`${book.contentPackId}/`)).map(key => Number(key.split("/")[1])).sort((a, b) => a - b);
  return <div className="book-assignment-editor">
    <div className="planner-section-heading"><div><div className="planner-person-heading"><ProfileAvatar userId={studentId} displayName={self ? me!.displayName : name} size={40} /><h2 ref={heading} tabIndex={-1}>{name}</h2></div><p>{self ? "Your assigned chapters power your activities in Student Mode." : "Choose chapters from the season books for this student."}</p></div><Badge>{saved.length ? "Assigned" : "Not assigned yet"}</Badge></div>
    {save.isPending && <Notice>{saveProgress.total ? `Saving chapters · ${saveProgress.completed} of ${saveProgress.total} confirmed. Keep this page open.` : "Saving plan settings…"}</Notice>}
    {save.isError && <Notice tone="danger">{save.error.message} Saved assignments are preserved. Retry to finish.</Notice>}
    {closed && <Notice>This season is closed. Assignments and progress are preserved.</Notice>}
    {!data.books.length && <Notice>Choose the season books first.</Notice>}
    <fieldset className="planner-fields" disabled={closed || pending}>
      <legend>Chapters to assign</legend>
      {data.books.length > 1 && <div className="planner-book-tabs" role="tablist" aria-label="Season books">
        {data.books.map(book => {
          const count = chaptersOf(book).length;
          const isActive = book.contentPackId === activeBook?.contentPackId;
          return <button key={book.contentPackId} type="button" role="tab" aria-selected={isActive} className={`planner-book-tab${isActive ? " is-active" : ""}`} onClick={() => setActiveBookId(book.contentPackId)}>
            <span className="planner-book-tab-name">{book.name}</span>
            <span className="planner-book-tab-count">{count ? `${count} selected` : "None yet"}</span>
          </button>;
        })}
      </div>}
      {data.books.length > 1 && <p className="planner-book-summary" aria-label="Selection summary">{data.books.map((book, index) => {
        const chapters = chaptersOf(book);
        return <span key={book.contentPackId}>{index > 0 && " · "}<strong>{book.name}</strong> {chapters.length ? chapters.join(", ") : "—"}</span>;
      })}</p>}
      {activeBook && <fieldset className="planner-chapter-book"><legend>{activeBook.name}</legend>
        {activeBook.restricted && <p className="planner-caption">Only the saved season selection is available.</p>}
        <ChapterStrip bookName={activeBook.name} options={activeOptions}
          selected={activeOptions.filter(option => selected.includes(`${activeBook.contentPackId}/${option.chapter}`)).map(option => option.chapter)}
          verseRanges={verseRanges.filter(item => item.packId === activeBook.contentPackId)}
          disabled={closed || pending}
          onSelect={(chapters, select) => change(chapters.map(chapter => `${activeBook.contentPackId}/${chapter}`), select)}
          onRemoveChapter={chapter => change([`${activeBook.contentPackId}/${chapter}`], false)} />
        {!!activeRefined.length && <div className="planner-verse-refine">
          <h4>Refine verses <span className="planner-caption">optional</span></h4>
          {activeRefined.map(option => <VerseRefine key={option.chapter} option={option}
            ranges={verseRanges.filter(item => item.packId === activeBook.contentPackId && item.chapter === option.chapter)}
            onAdd={range => addVerseRange(activeBook.contentPackId, range)}
            onRemove={range => removeVerseRange(activeBook.contentPackId, range)} />)}
        </div>}
      </fieldset>}
      <details className="planner-settings"><summary>Plan settings · {difficulty}</summary><div className="planner-pair">
        <label>Assignment role<Select value={role} onChange={event => { setRole(event.target.value); setSelected([]); setVerseRanges([]); }}><option value="PrimarySpecialist">Specialist study</option><option value="RequiredCoverage">Required coverage</option>{self && <option value="OptionalReview">Optional review</option>}</Select></label>
        <label>Training difficulty<Select value={difficulty} onChange={event => setDifficulty(event.target.value as TrainingDifficulty)}>{["Foundation", "Standard", "Advanced"].map(value => <option key={value}>{value}</option>)}</Select></label>
      </div><p>Difficulty applies to future sessions. {self && "Save it together with a chapter assignment."}</p></details>
      <div className="planner-actions"><Button disabled={!selected.length && (self || !saved.length || !difficultyEdit)} onClick={() => save.mutate(false)}>{save.isPending && saveProgress.total ? `Saving ${saveProgress.completed} of ${saveProgress.total}…` : pending ? "Saving…" : "Save assignments"}</Button>{nextStudent && <Button variant="secondary" disabled={!selected.length && !(!self && saved.length && difficultyEdit)} onClick={() => save.mutate(true)}>Save & next student →</Button>}</div>
      {nextStudent && <p className="planner-caption">Next: {nextStudent}</p>}
    </fieldset>
    {!!saved.length && <div className="planner-saved"><h3>Saved books</h3>{data.books.filter(book => saved.some(item => item.contentPackId === book.contentPackId || !item.contentPackId && book.includes.some(range => range.bookKey === item.bookKey))).map(book => {
      const items = saved.filter(item => item.contentPackId === book.contentPackId || !item.contentPackId && book.includes.some(range => range.bookKey === item.bookKey));
      const citation = describeAssignmentRanges(items, book.all);
      return <div className="planner-saved-row" key={book.contentPackId}><div><strong>{book.name}</strong><small>{complete(book, saved) ? "Assigned" : citation ? `${citation} · saved assignments` : "saved assignments"}</small></div>{!closed && <Button size="compact" variant="ghost" disabled={pending} onClick={() => { remove.reset(); setRemoving(book.contentPackId); }}>Remove<span className="sr-only"> {book.name}</span></Button>}</div>;
    })}</div>}
    {self && showTrainingLink && !dirty && !pending && <LinkButton variant="secondary" to={`/student?seasonId=${encodeURIComponent(season.id)}`}>Open Student Mode</LinkButton>}
    {removing && <ConfirmationDialog title="Remove book assignments?" description="Remove this book from this person's plan. Previous attempts and progress are preserved." confirmLabel="Remove assignments" pending={remove.isPending} error={remove.error?.message} onCancel={() => setRemoving(null)} onConfirm={() => remove.mutate(removing)} />}
  </div>;
}
