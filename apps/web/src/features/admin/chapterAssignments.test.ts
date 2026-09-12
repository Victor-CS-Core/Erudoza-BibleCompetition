import { describe, expect, it } from "vitest";
import type { Assignment, PassageRange } from "../../api/types";
import { chapterOptions, chapterRanges, saveChapterAssignments } from "./chapterAssignments";
import type { Coordinate } from "./passageRanges";

const context = { studentId: "student-a", contentPackId: "pack-a", type: "PrimarySpecialist" };
const chapter = (number: number, verses: number[]): Coordinate[] => verses.map(verse => ({ bookKey: "John", chapter: number, verse }));
const assignment = (changes: Partial<Assignment> = {}): Assignment => ({
  id: "assignment-a", studentUserId: "student-a", contentPackId: "pack-a", type: "PrimarySpecialist",
  bookKey: "John", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1, ...changes,
});

describe("chapterOptions", () => {
  it("offers only eligible chapters and labels scope-limited chapters as partial", () => {
    const all = [...chapter(1, [1, 2, 3]), ...chapter(2, [1, 2]), ...chapter(3, [1, 2])];
    const eligible = [...chapter(1, [2, 3]), ...chapter(3, [1, 2])];
    expect(chapterOptions(eligible, all, [], context)).toEqual([
      { chapter: 1, available: chapter(1, [2, 3]), remaining: chapter(1, [2, 3]), partial: true },
      { chapter: 3, available: chapter(3, [1, 2]), remaining: chapter(3, [1, 2]), partial: false },
    ]);
  });

  it("allows overlap across students, roles, packs, and books", () => {
    const all = chapter(1, [1, 2, 3, 4, 5]);
    const existing = [
      assignment({ studentUserId: "student-b" }),
      assignment({ type: "RequiredCoverage", startVerse: 2, endVerse: 2 }),
      assignment({ contentPackId: "pack-b", startVerse: 3, endVerse: 3 }),
      assignment({ bookKey: "Mark", startVerse: 4, endVerse: 4 }),
      assignment({ startVerse: 5, endVerse: 5 }),
    ];
    expect(chapterOptions(all, all, existing, context)[0]?.remaining).toEqual(chapter(1, [1, 2, 3, 4]));
  });

  it("recognizes legacy assignments and multi-chapter bounds without changing the partial label", () => {
    const all = [...chapter(1, [1, 2, 3]), ...chapter(2, [1, 2]), ...chapter(3, [1, 2])];
    const existing = [assignment({ contentPackId: undefined, startVerse: 2, endChapter: 3, endVerse: 1 })];
    expect(chapterOptions(all, all, existing, context)).toEqual([
      { chapter: 1, available: chapter(1, [1, 2, 3]), remaining: chapter(1, [1]), partial: false },
      { chapter: 2, available: chapter(2, [1, 2]), remaining: [], partial: false },
      { chapter: 3, available: chapter(3, [1, 2]), remaining: chapter(3, [2]), partial: false },
    ]);
  });

  it("sorts and deduplicates coordinates while rejecting eligible coordinates absent from storage", () => {
    const all = [...chapter(3, [2, 1, 1]), ...chapter(1, [3, 2, 1])];
    const eligible = [...chapter(3, [2, 1, 1]), ...chapter(1, [3, 1]), ...chapter(9, [9])];
    expect(chapterOptions(eligible, all, [], context)).toEqual([
      { chapter: 1, available: chapter(1, [1, 3]), remaining: chapter(1, [1, 3]), partial: true },
      { chapter: 3, available: chapter(3, [1, 2]), remaining: chapter(3, [1, 2]), partial: false },
    ]);
  });
});

describe("chapterRanges", () => {
  it("splits at excluded, already assigned, and missing verses and keeps each chapter separate", () => {
    const all = [...chapter(1, [1, 2, 3, 4, 5]), ...chapter(2, [1]), ...chapter(3, [1, 3])];
    const eligible = [...chapter(1, [1, 3, 4, 5]), ...chapter(2, [1]), ...chapter(3, [1, 3])];
    const existing = [assignment({ startVerse: 4, endVerse: 4 })];
    expect(chapterRanges([3, 1, 3, 99], eligible, all, existing, context)).toEqual([
      { bookKey: "John", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1 },
      { bookKey: "John", startChapter: 1, startVerse: 3, endChapter: 1, endVerse: 3 },
      { bookKey: "John", startChapter: 1, startVerse: 5, endChapter: 1, endVerse: 5 },
      { bookKey: "John", startChapter: 3, startVerse: 1, endChapter: 3, endVerse: 1 },
      { bookKey: "John", startChapter: 3, startVerse: 3, endChapter: 3, endVerse: 3 },
    ]);
  });

  it("does not merge adjacent complete chapters into a larger assignment", () => {
    const all = [...chapter(1, [1, 2]), ...chapter(2, [1, 2])];
    expect(chapterRanges([1, 2], all, all, [], context)).toEqual([
      { bookKey: "John", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 2 },
      { bookKey: "John", startChapter: 2, startVerse: 1, endChapter: 2, endVerse: 2 },
    ]);
  });

  it("produces no writes for empty, unknown, or fully assigned chapter selections", () => {
    const all = chapter(1, [1]);
    expect(chapterRanges([], all, all, [], context)).toEqual([]);
    expect(chapterRanges([99], all, all, [], context)).toEqual([]);
    expect(chapterRanges([1], all, all, [assignment()], context)).toEqual([]);
  });
});

