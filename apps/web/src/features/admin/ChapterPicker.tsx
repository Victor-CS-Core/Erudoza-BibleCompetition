import { Button } from "../../components/ui";
import type { ChapterOption } from "./chapterAssignments";
import { segmentRanges } from "./passageRanges";

export function ChapterPicker({ chapters, selected, onChange, bookName }: {
  chapters: ChapterOption[];
  selected: number[];
  onChange: (chapters: number[]) => void;
  bookName: string;
}) {
  const available = chapters.filter(chapter => chapter.remaining.length);
  const chosen = available.filter(chapter => selected.includes(chapter.chapter));
  return <fieldset className="season-chapter-picker">
    <legend>Select chapters</legend>
    <p>Choose one or more chapters for this student. Other students can study the same chapters.</p>
    <div className="season-chapter-actions">
      <Button variant="secondary" disabled={!available.length} onClick={() => onChange(available.map(chapter => chapter.chapter))}>Select all</Button>
      <Button variant="ghost" disabled={!selected.length} onClick={() => onChange([])}>Clear selection</Button>
    </div>
    {!chapters.length && <p>No chapters are available in this season book.</p>}
    <div className="season-chapter-grid">{chapters.map(chapter => {
      const assigned = !chapter.remaining.length;
      const partlyAssigned = !assigned && chapter.remaining.length < chapter.available.length;
      const description = `chapter-${chapter.chapter}-detail`;
      return <div key={chapter.chapter} className="season-chapter-option">
        <Button variant={selected.includes(chapter.chapter) && !assigned ? "primary" : "secondary"}
          aria-pressed={selected.includes(chapter.chapter) && !assigned} aria-describedby={description}
          disabled={assigned} onClick={() => onChange(selected.includes(chapter.chapter) ? selected.filter(value => value !== chapter.chapter) : [...selected, chapter.chapter].sort((a, b) => a - b))}>
          Chapter {chapter.chapter}
        </Button>
        <small id={description}>{assigned ? "Assigned" : partlyAssigned ? `${chapter.remaining.length} verses to add` : chapter.partial ? "Partial chapter" : `${chapter.available.length} verses`}</small>
      </div>;
    })}</div>
    {chapters.some(chapter => chapter.partial) && <details className="season-advanced-passages">
      <summary>Included verses in partial chapters</summary>
      <ul>{chapters.filter(chapter => chapter.partial).map(chapter => <li key={chapter.chapter}>Chapter {chapter.chapter}: {segmentRanges(chapter.available, chapter.available).map(range => range.startVerse === range.endVerse ? String(range.startVerse) : `${range.startVerse}–${range.endVerse}`).join(", ")}</li>)}</ul>
    </details>}
    <p role="status" className="season-chapter-summary">{chosen.length ? `${bookName} · Chapters ${chosen.map(chapter => chapter.chapter).join(", ")} · ${chosen.reduce((count, chapter) => count + chapter.remaining.length, 0)} verses to add` : "Select chapters to assign."}</p>
  </fieldset>;
}
