import { expect, test, type Page } from "@playwright/test";

async function loginAsStudent(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-identifier").fill("daniel.student");
  await page.getByTestId("login-password").fill("DevStudent!234");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("learner-tab-bar")).toBeVisible();
}

const phoneWidths = [320, 375, 430] as const;

test("learner shell keeps Home, Learner, and Progress tabs on phone widths", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loginAsStudent(page);

  const tabs = page.getByTestId("learner-tab-bar");
  await expect(tabs.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Learner", exact: true })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Progress", exact: true })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Reviews", exact: true })).toHaveCount(0);

  await page.getByTestId("learner-tab-progress").click();
  await expect(page).toHaveURL(/\/student\/progress$/);
  await expect(page.getByTestId("learner-tab-progress")).toHaveAttribute("aria-current", "page");

  await page.getByTestId("nav-academy-learner").click();
  await expect(page).toHaveURL(/\/student\/study/);
  await expect(page.getByTestId("nav-academy-learner")).toHaveAttribute("aria-current", "page");

  await page.getByTestId("learner-tab-home").click();
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.getByTestId("field-guide-academy")).toBeVisible();
});

for (const width of phoneWidths) {
  test(`learner home has no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await loginAsStudent(page);

    for (const name of ["Home", "Learner", "Progress"] as const) {
      const box = await page.getByTestId("learner-tab-bar").getByRole("link", { name, exact: true }).boundingBox();
      expect(box, name).toBeTruthy();
      expect(box!.width, `${name} width`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(44);
    }

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      columnWidth: document.querySelector('[data-testid="learner-phone-column"]')?.getBoundingClientRect().width ?? 0,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(overflow.columnWidth).toBeLessThanOrEqual(Math.min(width, 448));
  });
}
