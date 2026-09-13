import { expect, test, type Page } from '@playwright/test';
import { assertNoOverflow, login, logout } from './helpers';
import type { Me, StudyNotebook } from '../src/api/types';

async function openPsalm(page: Page, path: string) {
  await page.goto(path);
  await page.getByRole('searchbox', { name: 'Search books' }).fill('Psalms');
  await page.getByTestId('library-book').click();
  await page.getByRole('combobox', { name: 'Chapter', exact: true }).selectOption('23');
  await expect(page.getByRole('button', { name: 'Select verse 6' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bookmark chapter' })).toBeEnabled();
}
async function selectPhrase(page: Page) {
  const text = page.locator('[data-verse-text]').first();
  await text.scrollIntoViewIfNeeded();
  const points = await text.evaluate(element => {
    const node = element.firstChild!.firstChild!;
    const start = document.createRange(); start.setStart(node, 0); start.setEnd(node, 1);
    const end = document.createRange(); end.setStart(node, 23); end.setEnd(node, 24);
    const a = start.getBoundingClientRect(), b = end.getBoundingClientRect();
    return { x1: a.left + 1, y1: a.top + a.height / 2, x2: b.right - 1, y2: b.top + b.height / 2 };
  });
  await page.mouse.move(points.x1, points.y1); await page.mouse.down(); await page.mouse.move(points.x2, points.y2, { steps: 12 }); await page.mouse.up();
  await expect(page.getByRole('region', { name: 'Selected passage tools' })).toBeVisible();
}

test('private Scripture tools persist across navigation, reloads, conflicts and account changes', async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await login(page); await openPsalm(page, '/admin/content');
  const me = await (await page.request.get('/api/v1/me')).json() as Me;
  const notebookUrl = `/api/v1/organizations/${me.organizationId}/library/notebook`;
  const read = async () => (await (await page.request.get(notebookUrl)).json()) as StudyNotebook;
  const readerUrl = page.url();
  const selected = (await page.locator('[data-verse-text]').first().innerText()).slice(0, 24).trim();
  await selectPhrase(page);
  expect(selected).toBeTruthy();
  await page.getByRole('button', { name: 'Promises', exact: true }).click();
  await expect(page.locator('[data-verse-text] mark').first()).toBeVisible();
  expect((await read()).entries[0].quote).toBe(selected);
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await expect(page.locator('[data-verse-text] mark').first()).toHaveClass(/ds-highlight-people/);
  expect((await read()).entries).toHaveLength(1);
  await page.getByRole('button', { name: 'Hide words', exact: true }).click();
  await expect(page.getByLabel('Hidden words').first()).toBeVisible();
  await page.getByRole('button', { name: 'Reveal words', exact: true }).click();
  await expect(page.locator('[data-verse-text] mark').first()).toHaveText(selected!);
  await page.locator('[data-verse-text]').first().evaluate(first => { const second = document.querySelectorAll('[data-verse-text]')[1], range = document.createRange(); range.setStart(first, 0); range.setEnd(second, second.childNodes.length); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); });
  await expect(page.getByText('Select words within one verse, or use a verse number.', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Selected passage tools' })).toBeHidden();
  await page.getByRole('button', { name: 'Select verse 3', exact: true }).focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Your note', exact: true });
  await expect(input).toBeFocused(); await input.fill('He restores, then He leads.');
  await page.route('**/library/notebook/entries/*', route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue());
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/fetch|network|load/i); await expect(input).toHaveValue('He restores, then He leads.');
  await page.unroute('**/library/notebook/entries/*'); await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(input).toBeHidden(); await expect(page.getByText('He restores, then He leads.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Note', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Edit note', exact: true }).click(); await input.fill('Discard this draft.');
  await expect(page.getByRole('button', { name: 'Delete note for Psalms 23:3', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(page.getByRole('button', { name: 'Edit note', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Bookmark chapter', exact: true }).click(); await expect(page.getByRole('button', { name: 'Remove chapter bookmark' })).toBeEnabled();
  await page.reload(); await expect(page.getByRole('button', { name: 'Remove chapter bookmark' })).toBeEnabled();
  expect((await read()).entries).toHaveLength(3);
  await expect(page.getByText('He restores, then He leads.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit note', exact: true }).click(); await input.fill('A revised reflection.');
  // Simulate a second tab writing the same private notebook before this tab saves.
  const latest = await read(), highlight = latest.entries.find(e => e.kind === 'highlight')!;
  expect((await page.request.put(`${notebookUrl}/entries/${highlight.id}`, { data: { version: latest.version, entry: { ...highlight, color: 'Review' } } })).ok()).toBe(true);
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reload notebook', exact: true })).toBeVisible(); await expect(input).toHaveValue('A revised reflection.');
  await page.getByRole('button', { name: 'Reload notebook', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save note', exact: true })).toBeEnabled(); await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(input).toBeHidden(); await expect(page.getByText('A revised reflection.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  const sidebar = page.getByRole('complementary', { name: 'My study notebook' });
  await expect(sidebar.getByRole('article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Next chapter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Psalms 24', exact: true })).toBeVisible();
  await sidebar.getByRole('button', { name: 'Open Psalms 23', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Psalms 23', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole('combobox', { name: 'Verse', exact: true }).selectOption({ label: '1' });
    await page.getByRole('combobox', { name: 'Verse', exact: true }).selectOption({ label: '3' });
    await expect(page.getByRole('button', { name: 'Select verse 3', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Go to verse', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Select verse 3', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Select verse 3', exact: true }).click();
    await assertNoOverflow(page); await page.screenshot({ path: info.outputPath(`coach-study-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Focus', exact: true }).click();
    await expect(sidebar).toBeHidden(); await expect(page.getByRole('combobox', { name: 'Verse', exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Scripture text size', exact: true }).selectOption('larger');
    await assertNoOverflow(page); await page.getByRole('button', { name: 'Exit focus', exact: true }).click();
    await page.getByRole('combobox', { name: 'Scripture text size', exact: true }).selectOption('standard');
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Choose book', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search books', exact: true }).fill('Jude'); await page.getByTestId('library-book').click();
  await expect(page.getByRole('combobox', { name: 'Chapter', exact: true })).toHaveValue('1');
  await sidebar.getByRole('button', { name: 'Open Psalms 23:3', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Psalms 23', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete note for Psalms 23:3', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove entry', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect((await read()).entries).toHaveLength(2);
  await page.getByRole('button', { name: 'Remove chapter bookmark', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Remove entry', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden(); await page.reload();
  await expect(page.getByRole('button', { name: 'Bookmark chapter', exact: true })).toBeEnabled(); expect((await read()).entries).toHaveLength(1);
  await logout(page); await login(page, 'student.fixture');
  await page.goto(readerUrl.replace('/admin/content', '/student/library'));
  await expect(page.getByText('Your notebook is empty.', { exact: true })).toBeVisible();
  await expect(page.locator('[data-verse-text] mark')).toHaveCount(0);
  await page.getByRole('button', { name: 'Select verse 1', exact: true }).click(); await page.getByRole('button', { name: 'Promises', exact: true }).click();
  await expect(page.locator('[data-verse-text] mark')).toHaveCount(1);
  for (const width of [1440, 390, 320]) { await page.setViewportSize({ width, height: 1000 }); await assertNoOverflow(page); await page.screenshot({ path: info.outputPath(`student-study-${width}.png`), fullPage: true }); }
  await page.reload(); await expect(page.locator('[data-verse-text] mark')).toHaveCount(1);
  await page.getByRole('button', { name: 'Delete highlight for Psalms 23:1', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Remove entry', exact: true }).click(); await expect(page.getByRole('dialog')).toBeHidden(); await page.reload();
  await expect(page.getByText('Your notebook is empty.', { exact: true })).toBeVisible(); await expect(page.locator('[data-verse-text] mark')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('touch verse selection and book search remain usable at 320px', async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 900 }, hasTouch: true, isMobile: true, baseURL: 'http://localhost:8789', extraHTTPHeaders: { Origin: 'http://localhost:8789' } });
  const page = await context.newPage();
  try {
    await login(page, 'student.fixture'); await page.goto('/student/library');
    await page.getByRole('searchbox', { name: 'Search books' }).fill('Jude'); await page.getByTestId('library-book').tap();
    await page.getByRole('combobox', { name: 'Verse', exact: true }).selectOption({ label: '25' });
    await page.getByRole('button', { name: 'Select verse 25', exact: true }).tap();
    await page.getByRole('button', { name: 'Review', exact: true }).tap();
    await expect(page.locator('[data-verse-text] mark')).toHaveCount(1);
    await page.getByRole('button', { name: 'Hide words', exact: true }).tap(); await expect(page.getByLabel('Hidden words')).toBeVisible();
    await page.getByRole('button', { name: 'Reveal words', exact: true }).tap(); await assertNoOverflow(page);
    await page.screenshot({ path: info.outputPath('touch-study-320.png'), fullPage: true });
  } finally { await context.close(); }
});
