import type { Assignment, PassageRange } from "../../api/types";
import { orderCoordinates, segmentRanges, withinRange, type Coordinate } from "./passageRanges";

export type ChapterAssignmentContext = { studentId: string; contentPackId: string; type: string };
export type ChapterOption = { chapter: number; available: Coordinate[]; remaining: Coordinate[]; partial: boolean };
export type SaveChapterAssignmentsInput = {
  selectedChapters: number[];
  eligible: Coordinate[];
  all: Coordinate[];
  context: ChapterAssignmentContext;
  readAssignments: () => Promise<Assignment[]>;
  assign: (range: PassageRange) => Promise<Assignment>;
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

const asError = (error: unknown) => error instanceof Error ? error : new Error(typeof error === "string" ? error : "Could not save chapter assignments.");
const mergeAssignments = (existing: Assignment[], confirmed: Assignment[]) => [...new Map([...existing, ...confirmed].map(item => [item.id, item])).values()];

/** The write API is non-idempotent: never repeat a failed range without a new user attempt. */
export async function saveChapterAssignments(input: SaveChapterAssignmentsInput): Promise<SaveChapterAssignmentsResult> {
  const { selectedChapters, eligible, all, context, readAssignments, assign } = input;
  const selected = new Set(selectedChapters);
  const confirmed: Assignment[] = [];
  let assignments: Assignment[];
  let saved = 0;
  try {
    assignments = await readAssignments();
  } catch (error) {
    return { saved, completedChapters: [], remainingChapters: [...selected].sort((a, b) => a - b), error: asError(error) };
  }
  const result = (error?: Error): SaveChapterAssignmentsResult => {
    const options = chapterOptions(eligible, all, assignments, context).filter(option => selected.has(option.chapter));
    return {
      assignments,
      saved,
      completedChapters: options.filter(option => !option.remaining.length).map(option => option.chapter),
      remainingChapters: options.filter(option => option.remaining.length).map(option => option.chapter),
      ...(error ? { error } : {}),
    };
  };
  const covered = (range: PassageRange) => !chapterRanges([range.startChapter], eligible.filter(unit => withinRange(unit, range)), all, assignments, context).length;

  while (true) {
    const range = chapterRanges(selectedChapters, eligible, all, assignments, context)[0];
    if (!range) return result();
    try {
      const created = await assign(range);
      confirmed.push(created);
      assignments = mergeAssignments(assignments, [created]);
      if (!covered(range)) return result(new Error("The saved assignment did not confirm the requested passage. Review the remaining chapters before trying again."));
      saved++;
    } catch (error) {
      const writeError = asError(error);
      try {
        assignments = mergeAssignments(await readAssignments(), confirmed);
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
