import type { Assignment, PassageRange } from "../../api/types";
import { orderCoordinates, segmentRanges, withinRange, type Coordinate } from "./passageRanges";

export type ChapterAssignmentContext = { studentId: string; contentPackId: string; type: string };
export type ChapterOption = { chapter: number; available: Coordinate[]; remaining: Coordinate[]; partial: boolean };
/** Coach-picked verse spans inside one chapter. Multiple spans may be non-contiguous. */
export type VerseSelection = { chapter: number; startVerse: number; endVerse: number };
export type SaveChapterAssignmentsInput = {
  selectedChapters: number[];
  /** Optional per-chapter verse spans. A chapter listed here is narrowed from whole-chapter to exactly these spans. */
  verseSelections?: VerseSelection[];
  eligible: Coordinate[];
  all: Coordinate[];
  context: ChapterAssignmentContext;
  readAssignments: (signal: AbortSignal) => Promise<Assignment[]>;
  assign: (range: PassageRange, signal: AbortSignal) => Promise<Assignment>;
  onProgress?: (progress: { completedChapters: number[] }) => void;
};
export type SaveChapterAssignmentsResult = {
  assignments?: Assignment[];
  remainingChapters: number[];
  completedChapters: number[];
  saved: number;
  error?: Error;
};

const coordinateKey = (unit: Coordinate) => JSON.stringify([unit.bookKey, unit.chapter, unit.verse]);
const uniqueCoordinates = (units: Coordinate[]) => orderCoordinates([...new Map(units.map(unit => [coordinateKey(unit), unit])).values()]);
const matchesContext = (item: Assignment, context: ChapterAssignmentContext) => item.studentUserId === context.studentId && item.type === context.type && (!item.contentPackId || item.contentPackId === context.contentPackId);

/** Call with the selected book's stored coordinates and saved season eligibility. */
export function chapterOptions(eligible: Coordinate[], all: Coordinate[], existing: Assignment[], context: ChapterAssignmentContext): ChapterOption[] {
  const stored = uniqueCoordinates(all);
  const eligibleKeys = new Set(eligible.map(coordinateKey));
  const available = stored.filter(unit => eligibleKeys.has(coordinateKey(unit)));
  const matching = existing.filter(item => matchesContext(item, context));
  return [...new Set(available.map(unit => unit.chapter))].sort((a, b) => a - b).map(chapter => {
    const units = available.filter(unit => unit.chapter === chapter);
    return {
      chapter,
      available: units,
      remaining: units.filter(unit => !matching.some(item => withinRange(unit, item))),
      partial: units.length < stored.filter(unit => unit.chapter === chapter).length,
    };
  });
}

export function chapterRanges(selectedChapters: number[], eligible: Coordinate[], all: Coordinate[], existing: Assignment[], context: ChapterAssignmentContext): PassageRange[] {
  const selected = new Set(selectedChapters);
  const stored = uniqueCoordinates(all);
  return chapterOptions(eligible, stored, existing, context)
    .filter(option => selected.has(option.chapter))
    .flatMap(option => segmentRanges(option.remaining, stored.filter(unit => unit.chapter === option.chapter)));
}

/** Merge overlapping or adjacent verse spans within each chapter. Defensive: normalizes reversed spans. */
export function mergeVerseRanges(ranges: VerseSelection[]): VerseSelection[] {
  const byChapter = new Map<number, VerseSelection[]>();
  for (const range of ranges) {
    const startVerse = Math.min(range.startVerse, range.endVerse);
    const endVerse = Math.max(range.startVerse, range.endVerse);
    const list = byChapter.get(range.chapter) ?? [];
    list.push({ chapter: range.chapter, startVerse, endVerse });
    byChapter.set(range.chapter, list);
  }
  return [...byChapter.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([, list]) => {
      const merged: VerseSelection[] = [];
      for (const range of list.sort((a, b) => a.startVerse - b.startVerse)) {
        const last = merged.at(-1);
        if (last && range.startVerse <= last.endVerse + 1) last.endVerse = Math.max(last.endVerse, range.endVerse);
        else merged.push({ ...range });
      }
      return merged;
    });
}

/** Narrow a chapter's remaining units to the coach's verse selections. No selections means the whole chapter. */
export function selectedUnits(option: ChapterOption, verseSelections: VerseSelection[]): Coordinate[] {
  const ranges = verseSelections.filter(selection => selection.chapter === option.chapter);
  if (!ranges.length) return option.remaining;
  return option.remaining.filter(unit => ranges.some(range => unit.verse >= range.startVerse && unit.verse <= range.endVerse));
}

const formatVerseSpan = (startVerse: number, endVerse: number) => startVerse === endVerse ? `v. ${startVerse}` : `vv. ${startVerse}–${endVerse}`;
/** "v. 16" or "vv. 16–18" for a verse token. */
export const formatVerseSelection = (selection: VerseSelection) => formatVerseSpan(selection.startVerse, selection.endVerse);

