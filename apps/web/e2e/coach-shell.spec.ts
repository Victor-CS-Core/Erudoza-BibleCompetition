import { expect, test } from "@playwright/test";
import { login, assertNoOverflow } from "./helpers";
test("coach navigation and layouts remain usable on phone widths", async ({ page }) => {
  await login(page);
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 812 });
    for (const [id, url] of [["coach-tab-seasons", "/admin/seasons"], ["coach-tab-students", "/admin/students"], ["nav-content", "/admin/content"], ["coach-tab-overview", "/admin"]]) {
      await page.getByTestId(id).click();
      await expect(page).toHaveURL(new RegExp(`${url}$`));
      await expect(page.getByTestId(id)).toHaveAttribute("aria-current", "page");
      await assertNoOverflow(page);
    }
  }
});
