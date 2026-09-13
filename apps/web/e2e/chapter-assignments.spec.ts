import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Assignment, AttemptResult, ChallengeCard, LibraryBook, Me, Progress, ScriptureLibrary, SeasonScope, Student } from "../src/api/types";
import type { AssignedScripture } from "../src/api/scripture";
import { assertNoOverflow, login, logout } from "./helpers";
import { answerCard, json, type StoredSource } from "./study-source-helpers";

const chapterCheckbox = (page: Page, number: number) => page.getByRole("checkbox", { name: `Chapter ${number}`, exact: true });
const coordinates = (book: LibraryBook, chapters: number[], excluded: string[] = []) => book.chapters
  .filter(chapter => chapters.includes(chapter.number))
  .flatMap(chapter => chapter.verses.map(verse => `${chapter.number}:${verse}`))
  .filter(coordinate => !excluded.includes(coordinate));
const ranges = (assignments: Assignment[]) => assignments.map(item => ({ startChapter: item.startChapter, startVerse: item.startVerse, endChapter: item.endChapter, endVerse: item.endVerse }))
  .sort((a, b) => a.startChapter - b.startChapter || a.startVerse - b.startVerse);

async function createStudent(page: Page, org: string, displayName: string) {
  return json<Student>(page.request, `${org}/students`, { userName: `chapters.${randomUUID()}`, displayName, password: process.env.ERUDOZA_E2E_PASSWORD });
}

async function assertTouchTarget(locator: Locator) {
  const size = await locator.boundingBox();
  expect(size, `Visible touch target: ${await locator.textContent()}`).not.toBeNull();
  expect(size!.width).toBeGreaterThanOrEqual(44);
  expect(size!.height).toBeGreaterThanOrEqual(44);
}

