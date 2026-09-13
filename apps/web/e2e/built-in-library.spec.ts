import { expect, test } from "@playwright/test";
import { assertNoOverflow, login, logout } from "./helpers";
import type { Assignment, ChallengeCard, Me, ScriptureLibrary, SeasonScope, Student } from "../src/api/types";

test("built-in NKJV library is read-only, searchable and keyboard readable at all viewport sizes", async ({ page }, info) => {
  await login(page);
  const libraryWrites: string[] = [];
  page.on("request", request => {
    if (/\/api\/v1\/organizations\/[^/]+\/(library|content-packs)(\/|$)/.test(request.url()) && !["GET", "HEAD"].includes(request.method())) libraryWrites.push(request.url());
  });
  await page.goto("/admin/content");
  await expect(page.getByTestId("library-book")).toHaveCount(66);
  await expect(page.getByRole("button", { name: /import|delete/i })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /translation/i })).toHaveCount(0);
  const search = page.getByRole("searchbox", { name: "Search books" });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    if (!await search.isVisible()) await page.getByRole("button", { name: "Choose book", exact: true }).click();
    await search.fill("Ephesians");
    await expect(page.getByTestId("library-book")).toHaveCount(1);
    await search.press("Tab");
    await expect(page.getByTestId("library-book")).toBeFocused();
    await page.keyboard.press("Enter");
    const chapter = page.getByRole("combobox", { name: "Chapter", exact: true });
    await expect(chapter.locator("option")).toHaveCount(6);
    await expect(chapter.locator('option[value="7"]')).toHaveCount(0);
    await chapter.selectOption("6");
    await expect(page.getByRole("heading", { name: "Ephesians 6", exact: true })).toBeVisible();
    const verses = page.getByRole("region", { name: "Scripture verses", exact: true });
    await expect(verses.getByRole("button", { name: /^Select verse \d+$/ })).toHaveCount(24);
    await expect(verses.getByRole("button", { name: "Select verse 1", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Verse", exact: true }).locator("option")).toHaveCount(25);
    await assertNoOverflow(page);
    await page.screenshot({ path: info.outputPath(`library-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Choose book", exact: true }).click();
    await search.fill("Jude");
    await page.getByTestId("library-book").click();
    await expect(chapter).toHaveValue("1");
    await expect(chapter.locator("option")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Jude 1", exact: true })).toBeVisible();
    await expect(verses.getByRole("button", { name: /^Select verse \d+$/ })).toHaveCount(25);
    await expect(verses.getByRole("button", { name: "Select verse 25", exact: true })).toBeVisible();
    await expect(verses.locator("[data-verse-text]").last()).not.toBeEmpty();
    await assertNoOverflow(page);
  }
  expect(libraryWrites).toEqual([]);
});

test("coach saves bounded multi-book passages and student reads both assignments without changing the activity", async ({ page }, info) => {
  test.setTimeout(120000);
  await login(page);
  const me = await (await page.request.get("/api/v1/me")).json() as Me;
  const org = `/api/v1/organizations/${me.organizationId}`;
  const library = await (await page.request.get(`${org}/library`)).json() as ScriptureLibrary;
  const ephesians = library.books.find(book => book.bookKey === "EPH")!;
  const jude = library.books.find(book => book.bookKey === "JUD")!;
  expect(library.books).toHaveLength(66);
  const students = await (await page.request.get(`${org}/students`)).json() as Student[];
  const student = students.find(item => ["student.fixture", "daniel.student"].includes(item.userName))!;
  expect(student).toBeTruthy();
  await page.goto("/admin/seasons/new");
  await page.getByRole("textbox", { name: "Season name", exact: true }).fill(`NKJV browser ${Date.now()}`);
  await page.getByRole("checkbox", { name: "Ephesians Whole book", exact: true }).check();
  await page.getByRole("checkbox", { name: "Jude Whole book", exact: true }).check();
  const wholeBooks: SeasonScope = {
    contentPackId: null, includes: [], excludes: [], packs: [
      { contentPackId: ephesians.contentPackId, includes: [{ bookKey: "EPH", startChapter: 1, startVerse: 1, endChapter: 6, endVerse: 24 }], excludes: [] },
      { contentPackId: jude.contentPackId, includes: [{ bookKey: "JUD", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 25 }], excludes: [] },
    ],
  };
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await assertNoOverflow(page);
    await page.screenshot({ path: info.outputPath(`season-books-${width}.png`), fullPage: true });
  }
  const saveRequest = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith("/scope"));
  await page.getByRole("button", { name: "Save & assign students →", exact: true }).click();
  expect((await saveRequest).postDataJSON()).toEqual(wholeBooks);
  await expect(page.getByRole("heading", { name: "Student assignments", exact: true })).toBeVisible();
  const seasonId = new URL(page.url()).pathname.split("/").pop()!;
  const scopeUrl = `${org}/seasons/${seasonId}/scope`;
  expect(await (await page.request.get(scopeUrl)).json()).toMatchObject(wholeBooks);

  // Older seasons can contain verse ranges. The current whole-book planner must retain them.
  const bounded: SeasonScope = { contentPackId: null, includes: [], excludes: [], packs: [
    { contentPackId: ephesians.contentPackId, includes: [{ bookKey: "EPH", startChapter: 6, startVerse: 1, endChapter: 6, endVerse: 2 }], excludes: [] },
    { contentPackId: jude.contentPackId, includes: [{ bookKey: "JUD", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 2 }], excludes: [] },
  ] };
  expect((await page.request.post(scopeUrl, { data: bounded })).ok()).toBe(true);
  await page.goto(`/admin/seasons/${seasonId}?step=details`);
  for (const name of ["Ephesians", "Jude"]) await expect(page.getByRole("checkbox", { name: `${name} Saved season selection retained`, exact: true })).toBeChecked();
  await expect(page.getByText("Existing custom selections are preserved unless you remove and reselect their book.", { exact: true })).toBeVisible();
  const retainedRequest = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith("/scope"));
  await page.getByRole("button", { name: "Save & assign students →", exact: true }).click();
  expect((await retainedRequest).postDataJSON()).toEqual(bounded);
  await expect(page.getByRole("heading", { name: "Student assignments", exact: true })).toBeVisible();
  expect(await (await page.request.get(scopeUrl)).json()).toMatchObject(bounded);

  await page.goto(`/admin/seasons/${seasonId}?step=students&studentId=${student.userId}`);
  const ephChapters = page.getByRole("group", { name: "Ephesians", exact: true });
  const judeChapters = page.getByRole("group", { name: "Jude", exact: true });
  for (const chapters of [ephChapters, judeChapters]) {
    await expect(chapters.getByRole("checkbox", { name: /^Chapter / })).toHaveCount(1);
    await expect(chapters).toContainText("Only the saved season selection is available.");
  }
  await expect(ephChapters.getByRole("checkbox", { name: "Chapter 7", exact: true })).toHaveCount(0);
  await ephChapters.getByRole("checkbox", { name: "Chapter 6", exact: true }).check();
  await judeChapters.getByRole("checkbox", { name: "Chapter 1", exact: true }).check();
  await ephChapters.getByRole("checkbox", { name: "Chapter 6", exact: true }).uncheck();
  await expect(judeChapters.getByRole("checkbox", { name: "Chapter 1", exact: true })).toBeChecked();
  await ephChapters.getByRole("checkbox", { name: "Chapter 6", exact: true }).check();
  const assignmentWrites: unknown[] = [];
  const assignmentUrl = `${org}/seasons/${seasonId}/assignments`;
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith(assignmentUrl)) assignmentWrites.push(request.postDataJSON()); });
  await page.getByRole("button", { name: "Save assignments", exact: true }).click();
  await expect(page.getByText("Assignments saved.", { exact: true })).toBeVisible();
  expect(assignmentWrites).toHaveLength(2);
  for (const pack of bounded.packs!) expect(assignmentWrites).toContainEqual({ studentUserId: student.userId, contentPackId: pack.contentPackId, range: pack.includes[0], type: "PrimarySpecialist", difficulty: "Standard" });
  await page.reload();
  await expect(page.locator(".planner-saved-row")).toHaveCount(2);
  const assignments = await (await page.request.get(assignmentUrl)).json() as Assignment[];
  expect(assignments).toHaveLength(2);
  for (const pack of bounded.packs!) expect(assignments).toEqual(expect.arrayContaining([expect.objectContaining({ studentUserId: student.userId, contentPackId: pack.contentPackId, ...pack.includes[0] })]));
  for (const [chapters, number] of [[ephChapters, 6], [judeChapters, 1]] as const) {
    await expect(chapters.getByRole("checkbox", { name: `Chapter ${number}`, exact: true })).toBeChecked();
    await expect(chapters.getByRole("checkbox", { name: `Chapter ${number}`, exact: true })).toBeDisabled();
  }
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await assertNoOverflow(page);
    await page.screenshot({ path: info.outputPath(`assignments-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "Start season", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start season", exact: true }).click();
  await expect(page.locator(".ds-page-header").getByText("Active", { exact: true })).toBeVisible();
  await logout(page);
  await login(page, student.userName);
  const drawn = page.waitForResponse(response => /\/study\/sessions\/[^/]+\/next$/.test(response.url()));
  await page.goto(`/student/study?seasonId=${seasonId}`);
  const card = await (await drawn).json() as ChallengeCard;
  expect(card.activityType).toBe('MissingWords');
  const hidden = card.tokens.filter(token => token.hidden);
  expect(hidden.length).toBeGreaterThan(0);
  expect(hidden.every(token => token.display === '____')).toBe(true);
  const passage = page.getByRole('group', { name: 'Passage with missing words' });
  await expect(passage).toBeVisible();
  const draft = hidden.map((token, ordinal) => ({ index: token.index, text: `Answer in progress ${ordinal + 1}` }));
  const blank = (ordinal: number) => passage.getByRole('textbox', { name: `Blank ${ordinal + 1} of ${hidden.length}`, exact: true });
  for (const [ordinal, answer] of draft.entries()) await blank(ordinal).fill(answer.text);
  const passageText = await passage.textContent();
  const sessionUrl = page.url();
  const reader = page.getByRole("button", { name: "Read passage", exact: true });
  await reader.focus();
  await page.keyboard.press("Enter");
  const readerBook = page.getByRole("combobox", { name: "Book", exact: true });
  await expect(readerBook.locator("option")).toHaveCount(2);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await readerBook.selectOption("EPH");
    await expect(page.getByRole("combobox", { name: "Chapter", exact: true })).toHaveValue("6");
    await expect(page.getByRole("list", { name: "Scripture verses" })).toContainText("Ephesians 6:1");
    await readerBook.selectOption("JUD");
    await expect(page.getByRole("combobox", { name: "Chapter", exact: true })).toHaveValue("1");
    await expect(page.getByRole("combobox", { name: "Chapter", exact: true }).locator("option")).toHaveCount(1);
    await expect(page.getByRole("list", { name: "Scripture verses" }).getByRole("listitem")).toHaveCount(2);
    await assertNoOverflow(page);
    await page.screenshot({ path: info.outputPath(`student-nkjv-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "Hide passage", exact: true }).click();
  await expect(passage).toHaveText(passageText!);
  for (const [ordinal, answer] of draft.entries()) await expect(blank(ordinal)).toHaveValue(answer.text);
  expect(page.url()).toBe(sessionUrl);
});
