import { useRef, type KeyboardEvent } from "react";
import { Button } from "../../components/ui";
import type { ChapterOption, VerseSelection } from "./chapterAssignments";

/**
 * Chapter strip: the season-eligible chapters of one book as a compact,
 * glanceable strip. Tap a chapter to toggle it, drag across chapters to
 * paint a range, or shift-click to extend from the last tapped chapter.
 * Selected chapters collapse into range chips; chapters narrowed to verse
 * ranges get their own `chapter:verses` chips and a gold underline.
 *
 * Only season-eligible chapters render, and only chapters with remaining
 * verses are selectable — out-of-range values can never be offered.
 */
export function ChapterStrip({ bookName, options, selected, verseRanges, disabled, onSelect, onRemoveChapter }: {
  bookName: string;
  options: ChapterOption[];
  selected: number[];
  verseRanges: VerseSelection[];
  disabled?: boolean;
  onSelect: (chapters: number[], select: boolean) => void;
  onRemoveChapter: (chapter: number) => void;
}) {
  const selectedSet = new Set(selected);
  const refinedChapters = new Set(verseRanges.map(range => range.chapter));
  const selectable = options.filter(option => option.remaining.length > 0);
  const selectableChapters = selectable.map(option => option.chapter);
  const gridRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ start: number; value: boolean; moved: boolean } | null>(null);
  const anchor = useRef<number | null>(null);

  const inRange = (from: number, to: number) => {
    const low = Math.min(from, to), high = Math.max(from, to);
    return selectableChapters.filter(chapter => chapter >= low && chapter <= high);
  };
  const toggle = (chapter: number) => onSelect([chapter], !selectedSet.has(chapter));

  const handlePointerDown = (chapter: number) => () => {
    if (disabled) return;
    gesture.current = { start: chapter, value: !selectedSet.has(chapter), moved: false };
  };
  const handlePointerOver = (chapter: number) => () => {
    const current = gesture.current;
    if (!current || disabled || chapter === current.start) return;
    current.moved = true;
    onSelect(inRange(current.start, chapter), current.value);
  };
  const endGesture = () => { gesture.current = null; };
  const handleClick = (chapter: number) => (event: { shiftKey: boolean }) => {
    if (disabled) return;
    const current = gesture.current;
    gesture.current = null;
    if (current?.moved) { anchor.current = chapter; return; }
    if (event.shiftKey && anchor.current !== null && anchor.current !== chapter) {
      onSelect(inRange(anchor.current, chapter), true);
    } else {
      toggle(chapter);
    }
    anchor.current = chapter;
  };

  const focusCell = (chapter: number) => {
    gridRef.current?.querySelector<HTMLButtonElement>(`button[data-chapter="${chapter}"]`)?.focus();
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    const active = document.activeElement as HTMLElement | null;
    const current = active?.dataset?.chapter ? Number(active.dataset.chapter) : NaN;
    if (!Number.isFinite(current)) return;
    const index = selectableChapters.indexOf(current);
    if (index < 0) return;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = selectableChapters[index + 1] ?? null;
    else if (event.key === "ArrowLeft") next = selectableChapters[index - 1] ?? null;
    else if (event.key === "Home") next = selectableChapters[0] ?? null;
    else if (event.key === "End") next = selectableChapters[selectableChapters.length - 1] ?? null;
    if (next !== null) { event.preventDefault(); focusCell(next); }
  };

  const whole = [...selectedSet].filter(chapter => !refinedChapters.has(chapter)).sort((a, b) => a - b);
  const refined = [...selectedSet].filter(chapter => refinedChapters.has(chapter)).sort((a, b) => a - b);
  const wholeSpans = collapseSpans(whole);
  const versesByChapter = new Map<number, VerseSelection[]>();
  for (const range of verseRanges) {
    const list = versesByChapter.get(range.chapter) ?? [];
    list.push(range);
    versesByChapter.set(range.chapter, list);
  }

  return <div className="planner-strip-wrap">
    <ul className="planner-strip-legend" aria-label="Chapter cell meanings">
      <li><span className="planner-strip-swatch" aria-hidden="true" />Available</li>
      <li><span className="planner-strip-swatch is-selected" aria-hidden="true" />Selected</li>
      <li><span className="planner-strip-swatch is-saved" aria-hidden="true" />Already saved</li>
      <li><span className="planner-strip-swatch is-limited" aria-hidden="true" />Limited availability</li>
      <li><span className="planner-strip-swatch is-refined" aria-hidden="true" />Verse ranges</li>
    </ul>
    <div ref={gridRef} className="planner-strip" role="group" onPointerUp={endGesture} onPointerCancel={endGesture} onPointerLeave={endGesture} onKeyDown={handleKeyDown}
      aria-label={`${bookName} chapters. Activate a chapter to select it, or drag across chapters to select a range.`}>
      {options.map(option => {
        const saved = option.remaining.length === 0;
        const isSelected = selectedSet.has(option.chapter);
        const limited = !saved && (option.partial || option.remaining.length < option.available.length);
        const isRefined = isSelected && refinedChapters.has(option.chapter);
        const label = `Chapter ${option.chapter}${saved ? " (already saved)" : limited ? " (limited availability)" : ""}`;
        return <button key={option.chapter} type="button" data-chapter={option.chapter}
          className={`planner-strip-cell${isSelected ? " is-selected" : ""}${saved ? " is-saved" : ""}${limited ? " is-limited" : ""}${isRefined ? " is-refined" : ""}`}
          aria-pressed={isSelected} aria-label={label} disabled={saved || disabled}
          onPointerDown={handlePointerDown(option.chapter)} onPointerOver={handlePointerOver(option.chapter)} onClick={handleClick(option.chapter)}>
          {option.chapter}
        </button>;
      })}
    </div>
    <p className="planner-strip-count" aria-live="polite"><strong>{selected.length}</strong> of {selectable.length} chapters selected</p>
    {wholeSpans.length || refined.length ? <ul className="planner-strip-chips" aria-label={`Selected chapters in ${bookName}`}>
      {wholeSpans.map(span => {
        const label = formatChapterSpan(span);
        const chapters = whole.filter(chapter => chapter >= span[0] && chapter <= span[1]);
        return <li key={label}><span className="planner-strip-chip">{label}
          <Button variant="ghost" size="compact" onClick={() => onSelect(chapters, false)} aria-label={`Remove ${label}`}>✕</Button>
        </span></li>;
      })}
      {refined.map(chapter => {
        const label = formatChapterVerses(chapter, versesByChapter.get(chapter) ?? []);
        return <li key={`refined-${chapter}`}><span className="planner-strip-chip">{label}
          <Button variant="ghost" size="compact" onClick={() => onRemoveChapter(chapter)} aria-label={`Remove chapter ${chapter}`}>✕</Button>
        </span></li>;
      })}
    </ul> : <p className="planner-caption">No chapters selected yet.</p>}
    <div className="planner-strip-actions">
      <Button variant="secondary" size="compact" disabled={disabled || !selectableChapters.length || selected.length === selectableChapters.length}
        onClick={() => onSelect(selectableChapters, true)}>Select all chapters</Button>
      <Button variant="ghost" size="compact" disabled={disabled || !selected.length} onClick={() => onSelect([...selectedSet], false)}>Clear</Button>
    </div>
    <p className="planner-caption">Tip: drag across chapters to select a range. On a keyboard, use the arrow keys to move and Enter to select.</p>
  </div>;
}

function collapseSpans(chapters: number[]): [number, number][] {
  const spans: [number, number][] = [];
  let start: number | null = null, prev: number | null = null;
  for (const chapter of chapters) {
    if (start === null) { start = prev = chapter; continue; }
    if (chapter === (prev as number) + 1) { prev = chapter; continue; }
    spans.push([start, prev as number]);
    start = prev = chapter;
  }
  if (start !== null) spans.push([start, prev as number]);
  return spans;
}

const formatChapterSpan = ([start, end]: [number, number]) => start === end ? `Ch ${start}` : `Ch ${start}–${end}`;

function formatChapterVerses(chapter: number, ranges: VerseSelection[]): string {
  const spans = ranges.map(range => range.startVerse === range.endVerse ? `${range.startVerse}` : `${range.startVerse}–${range.endVerse}`).join(", ");
  return `${chapter}:${spans}`;
}
