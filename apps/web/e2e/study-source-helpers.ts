import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { ChallengeCard } from '../src/api/types';

export interface StoredSource { id: string; citation: string; canonicalText: string; bookKey: string; chapter: number; verse: number; ordinal: number }
export async function json<T>(api: APIRequestContext, path: string, data?: unknown): Promise<T> {
  const response = data === undefined ? await api.get(path) : await api.post(path, { data });
  expect(response.ok(), `${path}: HTTP ${response.status()}`).toBeTruthy();
  return response.status() === 204 ? undefined as T : response.json() as Promise<T>;
}

// Answers come from the coach's normal stored-content API for this synthetic fixture.
// The browser receives redacted real cards; no engine import, answer-key lookup or debug endpoint is used.
export async function answerCard(page: Page, card: ChallengeCard, sources: StoredSource[]) {
  const source = card.activityType === 'ReferenceMatch'
    ? sources.find(s => s.canonicalText === card.prompt)
    : sources.find(s => s.citation === card.citation);
  expect(source, `Stored source for ${card.activityType}`).toBeTruthy();
  const current = source!;
  if (card.activityType === 'MissingWords') {
    const words = current.canonicalText.split(' ');
    await page.getByTestId('missing-words-answer').fill(card.tokens.filter(t => t.hidden).map(t => words[t.index]).join(' '));
  } else if (card.activityType === 'VerseBuilder') {
    // Reconstruct by consuming the stored source. indexOf sorting loses repeated phrases
    // such as "of the", and the UI may split the same source differently by difficulty.
    const arrange = (rest: string, phrases: string[]): string[] | null => {
      if (!phrases.length) return rest === '' ? [] : null;
      for (const phrase of new Set(phrases)) {
        if (rest !== phrase && !rest.startsWith(`${phrase} `)) continue;
        const remaining = [...phrases];
        remaining.splice(remaining.indexOf(phrase), 1);
        const suffix = arrange(rest.slice(phrase.length).trimStart(), remaining);
        if (suffix) return [phrase, ...suffix];
      }
      return null;
    };
    const ordered = arrange(current.canonicalText, card.tokens.map(t => t.display));
    expect(ordered, 'Card phrases must reconstruct the normal stored source').not.toBeNull();
    expect(ordered!.join(' ')).toBe(current.canonicalText);
    for (const phrase of ordered!) {
      const button = page.getByRole('button', {name:`Add ${phrase}`,exact:true}).and(page.locator(':enabled')).first();
      await button.focus();
      await page.keyboard.press('Enter');
    }
  } else if (card.activityType === 'ReferenceMatch') {
    if (card.choices?.length) await page.getByRole('radio', { name: current.citation, exact: true }).check();
    else await page.getByTestId('missing-words-answer').fill(current.citation);
  } else if (card.activityType === 'TrueFalse') {
    const statement = card.prompt.slice(card.prompt.indexOf('? ') + 2);
    await page.getByTestId(statement === current.canonicalText ? 'true-false-true' : 'true-false-false').click();
  } else if (card.activityType === 'WhatComesNext') {
    const next = sources.find(s => s.ordinal === current.ordinal + 1);
    expect(next).toBeTruthy();
    await page.getByTestId('missing-words-answer').fill(next!.canonicalText);
  } else throw new Error(`Unsupported fixture activity: ${card.activityType}`);
}
