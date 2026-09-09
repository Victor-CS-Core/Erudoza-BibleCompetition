import { expect, test } from "@playwright/test";

const phoneWidths = [320, 375, 430] as const;

for (const width of phoneWidths) {
  test(`login phone sheet has no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.goto("/login");

    await expect(page.getByTestId("login-phone-column")).toBeVisible();
    await expect(page.getByTestId("login-kraft-banner")).toContainText("FIELD GUIDE");
    await expect(page.getByTestId("field-guide-academy")).toBeVisible();
    await expect(page.getByTestId("erudoza-mark")).toBeVisible();
    await expect(page.getByTestId("login-motto")).toHaveText("Discover · Interpret · Serve");
    await expect(page.getByTestId("login-signin-sheet")).toBeVisible();
    await expect(page.getByTestId("login-identifier")).toBeVisible();
    await expect(page.getByTestId("login-password")).toBeVisible();
    await expect(page.getByTestId("login-submit")).toContainText(/Continue/i);
    await expect(page.getByTestId("login-field-guide-chrome")).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByTestId("chrome-compass")).toBeAttached();
    await expect(page.getByTestId("chrome-mountain")).toBeAttached();
    await expect(page.getByTestId("chrome-forest")).toBeAttached();
    await expect(page.getByTestId("chrome-leaf")).toBeAttached();
    await expect(page.getByTestId("learner-tab-bar")).toHaveCount(0);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      columnWidth: document.querySelector('[data-testid="login-phone-column"]')?.getBoundingClientRect().width ?? 0,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(overflow.columnWidth).toBeGreaterThan(0);
    expect(overflow.columnWidth).toBeLessThanOrEqual(Math.min(width, 430));
  });
}