describe("saveChapterAssignments", () => {
  it("saves arbitrary chapters sequentially using one fresh read and confirmed responses", async () => {
    const all = [...chapter(1, [1, 2]), ...chapter(2, [1]), ...chapter(3, [1, 2])];
    const stored: Assignment[] = [];
    const events: string[] = [];
    const result = await saveChapterAssignments({
      selectedChapters: [3, 1], eligible: all, all, context,
      readAssignments: async () => { events.push("read"); return [...stored]; },
      assign: async range => {
        events.push(`start ${range.startChapter}`);
        await Promise.resolve();
        const saved = assignment({ id: `saved-${range.startChapter}`, ...range });
        stored.push(saved);
        events.push(`finish ${range.startChapter}`);
        return saved;
      },
    });
    expect(events).toEqual(["read", "start 1", "finish 1", "start 3", "finish 3"]);
    expect(stored.map(item => [item.startChapter, item.startVerse, item.endChapter, item.endVerse])).toEqual([[1, 1, 1, 2], [3, 1, 3, 2]]);
    expect(result).toEqual({ assignments: stored, saved: 2, completedChapters: [1, 3], remainingChapters: [] });
  });

  it("reconciles existing assignments before writing even when every selected chapter is complete", async () => {
    const all = chapter(1, [1]);
    const stored = [assignment()];
    const written: PassageRange[] = [];
    const result = await saveChapterAssignments({
      selectedChapters: [1], eligible: all, all, context,
      readAssignments: async () => stored,
      assign: async range => { written.push(range); return assignment(range); },
    });
    expect(written).toEqual([]);
    expect(result).toEqual({ assignments: stored, saved: 0, completedChapters: [1], remainingChapters: [] });
  });

  it("stops on a failed range and resumes only missing verses on a new attempt", async () => {
    const all = [...chapter(1, [1, 2, 3]), ...chapter(3, [1, 2])];
    const eligible = [...chapter(1, [1, 3]), ...chapter(3, [1, 2])];
    const stored: Assignment[] = [];
    const attempted: PassageRange[] = [];
    const unavailable = new Error("Service unavailable");
    let fail = true;
    const input = {
      selectedChapters: [1, 3], eligible, all, context,
      readAssignments: async () => [...stored],
      assign: async (range: PassageRange) => {
        attempted.push(range);
        if (fail && range.startVerse === 3) throw unavailable;
        const saved = assignment({ id: `saved-${stored.length}`, ...range });
        stored.push(saved);
        return saved;
      },
    };
    const first = await saveChapterAssignments(input);
    expect(attempted.map(range => [range.startChapter, range.startVerse])).toEqual([[1, 1], [1, 3]]);
    expect(first).toEqual({ assignments: [...stored], saved: 1, completedChapters: [], remainingChapters: [1, 3], error: unavailable });
    fail = false;
    const second = await saveChapterAssignments({ ...input, selectedChapters: first.remainingChapters });
    expect(attempted.map(range => [range.startChapter, range.startVerse])).toEqual([[1, 1], [1, 3], [1, 3], [3, 1]]);
    expect(stored.map(item => [item.startChapter, item.startVerse, item.endVerse])).toEqual([[1, 1, 1], [1, 3, 3], [3, 1, 2]]);
    expect(second).toEqual({ assignments: stored, saved: 2, completedChapters: [1, 3], remainingChapters: [] });
  });

  it("continues after a lost response only when fresh readback confirms the entire attempted range", async () => {
    const all = [...chapter(1, [1, 2]), ...chapter(3, [1])];
    const stored: Assignment[] = [];
    const attempted: number[] = [];
    let reads = 0;
    const result = await saveChapterAssignments({
      selectedChapters: [1, 3], eligible: all, all, context,
      readAssignments: async () => { reads++; return [...stored]; },
      assign: async range => {
        attempted.push(range.startChapter);
        const saved = assignment({ id: `saved-${range.startChapter}`, ...range });
        stored.push(saved);
        if (range.startChapter === 1) throw new Error("Response lost");
        return saved;
      },
    });
    expect(attempted).toEqual([1, 3]);
    expect(reads).toBe(2);
    expect(result).toEqual({ assignments: stored, saved: 2, completedChapters: [1, 3], remainingChapters: [] });
  });

  it("retains successful saves and both errors when reconciliation also fails", async () => {
    const all = [...chapter(1, [1]), ...chapter(2, [1])];
    const stored: Assignment[] = [];
    const attempted: number[] = [];
    let reads = 0;
    const result = await saveChapterAssignments({
      selectedChapters: [1, 2], eligible: all, all, context,
      readAssignments: async () => {
        if (++reads > 1) throw new Error("Readback offline");
        return [...stored];
      },
      assign: async range => {
        attempted.push(range.startChapter);
        const saved = assignment({ id: `saved-${range.startChapter}`, ...range });
        stored.push(saved);
        if (range.startChapter === 2) throw new Error("Write response lost");
        return saved;
      },
    });
    expect(attempted).toEqual([1, 2]);
    expect(result.saved).toBe(1);
    expect(result.assignments).toEqual([stored[0]]);
    expect(result.completedChapters).toEqual([1]);
    expect(result.remainingChapters).toEqual([2]);
    expect(result.error?.message).toContain("Write response lost");
    expect(result.error?.message).toContain("Readback offline");
  });

  it("makes no writes and preserves the error when the initial assignment read fails", async () => {
    const all = chapter(1, [1]);
    const offline = new Error("Assignments offline");
    const written: PassageRange[] = [];
    const result = await saveChapterAssignments({
      selectedChapters: [1], eligible: all, all, context,
      readAssignments: async () => { throw offline; },
      assign: async range => { written.push(range); return assignment(range); },
    });
    expect(written).toEqual([]);
    expect(result).toEqual({ saved: 0, completedChapters: [], remainingChapters: [1], error: offline });
  });

  it("does not treat partial readback coverage as a successful write", async () => {
    const all = [...chapter(1, [1, 2]), ...chapter(2, [1])];
    const stored: Assignment[] = [];
    const attempted: number[] = [];
    const lost = new Error("Response lost");
    const result = await saveChapterAssignments({
      selectedChapters: [1, 2], eligible: all, all, context,
      readAssignments: async () => [...stored],
      assign: async range => { attempted.push(range.startChapter); stored.push(assignment()); throw lost; },
    });
    expect(attempted).toEqual([1]);
    expect(result).toEqual({ assignments: stored, saved: 0, completedChapters: [], remainingChapters: [1, 2], error: lost });
  });

  it("preserves confirmed writes if a later error readback omits them", async () => {
    const all = [...chapter(1, [1]), ...chapter(2, [1])];
    const first = assignment({ id: "saved-1" });
    const lost = new Error("Response lost");
    const result = await saveChapterAssignments({
      selectedChapters: [1, 2], eligible: all, all, context,
      readAssignments: async () => [],
      assign: async range => { if (range.startChapter === 2) throw lost; return first; },
    });
    expect(result).toEqual({ assignments: [first], saved: 1, completedChapters: [1], remainingChapters: [2], error: lost });
  });

  it("stops if a successful response does not cover the requested range", async () => {
    const all = chapter(1, [1, 2]);
    const attempted: PassageRange[] = [];
    const result = await saveChapterAssignments({
      selectedChapters: [1], eligible: all, all, context,
      readAssignments: async () => [],
      assign: async range => { attempted.push(range); return assignment(); },
    });
    expect(attempted).toEqual([{ bookKey: "John", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 2 }]);
    expect(result.remainingChapters).toEqual([1]);
    expect(result.completedChapters).toEqual([]);
    expect(result.error).toBeInstanceOf(Error);
  });

  it("retains a recovered write when a later readback omits it", async () => {
    const all = [...chapter(1, [1]), ...chapter(2, [1]), ...chapter(3, [1])];
    const recovered = assignment({ id: "saved-1" });
    const second = assignment({ id: "saved-2", startChapter: 2, endChapter: 2 });
    const attempted: number[] = [];
    const snapshots = [[], [recovered], [second]];
    let reads = 0;
    const result = await saveChapterAssignments({
      selectedChapters: [1, 2, 3], eligible: all, all, context,
      readAssignments: async () => snapshots[Math.min(reads++, 2)],
      assign: async range => {
        attempted.push(range.startChapter);
        if (range.startChapter < 3) throw new Error("Response lost");
        return assignment({ id: "saved-3", ...range });
      },
    });
    expect(attempted).toEqual([1, 2, 3]);
    expect(result.saved).toBe(3);
    expect(result.remainingChapters).toEqual([]);
    expect(result.completedChapters).toEqual([1, 2, 3]);
    expect(result.assignments?.map(item => item.id).sort()).toEqual(["saved-1", "saved-2", "saved-3"]);
  });
});
