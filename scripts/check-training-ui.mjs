// Browser regression checks with isolated API fixtures; does not modify live data.
// Start Vite first, then: node scripts/check-training-ui.mjs http://127.0.0.1:5174
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base = process.argv[2] || 'http://127.0.0.1:5174';
const output = 'apps/web/test-results/training-ui';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
let role = 'Student';
let submitted = 0;
let drawn = 0;
let starts = 0;
let savedDifficulty = 'Standard';
let difficultyUpdates = 0;
const me = () => ({ userId: 'daniel', organizationId: 'academy', organizationName: 'Pathfinder Academy', displayName: role === 'Student' ? 'Daniel' : 'Coach', userName: 'daniel', email: null, kind: role === 'Student' ? 'Student' : 'Adult', role });
const assignment = { id: 'a', studentUserId: 'daniel', type: 'PrimarySpecialist', bookKey: 'DAN', startChapter: 2, startVerse: 1, endChapter: 2, endVerse: 23 };
const progress = { seasonId: 'season', seasonName: 'Daniel 2026', seasonStatus: 'Active', assignments: [assignment], masteredCount: 13, reviewDueCount: 6, attemptCount: 24, mastery: [], recentAttempts: [] };
const season = { id: 'season', organizationId: 'academy', name: 'Daniel 2026', status: 'Active', yearLabel: '2026', ruleProfileKey: 'PBE_STYLE_V1', ruleProfileVersion: 1, startDate: null, targetCompetitionDate: null, scopeUnitCount: 23, assignmentCount: 3 };
const students = ['Daniel', 'Sarah', 'Micah'].map((name, i) => ({ ...assignment, studentUserId: name.toLowerCase(), displayName: name, userName: name.toLowerCase(), assignmentType: 'PrimarySpecialist', eligibleUnitCount: 23, masteredCount: [13, 20, 10][i], reviewDueCount: [6, 0, 3][i], attemptCount: [24, 35, 16][i] }));
const context = await browser.newContext({ serviceWorkers: 'block' });
await context.route('**/api/v1/**', async route => {
  const { pathname } = new URL(route.request().url());
  let data;
  if (pathname.endsWith('/me') && !pathname.includes('/progress/')) data = me();
  else if (pathname.endsWith('/progress/me/seasons')) data = [{ id: 'season', name: 'Daniel 2026' }];
  else if (pathname.endsWith('/difficulty')) { savedDifficulty = route.request().postDataJSON().difficulty; difficultyUpdates++; data = { difficulty: savedDifficulty }; }
  else if (pathname.endsWith('/scope')) data = { contentPackId: 'pack', includes: [{ bookKey: 'DAN', startChapter: 2, startVerse: 1, endChapter: 2, endVerse: 23 }], excludes: [] };
  else if (pathname.endsWith('/scripture-catalog')) data = { translations: [], books: [{ bookKey: 'DAN', name: 'Daniel' }] };
  else if (pathname.endsWith('/assignments')) data = [{ ...assignment, studentDisplayName: 'Daniel', studentUserName: 'daniel', difficulty: savedDifficulty }];
  else if (pathname.endsWith('/content-packs')) data = [{ id: 'pack', packKey: 'Daniel', version: 1 }];
  else if (pathname.endsWith('/students')) data = [{ userId: 'daniel', userName: 'daniel', displayName: 'Daniel', email: null }];
  else if (pathname.endsWith('/seasons/season')) data = season;
  else if (pathname.endsWith('/progress/me')) data = progress;
  else if (pathname.endsWith('/coverage')) data = { seasonId: 'season', seasonName: 'Daniel 2026', seasonStatus: 'Active', students };
  else if (pathname.endsWith('/seasons')) data = [season];
  else if (pathname.endsWith('/study/sessions/session')) data = { session: { id: 'session', seasonId: 'season', status: 'Active', mode: 'Practice', targetCardCount: 10, difficulty: 'Standard' }, card: { id: `card-${drawn}`, sessionId: 'session', activityType: 'MissingWords', citation: 'Daniel 2:20', prompt: 'Blessed be the name of God for ever and ever: for wisdom and ____ are his:', tokens: [], sequence: 4 + drawn, total: 10 }, attempt: submitted > drawn ? { attemptId: 'attempt', isCorrect: true, evaluationResult: 'Correct', canonicalAnswer: 'might', citation: 'Daniel 2:20', sourceText: 'Blessed be the name of God for ever and ever: for wisdom and might are his:', masteryLevel: 'Review', exactWordingScore: 1, reviewDueAtUtc: null, alreadyProcessed: true } : null, summary: null };
  else if (pathname.endsWith('/next')) { drawn = submitted; data = { id: `card-${submitted}`, sessionId: 'session', activityType: 'MissingWords', citation: 'Daniel 2:20', prompt: 'Blessed be the name of God for ever and ever: for wisdom and ____ are his:', tokens: [], sequence: 4 + submitted, total: 10 }; }
  else if (pathname.endsWith('/study/sessions')) { starts++; data = { id: 'session', seasonId: 'season', status: 'Active', mode: 'Practice', targetCardCount: 10 }; }
  else if (pathname.endsWith('/attempts')) { submitted++; data = { attemptId: 'attempt', isCorrect: true, evaluationResult: 'Exact', canonicalAnswer: 'might', citation: 'Daniel 2:20', sourceText: 'Blessed be the name of God for ever and ever: for wisdom and might are his:', masteryLevel: 'Review', exactWordingScore: 1, reviewDueAtUtc: null, alreadyProcessed: false }; }
  else if (pathname.endsWith('/complete')) data = { sessionId: 'session', mode: 'Practice', attempted: 1, correct: 1, targetCardCount: 10, status: 'Completed' };
  else { errors.push(`Unexpected API request: ${pathname}`); return route.fulfill({ status: 404, json: { detail: 'Unconfigured fixture' } }); }
  await route.fulfill({ json: data });
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
async function checkScreen(path, name, width, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto(base + path);
  await page.locator('.training-app').waitFor();
  await page.waitForLoadState('networkidle');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, `${name} overflows horizontally`);
  const broken = await page.locator('img').evaluateAll(images => images.filter(i => !i.complete || i.naturalWidth === 0).map(i => i.src));
  assert.deepEqual(broken, [], `${name} has broken images`);
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
}
try {
  await checkScreen('/student', 'student-desktop', 1440);
  assert.equal(await page.getByTestId('mastered-count').textContent(), '13');
  await checkScreen('/student', 'student-mobile', 390, 844);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Close menu' }).click();
  await checkScreen('/student/study', 'study-mobile', 390, 844);
  assert.equal(await page.getByRole('button', { name: 'Check answer' }).isEnabled(), false);
  await page.getByTestId('missing-words-answer').fill('might');
  await page.getByRole('button', { name: 'Check answer' }).click();
  await page.getByTestId('challenge-feedback').waitFor();
  assert.equal(submitted, 1);
  const startsBeforeReload = starts;
  await page.reload();
  await page.getByTestId('challenge-feedback').waitFor();
  assert.equal(starts, startsBeforeReload);
  assert.equal(submitted, 1);
  assert.equal(await page.getByRole('button', { name: 'Check answer' }).isEnabled(), false);
  await page.getByRole('button', { name: 'Next card' }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="card-progress"]')?.textContent === '5 / 10');
  await checkScreen('/student/study?mode=Review', 'study-desktop', 1440);
  assert.equal(await page.getByTestId('missing-words-answer').isEnabled(), true);
  await checkScreen('/student/progress', 'progress-mobile', 390, 844);
  role = 'Admin';
  await checkScreen('/admin', 'coach-desktop', 1440);
  await page.getByRole('table').waitFor();
  assert.equal(await page.getByRole('link', { name: 'Question review', exact: true }).count(), 0);
  assert.equal(await page.getByRole('combobox', { name: 'Season', exact: true }).inputValue(), 'season');
  await checkScreen('/admin', 'coach-mobile', 390, 844);
  await checkScreen('/admin', 'coach-small', 320, 720);
  await checkScreen('/admin/seasons/season', 'students-table-mobile', 390, 844);
  await page.getByRole('link', { name: 'Manage assignments for Daniel', exact: true }).click();
  await page.getByLabel('Passage to assign').waitFor();
  await page.screenshot({ path: output + '/difficulty-mobile.png', fullPage: true });
  await page.getByRole('radio', { name: 'Advanced', exact: true }).check();
  await page.locator('[data-testid="difficulty-preview"] summary').click();
  assert.match(await page.getByTestId('difficulty-preview').innerText(), /Individual words/);
  await page.getByRole('button', { name: 'Save difficulty for future sessions' }).click();
  await page.getByText('Difficulty saved for future sessions.').waitFor();
  assert.equal(savedDifficulty, 'Advanced');
  assert.equal(difficultyUpdates, 1);
  await page.getByRole('button', { name: 'Review season →', exact: true }).click();
  await page.getByTestId('season-review').getByText('Advanced', { exact: true }).waitFor();
  await page.screenshot({ path: output + '/difficulty-roster.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: 10 desktop/mobile views, difficulty preview and future-session update, navigation, real-component study submission, duplicate-submit prevention, refresh recovery, and next-card flow. API fixtures only.');
} catch (error) {
  console.error('Page:', page.url(), 'Runtime errors:', errors);
  console.error((await page.locator('body').innerText()).slice(0, 2000));
  throw error;
} finally { await browser.close(); }