/** Describe saved assignment ranges as a compact citation, e.g. "1, 2, 3:16–18". Whole chapters collapse to their number. */
export function describeAssignmentRanges(ranges: PassageRange[], units: Coordinate[]): string {
  const chapters = [...new Set(units.map(unit => unit.chapter))].sort((a, b) => a - b);
  const parts: string[] = [];
  for (const chapter of chapters) {
    const chapterUnits = units.filter(unit => unit.chapter === chapter);
    if (!chapterUnits.length) continue;
    const probe = chapterUnits[0];
    const verses = [...new Set(chapterUnits.map(unit => unit.verse))].sort((a, b) => a - b);
    const covered = verses.filter(verse => ranges.some(range => withinRange({ ...probe, verse }, range)));
    if (!covered.length) continue;
    if (covered.length === verses.length) { parts.push(String(chapter)); continue; }
    const spans: string[] = [];
    let spanStart = covered[0], spanEnd = covered[0];
    for (const verse of covered.slice(1)) {
      if (verse === spanEnd + 1) spanEnd = verse;
      else { spans.push(spanStart === spanEnd ? String(spanStart) : `${spanStart}–${spanEnd}`); spanStart = spanEnd = verse; }
    }
    spans.push(spanStart === spanEnd ? String(spanStart) : `${spanStart}–${spanEnd}`);
    parts.push(`${chapter}:${spans.join(", ")}`);
  }
  return parts.join(", ");
}

const asError = (error: unknown) => error instanceof Error ? error : new Error(typeof error === "string" ? error : "Could not save chapter assignments.");
const mergeAssignments = (existing: Assignment[], confirmed: Assignment[]) => [...new Map([...existing, ...confirmed].map(item => [item.id, item])).values()];

/** Bound both fetch and response decoding. Aborting does not prove a write was rolled back. */
export async function withAssignmentTimeout<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("The assignment request timed out. Check your connection and try again."));
      controller.abort();
    }, 30_000);
  });
  try { return await Promise.race([request(controller.signal), deadline]); }
  finally { clearTimeout(timer!); }
}

/** The write API is non-idempotent: never repeat a failed range without a new user attempt. */
export async function saveChapterAssignments(input: SaveChapterAssignmentsInput): Promise<SaveChapterAssignmentsResult> {
  const { selectedChapters, verseSelections = [], eligible, all, context, readAssignments, assign } = input;
  const selected = new Set(selectedChapters);
  const confirmed: Assignment[] = [];
  let assignments: Assignment[];
  let saved = 0;
  try {
    assignments = await withAssignmentTimeout(readAssignments);
  } catch (error) {
    return { saved, completedChapters: [], remainingChapters: [...selected].sort((a, b) => a - b), error: asError(error) };
  }
  const result = (error?: Error): SaveChapterAssignmentsResult => {
    const options = chapterOptions(eligible, all, assignments, context).filter(option => selected.has(option.chapter));
    return {
      assignments,
      saved,
      completedChapters: options.filter(option => !selectedUnits(option, verseSelections).length).map(option => option.chapter),
      remainingChapters: options.filter(option => selectedUnits(option, verseSelections).length).map(option => option.chapter),
      ...(error ? { error } : {}),
    };
  };
  // Keep UI chapter choices granular, but send exact contiguous coverage as one request.
  const pending = () => chapterOptions(eligible, all, assignments, context).filter(option => selected.has(option.chapter));
  const covered = (range: PassageRange) => !pending().some(option => selectedUnits(option, verseSelections).some(unit => withinRange(unit, range)));

  while (true) {
    input.onProgress?.({ completedChapters: result().completedChapters });
    const range = segmentRanges(pending().flatMap(option => selectedUnits(option, verseSelections)), uniqueCoordinates(all))[0];
    if (!range) return result();
    try {
      const created = await withAssignmentTimeout(signal => assign(range, signal));
      confirmed.push(created);
      assignments = mergeAssignments(assignments, [created]);
      if (!covered(range)) return result(new Error("The saved assignment did not confirm the requested passage. Review the remaining chapters before trying again."));
      saved++;
    } catch (error) {
      const writeError = asError(error);
      try {
        assignments = mergeAssignments(await withAssignmentTimeout(readAssignments), confirmed);
      } catch (readError) {
        return result(new Error(`${writeError.message} Could not verify saved assignments: ${asError(readError).message}`, { cause: writeError }));
      }
      if (!covered(range)) return result(writeError);
      // A response can be lost after persistence. Continue only with fresh proof of full coverage.
      confirmed.push(...assignments.filter(item => matchesContext(item, context)
        && eligible.some(unit => withinRange(unit, range) && withinRange(unit, item))));
      saved++;
    }
  }
}
