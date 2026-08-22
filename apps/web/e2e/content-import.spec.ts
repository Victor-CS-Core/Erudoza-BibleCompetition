import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, identifier: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-identifier").fill(identifier);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test("coach can import a synthetic pack and browse stored verses", async ({ page }) => {
  const packKey = `dev-joshua-${Date.now()}`;
  await login(page, "admin@erudoza.local", "DevAdmin!234");
  await expect(page.getByTestId("organization-name")).toBeVisible();
  await page.getByRole("link", { name: "Content" }).click();
  await expect(page.getByTestId("load-sample-pack")).toBeVisible();
  const json = JSON.parse(await page.getByTestId("import-pack-json").inputValue()) as { packKey: string };
  json.packKey = packKey;
  await page.getByTestId("import-pack-json").fill(JSON.stringify(json));
  await page.getByTestId("import-pack-submit").click();
  await expect(page.getByTestId("content-pack").filter({ hasText: packKey })).toBeVisible();
  await page.getByTestId("content-pack").filter({ hasText: packKey }).click();
  await expect(page.getByTestId("source-unit-list")).toContainText("Joshua 1:1");
  await expect(page.getByTestId("source-unit-list")).toContainText("Development sample: Joshua rose early.");

  await page.goto("/admin/seasons/new");
  await page.getByTestId("season-name").fill(`Imported ${packKey}`);
  await page.getByTestId("save-season").click();
  await expect(page.getByTestId("select-content-pack")).toContainText(packKey);
  const packValue = await page.getByTestId("select-content-pack").locator("option", { hasText: packKey }).getAttribute("value");
  await page.getByTestId("select-content-pack").selectOption(packValue!);
  await expect(page.getByTestId("select-content-pack")).toHaveValue(packValue!);
});
