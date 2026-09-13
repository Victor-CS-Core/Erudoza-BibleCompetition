import { expect, test, type Page } from "@playwright/test";
import { assertNoOverflow, login } from "./helpers";
import type { Assignment, Me, PassageRange, ScriptureLibrary, Student } from "../src/api/types";

async function identity(page: Page) {
  const me = await (await page.request.get("/api/v1/me")).json() as Me;
  const org = `/api/v1/organizations/${me.organizationId}`;
  const students = await (await page.request.get(`${org}/students`)).json() as Student[];
  return { me, org, student: students.find(item => item.userName === "student.fixture")! };
}

async function smallSeason(page: Page, name: string) {
  const { org, student } = await identity(page);
  const library = await (await page.request.get(`${org}/library`)).json() as ScriptureLibrary;
  const book = library.books.find(book => book.bookKey === "EPH")!;
  const response = await page.request.post(`${org}/seasons`, { data: { name, yearLabel: "2026", ruleProfileKey: "PBE_STYLE_V1" } });
  expect(response.ok()).toBe(true);
  const season = await response.json() as { id: string };
  const endpoint = `${org}/seasons/${season.id}/assignments`;
  const range = { bookKey: book.bookKey, startChapter: 1, startVerse: 1, endChapter: 6, endVerse: 24 };
  expect((await page.request.post(`${org}/seasons/${season.id}/scope`, { data: { contentPackId: book.contentPackId, includes: [range], excludes: [] } })).ok()).toBe(true);
  await page.goto(`/admin/seasons/${season.id}?step=students&studentId=${student.userId}`);
  await page.getByRole("checkbox", { name: "Select all chapters in Ephesians" }).check();
  return { endpoint, student };
}

test("all 190 chapters save in two writes, persist for student and coach, and unlock season actions", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await login(page);
  const { me, org, student } = await identity(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/seasons/new");
  await page.getByLabel("Season name").fill("Whole books save regression");
  await page.getByRole("checkbox", { name: "Exodus Whole book", exact: true }).check();
  await page.getByRole("checkbox", { name: "Psalms Whole book", exact: true }).check();
  await page.getByRole("button", { name: "Save & assign students →" }).click();
  await expect(page.getByRole("heading", { name: "Student assignments", exact: true })).toBeVisible();
  const seasonId = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.goto(`/admin/seasons/${seasonId}?step=students&studentId=${student.userId}`);
  const endpoint = `${org}/seasons/${seasonId}/assignments`;
  const writes: { range: PassageRange; difficulty: string }[] = [];
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${endpoint}`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    writes.push(route.request().postDataJSON());
    if (writes.length === 1) await hold;
    await route.continue();
  });
  await page.getByRole("checkbox", { name: "Select all chapters in Exodus" }).check();
  await page.getByRole("checkbox", { name: "Select all chapters in Psalms" }).check();
  await page.getByText("Plan settings · Standard", { exact: true }).click();
  await page.getByLabel("Training difficulty").selectOption("Advanced");
  await page.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "0 of 190 confirmed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Saving 0 of 190…", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save as a draft" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Start season", exact: true })).toBeDisabled();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: "Saving 0 of 190…", exact: true }).scrollIntoViewIfNeeded();
    await assertNoOverflow(page);
    await page.screenshot({ path: info.outputPath(`saving-${width}.png`) });
  }
  release();
  await expect(page.getByText("Assignments saved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save as a draft" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Start season", exact: true })).toBeEnabled();
  expect(writes.map(write => [write.range.bookKey, write.range.startChapter, write.range.endChapter, write.difficulty])).toEqual([
    ["EXO", 1, 40, "Advanced"], ["PSA", 1, 150, "Advanced"],
  ]);
  const saved = await (await page.request.get(endpoint)).json() as Assignment[];
  expect(saved).toHaveLength(2);
  expect(saved.every(item => item.studentUserId === student.userId && item.difficulty === "Advanced")).toBe(true);
  await page.reload();
  await expect(page.locator('.planner-chapter-choice input:checked:disabled')).toHaveCount(190);
  await page.getByRole("button", { name: "Start season", exact: true }).scrollIntoViewIfNeeded();
  await assertNoOverflow(page);
  await page.screenshot({ path: info.outputPath("saved-320.png") });

  await page.goto(`/admin/seasons/${seasonId}?step=students&studentId=${me.userId}`);
  let selfWrites = 0;
  page.on("request", request => { if (request.url().endsWith(`/seasons/${seasonId}/my-assignments`) && request.method() === "POST") selfWrites++; });
  await page.getByRole("checkbox", { name: "Select all chapters in Exodus" }).check();
  await page.getByRole("checkbox", { name: "Select all chapters in Psalms" }).check();
  await page.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(page.getByText("Assignments saved.", { exact: true })).toBeVisible();
  expect(selfWrites).toBe(2);
  await page.reload();
  await expect(page.locator('.planner-chapter-choice input:checked:disabled')).toHaveCount(190);
  await expect(page.getByRole("link", { name: "Open Student Mode" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a stalled write times out, keeps selections, and retries once after fresh readback", async ({ page }, info) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const { endpoint } = await smallSeason(page, "Stalled save recovery");
  let attempts = 0;
  await page.route(`**${endpoint}`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    attempts++;
    if (attempts === 1) return; // Simulate a transport that never returns a response.
    await route.continue();
  });
  await page.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("timed out", { timeout: 35_000 });
  await expect(page.getByRole("checkbox", { name: "Select all chapters in Ephesians" })).toBeChecked();
  await expect(page.getByRole("button", { name: "Save assignments", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Start season", exact: true })).toBeDisabled();
  expect(attempts).toBe(1);
  await page.getByRole("alert").scrollIntoViewIfNeeded();
  await assertNoOverflow(page);
  await page.screenshot({ path: info.outputPath("retry-390.png") });
  await page.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(page.getByText("Assignments saved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start season", exact: true })).toBeEnabled();
  expect(attempts).toBe(2);
  expect(await (await page.request.get(endpoint)).json()).toHaveLength(1);
});

test("a response lost after persistence is reconciled without another write", async ({ page }) => {
  await login(page);
  const { endpoint } = await smallSeason(page, "Lost response recovery");
  let attempts = 0;
  await page.route(`**${endpoint}`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    attempts++;
    const persisted = await route.fetch();
    expect(persisted.ok()).toBe(true);
    await route.abort("connectionreset");
  });
  await page.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(page.getByText("Assignments saved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start season", exact: true })).toBeEnabled();
  expect(attempts).toBe(1);
  expect(await (await page.request.get(endpoint)).json()).toHaveLength(1);
});
