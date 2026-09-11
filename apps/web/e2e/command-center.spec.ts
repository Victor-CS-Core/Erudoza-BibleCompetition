import { expect, test } from "@playwright/test";
import { assertNoOverflow, login, logout } from "./helpers";

test("coach command search navigates, retains pins, and exposes nested actions", async ({ page, isMobile }, info) => {
  await login(page);
  const opener = page.getByRole("button", { name: "Search sections, students, or actions", exact: true });
  await expect(opener).toBeVisible();
  if (isMobile) await opener.click();
  else await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Command center" });
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole("searchbox", { name: "Search navigation" });
  await expect(search).toBeFocused();
  await search.fill("scripture");
  await search.press("ArrowDown");
  await expect(dialog.getByRole("link", { name: "Scripture library", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/content$/);
  await expect(dialog).not.toBeVisible();

  await page.getByRole("button", { name: "All sections", exact: true }).click();
  await dialog.getByRole("button", { name: "Unpin Scripture library", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("nav-content")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("coach-app-shell")).toBeVisible();
  await expect(page.getByTestId("nav-content")).toHaveCount(0);

  await page.getByRole("button", { name: "All sections", exact: true }).click();
  await dialog.getByRole("button", { name: "Pin Scripture library", exact: true }).click();
  await dialog.getByRole("button", { name: "Show Seasons options", exact: true }).click();
  await dialog.getByRole("link", { name: "Create season", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/seasons\/new$/);
  await expect(page.getByTestId("nav-content")).toHaveCount(1);
  await expect(page.getByTestId("season-name")).toBeVisible();
  await assertNoOverflow(page);
  await page.screenshot({ path: info.outputPath("coach-command-context.png"), fullPage: true });

  await page.getByRole("button", { name: "Search sections, students, or actions", exact: true }).click();
  await search.fill("no-such-navigation-7f923");
  await expect(dialog.getByRole("link")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Search sections, students, or actions", exact: true })).toBeFocused();
});

test("student navigation remains one click away and excludes coach commands after account switch", async ({ page }, info) => {
  await login(page);
  await logout(page);
  await login(page, "daniel.student");
  await page.getByRole("button", { name: "All sections", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Command center" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Students", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Scripture library", exact: true })).toHaveCount(0);
  await dialog.getByRole("searchbox", { name: "Search navigation" }).fill("progress");
  await dialog.getByRole("link", { name: "Progress", exact: true }).click();
  await expect(page).toHaveURL(/\/student\/progress$/);
  await expect(page.getByTestId("learner-tab-progress")).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Progress");
  await page.getByTestId("learner-tab-home").click();
  await expect(page.getByRole("heading", { name: "Training HQ", exact: true })).toBeVisible();
  await assertNoOverflow(page);
  await page.screenshot({ path: info.outputPath("student-command-home.png"), fullPage: true });
});
