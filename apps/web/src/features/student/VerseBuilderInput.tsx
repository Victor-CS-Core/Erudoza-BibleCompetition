import { useLayoutEffect, useRef } from 'react';
import { Button } from '../../components/ui';

export type ChunkPlacement = 'correct-position' | 'wrong-position' | 'not-in-verse';
export interface PlacedChunk { id: number; display: string; placement: ChunkPlacement }

const normalizeChunkWord = (word: string) => word.toLowerCase().replace(/[.,;:!?"“”‘’]/g, '');
const chunkWords = (text: string) => text.split(/\s+/).filter(Boolean).map(normalizeChunkWord);

/**
 * Per-chunk placement for the post-check feedback: each submitted chunk is
 * located in the checked verse text (from the attempt result). A chunk whose
 * words occur at the spot its submitted rank points to is in the correct
 * position; a chunk that occurs elsewhere in the verse is in the wrong
 * position; a chunk whose words never occur is not in the verse. Duplicate
 * chunks consume distinct occurrences in submitted order.
 */
export function chunkPlacements(
  tokens: { index: number; display: string }[],
  selected: number[],
  sourceText: string,
): PlacedChunk[] {
  const verseWords = chunkWords(sourceText);
  const usedStarts = new Set<number>();
  const starts = selected.map(id => {
    const token = tokens.find(t => t.index === id);
    if (!token) return -1;
    const words = chunkWords(token.display);
    if (!words.length) return -1;
    for (let start = 0; start + words.length <= verseWords.length; start++) {
      if (usedStarts.has(start)) continue;
      if (words.every((word, offset) => verseWords[start + offset] === word)) {
        usedStarts.add(start);
        return start;
      }
    }
    return -1;
  });
  const expectedOrder = starts
    .map((start, submittedRank) => ({ start, submittedRank }))
    .filter(entry => entry.start >= 0)
    .sort((a, b) => a.start - b.start || a.submittedRank - b.submittedRank);
  const expectedRankBySubmitted = new Map(expectedOrder.map((entry, rank) => [entry.submittedRank, rank]));
  return selected.map((id, submittedRank) => {
    const token = tokens.find(t => t.index === id);
    const placement: ChunkPlacement = starts[submittedRank] < 0
      ? 'not-in-verse'
      : expectedRankBySubmitted.get(submittedRank) === submittedRank ? 'correct-position' : 'wrong-position';
    return { id, display: token?.display ?? '', placement };
  });
}

const PLACEMENT_LABEL: Record<ChunkPlacement, string> = {
  'correct-position': 'Right place',
  'wrong-position': 'In the verse, but in the wrong place',
  'not-in-verse': 'Not in this verse',
};
const PLACEMENT_MARK: Record<ChunkPlacement, string> = {
  'correct-position': '✓',
  'wrong-position': '↔',
  'not-in-verse': '✕',
};

export function VerseBuilderInput({ tokens, selected, onChange, disabled, feedbackSourceText }: {
  tokens: { index: number; display: string }[];
  selected: number[];
  onChange(ids: number[]): void;
  disabled: boolean;
  /** The checked verse text from the attempt result; when present (after
   * the answer is checked) each submitted chunk gets a placement tick. */
  feedbackSourceText?: string;
}) {
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const undo = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<number | 'undo' | undefined>(undefined);
  // Focus after the controlled selection updates, when the destination is enabled.
  useLayoutEffect(() => {
    if (pendingFocus.current !== undefined) {
      (pendingFocus.current === 'undo' ? undo.current : buttons.current.get(pendingFocus.current))?.focus();
      pendingFocus.current = undefined;
    }
  }, [selected]);
  const available = tokens.filter(token => !selected.includes(token.index));
  return <div className="mt-6 space-y-3" aria-label="Verse builder">
    <p>Choose each phrase in verse order.</p>
    <p className="er-scripture" aria-label="Your verse" aria-live="polite">
      {selected.map(id => tokens.find(t => t.index === id)?.display).join(' ') || 'Your verse will appear here.'}
    </p>
    {feedbackSourceText && selected.length > 0 && <ul className="text-sm" data-testid="chunk-placements" aria-label="Where each phrase belongs" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--er-space-1)' }}>
      {chunkPlacements(tokens, selected, feedbackSourceText).map((chunk, position) => <li key={`${chunk.id}-${position}`} data-testid="chunk-placement" data-placement={chunk.placement}>
        <span className={chunk.placement === 'correct-position' ? undefined : chunk.placement === 'wrong-position' ? 'diff-token diff-missed' : 'diff-token diff-extra'} style={chunk.placement === 'correct-position' ? { color: 'var(--er-success-ink)', fontWeight: 600 } : undefined}>{PLACEMENT_MARK[chunk.placement]} {PLACEMENT_LABEL[chunk.placement]}</span>
        {' — '}{chunk.display}
      </li>)}
    </ul>}
    <div className="flex flex-wrap gap-2">
      {tokens.map(token => <Button key={token.index} ref={button => {
        if (button) buttons.current.set(token.index, button);
        else buttons.current.delete(token.index);
      }} type="button" variant="secondary" className="max-w-full whitespace-normal text-left"
        aria-label={`Add ${token.display}`} disabled={disabled || selected.includes(token.index)}
        onClick={() => {
          pendingFocus.current = available.find(t => t.index !== token.index)?.index ?? 'undo';
          onChange([...selected, token.index]);
        }}>{token.display}</Button>)}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button ref={undo} type="button" variant="secondary" disabled={disabled || !selected.length}
        onClick={() => {
          if (selected.length === 1) pendingFocus.current = selected[0];
          onChange(selected.slice(0, -1));
        }}>Undo last phrase</Button>
      <Button type="button" variant="ghost" disabled={disabled || !selected.length}
        onClick={() => {
          pendingFocus.current = tokens[0]?.index;
          onChange([]);
        }}>Clear verse</Button>
    </div>
  </div>;
}
