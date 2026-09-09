import { expect, test, type Page } from "@playwright/test";

async function loginAsCoach(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-identifier").fill("admin@erudoza.local");
  await page.getByTestId("login-password").fill("DevAdmin!234");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("coach-tab-bar")).toBeVisible();
}

const phoneWidths = [320, 375, 430] as const;

test("coach shell keeps Seasons, Students, and More tabs on phone widths", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loginAsCoach(page);

  const tabs = page.getByTestId("coach-tab-bar");
  await expect(tabs.getByRole("link", { name: "Seasons", exact: true })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Students", exact: true })).toBeVisible();
  await expect(tabs.getByRole("button", { name: "More", exact: true })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Content", exact: true })).toHaveCount(0);

  await expect(page.getByTestId("create-season")).toBeVisible();
  await expect(page.getByTestId("coach-tab-seasons")).toHaveAttribute("aria-current", "page");

  await page.getByTestId("coach-tab-students").click();
  await expect(page).toHaveURL(/\/admin\/students$/);
  await expect(page.getByTestId("coach-tab-students")).toHaveAttribute("aria-current", "page");

  await page.getByTestId("coach-tab-more").click();
  await expect(page.getByTestId("coach-more-overflow").getByRole("link", { name: "Content" })).toBeVisible();
  await page.getByTestId("coach-more-overflow").getByRole("link", { name: "Content" }).click();
  await expect(page).toHaveURL(/\/admin\/content$/);
  await expect(page.getByTestId("coach-tab-more")).toHaveAttribute("aria-current", "page");

  await page.getByTestId("coach-tab-seasons").click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByTestId("create-season")).toBeVisible();
});

for (const width of phoneWidths) {
  test(`coach seasons has no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await loginAsCoach(page);

    for (const name of ["Seasons", "Students"] as const) {
      const box = await page.getByTestId("coach-tab-bar").getByRole("link", { name, exact: true }).boundingBox();
      expect(box, name).toBeTruthy();
      expect(box!.width, `${name} width`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(44);
    }
    const more = await page.getByTestId("coach-tab-more").boundingBox();
    expect(more).toBeTruthy();
    expect(more!.width).toBeGreaterThanOrEqual(44);
    expect(more!.height).toBeGreaterThanOrEqual(44);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      columnWidth: document.querySelector('[data-testid="coach-phone-column"]')?.getBoundingClientRect().width ?? 0,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(overflow.columnWidth).toBeLessThanOrEqual(Math.min(width, 430));
  });
}
