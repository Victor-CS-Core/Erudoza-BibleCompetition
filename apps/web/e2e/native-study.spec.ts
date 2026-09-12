import { expect, test } from '@playwright/test';
import { answerCard, json, type StoredSource } from './study-source-helpers';
import { randomUUID } from 'node:crypto';
import { assertNoOverflow, login, logout } from './helpers';
import type { AttemptResult, ChallengeCard, ContentPack, Me, Progress, SessionSummary, Student } from '../src/api/types';

test('native coach assignment leads to an eight-card student session, durable resume and progress at phone/desktop widths', async ({ page }, info) => {
  test.setTimeout(120000);
  const password = process.env.ERUDOZA_E2E_PASSWORD;
  expect(password, 'The native fixture launcher supplies ERUDOZA_E2E_PASSWORD').toBeTruthy();
  await login(page, 'admin@erudoza.local', password!);
  const me = await json<Me>(page.request, '/api/v1/me');
  const org = `/api/v1/organizations/${me.organizationId}`;
  const packs = await json<ContentPack[]>(page.request, `${org}/content-packs`);
  const pack = packs.find(p => p.packKey === 'dev-daniel');
  expect(pack).toBeTruthy();
  const sources = (await json<StoredSource[]>(page.request, `${org}/content-packs/${pack!.id}/source-units`)).sort((a, b) => a.ordinal - b.ordinal).slice(0, 3);
  expect(sources).toHaveLength(3);
  expect(sources.every(s => s.canonicalText.includes('synthetic development passage'))).toBe(true);
  const students = await json<Student[]>(page.request, `${org}/students`);
  const student = students.find(s => s.userName === 'student.fixture');
  expect(student).toBeTruthy();
  const season = await json<{ id: string; name: string }>(page.request, `${org}/seasons`, { name: `Native study ${randomUUID()}`, yearLabel: '2026', ruleProfileKey: 'PBE_STYLE_V1' });
  const range = { bookKey: sources[0].bookKey, startChapter: sources[0].chapter, startVerse: sources[0].verse, endChapter: sources[2].chapter, endVerse: sources[2].verse };
  await json(page.request, `${org}/seasons/${season.id}/scope`, { contentPackId: pack!.id, includes: [range], excludes: [] });
  await json(page.request, `${org}/seasons/${season.id}/assignments`, { studentUserId: student!.userId, contentPackId: pack!.id, type: 'PrimarySpecialist', difficulty: 'Standard', range });
  expect(await json(page.request, `${org}/seasons/${season.id}/activate`, {})).toMatchObject({ activated: true });
  await page.goto(`/admin/seasons/${season.id}?step=review`);
  await expect(page.getByTestId('season-status')).toHaveText('Active');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await assertNoOverflow(page);
    await page.screenshot({ path: info.outputPath(`coach-season-${width}.png`), fullPage: true });
  }

  await logout(page);
  await login(page, 'student.fixture', password!);
  await page.goto(`/student?seasonId=${season.id}`);
  await expect(page.getByTestId('start-todays-deck')).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 900 });
  await assertNoOverflow(page);
  const firstResponse = page.waitForResponse(r => /\/api\/v1\/study\/sessions\/[^/]+\/next$/.test(r.url()));
  await page.getByTestId('start-todays-deck').click();
  let card = await (await firstResponse).json() as ChallengeCard;
  const sessionId = card.sessionId;
  const resumeBefore = page.waitForResponse(r => r.url().endsWith(`/api/v1/study/sessions/${sessionId}`));
  await page.reload();
  expect((await (await resumeBefore).json()).card).toEqual(card);
  await expect(page.getByTestId('challenge-card')).toBeVisible();
  const activities = new Set<string>();
  let firstAttempt: AttemptResult | undefined;
  for (let index = 0; index < 8; index++) {
    expect(card.sequence).toBe(index + 1);
    expect(card.total).toBe(8);
    expect(card.debugAnswer).toBeFalsy();
    await expect(page.getByTestId('debug-answer')).toHaveCount(0);
    await expect(page.getByTestId('card-progress')).toHaveText(`${index + 1} / 8`);
    activities.add(card.activityType);
    await answerCard(page, card, sources);
    const accepted = page.waitForResponse(r => r.url().endsWith(`/api/v1/study/sessions/${sessionId}/attempts`) && r.request().method() === 'POST');
    await page.getByTestId('submit-answer').click();
    const result = await (await accepted).json() as AttemptResult;
    expect(result.isCorrect, `${card.activityType} must accept its stored synthetic source answer`).toBe(true);
    await expect(page.getByTestId('challenge-feedback')).toContainText('Well remembered');
    await expect(page.getByTestId('submit-answer')).toBeDisabled();
    if (index === 0) {
      firstAttempt = result;
      const resumed = page.waitForResponse(r => r.url().endsWith(`/api/v1/study/sessions/${sessionId}`));
      await page.reload();
      expect((await (await resumed).json()).attempt).toEqual({ ...result, alreadyProcessed: true });
      await expect(page.getByTestId('challenge-feedback')).toContainText('Well remembered');
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
    await assertNoOverflow(page);
        await page.screenshot({ path: info.outputPath(`student-feedback-${width}.png`), fullPage: true });
      }
      await page.setViewportSize({ width: 390, height: 900 });
    }
    if (index < 7) {
      const next = page.waitForResponse(r => r.url().endsWith(`/api/v1/study/sessions/${sessionId}/next`));
      await page.getByTestId('next-card').click();
      card = await (await next).json() as ChallengeCard;
    }
  }
  await expect(page.getByTestId('next-card')).toHaveCount(0);
  const completed = page.waitForResponse(r => r.url().endsWith(`/api/v1/study/sessions/${sessionId}/complete`));
  await page.getByTestId('complete-session').click();
  const summary = await (await completed).json() as SessionSummary;
  expect(summary).toMatchObject({ sessionId, attempted: 8, correct: 8, targetCardCount: 8, status: 'Completed' });
  await expect(page).toHaveURL(new RegExp(`/student/sessions/${sessionId}/recap`));
  await page.getByRole('link', { name: 'View current progress', exact: true }).click();
  await expect(page.getByTestId('progress-attempts')).toHaveText('8');
  const progress = await json<Progress>(page.request, `/api/v1/progress/me?seasonId=${season.id}`);
  expect(progress.attemptCount).toBe(8);
  expect(progress.reviewDueCount).toBe(0);
  expect(progress.mastery.some(m => m.exactWordingScore > 0)).toBe(true);
  expect(progress.mastery.every(m => m.algorithmVersion === 'v2-skill-evidence')).toBe(true);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await assertNoOverflow(page);
    await page.screenshot({ path: info.outputPath(`student-progress-${width}.png`), fullPage: true });
  }
  expect(activities).toEqual(new Set(['MissingWords', 'VerseBuilder', 'ReferenceMatch', 'WhatComesNext', 'TrueFalse']));
  expect(firstAttempt?.attemptId).toBeTruthy();
  await info.attach('native-study-evidence', { body: JSON.stringify({ seasonId: season.id, sessionId, summary, activities: [...activities], firstAttemptId: firstAttempt!.attemptId, mastery: progress.mastery }, null, 2), contentType: 'application/json' });
  await logout(page);
  await login(page, 'admin@erudoza.local', password!);
  const coachProgress = await json<Progress>(page.request, `${org}/seasons/${season.id}/students/${student!.userId}/progress`);
  expect(coachProgress.attemptCount).toBe(8);
  expect(coachProgress.mastery).toEqual(progress.mastery);
  await page.goto(`/admin/seasons/${season.id}/students/${student!.userId}/progress`);
  await expect(page.getByTestId('progress-attempts')).toHaveText('8');
});

test('native PBE requests reject an untimed Simulation entry before creating a session',async({page})=>{
 await login(page);const me=await json<Me>(page.request,'/api/v1/me');const students=await json<Student[]>(page.request,`/api/v1/organizations/${me.organizationId}/students`);expect(students.some(s=>s.userName==='student.fixture')).toBe(true);await logout(page);await login(page,'student.fixture');const response=await page.request.post('/api/v1/study/sessions',{data:{seasonId:randomUUID(),format:'Pbe',mode:'Simulation'}});expect(response.status()).toBe(400);expect(await response.text()).toContain('Timed rehearsal is not enabled');
});
