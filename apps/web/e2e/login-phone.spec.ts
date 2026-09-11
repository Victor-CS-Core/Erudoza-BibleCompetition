import { expect, test } from "@playwright/test";
import { assertNoOverflow } from "./helpers";
for (const width of [320, 375, 430]) {
  test(`sign-in controls work without overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    await page.getByLabel("Password", { exact: true }).fill("Synthetic!234");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
    await assertNoOverflow(page);
    await page.getByRole("link", { name: "Back to home" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
}