test("whole-book season supports separate chapter selections, overlapping student plans, and preserved progress", async ({ page }, info) => {
  test.setTimeout(150_000);
  page.setDefaultTimeout(15_000);
  if (process.env.ERUDOZA_CHAPTER_BLOCK_COFFEE) await page.route("https://cdnjs.buymeacoffee.com/1.0.0/widget.prod.min.js", route => route.abort("blockedbyclient"));
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const mobile = info.project.name.includes("mobile");
  const widths = mobile ? [390, 320] : [1440];
  await page.setViewportSize({ width: widths[0], height: 1000 });
  await login(page);
  const me = await json<Me>(page.request, "/api/v1/me");
  const org = `/api/v1/organizations/${me.organizationId}`;
  const library = await json<ScriptureLibrary>(page.request, `${org}/library`);
  const book = library.books.find(item => item.bookKey === "EPH")!;
  expect(book.chapters).toHaveLength(6);
  const longName = `Alexandria ${"Longfamilyname".repeat(12)} ${randomUUID().slice(0, 8)}`;
  const student = await createStudent(page, org, longName);
  const second = await createStudent(page, org, "Second chapter student");
  const sources = await json<StoredSource[]>(page.request, `${org}/content-packs/${book.contentPackId}/source-units`);

  await page.goto("/admin/seasons/new");
  await page.getByLabel("Season name", { exact: true }).fill(`Chapter assignment ${"Seasonname".repeat(9)} ${randomUUID().slice(0, 8)}`);
  await page.getByRole("checkbox", { name: "Ephesians Whole book", exact: true }).check();
  await expect(page.getByRole("complementary").filter({ hasText: "Season summary" })).toContainText("Ephesians");
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await assertNoOverflow(page);
    await page.screenshot({ path: info.outputPath(`whole-book-scope-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "Save & assign students →", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Student assignments", exact: true })).toBeVisible();
  const seasonId = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.goto(`/admin/assignments?seasonId=${seasonId}&studentId=${student.userId}`);
  const savedScope = await json<SeasonScope>(page.request, `${org}/seasons/${seasonId}/scope`);
  expect(savedScope.packs).toEqual([{ contentPackId: book.contentPackId, includes: [{ bookKey: "EPH", startChapter: 1, startVerse: 1, endChapter: 6, endVerse: 24 }], excludes: [] }]);

  const picker = page.getByRole("group", { name: "Chapters to assign", exact: true });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("checkbox", { name: /^Chapter \d+$/ })).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Save assignments", exact: true })).toBeDisabled();
  await chapterCheckbox(page, 1).focus();
  await page.keyboard.press("Space");
  await expect(chapterCheckbox(page, 1)).toBeChecked();
  await chapterCheckbox(page, 3).focus();
  await page.keyboard.press("Space");
  await expect(chapterCheckbox(page, 3)).toBeChecked();
  await expect(chapterCheckbox(page, 2)).not.toBeChecked();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await assertNoOverflow(page);
    if (mobile) {
      for (const target of [chapterCheckbox(page, 1).locator(".."), chapterCheckbox(page, 3).locator(".."), page.getByRole("checkbox", { name: "Select all chapters in Ephesians", exact: true }).locator(".."), page.getByRole("button", { name: "Save assignments", exact: true })]) await assertTouchTarget(target);
      await chapterCheckbox(page, 1).locator("..").evaluate(label => label.scrollIntoView({ block: "center" }));
      const chapter = await chapterCheckbox(page, 1).locator("..").boundingBox();
      const masthead = await page.locator(".command-masthead").boundingBox();
      const dock = await page.getByRole("navigation", { name: "Mobile navigation", exact: true }).boundingBox();
      expect.soft(chapter!.y).toBeGreaterThanOrEqual(Math.max(0, masthead!.y + masthead!.height));
      expect.soft(chapter!.y + chapter!.height).toBeLessThanOrEqual(dock!.y);
      // The current editor saves in normal page flow below the chapter choices.
      await page.getByRole("button", { name: "Save assignments", exact: true }).evaluate(button => button.scrollIntoView({ block: "center" }));
      const save = await page.getByRole("button", { name: "Save assignments", exact: true }).boundingBox();
      const chapterAfterScroll = await chapterCheckbox(page, 1).locator("..").boundingBox();
      if (process.env.ERUDOZA_CHAPTER_BLOCK_COFFEE) await expect(page.locator(".coffee-fallback")).toBeVisible();
      const supportControls = await page.locator("#bmc-wbtn, .coffee-fallback, .coffee-minimize").evaluateAll(elements => elements.flatMap(element => {
        const style = getComputedStyle(element), rect = element.getBoundingClientRect();
        return style.display === "none" || style.visibility === "hidden" || !rect.width || !rect.height ? [] : [{ name: element.id || element.className, x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: style.bottom, transform: style.transform, transition: style.transition, animation: style.animation, activeAnimations: element.getAnimations().map(animation => ({ playState: animation.playState, currentTime: animation.currentTime, transitionProperty: animation instanceof CSSTransition ? animation.transitionProperty : null })) }];
      }));
      await info.attach(`save-dock-${width}`, { body: JSON.stringify({ save, dock, chapter, chapterAfterScroll }), contentType: "application/json" });
      await info.attach(`save-support-${width}`, { body: JSON.stringify({ save, supportControls }), contentType: "application/json" });
      await page.screenshot({ path: info.outputPath(`chapter-controls-viewport-${width}.png`) });
      for (const support of supportControls) expect.soft(save!.x + save!.width <= support.x || support.x + support.width <= save!.x || save!.y + save!.height <= support.y || support.y + support.height <= save!.y, `${support.name} must not cover Save assignments at ${width}px`).toBe(true);
      expect.soft(save!.y).toBeGreaterThanOrEqual(0);
      expect.soft(save!.x).toBeGreaterThanOrEqual(0);
      expect.soft(save!.x + save!.width).toBeLessThanOrEqual(width);
      expect.soft(save!.y + save!.height).toBeLessThanOrEqual(dock!.y);
      expect.soft(save!.y).toBeGreaterThanOrEqual(chapterAfterScroll!.y + chapterAfterScroll!.height);
      const minimize = page.getByRole("button", { name: "Minimize support widget" });
      if (await minimize.isVisible()) {
        await minimize.click();
        await expect(page.locator("#bmc-wbtn")).toBeHidden();
        await expect(page.locator(".coffee-fallback")).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Support Erudoza (opens in a new tab)" })).toBeFocused();
        await page.screenshot({ path: info.outputPath(`chapter-support-minimized-${width}.png`) });
        await page.getByRole("button", { name: "Show support button" }).click();
        await expect(minimize).toBeFocused();
        await expect(chapterCheckbox(page, 1)).toBeChecked();
      }
    }
    await page.screenshot({ path: info.outputPath(`chapter-picker-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(page.locator(".planner-saved-row")).toHaveCount(1);
  await expect(page.locator(".planner-saved-row")).toContainText("Chapters 1, 3 · saved assignments");
  const original = (await json<Assignment[]>(page.request, `${org}/seasons/${seasonId}/assignments`)).filter(item => item.studentUserId === student.userId);
  expect(ranges(original)).toEqual([{ startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 23 }, { startChapter: 3, startVerse: 1, endChapter: 3, endVerse: 21 }]);
  expect(await page.locator(".planner-saved").evaluate((saved, fields) => !!(fields!.compareDocumentPosition(saved) & Node.DOCUMENT_POSITION_FOLLOWING), await picker.elementHandle())).toBe(true);
  await page.reload();
  await expect(page.locator(".planner-saved-row")).toHaveCount(1);
  await expect(page.locator(".planner-saved-row")).toContainText("Chapters 1, 3 · saved assignments");
  await expect(chapterCheckbox(page, 1)).toBeDisabled();
  await expect(chapterCheckbox(page, 3)).toBeDisabled();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await assertNoOverflow(page);
    await page.screenshot({ path: info.outputPath(`saved-chapter-assignments-${width}.png`), fullPage: true });
  }
  await expect(page.getByRole("button", { name: "Specific verses", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("assignment-start-chapter")).toHaveCount(0);
  await expect(picker.getByRole("checkbox", { name: /^Chapter \d+$/ })).toHaveCount(6);

  await page.goto(`/admin/assignments?seasonId=${seasonId}&studentId=${second.userId}`);
  await chapterCheckbox(page, 1).click();
  await chapterCheckbox(page, 3).click();
  await page.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(page.locator(".planner-saved-row")).toHaveCount(1);
  await expect(page.locator(".planner-saved-row")).toContainText("Chapters 1, 3 · saved assignments");
  const allAssignments = await json<Assignment[]>(page.request, `${org}/seasons/${seasonId}/assignments`);
  expect(ranges(allAssignments.filter(item => item.studentUserId === second.userId))).toEqual(ranges(original));
  expect(allAssignments.filter(item => item.studentUserId === student.userId)).toEqual(original);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/admin/assignments?seasonId=${seasonId}`);
    await expect(page.getByRole("table")).toContainText(longName);
    await page.screenshot({ path: info.outputPath(`assignment-coverage-${width}.png`), fullPage: true });
    await assertNoOverflow(page);
    if (mobile) {
      const coverage = page.getByRole("region", { name: "Assigned passage coverage", exact: true });
      await coverage.focus();
      await expect(coverage).toBeFocused();
      await coverage.press("ArrowRight");
      await expect.poll(() => coverage.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    }
  }
  expect(await json(page.request, `${org}/seasons/${seasonId}/activate`, {})).toMatchObject({ activated: true });
  await logout(page);
  await login(page, student.userName);
  const assigned = await json<AssignedScripture>(page.request, `/api/v1/study/seasons/${seasonId}/scripture`);
  expect(assigned.verses.map(verse => `${verse.chapter}:${verse.verse}`)).toEqual(coordinates(book, [1, 3]));
  const cardResponse = page.waitForResponse(response => /\/api\/v1\/study\/sessions\/[^/]+\/next$/.test(response.url()));
  await page.goto(`/student/study?seasonId=${seasonId}`);
  const card = await (await cardResponse).json() as ChallengeCard;
  await expect(page.getByTestId("challenge-card")).toBeVisible();
  expect(card.debugAnswer).toBeFalsy();
  await page.screenshot({ path: info.outputPath("student-before-reader.png"), fullPage: true });
  await assertNoOverflow(page);
  const readPassage = page.getByRole("button", { name: "Read passage", exact: true });
  await readPassage.evaluate(button => button.scrollIntoView({ block: "center" }));
  await readPassage.click();
  const readerChapter = page.getByRole("combobox", { name: "Chapter", exact: true });
  await expect(readerChapter.locator("option")).toHaveText(["1", "3"]);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await readerChapter.selectOption("3");
    await expect(page.getByRole("list", { name: "Scripture verses" }).getByRole("listitem")).toHaveCount(21);
    await assertNoOverflow(page);
    await page.screenshot({ path: info.outputPath(`student-assigned-chapters-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "Hide passage", exact: true }).click();
  await answerCard(page, card, sources);
  const attemptResponse = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(`/study/sessions/${card.sessionId}/attempts`));
  await page.getByTestId("submit-answer").click();
  const attempt = await (await attemptResponse).json() as AttemptResult;
  expect(attempt.isCorrect).toBe(true);
  const before = await json<Progress>(page.request, `/api/v1/progress/me?seasonId=${seasonId}`);
  expect(before.attemptCount).toBe(1);
  await logout(page);
  await login(page);
  await page.goto(`/admin/assignments?seasonId=${seasonId}&studentId=${student.userId}`);
  await chapterCheckbox(page, 5).click();
  await page.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(page.locator(".planner-saved-row")).toHaveCount(1);
  await expect(page.locator(".planner-saved-row")).toContainText("Chapters 1, 3, 5 · saved assignments");
  const after = await json<Progress>(page.request, `${org}/seasons/${seasonId}/students/${student.userId}/progress`);
  expect(after.attemptCount).toBe(before.attemptCount);
  expect(after.mastery).toEqual(before.mastery);
  expect(after.recentAttempts).toEqual(before.recentAttempts);
  expect(after.assignments.filter(item => original.some(saved => saved.id === item.id))).toEqual(before.assignments);
  expect(pageErrors).toEqual([]);
  await info.attach("chapter-assignment-evidence", { body: JSON.stringify({ seasonId, scope: savedScope, firstStudentRanges: ranges(original), secondStudentRanges: ranges(allAssignments.filter(item => item.studentUserId === second.userId)), assignedVerseCount: assigned.verses.length, preservedAttemptId: attempt.attemptId, widths, pageErrors }, null, 2), contentType: "application/json" });
});

test("chapter selection respects excluded verses and chapters without widening the student assignment", async ({ page }) => {
  await login(page);
  const me = await json<Me>(page.request, "/api/v1/me");
  const org = `/api/v1/organizations/${me.organizationId}`;
  const library = await json<ScriptureLibrary>(page.request, `${org}/library`);
  const book = library.books.find(item => item.bookKey === "EPH")!;
  const student = await createStudent(page, org, "Excluded chapter student");
  const season = await json<{ id: string }>(page.request, `${org}/seasons`, { name: `Chapter exclusions ${randomUUID()}`, yearLabel: "2026", ruleProfileKey: "PBE_STYLE_V1" });
  const customScope = { contentPackId: book.contentPackId, includes: [{ bookKey: "EPH", startChapter: 1, startVerse: 1, endChapter: 3, endVerse: 21 }], excludes: [{ bookKey: "EPH", startChapter: 1, startVerse: 2, endChapter: 1, endVerse: 2 }, { bookKey: "EPH", startChapter: 2, startVerse: 1, endChapter: 2, endVerse: 22 }] };
  await json(page.request, `${org}/seasons/${season.id}/scope`, customScope);
  await page.goto(`/admin/seasons/${season.id}?step=details`);
  await expect(page.getByRole("checkbox", { name: "Ephesians Saved season selection retained", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Save & assign students →", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Student assignments", exact: true })).toBeVisible();
  expect((await json<SeasonScope>(page.request, `${org}/seasons/${season.id}/scope`)).packs).toEqual([customScope]);
  await page.goto(`/admin/assignments?seasonId=${season.id}&studentId=${student.userId}`);
  await expect(chapterCheckbox(page, 1)).toBeVisible();
  await expect(chapterCheckbox(page, 2)).toHaveCount(0);
  await expect(chapterCheckbox(page, 4)).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Select all chapters in Ephesians", exact: true }).check();
  await expect(chapterCheckbox(page, 1)).toBeChecked();
  await expect(chapterCheckbox(page, 3)).toBeChecked();
  await page.getByRole("checkbox", { name: "Select all chapters in Ephesians", exact: true }).uncheck();
  await expect(chapterCheckbox(page, 1)).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Save assignments", exact: true })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Select all chapters in Ephesians", exact: true }).check();
  await page.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(page.locator(".planner-saved-row")).toHaveCount(1);
  await expect(page.locator(".planner-saved-row")).toContainText("Assigned");
  const saved = await json<Assignment[]>(page.request, `${org}/seasons/${season.id}/assignments`);
  expect(ranges(saved)).toEqual([{ startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1 }, { startChapter: 1, startVerse: 3, endChapter: 1, endVerse: 23 }, { startChapter: 3, startVerse: 1, endChapter: 3, endVerse: 21 }]);
  expect(await json(page.request, `${org}/seasons/${season.id}/activate`, {})).toMatchObject({ activated: true });
  await logout(page);
  await login(page, student.userName);
  const assigned = await json<AssignedScripture>(page.request, `/api/v1/study/seasons/${season.id}/scripture`);
  expect(assigned.verses.map(verse => `${verse.chapter}:${verse.verse}`)).toEqual(coordinates(book, [1, 3], ["1:2"]));
});
