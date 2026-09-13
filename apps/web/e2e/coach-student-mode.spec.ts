import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { assertNoOverflow, login } from './helpers';
import { answerCard, json, type StoredSource } from './study-source-helpers';
import type { Assignment, AttemptResult, ChallengeCard, ContentPack, Me, Progress, Student } from '../src/api/types';

test('coach switches workspace, assigns personal passages, studies and keeps student coverage separate', async ({ page }, info) => {
  test.setTimeout(180000);
  await login(page);
  const me = await json<Me>(page.request, '/api/v1/me');
  const org = `/api/v1/organizations/${me.organizationId}`;
  const packs = await json<ContentPack[]>(page.request, `${org}/content-packs`);
  const pack = packs.find(p => p.packKey === 'dev-daniel')!;
  const sources = (await json<StoredSource[]>(page.request, `${org}/content-packs/${pack.id}/source-units`)).sort((a, b) => a.ordinal - b.ordinal).slice(0, 3);
  expect(sources).toHaveLength(3);
  const students = await json<Student[]>(page.request, `${org}/students`);
  const season = await json<{ id: string }>(page.request, `${org}/seasons`, { name: `Coach personal ${randomUUID()}`, yearLabel: '2026', ruleProfileKey: 'PBE_STYLE_V1' });
  const range = { bookKey: sources[0].bookKey, startChapter: sources[0].chapter, startVerse: sources[0].verse, endChapter: sources[2].chapter, endVerse: sources[2].verse };
  await json(page.request, `${org}/seasons/${season.id}/scope`, { contentPackId: pack.id, includes: [range], excludes: [] });
  await json(page.request, `${org}/seasons/${season.id}/assignments`, { studentUserId: students[0].userId, contentPackId: pack.id, type: 'RequiredCoverage', range });
  await json(page.request, `${org}/seasons/${season.id}/activate`, {});
  const before = await json(page.request, `${org}/seasons/${season.id}/coverage`);
  await page.goto(`/admin/seasons/${season.id}?step=students`);
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByTestId('switch-workspace').click();
  await expect(page).toHaveURL(new RegExp(`/student\\?seasonId=${season.id}`));
  await page.goto(`/student/assignments?seasonId=${season.id}`);
  await expect(page.getByRole('heading', { name: 'My assignments', exact: true })).toBeVisible();
  await expect(page.getByText('Only the saved season selection is available.', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /^Chapter \d+$/ })).toHaveCount(1);
  await page.getByRole('checkbox', { name: `Chapter ${sources[0].chapter}`, exact: true }).check();
  const created = page.waitForResponse(r => r.url().endsWith(`/seasons/${season.id}/my-assignments`) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save assignments', exact: true }).click();
  expect((await created).ok()).toBe(true);
  await expect(page.getByText('Assignments saved.', { exact: true })).toBeVisible();
  const personal = await json<Assignment[]>(page.request, `${org}/seasons/${season.id}/my-assignments`);
  expect(personal).toHaveLength(1);
  expect(personal[0]).toMatchObject({ studentUserId: me.userId, contentPackId: pack.id, ...range });
  await expect(page.getByRole('checkbox', { name: `Chapter ${sources[0].chapter}`, exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: `Chapter ${sources[0].chapter}`, exact: true })).toBeDisabled();
  expect(await json(page.request, `${org}/seasons/${season.id}/coverage`)).toEqual(before);
  expect(await json<Assignment[]>(page.request, `${org}/seasons/${season.id}/assignments`)).toHaveLength(1);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await assertNoOverflow(page);
    await page.screenshot({ path: info.outputPath(`coach-personal-assignments-${width}.png`), fullPage: true });
  }
  const scripture = await json<{ verses: { id: string }[] }>(page.request, `/api/v1/study/seasons/${season.id}/scripture`);
  expect(scripture.verses).toHaveLength(3);
  expect(scripture.verses.map(verse => verse.id)).toEqual(sources.map(source => source.id));
  await page.goto(`/student?seasonId=${season.id}`);
  await expect(page.getByTestId('start-todays-deck')).toBeEnabled();
  const first = page.waitForResponse(r => /\/study\/sessions\/[^/]+\/next$/.test(r.url()));
  await page.getByTestId('start-todays-deck').click();
  let card = await (await first).json() as ChallengeCard;
  const sessionId = card.sessionId;
  await page.reload();
  await expect(page.getByTestId('challenge-card')).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await answerCard(page, card, sources);
    const accepted = page.waitForResponse(r => r.url().endsWith(`/study/sessions/${sessionId}/attempts`) && r.request().method() === 'POST');
    await page.getByTestId('submit-answer').click();
    expect((await (await accepted).json() as AttemptResult).isCorrect).toBe(true);
    if (i < 7) {
      const next = page.waitForResponse(r => r.url().endsWith(`/study/sessions/${sessionId}/next`));
      await page.getByTestId('next-card').click();
      card = await (await next).json() as ChallengeCard;
    }
  }
  await page.getByTestId('complete-session').click();
  await expect(page).toHaveURL(new RegExp(`/student/sessions/${sessionId}/recap`));
  expect((await json<Progress>(page.request, `/api/v1/progress/me?seasonId=${season.id}`)).attemptCount).toBe(8);
  for (const route of ['progress', 'honors', 'profile']) {
    await page.goto(`/student/${route}?seasonId=${season.id}`);
    await expect(page.locator('h1')).toBeVisible();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await assertNoOverflow(page);
      await page.screenshot({ path: info.outputPath(`coach-student-${route}-${width}.png`), fullPage: true });
    }
  }
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByTestId('switch-workspace').click();
  await expect(page).toHaveURL(/\/admin/);
  expect((await json<Me>(page.request, '/api/v1/me')).userId).toBe(me.userId);
  expect(await json(page.request, `${org}/seasons/${season.id}/coverage`)).toEqual(before);
  await page.goto(`/student/assignments?seasonId=${season.id}`);
  await page.getByRole('button', { name: `Remove ${range.bookKey}`, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove assignments', exact: true }).click();
  await expect(page.getByText('Assignment removed. Previous progress is preserved.', { exact: true })).toBeVisible();
  expect(await json(page.request, `${org}/seasons/${season.id}/my-assignments`)).toEqual([]);
  await page.goto(`/student/sessions/${sessionId}/recap?seasonId=${season.id}`);
  await expect(page.getByRole('heading', { name: 'Session recap', exact: true })).toBeVisible();
});
