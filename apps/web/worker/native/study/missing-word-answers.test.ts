import { describe, expect, it } from 'vitest';
import { evaluateMissingWordAnswers, isSpellingNearMiss } from './missing-word-answers';

describe('spelling flag (twin of wordDiff.ts isSpellingPair)', () => {
  const slot = (expected: string, submitted: string) =>
    evaluateMissingWordAnswers([{ index: 0, text: expected, hidden: true }], [{ index: 0, text: submitted }]).results[0];

  it('flags a one-letter slip and a transposition without changing the verdict or score', () => {
    // Mirrors wordDiff.test.ts: 'baptized'/'baptised' and 'receive'/'recieve'.
    expect(slot('baptized', 'baptised')).toEqual({ index: 0, isCorrect: false, expected: 'baptized', spelling: true });
    expect(slot('receive', 'recieve').spelling).toBe(true);
    const graded = evaluateMissingWordAnswers([{ index: 0, text: 'baptized', hidden: true }], [{ index: 0, text: 'baptised' }]);
    expect(graded).toMatchObject({ isCorrect: false, score: 0, evaluationCode: 'Incorrect' });
  });

  it('does not flag a genuinely different word (mirrors wordDiff.test.ts)', () => {
    expect(slot('walked', 'went').spelling).toBe(false);
    expect(slot('river', 'mountain').spelling).toBe(false);
    expect(isSpellingNearMiss('walked', 'went')).toBe(false);
    expect(isSpellingNearMiss('river', 'mountain')).toBe(false);
  });

  it('never flags correct slots or empty submissions', () => {
    expect(slot('baptized', 'Baptized,').spelling).toBe(false);
    expect(slot('baptized', '').spelling).toBe(false);
    expect(slot('baptized', '   ').spelling).toBe(false);
  });

  it('respects the exact distance boundaries of the client rule', () => {
    // <= 5 letters: distance 1 passes, distance 2 fails.
    expect(isSpellingNearMiss('faith', 'fait')).toBe(true);
    expect(isSpellingNearMiss('faith', 'fath')).toBe(true);
    expect(isSpellingNearMiss('faith', 'foth')).toBe(false);
    // Longer words: distance 2 passes, distance 3 fails.
    expect(isSpellingNearMiss('baptized', 'baptisd')).toBe(true);
    expect(isSpellingNearMiss('baptized', 'bptisd')).toBe(false);
    // Distance must also be <= a third of the longer word: 6 letters, distance 2 ok; 5 letters distance 2 already over the <=5 cap.
    expect(isSpellingNearMiss('spirit', 'sprit')).toBe(true);
    // Words under 3 letters are never spelling pairs, however close.
    expect(isSpellingNearMiss('in', 'im')).toBe(false);
    expect(isSpellingNearMiss('go', 'goo')).toBe(false);
    // Identical after normalization is not a near-miss.
    expect(isSpellingNearMiss('Word,', 'word')).toBe(false);
  });
});

