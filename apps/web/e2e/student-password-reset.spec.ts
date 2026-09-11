import { expect, test } from "@playwright/test";
import { login, logout } from "./helpers";

test("coach can reset a student password and the student can sign in", async ({ page }) => {
  const userName = `reset.student.${Date.now()}`;
  await login(page, "admin@erudoza.local", process.env.ERUDOZA_E2E_PASSWORD!);
  await expect(page.getByTestId("coach-app-shell")).toBeVisible();
  await page.getByTestId("coach-tab-students").click();
  await page.getByTestId("student-username").fill(userName);
  await page.getByTestId("student-display-name").fill("Reset Student");
  await page.getByTestId("student-password").fill("OldPass!234");
  await page.getByTestId("add-student").click();
  await page.getByLabel("Search students", { exact: true }).fill(userName);
  await expect(page.getByRole("table")).toContainText(userName);

  await page.getByTestId(`reset-password-${userName}`).click();
  await page.getByTestId("reset-password-input").fill("NewPass!234");
  await page.getByRole("dialog").getByRole("button", { name: "Save password" }).click();
  await expect(page.getByTestId("reset-password-status")).toContainText("Password updated");


  await logout(page);
  await login(page, userName, "NewPass!234");
  await expect(page.getByRole("heading", { name: "Training HQ" })).toBeVisible();
});
