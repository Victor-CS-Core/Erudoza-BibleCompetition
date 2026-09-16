// Visual screenshot tour for pre-production review.
// Runs against the self-contained Miniflare fixture (seeded coach + student).
// Screenshots land in test-results/visual-screenshots/<project>/<name>.png and
// are uploaded as CI artifacts on every push to main.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { login, logout } from "./helpers";

// Overflow note: report-only via test annotations — the screenshots are the
// evidence, and pre-existing narrow-viewport overflow must not fail the tour.
async function checkNoOverflow(page: Page, path: string, info: TestInfo) {
  const size = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  if (size.scroll > size.width + 1) {
    info.annotations.push({
      type: "overflow",
      description: `${path}: scrollWidth ${size.scroll} > clientWidth ${size.width}`,
    });
  }
}

const outDir = (info: { project: { name: string } }, name: string) => {
  const dir = join("test-results", "visual-screenshots", info.project.name);
  mkdirSync(dir, { recursive: true });
  return join(dir, `${name}.png`);
};

type Info = TestInfo & { project: { name: string } };
async function capture(page: Page, info: Info, name: string, path: string) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await checkNoOverflow(page, path, info);
  await page.screenshot({ path: outDir(info, name), fullPage: true });
  expect(errors, `page errors on ${path}`).toEqual([]);
}

async function captureAuthed(page: Page, info: Info, name: string, path: string) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await checkNoOverflow(page, path, info);
  await page.screenshot({ path: outDir(info, name), fullPage: true });
  expect(errors, `page errors on ${path}`).toEqual([]);
}

test("public pages", async ({ page }, info) => {
  await capture(page, info, "landing", "/");
  await capture(page, info, "login", "/login");
  await capture(page, info, "wiki-public", "/wiki");
  await capture(page, info, "privacy", "/privacy");
});

test("coach pages, incl. character 2D/3D toggle", async ({ page }, info) => {
  await login(page);
  await captureAuthed(page, info, "coach-overview", "/admin");
  await captureAuthed(page, info, "coach-students", "/admin/students");
  await captureAuthed(page, info, "coach-seasons", "/admin/seasons");
  await captureAuthed(page, info, "coach-assignments", "/admin/assignments");
  await captureAuthed(page, info, "coach-practice", "/admin/practice");

  // Character panel: still 2D render, then the animated 3D preview in place.
  await page.goto("/admin/profile");
  await page.waitForLoadState("networkidle");
  const canvas = page.locator(".character-canvas").first();
  await expect(canvas).toHaveAttribute("data-ready", "true");
  await checkNoOverflow(page, "/admin/profile", info);
  await page.screenshot({ path: outDir(info, "coach-profile-character-2d"), fullPage: true });
  await page.getByRole("group", { name: "Preview style" }).getByRole("button", { name: "3D", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-ready", "true");
  await page.waitForTimeout(800); // let the idle animation advance a few frames
  await page.screenshot({ path: outDir(info, "coach-profile-character-3d"), fullPage: true });
  await logout(page);
});

test("student pages", async ({ page }, info) => {
  await login(page, "student.fixture");
  await captureAuthed(page, info, "student-hq", "/student");
  await page.goto("/student/profile");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".character-canvas").first()).toHaveAttribute("data-ready", "true");
  await checkNoOverflow(page, "/student/profile", info);
  await page.screenshot({ path: outDir(info, "student-profile"), fullPage: true });
  await logout(page);
});
