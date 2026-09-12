import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { ChapterPage, CooperationSnapshot, CooperationStudentPage } from '../src/api/pbeTypes';
import { assertNoOverflow, login, logout } from './helpers';
import { createChapterBrowserFixture, finishChapters, finishCooperation, seedSyntheticChapterStamp } from './pbe-chapter-progress-fixtures';
import { json } from './study-source-helpers';

async function capture(page: Page, info: TestInfo, label: string) {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await assertNoOverflow(page);
    await page.screenshot({ path: info.outputPath(`${label}-${width}.png`), fullPage: true });
  }
}

test('real chapter actions and cooperation stay scoped, private and recoverable across coach and student screens', async ({ page, browser }, info) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const unexpectedFailures: string[] = [];
  const unexpectedResponses: string[] = [];
  let expectedLostStart = false;
  const isIdentityRequest = (request: import('@playwright/test').Request) => request.method() === 'GET' && ['/api/v1/me', '/api/v1/profile/me'].includes(new URL(request.url()).pathname);
  let expectedIdentityNavigationAbort = false;
  const expectedIdentityNavigationRequests = new Set<import('@playwright/test').Request>();
  const trackResponse = (response: import('@playwright/test').Response) => {
    if (response.status() < 400) return;
    const url = new URL(response.url());
    if (response.status() === 401 && response.request().method() === 'GET' && url.pathname === '/api/v1/me') return;
    if (response.status() === 409 && response.request().method() === 'POST' && (
      ['/api/v1/progress/me/chapters/continue', '/api/v1/progress/me/pbe-cooperation/continue', '/api/v1/study/sessions'].includes(url.pathname)
      || /^\/api\/v1\/study\/sessions\/[^/]+\/attempts$/.test(url.pathname)
    )) return;
    unexpectedResponses.push(`${response.status()} ${response.request().method()} ${url.pathname}`);
  };
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', trackResponse);
  page.on('request', request => {
    if (expectedIdentityNavigationAbort && isIdentityRequest(request)) expectedIdentityNavigationRequests.add(request);
  });
  page.on('requestfailed', request => {
    if (expectedLostStart && request.url().endsWith('/api/v1/study/sessions')) return;
    if (request.failure()?.errorText === 'net::ERR_ABORTED' && request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/auth/logout') return;
    if (request.failure()?.errorText === 'net::ERR_ABORTED' && /chapters|pbe-cooperation/.test(request.url())) return;
    if (expectedIdentityNavigationRequests.has(request) && request.failure()?.errorText === 'net::ERR_ABORTED' && isIdentityRequest(request)) return;
    unexpectedFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`);
  });
  const withIdentityNavigation = async (navigate: () => Promise<unknown>) => {
    expectedIdentityNavigationAbort = true;
    try {
      const successfulIdentity = page.waitForResponse(response => response.status() === 200 && isIdentityRequest(response.request()));
      await Promise.all([navigate(), successfulIdentity]);
    } finally {
      expectedIdentityNavigationAbort = false;
    }
  };
  const reloadWithIdentity = () => withIdentityNavigation(() => page.reload());

  await login(page);
  const fixture = await createChapterBrowserFixture(page.request, info.project.name.startsWith('native'));
  const origin = new URL(page.url()).origin;
  const admin = await browser.newPage({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
  admin.on('pageerror', error => pageErrors.push(`admin: ${error.message}`));
  admin.on('console', message => { if (message.type() === 'error') consoleErrors.push(`admin: ${message.text()}`); });
  admin.on('response', trackResponse);
  await login(admin);
  await logout(page);
  await login(page, fixture.primary.userName);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

  const chapters = await finishChapters(page.request, fixture.seasonId);
  expect(chapters.view).toBe('Chapters');
  const chapterRows = chapters.view === 'Chapters' ? chapters.items : [];
  const chapter = chapterRows.find(row => row.kind === 'Chapter');
  const introduction = chapterRows.find(row => row.key === `intro:${fixture.introduction.id}`);
  const emptyIntroduction = chapterRows.find(row => row.key === `intro:${fixture.emptyIntroduction.id}`);
  expect(chapter).toMatchObject({ wholeChapterAssigned: false, currentReadiness: 'Incomplete' });
  expect(chapter?.counts).toMatchObject({ assignedPassages: 7, totalTargets: 1, questionCoveredPassages: 2 });
  expect(chapter?.actions.length).toBeGreaterThan(0);
  expect(introduction).toMatchObject({ kind: 'Introduction', counts: { assignedPassages: 1, totalTargets: 1, questionCoveredPassages: 1 } });
  expect(emptyIntroduction).toMatchObject({ kind: 'Introduction', counts: { assignedPassages: 1, totalTargets: 0, questionCoveredPassages: 0 } });
  const groups = await json<ChapterPage>(page.request, `/api/v1/progress/me/chapters?seasonId=${encodeURIComponent(fixture.seasonId)}&view=Groups&chapterKey=${encodeURIComponent(chapter!.key)}&limit=32`);
  expect(groups.view).toBe('Groups');
  const groupRows = groups.view === 'Groups' ? groups.items : [];
  expect(groupRows).toHaveLength(2);
  expect(groupRows.every(row => row.kind === 'PassageGroup' && row.stamp === null && row.wholeChapterAssigned === null)).toBe(true);
  expect(groupRows.reduce((sum, row) => sum + row.counts.totalTargets, 0)).toBeGreaterThan(chapter!.counts.totalTargets);

  const cooperation = await finishCooperation(page.request, fixture.seasonId);
  expect(cooperation).toMatchObject({ state: 'Provisional', rosterStudents: 3, unknownStudents: 1 });
  expect(cooperation.scripture?.assigned).toBe(7);
  expect(cooperation.own?.scripture.assigned).toBe(7);
  expect(cooperation.own?.state).toBe('Known');
  const studentSummaryResponse = await page.request.get(`/api/v1/progress/me/pbe-cooperation?seasonId=${encodeURIComponent(fixture.seasonId)}`);
  const studentSummaryText = await studentSummaryResponse.text();
  expect(studentSummaryResponse.ok()).toBe(true);
  expect(studentSummaryText).not.toContain(fixture.peer.userId);
  expect(studentSummaryText).not.toContain(fixture.peer.displayName);
  expect(studentSummaryText).not.toContain(fixture.peerUsername);
  expect(studentSummaryText).not.toContain(fixture.unassigned.userId);
  expect(studentSummaryText).not.toContain(fixture.unassigned.displayName);
  expect(studentSummaryText).not.toContain(fixture.unassignedUsername);

  await page.goto(`/student/progress?seasonId=${fixture.seasonId}`);
  await expect(page.getByRole('heading', { name: 'Your PBE chapter progress' })).toBeVisible();
  await expect(page.getByText('Assigned passages retained', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Current work incomplete', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('No eligible targets yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Season cooperation' })).toBeVisible();
  await expect(page.getByText(/student records are still unknown/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your Memory passage progress' })).toBeVisible();
  await expect(page.getByText(fixture.peer.displayName)).toHaveCount(0);
  await capture(page, info, 'student-partial-provisional');

  const coachSnapshot = await json<CooperationSnapshot>(admin.request, `${fixture.orgPath}/seasons/${fixture.seasonId}/pbe-cooperation`);
  expect(coachSnapshot.snapshotId).toBe(cooperation.snapshotId);
  const coachStudents = await json<CooperationStudentPage>(admin.request, `${fixture.orgPath}/seasons/${fixture.seasonId}/pbe-cooperation/students?limit=32`);
  expect(coachStudents.snapshotId).toBe(cooperation.snapshotId);
  expect(coachStudents.items.map(student => student.displayName)).toEqual(expect.arrayContaining([fixture.primary.displayName, fixture.peer.displayName, fixture.unassigned.displayName]));
  await admin.goto(`/admin/seasons/${fixture.seasonId}/students/${fixture.primary.userId}/progress`);
  await expect(admin.getByRole('heading', { name: 'Season cooperation' })).toBeVisible();
  await expect(admin.getByText(fixture.peer.displayName, { exact: true })).toBeVisible();
  await capture(admin, info, 'coach-provisional-breakdown');

  const peer = await browser.newPage({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
  peer.on('pageerror', error => pageErrors.push(`peer: ${error.message}`));
  peer.on('console', message => { if (message.type() === 'error') consoleErrors.push(`peer: ${message.text()}`); });
  peer.on('response', trackResponse);
  await login(peer, fixture.peerUsername);
  await finishChapters(peer.request, fixture.seasonId);
  const unassigned = await browser.newPage({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
  unassigned.on('pageerror', error => pageErrors.push(`unassigned: ${error.message}`));
  unassigned.on('console', message => { if (message.type() === 'error') consoleErrors.push(`unassigned: ${message.text()}`); });
  unassigned.on('response', trackResponse);
  await login(unassigned, fixture.unassignedUsername);
  const emptyAssignment = await finishChapters(unassigned.request, fixture.seasonId);
  expect(emptyAssignment).toMatchObject({ currentAvailable: false, work: { state: 'Blocked', reason: 'NoAssignment' } });
  const checkedCooperation = await finishCooperation(page.request, fixture.seasonId);
  expect(checkedCooperation).toMatchObject({ state: 'Snapshot', rosterStudents: 3, unknownStudents: 0 });
  expect(checkedCooperation.scripture?.questionCovered.known).toBeGreaterThan(0);
  expect(checkedCooperation.scripture?.questionCovered.known).toBeLessThan(checkedCooperation.scripture!.assigned);
  await admin.goto(`/admin/seasons/${fixture.seasonId}/students/${fixture.primary.userId}/progress`);
  await expect(admin.getByText('Checked snapshot', { exact: true })).toBeVisible();
  await expect(admin.getByText('PBE Peer Fixture', { exact: true })).toBeVisible();
  await expect(admin.getByText('PBE Unassigned Fixture', { exact: true })).toBeVisible();
  await expect(admin.getByText('Unassigned', { exact: true }).first()).toBeVisible();
  await capture(admin, info, 'coach-checked-partial');
  await peer.close();
  await unassigned.close();

  await page.goto(`/student/progress?seasonId=${fixture.seasonId}`);
  await expect(page.getByText('Checked snapshot', { exact: true })).toBeVisible();
  await expect(page.getByText(fixture.peer.displayName)).toHaveCount(0);
  await expect(page.getByText(fixture.unassigned.displayName)).toHaveCount(0);
  await capture(page, info, 'student-checked-partial');

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/student/progress?seasonId=${fixture.seasonId}`);
  const chapterCard = page.locator('article.pbe-chapter-card').filter({ hasText: chapter!.label }).first();
  const practice = chapterCard.getByRole('button', { name: chapter!.actions[0].label, exact: true });
  const starts: unknown[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/api/v1/study/sessions')) starts.push(request.postDataJSON());
  });
  let committedSessionId = '';
  await page.route('**/api/v1/study/sessions', async route => {
    expectedLostStart = true;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    committedSessionId = (await response.json() as { id: string }).id;
    await route.abort('failed');
  }, { times: 1 });
  await practice.focus();
  await expect(practice).toBeFocused();
  await page.keyboard.press('Enter');
  const startError = page.getByRole('alert');
  const challenge = page.getByTestId('challenge-card');
  await expect.poll(async () => await startError.count() + await challenge.count()).toBeGreaterThan(0);
  let retainedStartId: string | null = null;
  if (await startError.count()) {
    const lostUrl = new URL(page.url());
    retainedStartId = lostUrl.searchParams.get('startId');
    expect(retainedStartId).toBeTruthy();
    expect(lostUrl.searchParams.get('progressScopeKey')).toBe(chapter!.actions[0].progressScope.key);
    await expect(startError).toContainText(/Failed to fetch|Network|fetch/i);
    await reloadWithIdentity();
  }
  expectedLostStart = false;
  await expect(challenge).toBeVisible();
  await expect(page.getByTestId('challenge-prompt')).toContainText(fixture.spanningPrompt);
  expect(starts).toHaveLength(2);
  expect(starts[1]).toEqual(starts[0]);
  retainedStartId ??= (starts[0] as { training?: { clientStartId?: string } }).training?.clientStartId ?? null;
  expect(retainedStartId).toBeTruthy();
  expect(starts[0]).toMatchObject({ seasonId: fixture.seasonId, mode: chapter!.actions[0].mode, format: 'Pbe', progressScope: chapter!.actions[0].progressScope, training: { clientStartId: retainedStartId } });
  expect(committedSessionId).toBeTruthy();
  await page.getByLabel('Answer 1', { exact: true }).fill('incorrect browser fixture answer');
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  const feedback = page.getByTestId('challenge-feedback');
  const retrySavedAnswer = page.getByRole('button', { name: 'Retry saved answer', exact: true });
  await expect.poll(async () => await feedback.count() + await retrySavedAnswer.count()).toBeGreaterThan(0);
  if (await retrySavedAnswer.count()) {
    await expect(page.getByText('Saved answer awaiting confirmation. Retry sends these exact answers.', { exact: true })).toBeVisible();
    await retrySavedAnswer.click();
  }
  await expect(feedback).toBeVisible();
  await page.getByTestId('complete-session').click();
  await expect(page.getByRole('heading', { name: 'Session recap', exact: true })).toBeVisible();
  await expect(page.getByText(/does not by itself earn a chapter stamp/)).toBeVisible();
  await page.getByRole('link', { name: 'See current PBE chapter progress' }).click();
  await expect(page.getByRole('heading', { name: 'Your PBE chapter progress' })).toBeVisible();
  const updatedChapterCard = page.locator('article.pbe-chapter-card').filter({ hasText: chapter!.label }).first();
  await expect(updatedChapterCard).toBeVisible({ timeout: 15_000 });
  await expect(updatedChapterCard.locator('dt', { hasText: 'Due or repair' }).locator('..').locator('dd')).toHaveText(/[1-9]/, { timeout: 20_000 });
  await expect(page.getByText(/passages? needs? maintenance/)).toBeVisible({ timeout: 20_000 });
  const dueCooperation = await json<CooperationSnapshot>(page.request, `/api/v1/progress/me/pbe-cooperation?seasonId=${encodeURIComponent(fixture.seasonId)}`);
  expect(dueCooperation.scripture?.due.known).toBeGreaterThan(0);
  await capture(page, info, 'student-due-current');

  const staleAction = page.locator('article.pbe-chapter-card').filter({ hasText: chapter!.label }).first().getByRole('button', { name: /Practice|Review|Comeback/ }).first();
  await expect(staleAction).toBeVisible();
  const changedTarget = randomUUID();
  const changedQuestions = [0, 1].map(variant => ({
    schemaVersion: 2, id: randomUUID(), version: 1, contentPackId: chapter!.contentPackId,
    sourceUnitId: fixture.sources[0].id, sourceUnitIds: [fixture.sources[0].id], sourceKind: 'Scripture', kind: 'ShortAnswer',
    prompt: `Changed bank fixture ${variant + 1}`, reference: fixture.sources[0].citation, evidence: fixture.sources[0].canonicalText,
    ordered: false, parts: [{ targetId: changedTarget, acceptedAnswers: ['changed'], points: 1 }],
  }));
  await json(admin.request, `${fixture.pbePath}/questions/import`, { targets: [{ id: changedTarget, sourceUnitIds: [fixture.sources[0].id], skill: 'FactualRecall', label: 'Changed fixture' }], questions: changedQuestions });
  for (const question of changedQuestions) await json(admin.request, `${fixture.pbePath}/questions/${question.id}/1/publish`, {});
  await staleAction.click();
  await expect(page.getByRole('alert')).toContainText('This chapter action is out of date');
  await expect(page.getByRole('button', { name: 'Retry start' })).toHaveCount(0);
  const returnToProgress = page.getByRole('link', { name: 'Return to chapter progress' });
  await expect(returnToProgress).toBeVisible();

  const syntheticStamp = await seedSyntheticChapterStamp(page.request, info.project.name.startsWith('native'), {
    organizationId: fixture.organizationId,
    seasonId: fixture.seasonId,
    studentId: fixture.primary.userId,
    chapterKey: chapter!.key,
    label: 'Synthetic dated browser stamp',
    scopeLabel: 'Synthetic earlier assignment · presentation fixture',
    scopeVersion: 'synthetic-earlier-scope',
    earnedAtUtc: '2026-08-20T12:00:00.000Z',
  });
  expect(syntheticStamp.fixture).toBe('synthetic-history');
  const stampPage = await json<ChapterPage>(page.request, `/api/v1/progress/me/chapters?seasonId=${encodeURIComponent(fixture.seasonId)}&view=Stamps&limit=32`);
  const initialSyntheticStamp = (stampPage.view === 'Stamps' ? stampPage.items : []).find(item => item.stampId === syntheticStamp.stampId);
  expect(initialSyntheticStamp).toEqual(expect.objectContaining({
    stampId: syntheticStamp.stampId,
    label: 'Synthetic dated browser stamp',
  }));
  expect([null, false]).toContain(initialSyntheticStamp!.matchesCurrentScope);

  let continuationCount = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/progress/me/chapters/continue')) continuationCount++; });
  const continuation = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/progress/me/chapters/continue'));
  await returnToProgress.click();
  await continuation;
  await withIdentityNavigation(() => page.getByRole('link', { name: 'Honors', exact: true }).click());
  await expect(page).toHaveURL(`/student/honors?seasonId=${fixture.seasonId}`);
  await expect(page.getByRole('heading', { name: 'PBE chapter stamps' })).toBeVisible();
  await page.waitForTimeout(250);
  const stoppedCount = continuationCount;
  await page.waitForTimeout(500);
  expect(continuationCount).toBe(stoppedCount);
  await finishChapters(page.request, fixture.seasonId);
  const currentStampPage = await json<ChapterPage>(page.request, `/api/v1/progress/me/chapters?seasonId=${encodeURIComponent(fixture.seasonId)}&view=Stamps&limit=32`);
  expect(currentStampPage.view === 'Stamps' ? currentStampPage.items : []).toContainEqual(expect.objectContaining({
    stampId: syntheticStamp.stampId,
    matchesCurrentScope: false,
  }));
  await reloadWithIdentity();
  await expect(page.getByRole('heading', { name: 'PBE chapter stamps' })).toBeVisible();
  await expect(page.getByText('Synthetic dated browser stamp', { exact: true })).toBeVisible();
  await expect(page.getByText('Earned for an earlier assigned scope.', { exact: true })).toBeVisible();
  await expect(page.getByText(/Earned Honors preserve their qualifying evidence and date/)).toBeVisible();
  await capture(page, info, 'student-honors-history');

  await admin.close();
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter(message => !/Failed to load resource: (?:the server responded with a status of (?:401 \(Unauthorized\)|409 \(Conflict\))|net::ERR_FAILED)/.test(message))).toEqual([]);
  expect(unexpectedResponses).toEqual([]);
  expect(unexpectedFailures).toEqual([]);
});
