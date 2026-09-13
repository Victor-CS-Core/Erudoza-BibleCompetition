import { useEffect, useRef, useState } from 'react';
import type { HighlightColor, NotebookEntry, SourceUnit } from '../../api/types';
import { Button, Panel } from '../ui';
import { readVerseSelection, scriptureSegments, type VerseSelection } from './selection';

export const highlightColors: HighlightColor[] = ['Promises', 'People', 'Review'];
export type SelectedPassage = VerseSelection & { unit: SourceUnit };
export function StudyReader({ units, entries, ready, onHighlight, onNote, onOpenNotes, targetSourceId, targetVisit }: {
  units: SourceUnit[]; entries: NotebookEntry[]; ready: boolean;
  onHighlight: (selection: SelectedPassage, color: HighlightColor) => void;
  onNote: (selection: SelectedPassage) => void; onOpenNotes: (sourceId: string) => void; targetSourceId?: string | null; targetVisit?: number;
}) {
  const [selection, setSelection] = useState<SelectedPassage | null>(null), [hidden, setHidden] = useState(false), [selectionError, setSelectionError] = useState('');
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dragging = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSelection = () => {
      if (hidden || dragging) return;
      const browserSelection = window.getSelection();
      if (!browserSelection?.rangeCount || browserSelection.isCollapsed) return;
      const range = browserSelection.getRangeAt(0);
      if (!region.current?.contains(range.startContainer)) return;
      const read = readVerseSelection(range), unit = units.find(u => u.id === read?.sourceUnitId);
      if (!read || !unit) { setSelection(null); setSelectionError('Select words within one verse, or use a verse number.'); return; }
      // Capture the finished range before rendering marks/tools changes its DOM nodes.
      browserSelection.removeAllRanges();
      setSelection({ ...read, unit }); setSelectionError('');
    };
    const pointerDown = () => { dragging = true; clearTimeout(timer); };
    const pointerUp = () => { dragging = false; onSelection(); };
    const selectionChanged = () => { clearTimeout(timer); if (!dragging) timer = setTimeout(onSelection, 180); };
    document.addEventListener('pointerdown', pointerDown);
    document.addEventListener('pointerup', pointerUp);
    document.addEventListener('pointercancel', pointerUp);
    document.addEventListener('keyup', onSelection);
    document.addEventListener('selectionchange', selectionChanged);
    return () => { clearTimeout(timer); document.removeEventListener('pointerdown', pointerDown); document.removeEventListener('pointerup', pointerUp); document.removeEventListener('pointercancel', pointerUp); document.removeEventListener('keyup', onSelection); document.removeEventListener('selectionchange', selectionChanged); };
  }, [units, hidden]);
  useEffect(() => {
    if (targetSourceId) region.current?.querySelector<HTMLButtonElement>(`[data-select-source="${CSS.escape(targetSourceId)}"]`)?.focus({ preventScroll: false });
  }, [targetSourceId, targetVisit]);
  function selectVerse(unit: SourceUnit) { window.getSelection()?.removeAllRanges(); setSelection({ unit, sourceUnitId: unit.id, startOffset: 0, endOffset: unit.canonicalText.length }); setHidden(false); setSelectionError(''); }
  return <div ref={region} data-testid="source-unit-list" role="region" aria-label="Scripture verses">
    <p className="ds-study-caption">Select a phrase, or choose a verse number to study the whole verse.</p>
    {selectionError && <p role="status" className="ds-study-caption">{selectionError}</p>}
    {units.map(unit => {
      const active = selection?.sourceUnitId === unit.id ? selection : null;
      const highlights = entries.filter(e => e.kind === 'highlight' && e.sourceUnitId === unit.id);
      const notes = entries.filter(e => e.kind === 'note' && e.sourceUnitId === unit.id);
      return <div key={unit.id} className="study-verse-block">
        <p className="study-verse"><Button variant="ghost" size="compact" className="ds-verse-number" data-select-source={unit.id} aria-label={`Select verse ${unit.verse}`} aria-pressed={!!active} onClick={() => selectVerse(unit)}>{unit.verse}</Button><span data-verse-text={unit.id} className="ds-scripture-text">{scriptureSegments(unit.canonicalText, highlights, active).map((part, index) => {
          if (hidden && part.selected) return <span key={index} className="ds-scripture-concealed" aria-label="Hidden words">{'•'.repeat(Math.min(part.text.length, 18))}</span>;
          const style = `ds-scripture-highlight ${part.color ? `ds-highlight-${part.color.toLowerCase()}` : ''} ${part.selected ? 'ds-scripture-selected' : ''}`;
          return part.color ? <mark key={index} className={style} title={`${part.color} highlight`}>{part.text}</mark> : <span key={index} className={part.selected ? 'ds-scripture-selected' : undefined}>{part.text}</span>;
        })}</span></p>
        {active && <Panel className="study-selection-tools" aria-label="Selected passage tools"><div className="study-tools-heading"><small>{unit.citation} · Selected text</small><Button size="compact" variant="ghost" aria-label="Clear selection" onClick={() => { setSelection(null); setHidden(false); window.getSelection()?.removeAllRanges(); }}>Close</Button></div><div className="study-tools-row"><span className="ds-study-caption">Highlight</span>{highlightColors.map(color => <Button key={color} variant="secondary" size="compact" disabled={!ready} aria-pressed={highlights.some(e => e.startOffset === active.startOffset && e.endOffset === active.endOffset && e.color === color)} onClick={() => onHighlight(active, color)}><span aria-hidden="true" className={`ds-highlight-swatch ds-highlight-${color.toLowerCase()}`} />{color}</Button>)}</div><div className="study-tools-row"><Button variant="ghost" size="compact" disabled={!ready} onClick={() => onNote(active)}>Note</Button><Button variant="ghost" size="compact" aria-pressed={hidden} onClick={() => { window.getSelection()?.removeAllRanges(); setHidden(!hidden); }}>{hidden ? 'Reveal words' : 'Hide words'}</Button></div></Panel>}
        {!!notes.length && <Button className="study-note-link" size="compact" variant="ghost" onClick={() => onOpenNotes(unit.id)}>{notes.length} personal {notes.length === 1 ? 'note' : 'notes'} · verse {unit.verse}</Button>}
      </div>;
    })}
    {!units.length && <p>No stored verses are available for this chapter.</p>}
  </div>;
}
