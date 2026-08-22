import { expect, test } from "@playwright/test";

test("landing page uses the Erudoza paper shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("erudoza-wordmark")).toContainText("Erudoza");
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  await expect(page.getByTestId("start-studying")).toBeVisible();
  await expect(page.getByTestId("build-a-season")).toBeVisible();
});
