import { expect, it } from 'vitest';
import { readVerseSelection, scriptureSegments } from './selection';

it('anchors a phrase across marked text nodes without including the verse number', () => {
  document.body.innerHTML = '<p><button>1</button><span data-verse-text="v1">The <mark>Lord</mark> is my shepherd.</span></p>';
  const span = document.querySelector('[data-verse-text]')!;
  const range = document.createRange(); range.setStart(span.firstChild!, 0); range.setEnd(span.lastChild!, 6);
  expect(readVerseSelection(range)).toEqual({ sourceUnitId: 'v1', startOffset: 0, endOffset: 14 });
});
it('rejects selections crossing verses, controls, or empty space', () => {
  document.body.innerHTML = '<p><button>1</button><span data-verse-text="a">One</span><span data-verse-text="b">Two</span></p>';
  const spans = document.querySelectorAll('span'), range = document.createRange();
  range.setStart(spans[0].firstChild!, 0); range.setEnd(spans[1].firstChild!, 3);
  expect(readVerseSelection(range)).toBeNull();
  range.selectNodeContents(document.querySelector('button')!); expect(readVerseSelection(range)).toBeNull();
  range.setStart(spans[0].firstChild!, 1); range.collapse(true); expect(readVerseSelection(range)).toBeNull();
});
it('preserves exact text and renders the latest overlapping color with selected boundaries', () => {
  const parts = scriptureSegments('abcdefghij', [{ startOffset: 0, endOffset: 6, color: 'Promises', updatedAtUtc: '2026-01-01', id: 'a' }, { startOffset: 4, endOffset: 8, color: 'People', updatedAtUtc: '2026-01-02', id: 'b' }], { startOffset: 2, endOffset: 5 });
  expect(parts).toEqual([
    { text: 'ab', color: 'Promises', selected: false }, { text: 'cd', color: 'Promises', selected: true },
    { text: 'e', color: 'People', selected: true }, { text: 'f', color: 'People', selected: false },
    { text: 'gh', color: 'People', selected: false }, { text: 'ij', color: null, selected: false },
  ]);
});
