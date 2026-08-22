import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, identifier: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-identifier").fill(identifier);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test("admin can activate a season and the student can study missing words", async ({ page }) => {
  const seasonName = `Gauntlet ${Date.now()}`;
  await login(page, "admin@erudoza.local", "DevAdmin!234");
  await expect(page.getByTestId("organization-name")).toContainText("Development Academy");
  await page.getByTestId("create-season").click();
  await page.getByTestId("season-name").fill(seasonName);
  await expect(page.getByTestId("rule-profile")).toHaveValue("PBE_STYLE_V1");
  await page.getByTestId("save-season").click();
  await expect(page.getByTestId("select-content-pack")).toContainText("dev-daniel");
  await page.getByTestId("save-scope").click();
  await expect(page.getByText("Scope saved.")).toBeVisible();
  await page.getByTestId("assign-student").click();
  await expect(page.getByText("Assignment saved.")).toBeVisible();
  await page.getByTestId("activate-season").click();
  await expect(page.getByTestId("season-status")).toHaveText("Active");
  await page.getByTestId("logout").click();

  await login(page, "daniel.student", "DevStudent!234");
  await expect(page.getByTestId("assignment-range")).toContainText("DAN");
  await page.getByTestId("start-todays-deck").click();
  await expect(page.getByTestId("challenge-card")).toBeVisible();
  await expect(page.getByTestId("challenge-prompt")).toContainText("____");
  const answer = await page.getByTestId("debug-answer").innerText();
  await page.getByTestId("missing-words-answer").fill(answer.trim());
  await page.getByTestId("submit-answer").click();
  await expect(page.getByTestId("challenge-feedback")).toBeVisible();
  await expect(page.getByTestId("feedback-citation")).toContainText("Daniel");
  await expect(page.getByTestId("feedback-source")).toContainText("Development sample");
  await page.getByTestId("complete-session").click();
  await expect(page.getByTestId("progress-mastery")).toBeVisible();
  await expect(page.getByTestId("progress-attempts")).not.toHaveText("0");
});
