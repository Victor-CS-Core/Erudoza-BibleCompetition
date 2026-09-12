import { expect, test } from "@playwright/test";
import { login, assertNoOverflow } from "./helpers";
test("learner menu navigates Training HQ and progress on phone widths", async ({ page }) => {
  await login(page, process.env.ERUDOZA_E2E_STUDENT ?? "daniel.student", process.env.ERUDOZA_E2E_PASSWORD!);
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 812 });
    const dock = page.getByRole("navigation", { name: "Mobile navigation", exact: true });
    await dock.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("dialog", { name: "Command center", exact: true }).getByRole("link", { name: "Progress", exact: true }).click();
    await expect(page).toHaveURL(/\/student\/progress$/);
    await expect(page.getByRole("heading", { name: "Your progress", exact: true })).toBeVisible();
    await expect(dock.getByRole("button", { name: "More", exact: true })).toHaveAttribute("aria-current", "page");
    await assertNoOverflow(page);
    await dock.getByRole("link", { name: "HQ", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Training HQ" })).toBeVisible();
    await expect(dock.getByRole("link", { name: "HQ", exact: true })).toHaveAttribute("aria-current", "page");
    await assertNoOverflow(page);
  }
});
