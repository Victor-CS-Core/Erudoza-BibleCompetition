import { expect, test } from "@playwright/test";
import { login, assertNoOverflow, openLearnerMenu } from "./helpers";
test("learner menu navigates Training HQ and progress on phone widths", async ({ page }) => {
  await login(page, "daniel.student", process.env.ERUDOZA_E2E_PASSWORD!);
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 812 });
    await openLearnerMenu(page);
    await page.getByTestId("learner-tab-progress").click();
    await expect(page).toHaveURL(/\/student\/progress$/);
    await assertNoOverflow(page);
    await openLearnerMenu(page);
    await page.getByTestId("learner-tab-home").click();
    await expect(page.getByRole("heading", { name: "Training HQ" })).toBeVisible();
    await assertNoOverflow(page);
  }
});