describe('evaluateMissingWordAnswers', () => {
  it('does not move words across an empty blank', () => {
    const tokens = [{ index: 2, text: 'in', hidden: true }, { index: 3, text: 'the', hidden: true }];
    expect(evaluateMissingWordAnswers(tokens, [{ index: 2, text: 'in the' }, { index: 3, text: '' }]).isCorrect).toBe(false);
  });

  it('keeps an empty middle slot and rejects swapped distinct words', () => {
    const tokens = [
      { index: 2, text: 'alpha', hidden: true },
      { index: 3, text: 'beta', hidden: true },
      { index: 4, text: 'gamma', hidden: true },
    ];
    expect(evaluateMissingWordAnswers(tokens, [
      { index: 2, text: 'alpha' }, { index: 3, text: '' }, { index: 4, text: 'beta gamma' },
    ]).results).toEqual([
      { index: 2, isCorrect: true, expected: 'alpha', spelling: false },
      { index: 3, isCorrect: false, expected: 'beta', spelling: false },
      { index: 4, isCorrect: false, expected: 'gamma', spelling: false },
    ]);
    expect(evaluateMissingWordAnswers(tokens, [
      { index: 2, text: 'beta' }, { index: 3, text: 'alpha' }, { index: 4, text: 'gamma' },
    ]).isCorrect).toBe(false);
  });

  it('compares repeated slots separately in saved token order', () => {
    const tokens = [
      { index: 8, text: 'again', hidden: true },
      { index: 4, text: 'then', hidden: true },
      { index: 9, text: 'again', hidden: true },
    ];
    expect(evaluateMissingWordAnswers(tokens, [
      { index: 9, text: 'again' }, { index: 8, text: 'again' }, { index: 4, text: 'again' },
    ])).toEqual({
      isCorrect: false,
      score: 67,
      evaluationCode: 'PartialMatch',
      results: [
        { index: 8, isCorrect: true, expected: 'again', spelling: false },
        { index: 4, isCorrect: false, expected: 'then', spelling: false },
        { index: 9, isCorrect: true, expected: 'again', spelling: false },
      ],
    });
  });

  it.each([
    ['duplicate', [{ index: 2, text: 'in' }, { index: 2, text: 'the' }]],
    ['unknown', [{ index: 2, text: 'in' }, { index: 99, text: 'the' }]],
    ['visible', [{ index: 1, text: 'shown' }, { index: 2, text: 'in' }, { index: 3, text: 'the' }]],
    ['missing', [{ index: 2, text: 'in' }]],
    ['non-integer', [{ index: 2.5, text: 'in' }, { index: 3, text: 'the' }]],
    ['non-string', [{ index: 2, text: 1 }, { index: 3, text: 'the' }]],
  ])('rejects %s slot shapes', (_label, answers) => {
    const tokens = [
      { index: 1, text: 'shown', hidden: false },
      { index: 2, text: 'in', hidden: true },
      { index: 3, text: 'the', hidden: true },
    ];
    expect(() => evaluateMissingWordAnswers(tokens, answers as never)).toThrow('Invalid missing-word answers.');
  });

  it('uses existing normalization per slot while preserving hyphens and embedded whitespace', () => {
    const tokens = [
      { index: 2, text: '“Word,”', hidden: true },
      { index: 3, text: 'well-being', hidden: true },
      { index: 4, text: 'two\twords', hidden: true },
    ];
    expect(evaluateMissingWordAnswers(tokens, [
      { index: 2, text: ' word ' },
      { index: 3, text: 'WELL-BEING' },
      { index: 4, text: ' two   words ' },
    ]).isCorrect).toBe(true);
    expect(evaluateMissingWordAnswers(tokens, [
      { index: 2, text: 'word' },
      { index: 3, text: 'well being' },
      { index: 4, text: 'two words' },
    ]).isCorrect).toBe(false);
  });

  it('removes apostrophes and commas without treating commas as separators', () => {
    const tokens = [
      { index: 2, text: "king's", hidden: true },
      { index: 3, text: 'one,two', hidden: true },
    ];
    expect(evaluateMissingWordAnswers(tokens, [
      { index: 2, text: 'KINGS' }, { index: 3, text: 'onetwo' },
    ]).isCorrect).toBe(true);
    expect(evaluateMissingWordAnswers(tokens, [
      { index: 2, text: 'kings' }, { index: 3, text: 'one, two' },
    ]).isCorrect).toBe(false);
  });

  it('requires nonempty original text when a punctuation-only source normalizes empty', () => {
    const tokens = [{ index: 7, text: '“”', hidden: true }];
    expect(evaluateMissingWordAnswers(tokens, [{ index: 7, text: '' }]).isCorrect).toBe(false);
    expect(evaluateMissingWordAnswers(tokens, [{ index: 7, text: '  “ ”  ' }])).toEqual({
      isCorrect: false,
      score: 0,
      evaluationCode: 'Incorrect',
      results: [{ index: 7, isCorrect: false, expected: '“”', spelling: false }],
    });
    expect(evaluateMissingWordAnswers(tokens, [{ index: 7, text: '“”' }]).isCorrect).toBe(true);
  });
});
