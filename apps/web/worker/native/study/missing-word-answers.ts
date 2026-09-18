import { normalizeText, type Token } from './engine';

export interface MissingWordAnswer { index: number; text: string }
export interface MissingWordResult { index: number; isCorrect: boolean; expected: string }

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
    return { index: token.index, isCorrect, expected: token.text };
  });
  const isCorrect = results.every(result => result.isCorrect);
  const score = results.length ? Math.round(results.filter(result => result.isCorrect).length / results.length * 100) : 0;
  return { isCorrect, results, score, evaluationCode: isCorrect ? 'ExactMatch' : score >= 50 ? 'PartialMatch' : 'Incorrect' };
}
