import { expect, test } from "@playwright/test";
import { assertNoOverflow, login, logout } from "./helpers";
import type { ChallengeCard, Me, ScriptureLibrary, SeasonScope, Student } from "../src/api/types";

test("built-in NKJV library is read-only, searchable and keyboard readable at all viewport sizes", async ({ page }, info) => {
  await login(page);
  await page.goto("/admin/content");
  await expect(page.getByTestId("library-book")).toHaveCount(66);
  await expect(page.getByRole("button", { name: /import|delete/i })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /translation/i })).toHaveCount(0);
  const search = page.getByRole("searchbox", { name: "Search books" });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await search.fill("Ephesians");
    await expect(page.getByTestId("library-book")).toHaveCount(1);
    await search.press("Tab");
    await expect(page.getByTestId("library-book")).toBeFocused();
    await page.keyboard.press("Enter");
    const chapter = page.getByRole("combobox", { name: "Preview chapter" });
    await expect(chapter.locator("option")).toHaveCount(6);
    await expect(chapter.locator('option[value="7"]')).toHaveCount(0);
    await chapter.selectOption("6");
    await expect(page.getByTestId("source-unit-list")).toContainText("Ephesians 6:1");
    await assertNoOverflow(page);
    await page.screenshot({ path: info.outputPath(`library-${width}.png`), fullPage: true });
    await search.fill("Jude");
    await page.getByTestId("library-book").click();
    await expect(chapter).toHaveValue("1");
    await expect(chapter.locator("option")).toHaveCount(1);
    await expect(page.getByTestId("source-unit-list").locator("article")).toHaveCount(25);
    await expect(page.getByTestId("source-unit-list")).toContainText("Jude 1:25");
    await assertNoOverflow(page);
  }
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
  await page.getByTestId("season-name").fill(`NKJV browser ${Date.now()}`);
  await page.getByTestId("save-season").click();
  await page.getByRole("button", { name: "Choose passages", exact: true }).click();
  await page.getByRole("combobox", { name: "Add a library book" }).selectOption(ephesians.contentPackId);
  await page.getByRole("button", { name: "Add book", exact: true }).click();
  await expect(page.getByTestId("scope-start-chapter").locator("option")).toHaveCount(6);
  await expect(page.getByTestId("scope-start-chapter").locator('option[value="7"]')).toHaveCount(0);
  await page.getByTestId("scope-start-chapter").selectOption("4");
  await page.getByTestId("scope-start").selectOption("32");
  await expect(page.getByTestId("scope-end")).toHaveValue("32");
  await page.getByTestId("scope-start-chapter").selectOption("6");
  await expect(page.getByTestId("scope-start")).toHaveValue("1");
  await expect(page.getByTestId("scope-end-chapter")).toHaveValue("6");
  await expect(page.getByTestId("scope-end")).toHaveValue("1");
  await expect(page.getByTestId("scope-start").locator("option")).toHaveCount(24);
  await expect(page.getByTestId("scope-start").locator('option[value="25"]')).toHaveCount(0);
  await page.getByTestId("scope-end").selectOption("2");
  await page.getByRole("combobox", { name: "Add a library book" }).selectOption(jude.contentPackId);
  await page.getByRole("button", { name: "Add book", exact: true }).click();
  await expect(page.getByTestId("1-includes-0-start-chapter").locator("option")).toHaveCount(1);
  await expect(page.getByTestId("1-includes-0-start").locator("option")).toHaveCount(25);
  await page.getByTestId("1-includes-0-end").selectOption("2");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await assertNoOverflow(page);
    await page.screenshot({ path: info.outputPath(`season-passages-${width}.png`), fullPage: true });
  }
  const saveRequest = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith("/scope"));
  await page.getByTestId("save-scope").click();
  expect((await saveRequest).postDataJSON()).toMatchObject({ contentPackId: null, includes: [], excludes: [], packs: [{ contentPackId: ephesians.contentPackId }, { contentPackId: jude.contentPackId }] });
  await page.getByRole("link", { name: `Manage assignments for ${student.displayName}`, exact: true }).click();
  const seasonId = new URL(page.url()).pathname.split("/").pop()!;
  const saved = await (await page.request.get(`${org}/seasons/${seasonId}/scope`)).json() as SeasonScope;
  expect(saved.packs).toHaveLength(2);
  const book = page.getByRole("combobox", { name: "Assignment book", exact: true });
  await expect(book.locator("option")).toHaveCount(2);
  await page.getByRole("combobox", { name: "Passage to assign" }).selectOption("custom");
  await expect(page.getByTestId("assignment-start-chapter").locator("option")).toHaveCount(1);
  await expect(page.getByTestId("assignment-start").locator("option")).toHaveCount(2);
  await page.getByTestId("assignment-start").selectOption("2");
  await book.selectOption(jude.contentPackId);
  await expect(page.getByTestId("assignment-start")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Passage to assign" }).selectOption("custom");
  await expect(page.getByTestId("assignment-start-chapter")).toHaveValue("1");
  await expect(page.getByTestId("assignment-start")).toHaveValue("1");
  for (const pack of [jude, ephesians]) {
    await book.selectOption(pack.contentPackId);
    const assignmentRequest = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith("/assignments"));
    await page.getByTestId("assign-student").click();
    expect((await assignmentRequest).postDataJSON()).toMatchObject({ contentPackId: pack.contentPackId, range: { bookKey: pack.bookKey, startVerse: 1, endVerse: 2 } });
    await expect(page.locator(".season-saved-assignments")).toContainText(pack.bookKey);
  }
  await page.reload();
  await expect(page.locator(".season-saved-assignments li")).toHaveCount(2);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await assertNoOverflow(page);
    await page.screenshot({ path: info.outputPath(`assignments-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "Review season" }).click();
  await page.getByTestId("activate-season").click();
  await page.getByRole("dialog").getByRole("button", { name: "Start season", exact: true }).click();
  await expect(page.getByTestId("season-status")).toHaveText("Active");
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
