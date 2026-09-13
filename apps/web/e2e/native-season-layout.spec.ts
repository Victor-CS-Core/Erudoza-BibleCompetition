import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { assertNoOverflow, login } from './helpers';

async function expectFullWidthEditor(page: Page) {
  await expect(page.getByLabel('Student or coach')).toBeVisible();
  await expect(page.locator('.planner-roster')).toBeHidden();
  const layout = await page.locator('.planner-roster-layout').boundingBox();
  const editor = await page.locator('.planner-editor').boundingBox();
  expect(editor!.x).toBeCloseTo(layout!.x, 0);
  expect(editor!.width).toBeCloseTo(layout!.width, 0);
  await assertNoOverflow(page);
}

test('season editor retains selections and usable layout through rotation', async ({ page }, info) => {
  // Use the existing provider contract fixture, with real local season/auth APIs.
  const provider = await readFile(new URL('./fixtures/coffee-widget-contract.js', import.meta.url), 'utf8');
  const cup = await readFile(new URL('./fixtures/bmc-coffee-cup.svg', import.meta.url), 'utf8');
  await page.route('https://cdnjs.buymeacoffee.com/1.0.0/widget.prod.min.js', route => info.project.name === 'phone-fallback'
    ? route.abort('blockedbyclient') : route.fulfill({ contentType: 'application/javascript', body: provider }));
  await page.route('https://cdn.buymeacoffee.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body: cup }));
  await page.route('https://www.buymeacoffee.com/widget/**', route => route.abort('blockedbyclient'));
  const phone = info.project.name.startsWith('phone');
  await login(page);
  await page.goto('/admin/seasons/new');
  await page.getByLabel('Season name').fill(`Rotation ${info.project.name}`);
  await page.getByRole('searchbox', { name: 'Search books' }).fill('Exodus');
  await page.getByRole('checkbox', { name: 'Exodus Whole book', exact: true }).check();
  if (phone) {
    await page.setViewportSize({ width: 844, height: 390 });
    const books = await page.locator('.planner-columns > .ds-panel').first().boundingBox();
    const summary = await page.locator('.planner-summary').boundingBox();
    expect(summary!.y).toBeGreaterThanOrEqual(books!.y + books!.height);
    await page.getByRole('searchbox', { name: 'Search books' }).fill('');
    expect((await page.locator('.bible-book-groups').boundingBox())!.height).toBeLessThan(250);
    await expect(page.getByRole('checkbox', { name: 'Exodus Whole book', exact: true })).toBeChecked();
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await page.getByRole('button', { name: 'Save & assign students →' }).click();
  await expect(page.locator('.planner-chapter-choice')).toHaveCount(40);
  const student = await page.getByLabel('Student or coach').inputValue();
  await page.getByRole('checkbox', { name: 'Select all chapters in Exodus' }).check();
  await page.getByText('Plan settings · Standard', { exact: true }).click();
  await page.getByLabel('Training difficulty').selectOption('Advanced');
  const role = await page.getByLabel('Assignment role').inputValue();

  if (phone) {
    // Rotate both ways across the desktop-width breakpoint, including a smaller phone.
    for (const viewport of [{ width: 844, height: 390 }, { width: 932, height: 430 }, { width: 667, height: 375 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await expectFullWidthEditor(page);
      await expect(page.getByLabel('Student or coach')).toHaveValue(student);
      await expect(page.locator('.planner-chapter-choice input:checked')).toHaveCount(40);
      await expect(page.getByLabel('Assignment role')).toHaveValue(role);
      await expect(page.getByLabel('Training difficulty')).toHaveValue('Advanced');
      if (viewport.width > viewport.height) {
        expect((await page.locator('.planner-chapter-grid').boundingBox())!.height).toBeLessThan(250);
      }
      const save = page.getByRole('button', { name: 'Save assignments', exact: true });
      await save.scrollIntoViewIfNeeded();
      await expect(save).toBeInViewport();
      await save.click({ trial: true });
      if (viewport.width > viewport.height) {
        // Even an edge tap must reach Save, not the floating support controls.
        await expect(page.locator('.coffee-floating')).toBeVisible();
        const saveBox = (await save.boundingBox())!;
        for (const control of [page.locator('.coffee-floating'), page.locator('#bmc-wbtn')]) {
          if (!await control.isVisible()) continue;
          const box = (await control.boundingBox())!;
          expect(saveBox.x + saveBox.width).toBeLessThanOrEqual(box.x);
        }
      }
      await page.screenshot({ path: info.outputPath(`assignments-${viewport.width}.png`) });
    }
  } else {
    for (const viewport of info.project.name === 'tablet'
      ? [{ width: 768, height: 1024 }, { width: 1024, height: 768 }]
      : [{ width: 1440, height: 900 }, { width: 932, height: 430 }]) {
      await page.setViewportSize(viewport);
      await expect(page.locator('.planner-roster')).toBeVisible();
      await expect(page.getByLabel('Student or coach')).toBeHidden();
      await expect(page.locator('.planner-chapter-choice input:checked')).toHaveCount(40);
      await assertNoOverflow(page);
    }
  }
  await page.getByRole('button', { name: 'Save assignments', exact: true }).click();
  await expect(page.getByText('Assignments saved.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.planner-chapter-choice input:checked:disabled')).toHaveCount(40);
  await expect(page.getByRole('button', { name: 'Start season', exact: true })).toBeEnabled();
  if (phone) {
    // The same responsive editor also supports the coach's own study plan.
    await page.getByLabel('Student or coach').selectOption({ label: 'My assignments' });
    await page.getByRole('checkbox', { name: 'Chapter 1', exact: true }).check();
    await page.setViewportSize({ width: 844, height: 390 });
    await expectFullWidthEditor(page);
    await expect(page.getByRole('checkbox', { name: 'Chapter 1', exact: true })).toBeChecked();
    await page.getByRole('button', { name: 'Save assignments', exact: true }).click();
    await expect(page.getByText('Assignments saved.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('.planner-chapter-choice input:checked:disabled')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Open Student Mode' })).toBeVisible();
    // Minimizing support gives the form its space back; rotation does not change the preference.
    await page.getByRole('button', { name: 'Minimize support widget' }).click();
    await expect(page.locator('.coffee-floating')).toBeHidden();
    await expect(page.getByRole('link', { name: 'Support Erudoza (opens in a new tab)' })).toBeVisible();
    expect(await page.locator('.training-main').evaluate(el => parseFloat(getComputedStyle(el).paddingRight))).toBeLessThan(100);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.coffee-floating')).toBeHidden();
  }
});
