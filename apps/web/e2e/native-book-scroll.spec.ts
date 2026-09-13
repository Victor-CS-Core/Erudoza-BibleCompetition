import { expect, test, type Locator, type Page } from '@playwright/test';
import { assertNoOverflow, login, logout } from './helpers';

async function scrollOver(page: Page, list: Locator, delta: number, touch: boolean) {
  // Commit the programmatic boundary setup before sending compositor-handled input.
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const box = await list.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  const x = box!.x + box!.width / 2;
  const top = Math.max(70, box!.y), bottom = Math.min(viewport.height - 90, box!.y + box!.height);
  expect(bottom - top).toBeGreaterThan(40);
  const y = (top + bottom) / 2;
  if (touch) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 12; step++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - delta * step / 12 }] });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  } else {
    await page.mouse.move(x, y);
    // Two successive wheel ticks model continuing to scroll across a boundary.
    for (let tick = 0; tick < 2; tick++) {
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(600);
    }
  }
}

async function checkHandoff(page: Page, list: Locator, touch: boolean) {
  await list.evaluate(element => { element.scrollIntoView({ block: 'center' }); element.scrollTop = 0; });
  const pageBefore = await page.evaluate(() => scrollY);
  await scrollOver(page, list, 130, touch);
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(50);
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(pageBefore, 0);

  // Set up the boundary, then use real input over the list to test page handoff.
  await list.evaluate(element => { element.scrollIntoView({ block: 'center' }); element.scrollTop = element.scrollHeight; window.scrollBy(0, -150); });
  const bottomBefore = await page.evaluate(() => scrollY);
  expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight - scrollY)).toBeGreaterThan(50);
  await scrollOver(page, list, 130, touch);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(bottomBefore + 50);

  await list.evaluate(element => { element.scrollIntoView({ block: 'center' }); element.scrollTop = 0; });
  const topBefore = await page.evaluate(() => scrollY);
  expect(topBefore).toBeGreaterThan(50);
  await scrollOver(page, list, -130, touch);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(topBefore - 50);
  await assertNoOverflow(page);
}

test('book lists hand scrolling to the page at either boundary, including after filtering', async ({ page, isMobile }, info) => {
  await login(page);
  await page.goto('/admin/seasons/new');
  const list = page.locator('.bible-book-groups');
  await expect(list.getByRole('checkbox')).toHaveCount(66);
  await checkHandoff(page, list, isMobile);
  await page.getByRole('searchbox', { name: 'Search books' }).fill('Psalms');
  await page.getByRole('checkbox', { name: 'Psalms Whole book', exact: true }).check();
  await list.evaluate(element => { element.scrollIntoView({ block: 'center' }); window.scrollBy(0, -150); });
  expect(await list.evaluate(element => element.scrollHeight - element.clientHeight)).toBe(0);
  const filteredBefore = await page.evaluate(() => scrollY);
  await scrollOver(page, list, 130, isMobile);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(filteredBefore + 50);
  await page.getByRole('searchbox', { name: 'Search books' }).fill('');
  await checkHandoff(page, list, isMobile);
  await expect(page.getByRole('checkbox', { name: 'Psalms Whole book', exact: true })).toBeChecked();
  await page.screenshot({ path: info.outputPath('season-book-scroll.png') });

  await page.goto('/admin/content');
  await expect(list.getByTestId('library-book')).toHaveCount(66);
  await checkHandoff(page, list, isMobile);
  await logout(page);
  await login(page, 'student.fixture');
  await page.goto('/student/library');
  await expect(list.getByTestId('library-book')).toHaveCount(66);
  await checkHandoff(page, list, isMobile);
});


test('chapter lists also hand scrolling to the page without changing selected chapters', async ({ page, isMobile }, info) => {
  await login(page);
  await page.goto('/admin/seasons/new');
  await page.getByLabel('Season name').fill(`Chapter scroll ${info.project.name}`);
  await page.getByRole('searchbox', { name: 'Search books' }).fill('Psalms');
  await page.getByRole('checkbox', { name: 'Psalms Whole book', exact: true }).check();
  await page.getByRole('button', { name: 'Save & assign students →' }).click();
  const list = page.locator('.planner-chapter-grid');
  await expect(list.getByRole('checkbox')).toHaveCount(150);
  await page.getByRole('checkbox', { name: 'Chapter 1', exact: true }).check();
  await checkHandoff(page, list, isMobile);
  await expect(page.getByRole('checkbox', { name: 'Chapter 1', exact: true })).toBeChecked();
  await expect(list.locator('input:checked')).toHaveCount(1);
});
