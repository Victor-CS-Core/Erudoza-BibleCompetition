import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, identifier: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-identifier").fill(identifier);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test("coach can reset a student password and the student can sign in", async ({ page }) => {
  const userName = `reset.student.${Date.now()}`;
  await login(page, "admin@erudoza.local", "DevAdmin!234");
  await expect(page.getByTestId("organization-name")).toBeVisible();
  await page.getByRole("link", { name: "Students" }).click();
  await page.getByTestId("student-username").fill(userName);
  await page.getByTestId("student-display-name").fill("Reset Student");
  await page.getByTestId("student-password").fill("OldPass!234");
  await page.getByTestId("add-student").click();
  await expect(page.getByTestId("student-list")).toContainText(userName);

  await page.getByTestId(`reset-password-${userName}`).click();
  await page.getByTestId("reset-password-input").fill("NewPass!234");
  await page.getByTestId("reset-password-save").click();
  await expect(page.getByTestId("reset-password-status")).toContainText("Password updated");

  await page.getByTestId("logout").click();
  await login(page, userName, "NewPass!234");
  await expect(page.getByRole("heading", { name: "Field Guide Academy" })).toBeVisible();
});
