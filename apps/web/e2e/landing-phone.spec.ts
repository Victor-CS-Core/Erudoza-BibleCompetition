import { expect, test } from "@playwright/test";

const phoneWidths = [320, 390, 430] as const;

for (const width of phoneWidths) {
  test(`landing phone column has no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.goto("/");

    await expect(page.getByTestId("landing-phone-column")).toBeVisible();
    await expect(page.getByRole("link", { name: "Erudoza home" })).toBeVisible();
    await expect(page.getByTestId("start-studying")).toBeVisible();
    await expect(page.getByTestId("build-a-season")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Rooted in Scripture.");
    await expect(page.getByRole("heading", { name: "Learn your passages" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review with purpose" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rehearse with your team" })).toBeVisible();
    await expect(page.getByRole("figure", { name: "A glimpse of Erudoza Honors" })).toContainText("Sample artwork");
    await expect(page.getByTestId("start-studying")).toHaveAttribute("href", "/login");
    await expect(page.getByTestId("build-a-season")).toHaveAttribute("href", "/login");

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
