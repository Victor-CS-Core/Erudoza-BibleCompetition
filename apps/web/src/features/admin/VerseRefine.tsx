import { useState } from "react";
import { Button, Select } from "../../components/ui";
import { formatVerseSelection, type ChapterOption, type VerseSelection } from "./chapterAssignments";

/**
 * Per-chapter verse refinement. Rendered only for checked chapters, so the
 * From/To/Add fields can never be used before a chapter is selected and can
 * never offer verses outside the chapter's remaining availability.
 */
export function VerseRefine({ option, ranges, onAdd, onRemove }: {
  option: ChapterOption;
  ranges: VerseSelection[];
  onAdd: (range: VerseSelection) => void;
  onRemove: (range: VerseSelection) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hadRanges, setHadRanges] = useState(false);
  const hasRanges = ranges.length > 0;
  // Auto-open when the first verse range is added. The toggle stays the single
  // source of truth afterwards, so Hide always collapses the panel again.
  if (hasRanges !== hadRanges) {
    setHadRanges(hasRanges);
    if (hasRanges) setExpanded(true);
  }
  const open = expanded;
  const remainingVerses = [...new Set(option.remaining.map(unit => unit.verse))].sort((a, b) => a - b);
  const [fromVerse, setFromVerse] = useState<number | null>(null);
  const [toVerse, setToVerse] = useState<number | null>(null);
  const from = fromVerse ?? remainingVerses[0] ?? null;
  const toOptions = remainingVerses.filter(verse => from === null || verse >= from);
  const to = toVerse !== null && toOptions.includes(toVerse) ? toVerse : toOptions[0] ?? null;

  const add = () => {
    if (from === null || to === null) return;
    onAdd({ chapter: option.chapter, startVerse: from, endVerse: to });
    setFromVerse(null);
    setToVerse(null);
  };

  return <div className="planner-refine-row">
    <div className="planner-refine-head">
      <strong>Chapter {option.chapter}</strong>
      <span className="planner-refine-status">{ranges.length ? ranges.map(formatVerseSelection).join(" · ") : "Whole chapter"}</span>
      <Button variant="ghost" size="compact" onClick={() => setExpanded(current => !current)} aria-expanded={open}>
        {open ? "Hide" : "Refine"}
      </Button>
    </div>
    {open && <div className="planner-refine-body">
      {!!ranges.length && <ul className="planner-range-tokens" aria-label={`Selected verse ranges for chapter ${option.chapter}`}>
        {ranges.map(range => <li key={`${range.startVerse}-${range.endVerse}`}>
          <span className="planner-range-token">{formatVerseSelection(range)}
            <Button variant="ghost" size="compact" onClick={() => onRemove(range)} aria-label={`Remove ${formatVerseSelection(range)} from chapter ${option.chapter}`}>✕</Button>
          </span>
        </li>)}
      </ul>}
      {from === null ? <p className="planner-caption">All available verses are already assigned.</p> : <div className="planner-range-fields">
        <label>From verse<Select aria-label={`From verse in chapter ${option.chapter}`} value={from} onChange={event => { setFromVerse(Number(event.target.value)); setToVerse(null); }}>
          {remainingVerses.map(verse => <option key={verse} value={verse}>{verse}</option>)}
        </Select></label>
        <label>To verse<Select aria-label={`To verse in chapter ${option.chapter}`} value={to ?? ""} onChange={event => setToVerse(Number(event.target.value))}>
          {toOptions.map(verse => <option key={verse} value={verse}>{verse}</option>)}
        </Select></label>
        <Button variant="secondary" size="compact" onClick={add} disabled={to === null}>Add verses</Button>
      </div>}
      <p className="planner-caption">Only verses still available in this chapter are offered. Removing every range restores the whole chapter.</p>
    </div>}
  </div>;
}
