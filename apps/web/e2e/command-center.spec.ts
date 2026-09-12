import { expect, test } from "@playwright/test";
import { assertNoOverflow, login, logout, openCommandCenter } from "./helpers";

async function assertHeaderLayout(page: import("@playwright/test").Page) {
  const header = page.locator(".command-masthead");
  const search = header.getByRole("button", { name: /^Search sections,/ });
  const brand = header.getByRole("link", { name: "Erudoza home", exact: true });
  const account = header.getByRole("button", { name: "Account", exact: true });
  await expect(search).toBeVisible();
  await expect(brand).toBeVisible();
  const [searchBox, brandBox, accountBox] = await Promise.all([search.boundingBox(), brand.boundingBox(), account.boundingBox()]);
  const width = page.viewportSize()!.width;
  if (width <= 760) {
    expect(Math.abs(brandBox!.x + brandBox!.width / 2 - width / 2)).toBeLessThan(1);
    expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(brandBox!.x);
    expect(brandBox!.x + brandBox!.width).toBeLessThanOrEqual(accountBox!.x);
    for (const box of [searchBox!, brandBox!, accountBox!]) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  } else {
    // Search fills the entire flexible column, leaving only the shared row gaps.
    expect(searchBox!.x - brandBox!.x - brandBox!.width).toBeGreaterThanOrEqual(16);
    expect(searchBox!.x - brandBox!.x - brandBox!.width).toBeLessThanOrEqual(32);
    expect(accountBox!.x - searchBox!.x - searchBox!.width).toBeGreaterThanOrEqual(16);
    expect(accountBox!.x - searchBox!.x - searchBox!.width).toBeLessThanOrEqual(32);
  }
  await assertNoOverflow(page);
}

test("coach command search navigates, retains pins, and exposes nested actions", async ({ page, isMobile }, info) => {
  await login(page);
  await assertHeaderLayout(page);
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

  await openCommandCenter(page);
  await dialog.getByRole("button", { name: "Unpin Scripture library", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("nav-content")).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(page.getByTestId("coach-app-shell")).toBeVisible();
  await expect(page.getByTestId("nav-content")).toHaveAttribute("aria-current", "page");

  await openCommandCenter(page);
  await expect(dialog.getByRole("button", { name: "Pin Scripture library", exact: true })).toHaveAttribute("aria-pressed", "false");
  await dialog.getByRole("link", { name: "Seasons", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/seasons$/);
  await expect(page.getByTestId("nav-content")).toHaveCount(0);
  await openCommandCenter(page);
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
  await login(page, process.env.ERUDOZA_E2E_STUDENT ?? "daniel.student");
  await assertHeaderLayout(page);
  await openCommandCenter(page);
  const dialog = page.getByRole("dialog", { name: "Command center" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Students", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Scripture library", exact: true })).toHaveCount(0);
  await dialog.getByRole("searchbox", { name: "Search navigation" }).fill("progress");
  await dialog.getByRole("link", { name: "Progress", exact: true }).click();
  await expect(page).toHaveURL(/\/student\/progress$/);
  await expect(page.getByTestId("learner-tab-progress")).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Your progress", exact: true })).toBeVisible();
  const dock = page.getByRole("navigation", { name: "Mobile navigation", exact: true });
  if (await dock.isVisible()) {
    await expect(dock.getByRole("button", { name: "More", exact: true })).toHaveAttribute("aria-current", "page");
    await dock.getByRole("link", { name: "HQ", exact: true }).click();
  } else {
    await page.getByTestId("learner-tab-home").click();
  }
  await expect(page.getByRole("heading", { name: "Training HQ", exact: true })).toBeVisible();
  await assertNoOverflow(page);
  await page.screenshot({ path: info.outputPath("student-command-home.png"), fullPage: true });
});
