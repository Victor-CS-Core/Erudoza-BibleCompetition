import { expect, test } from "@playwright/test";
import { login, assertNoOverflow } from "./helpers";
test("coach navigation and layouts remain usable on phone widths", async ({ page }) => {
  await login(page);
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 812 });
    const dock = page.getByRole("navigation", { name: "Mobile navigation", exact: true });
    await expect(dock).toBeVisible();
    for (const [label, url] of [["Seasons", "/admin/seasons"], ["Students", "/admin/students"], ["Scripture library", "/admin/content"], ["Overview", "/admin"]]) {
      if (label === "Scripture library") {
        await dock.getByRole("button", { name: "More", exact: true }).click();
        await page.getByRole("dialog", { name: "Command center", exact: true }).getByRole("link", { name: label, exact: true }).click();
      } else {
        await dock.getByRole("link", { name: label, exact: true }).click();
      }
      await expect(page).toHaveURL(new RegExp(`${url}$`));
      const current = label === "Scripture library" ? dock.getByRole("button", { name: "More", exact: true }) : dock.getByRole("link", { name: label, exact: true });
      await expect(current).toHaveAttribute("aria-current", "page");
      await assertNoOverflow(page);
    }
  }
});
