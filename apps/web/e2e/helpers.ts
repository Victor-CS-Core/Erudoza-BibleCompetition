import { expect, type Page } from "@playwright/test";
export async function login(page: Page, identifier = "admin@erudoza.local", password = process.env.ERUDOZA_E2E_PASSWORD!) {
  await page.goto("/login");
  await page.getByLabel("Email or username").fill(identifier);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(identifier.includes("admin@") ? /\/admin$/ : /\/student$/);
}
export async function assertNoOverflow(page: Page) {
  const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
}
export async function openLearnerMenu(page: Page) {
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) await menu.click();
}
export async function logout(page: Page) {
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByTestId("logout").click();
  await expect(page).toHaveURL(/\/login$/);
}
