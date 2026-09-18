import { describe, expect, it } from 'vitest';
import { evaluateMissingWordAnswers } from './missing-word-answers';

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
      { index: 2, isCorrect: true, expected: 'alpha' },
      { index: 3, isCorrect: false, expected: 'beta' },
      { index: 4, isCorrect: false, expected: 'gamma' },
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
        { index: 8, isCorrect: true, expected: 'again' },
        { index: 4, isCorrect: false, expected: 'then' },
        { index: 9, isCorrect: true, expected: 'again' },
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
      results: [{ index: 7, isCorrect: false, expected: '“”' }],
    });
    expect(evaluateMissingWordAnswers(tokens, [{ index: 7, text: '“”' }]).isCorrect).toBe(true);
  });
});
