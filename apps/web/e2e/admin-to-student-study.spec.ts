import { expect, test } from "@playwright/test";
import { login, logout } from "./helpers";
test("coach activates a season and student submits a correct real activity with debug answers disabled", async ({ page }) => {
  await login(page);
  const me = await (await page.request.get("/api/v1/me")).json();
  const org = `/api/v1/organizations/${me.organizationId}`;
  const students = await (await page.request.get(`${org}/students`)).json();
  const student = students.find((item: { userName: string }) => ["daniel.student", "student.fixture"].includes(item.userName));
  expect(student).toBeTruthy();
  const library = await (await page.request.get(`${org}/library`)).json();
  const daniel = library.books.find((book: { bookKey: string }) => book.bookKey === "DAN");
  const units = await (await page.request.get(`${org}/content-packs/${daniel.contentPackId}/source-units`)).json();
  const source: string = units.find((unit: { chapter: number; verse: number }) => unit.chapter === 1 && unit.verse === 1).canonicalText;
  await page.goto("/admin/seasons/new");
  await page.getByTestId("season-name").fill(`E2E study ${Date.now()}`);
  await page.getByTestId("save-season").click();
  await page.getByRole("button", { name: "Choose passages", exact: true }).click();
  await page.getByRole("combobox", { name: "Add a library book" }).selectOption(daniel.contentPackId);
  await page.getByRole("button", { name: "Add book", exact: true }).click();
  await page.getByText("Advanced passage options", { exact: true }).click();
  await page.getByTestId("scope-end-chapter").selectOption("1");
  await page.getByTestId("scope-end").selectOption("1");
  await page.getByTestId("save-scope").click();
  await page.getByRole("link", { name: `Manage assignments for ${student.displayName}`, exact: true }).click();
  await page.getByRole("button", { name: "Specific verses", exact: true }).click();
  await page.getByTestId("assign-student").click();
  await expect(page.getByText("Assignment saved.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review season" }).click();
  await page.getByTestId("activate-season").click();
  await page.getByRole("dialog").getByRole("button", { name: "Start season", exact: true }).click();
  await expect(page.getByTestId("season-status")).toHaveText("Active");
  const seasonId = new URL(page.url()).pathname.split("/").pop();
  await logout(page);
  await login(page, student.userName, process.env.ERUDOZA_E2E_PASSWORD!);
  await page.goto(`/student?seasonId=${seasonId}`);
  const cardResponse = page.waitForResponse(response => /\/api\/v1\/study\/sessions\/[^/]+\/next$/.test(response.url()));
  await page.getByTestId("start-todays-deck").click();
  expect((await (await cardResponse).json()).debugAnswer).toBeFalsy();
  await expect(page.getByTestId("card-progress")).toHaveText(/1 \/ \d+/);
  await expect(page.getByTestId("submit-answer")).toBeVisible();
  await expect(page.getByTestId("debug-answer")).toHaveCount(0);
  const activity = await page.getByTestId("academy-activity-name").innerText();
  const prompt = await page.getByTestId("challenge-prompt").innerText();
  if (/Missing Words/i.test(activity)) {
    const words = source.split(" ");
    const displayed = prompt.split(/\s+/);
    expect(displayed).toHaveLength(words.length);
    await page.getByTestId("missing-words-answer").fill(displayed.flatMap((word, i) => word === "____" ? [words[i]] : []).join(" "));
  } else if (/Verse Builder/i.test(activity)) {
    const phrases = page.locator(".student-builder-phrase");
    const target = (await phrases.allTextContents()).sort((a, b) => source.indexOf(a) - source.indexOf(b));
    for (let i = 0; i < target.length; i++) {
      let index = (await phrases.allTextContents()).indexOf(target[i]);
      while (index > i) { await page.getByRole("button", { name: `Move phrase ${index + 1} up`, exact: true }).click(); index--; }
    }
  } else if (/Reference Match/i.test(activity)) {
    const radio = page.getByRole("radio", { name: "Daniel 1:1", exact: true });
    if (await radio.count()) await radio.check();
    else await page.getByTestId("missing-words-answer").fill("Daniel 1:1");
  } else if (/True.*False/i.test(activity)) {
    await page.getByTestId(prompt.endsWith(source) ? "true-false-true" : "true-false-false").click();
  } else throw new Error(`Unexpected activity for a single verse: ${activity}`);
  await page.getByTestId("submit-answer").click();
  await expect(page.getByTestId("challenge-feedback").getByRole("heading", { name: "Well remembered" })).toBeVisible();
  await expect(page.getByTestId("feedback-source")).toHaveText(source);
  await expect(page.getByTestId("submit-answer")).toBeDisabled();
  await page.reload();
  await expect(page.getByTestId("challenge-feedback").getByRole("heading", { name: "Well remembered" })).toBeVisible();
  await page.getByTestId("complete-session").click();
  await expect(page).toHaveURL(/\/student\/sessions\/[^/]+\/recap/);
  await expect(page.getByText("1 correct from 1 accepted attempts", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "View current progress", exact: true }).click();
  await expect(page.getByTestId("progress-attempts")).not.toHaveText("0");
});
