import type { HighlightColor } from '../../api/types';
export type VerseSelection = { sourceUnitId: string; startOffset: number; endOffset: number };
function verseElement(node: Node) { return (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('[data-verse-text]') ?? null; }
export function readVerseSelection(range: Range): VerseSelection | null {
  const start = verseElement(range.startContainer), end = verseElement(range.endContainer);
  if (!start || start !== end || range.collapsed || !range.toString().trim()) return null;
  const prefix = range.cloneRange(); prefix.selectNodeContents(start); prefix.setEnd(range.startContainer, range.startOffset);
  let startOffset = prefix.toString().length, endOffset = startOffset + range.toString().length;
  const text = start.textContent ?? '';
  while (startOffset < endOffset && /\s/.test(text[startOffset])) startOffset++;
  while (endOffset > startOffset && /\s/.test(text[endOffset - 1])) endOffset--;
  return { sourceUnitId: start.dataset.verseText!, startOffset, endOffset };
}
type Highlight = { startOffset: number | null; endOffset: number | null; color: HighlightColor | null; updatedAtUtc: string; id: string };
export function scriptureSegments(text: string, highlights: Highlight[], selection?: Pick<VerseSelection, 'startOffset' | 'endOffset'> | null) {
  const valid = highlights.filter(h => h.startOffset !== null && h.endOffset !== null && h.startOffset >= 0 && h.endOffset <= text.length && h.endOffset > h.startOffset).sort((a, b) => a.updatedAtUtc.localeCompare(b.updatedAtUtc) || a.id.localeCompare(b.id));
  const edges = [...new Set([0, text.length, ...valid.flatMap(h => [h.startOffset!, h.endOffset!]), ...(selection ? [selection.startOffset, selection.endOffset] : [])])].sort((a, b) => a - b);
  return edges.slice(0, -1).map((start, i) => ({ text: text.slice(start, edges[i + 1]), color: valid.findLast(h => h.startOffset! <= start && h.endOffset! > start)?.color ?? null, selected: !!selection && start >= selection.startOffset && start < selection.endOffset }));
}
