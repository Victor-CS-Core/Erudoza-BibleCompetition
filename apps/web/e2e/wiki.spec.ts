import { expect, test } from "@playwright/test";
import { assertNoOverflow, login, logout } from "./helpers";

test("coach can search and browse the authenticated wiki", async ({ page }, info) => {
  await login(page);
  const runtimeErrors: string[] = [];
  page.on("pageerror", error => runtimeErrors.push(error.message));

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/wiki?q=assignment");
    await expect(page.getByRole("heading", { name: "Erudoza wiki", exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("searchbox", { name: "Search the wiki", exact: true })).toHaveValue("assignment", { timeout: 15_000 });
    await expect(page.getByText(/guides match/)).toBeVisible();
    const assignmentSummary = page.locator("details.wiki-article > summary").filter({ hasText: "Assignments and chapter plans" }).first();
    const assignmentArticle = assignmentSummary.locator("..");
    await assignmentSummary.click();
    await expect(assignmentArticle.getByRole("link", { name: "Coach assignments", exact: true })).toHaveAttribute("href", "/admin/assignments");
    const images = page.locator(".wiki-article[open] .wiki-screenshot img");
    expect(await images.count()).toBeGreaterThan(0);
    expect(await images.evaluateAll(elements => elements.every(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0))).toBeTruthy();
    await assertNoOverflow(page);
    if (info.project.name === "chromium" && width === 1440) await page.screenshot({ path: info.outputPath("coach-wiki-assignment.png"), fullPage: true });
  }

  await page.getByRole("button", { name: "Coach", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Coach guides", exact: true })).toBeVisible();
  await page.goto("/admin");
  await logout(page);
  await page.goto("/wiki");
  await expect(page).toHaveURL(/\/login$/);
  expect(runtimeErrors).toEqual([]);
});

test("student can open the wiki and search shared explanations", async ({ page }, info) => {
  await login(page, process.env.ERUDOZA_E2E_STUDENT ?? "daniel.student");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/wiki?q=privacy");
    await expect(page.locator("#wiki-main").getByText("Student workspace", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".wiki-results").getByText("Privacy, permissions, and saved data", { exact: true }).first()).toBeVisible();
    await assertNoOverflow(page);
    if (info.project.name === "chromium" && width === 1440) await page.screenshot({ path: info.outputPath("student-wiki-privacy.png"), fullPage: true });
  }
});
