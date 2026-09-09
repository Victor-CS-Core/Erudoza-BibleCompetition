import { expect, test } from "@playwright/test";

const phoneWidths = [320, 375, 430] as const;

for (const width of phoneWidths) {
  test(`landing phone column has no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.goto("/");

    await expect(page.getByTestId("landing-phone-column")).toBeVisible();
    await expect(page.getByTestId("erudoza-mark")).toBeVisible();
    await expect(page.getByTestId("start-studying")).toBeVisible();
    await expect(page.getByTestId("build-a-season")).toBeVisible();
    await expect(page.getByRole("heading", { name: "TRAINING DECKS" })).toBeVisible();
    await expect(page.getByTestId("landing-deck-learner")).toHaveText("Learner");
    await expect(page.getByTestId("landing-deck-reviews")).toHaveText("Reviews");
    await expect(page.getByTestId("landing-deck-rehearsal")).toHaveText("Rehearsal");
    await expect(page.getByTestId("landing-field-guide-chrome")).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByTestId("chrome-compass")).toBeAttached();
    await expect(page.getByTestId("chrome-mountain")).toBeAttached();
    await expect(page.getByTestId("chrome-forest")).toBeAttached();
    await expect(page.getByTestId("chrome-leaf")).toBeAttached();

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      columnWidth: document.querySelector('[data-testid="landing-phone-column"]')?.getBoundingClientRect().width ?? 0,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(overflow.columnWidth).toBeGreaterThan(0);
    expect(overflow.columnWidth).toBeLessThanOrEqual(Math.min(width, 448));
  });
}
