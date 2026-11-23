import { normalizeText, type Token } from './engine';

export interface MissingWordAnswer { index: number; text: string }
export interface MissingWordResult { index: number; isCorrect: boolean; expected: string; spelling: boolean }

/** Spelling near-miss rule — the worker twin of the client's
 * `isSpellingPair` in src/features/student/wordDiff.ts (the worker cannot
 * import client code, so the rule is duplicated here and must be kept in
 * step with it): both words at least 3 letters after the client's word
 * normalization (lowercase, strip .,;:!? and quote marks), Damerau-
 * Levenshtein (optimal string alignment) distance <= 1 for words up to 5
 * letters, <= 2 for longer words, and never more than a third of the
 * longer word. Feedback-only: it never changes a slot's score. */
const normalizeSpellingWord = (word: string) => word.toLowerCase().replace(/[.,;:!?"“”‘’]/g, '');

function spellingEditDistance(a: string, b: string): number {
  const rows = a.length + 1, cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

export function isSpellingNearMiss(expectedWord: string, submittedWord: string): boolean {
  const a = normalizeSpellingWord(expectedWord), b = normalizeSpellingWord(submittedWord);
  if (!a || !b || a === b) return false;
  const longer = Math.max(a.length, b.length);
  if (Math.min(a.length, b.length) < 3) return false;
  const limit = longer <= 5 ? 1 : 2;
  const distance = spellingEditDistance(a, b);
  return distance <= limit && distance <= Math.ceil(longer / 3);
}

export function evaluateMissingWordAnswers(tokens: Token[], answers: MissingWordAnswer[]): {
  isCorrect: boolean;
  results: MissingWordResult[];
  score: number;
  evaluationCode: 'ExactMatch' | 'PartialMatch' | 'Incorrect';
} {
  const tokenIndices = new Set<number>();
  for (const token of tokens) {
    if (!Number.isInteger(token.index) || tokenIndices.has(token.index)) throw new Error('Invalid missing-word answers.');
    tokenIndices.add(token.index);
  }

  const hidden = tokens.filter(token => token.hidden);
  const hiddenIndices = new Set(hidden.map(token => token.index));
  const submitted = new Map<number, string>();
  if (!Array.isArray(answers)) throw new Error('Invalid missing-word answers.');
  for (const answer of answers) {
    if (!answer || !Number.isInteger(answer.index) || typeof answer.text !== 'string' ||
      !hiddenIndices.has(answer.index) || submitted.has(answer.index)) {
      throw new Error('Invalid missing-word answers.');
    }
    submitted.set(answer.index, answer.text);
  }
  if (submitted.size !== hidden.length) throw new Error('Invalid missing-word answers.');

  const results = hidden.map(token => {
    const text = submitted.get(token.index)!;
    const normalizedExpected = normalizeText(token.text);
    const isCorrect = normalizedExpected.length > 0
      ? normalizeText(text).length > 0 && normalizeText(text) === normalizedExpected
      : text.trim().length > 0 && text.trim() === token.text.trim();
    return { index: token.index, isCorrect, expected: token.text, spelling: !isCorrect && isSpellingNearMiss(token.text, text) };
  });
  const isCorrect = results.every(result => result.isCorrect);
  const score = results.length ? Math.round(results.filter(result => result.isCorrect).length / results.length * 100) : 0;
  return { isCorrect, results, score, evaluationCode: isCorrect ? 'ExactMatch' : score >= 50 ? 'PartialMatch' : 'Incorrect' };
}
