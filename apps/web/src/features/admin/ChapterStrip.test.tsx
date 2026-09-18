import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ChapterStrip } from "./ChapterStrip";
import type { ChapterOption, VerseSelection } from "./chapterAssignments";

const units = (chapter: number, verses: number[]) => verses.map(verse => ({ bookKey: "Num", chapter, verse }));
const option = (chapter: number, remaining: number[], partial = false): ChapterOption => ({
  chapter,
  available: units(chapter, [1, 2, 3, 4, 5]),
  remaining: units(chapter, remaining),
  partial,
});

const chapterCell = (chapter: number) => screen.getByRole("button", { name: new RegExp(`^Chapter ${chapter}( \\(|$)`) });

function renderStrip(overrides: Partial<Parameters<typeof ChapterStrip>[0]> = {}) {
  const props = {
    bookName: "Numbers",
    options: [1, 2, 3, 4, 5].map(chapter => option(chapter, [1, 2, 3, 4, 5])),
    selected: [] as number[],
    verseRanges: [] as VerseSelection[],
    onSelect: vi.fn(),
    onRemoveChapter: vi.fn(),
    ...overrides,
  };
  const view = render(<ChapterStrip {...props} />);
  return { ...view, props };
}

it("renders one cell per eligible chapter and locks saved chapters", () => {
  renderStrip({ options: [option(1, []), option(2, [1, 2]), option(3, [1])] });
  expect(chapterCell(1)).toBeDisabled();
  expect(chapterCell(1)).toHaveAttribute("aria-label", "Chapter 1 (already saved)");
  expect(chapterCell(2)).toBeEnabled();
  expect(chapterCell(3)).toBeEnabled();
});

it("toggles a chapter on click and reports the selection count", () => {
  const { props, container } = renderStrip();
  fireEvent.click(chapterCell(2));
  expect(props.onSelect).toHaveBeenCalledWith([2], true);
  expect(container.querySelector(".planner-strip-count")?.textContent).toBe("0 of 5 chapters selected");
});

it("drags to paint a range, skipping saved chapters", () => {
  const { props, container } = renderStrip({ options: [option(1, []), option(2, [1, 2]), option(3, []), option(4, [1]), option(5, [1])] });
  const strip = container.querySelector(".planner-strip")!;
  fireEvent.pointerDown(chapterCell(2));
  // Touch path: the pointer is captured to the start cell, so painting goes
  // through the container's pointermove with a coordinate hit-test.
  const restoreHit = mockHitTest(chapterCell(4));
  fireEvent.pointerMove(strip, { clientX: 120, clientY: 40 });
  restoreHit();
  expect(props.onSelect).toHaveBeenCalledWith([2, 4], true);
  // The trailing click lands on the capture target (the start cell) after a
  // touch paint — it must be swallowed, not toggle the cell back off.
  fireEvent.pointerUp(strip);
  fireEvent.click(chapterCell(2));
  expect(props.onSelect).toHaveBeenCalledTimes(1);
});

it("paints a deselect range on drag without re-toggling the start cell", () => {
  const { props, container } = renderStrip({ selected: [2, 3, 4] });
  const strip = container.querySelector(".planner-strip")!;
  fireEvent.pointerDown(chapterCell(4));
  const restoreHit = mockHitTest(chapterCell(2));
  fireEvent.pointerMove(strip, { clientX: 40, clientY: 40 });
  restoreHit();
  expect(props.onSelect).toHaveBeenCalledWith([2, 3, 4], false);
  fireEvent.pointerUp(strip);
  fireEvent.click(chapterCell(4));
  expect(props.onSelect).toHaveBeenCalledTimes(1);
});

// jsdom does not implement document.elementFromPoint; the strip's touch
// paint path hit-tests through it, so stub it for drag tests.
function mockHitTest(cell: HTMLElement) {
  const original = document.elementFromPoint;
  document.elementFromPoint = (() => cell) as unknown as typeof document.elementFromPoint;
  return () => { document.elementFromPoint = original; };
}

it("shift-click extends the selection from the last tapped chapter", () => {
  const { props } = renderStrip();
  fireEvent.click(chapterCell(2));
  fireEvent.click(chapterCell(4), { shiftKey: true });
  expect(props.onSelect).toHaveBeenLastCalledWith([2, 3, 4], true);
});

it("collapses whole chapters into range chips and shows verse chips with removal", () => {
  const { props } = renderStrip({
    selected: [2, 3, 4, 6],
    verseRanges: [{ chapter: 6, startVerse: 1, endVerse: 5 }],
    options: [1, 2, 3, 4, 5, 6].map(chapter => option(chapter, [1, 2, 3, 4, 5])),
  });
  expect(screen.getByText("Ch 2–4")).toBeInTheDocument();
  expect(screen.getByText("6:1–5")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove Ch 2–4" }));
  expect(props.onSelect).toHaveBeenCalledWith([2, 3, 4], false);
  fireEvent.click(screen.getByRole("button", { name: "Remove chapter 6" }));
  expect(props.onRemoveChapter).toHaveBeenCalledWith(6);
});

it("marks limited-availability and verse-refined chapters", () => {
  renderStrip({
    options: [option(1, [1, 2, 3, 4, 5], true), option(2, [3, 4, 5]), option(3, [1])],
    selected: [2],
    verseRanges: [{ chapter: 2, startVerse: 3, endVerse: 4 }],
  });
  expect(chapterCell(1)).toHaveClass("is-limited");
  expect(chapterCell(1)).toHaveAttribute("aria-label", "Chapter 1 (limited availability)");
  expect(chapterCell(2)).toHaveClass("is-refined");
});

it("selects all available chapters and clears the selection", () => {
  const { props } = renderStrip({ options: [option(1, []), option(2, [1]), option(3, [1])], selected: [2] });
  fireEvent.click(screen.getByRole("button", { name: "Select all chapters" }));
  expect(props.onSelect).toHaveBeenCalledWith([2, 3], true);
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(props.onSelect).toHaveBeenCalledWith([2], false);
});

it("moves focus with the arrow keys", () => {
  renderStrip();
  chapterCell(2).focus();
  fireEvent.keyDown(chapterCell(2), { key: "ArrowRight" });
  expect(document.activeElement).toBe(chapterCell(3));
  fireEvent.keyDown(chapterCell(3), { key: "ArrowLeft" });
  expect(document.activeElement).toBe(chapterCell(2));
});
