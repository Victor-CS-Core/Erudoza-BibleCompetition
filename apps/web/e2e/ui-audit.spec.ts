import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { assertNoOverflow, login, logout } from "./helpers";
import type { ChallengeCard, SourceUnit } from "../src/api/types";

// Opt-in evidence capture. All writes target Playwright's fresh, isolated API.
test.skip(!process.env.ERUDOZA_UI_AUDIT, "Set ERUDOZA_UI_AUDIT=1 to capture the populated route audit.");
async function json(api: APIRequestContext, path: string, data?: unknown) {
  const response = data === undefined ? await api.get(path) : await api.post(path, { data });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.status() === 204 ? undefined : response.json();
}

test("populated coach and student route audit", async ({ page }, info) => {
  test.setTimeout(180_000);
  const mobile = info.project.name.includes("mobile");
  await page.setViewportSize({ width: mobile ? 390 : 1440, height: 1000 });
  const coverage: { name: string; url: string; state: string; screenshot: string; headings: string[] }[] = [];
  const overflowIssues: unknown[] = [];
  const runtimeErrors: string[] = [];
  page.on("pageerror", error => runtimeErrors.push(error.message));
  const capture = async (name: string, url: string, state: string, ready?: (page: Page) => Promise<void>) => {
    if (url) await page.goto(url);
    if (ready) await ready(page);
    else await expect(page.locator("main h1,main h2").first()).toBeVisible();
    // The design reference intentionally demonstrates the Loading primitive.
    if (name !== "coach-design-reference") await expect(page.getByText(/^Loading(?:\b|…)/)).toHaveCount(0, { timeout: 10_000 });
    await page.evaluate(() => document.fonts.ready);
    if (mobile) for (const width of [320, 430, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const overflow = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll("main *")].filter(node => node.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 12).map(node => ({ tag: node.tagName, className: node.className, right: node.getBoundingClientRect().right, text: node.textContent?.slice(0, 80) })) }));
      if (overflow.scroll > overflow.width + 1) {
        const ancestors = await page.evaluate(() => {
          const result = []; let node: Element | null = document.querySelector('[data-testid="coverage-table"]');
          while (node) { const style = getComputedStyle(node); const rect = node.getBoundingClientRect(); result.push({ tag: node.tagName, className: node.className, width: rect.width, left: rect.left, right: rect.right, display: style.display, minWidth: style.minWidth, maxWidth: style.maxWidth, gridTemplateColumns: style.gridTemplateColumns, overflowX: style.overflowX }); node = node.parentElement; }
          return result;
        });
        overflowIssues.push({ name, ...overflow, ancestors });
        if (name === "coach-assignments") console.log(JSON.stringify({ width, ancestors }));
      }
    }
    if (!mobile) await assertNoOverflow(page);
    const screenshot = info.outputPath(`${name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    coverage.push({ name, url: page.url(), state, screenshot, headings: await page.locator("main h1,main h2").allTextContents() });
    await info.attach(`${name}-overflow`, { body: JSON.stringify(overflowIssues.filter(item => (item as { name: string }).name === name), null, 2), contentType: "application/json" });
  };
  await capture("landing", "/", "Signed out", p => expect(p.getByTestId("start-studying")).toBeVisible());
  await capture("login", "/login", "Signed out", p => expect(p.getByTestId("login-submit")).toBeVisible());
  await capture("not-found", "/audit-page-does-not-exist", "Unknown route recovery", p => expect(p.getByRole("heading", { level: 1 })).toBeVisible());
  await login(page);
  const me = await json(page.request, "/api/v1/me");
  const org = `/api/v1/organizations/${me.organizationId}`;
  const packs = await json(page.request, `${org}/content-packs`);
  const pack = packs.find((p: { packKey: string }) => p.packKey === "dev-daniel");
  expect(pack, "The populated audit requires the stored Daniel fixture").toBeTruthy();
  const units: SourceUnit[] = await json(page.request, `${org}/content-packs/${pack.id}/source-units`);
  const student = (await json(page.request, `${org}/students`)).find((s: { userName: string }) => s.userName === "daniel.student");
  expect(student).toBeTruthy();
  const season = await json(page.request, `${org}/seasons`, { name: `Academy route audit ${mobile ? "mobile" : "desktop"}`, yearLabel: "2026", ruleProfileKey: "PBE_STYLE_V1" });
  const range = { bookKey: "DAN", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 4 };
  await json(page.request, `${org}/seasons/${season.id}/scope`, { contentPackId: pack.id, includes: [range], excludes: [] });
  await json(page.request, `${org}/seasons/${season.id}/assignments`, { studentUserId: student.userId, contentPackId: pack.id, type: "RequiredCoverage", range });
  const activation = await json(page.request, `${org}/seasons/${season.id}/activate`, {});
  expect(activation.activated).toBeTruthy();
  if (process.env.ERUDOZA_UI_AUDIT_FOCUS === "assignments") {
    await capture("coach-assignments", `/admin/assignments?seasonId=${season.id}`, "Populated assignment coverage", p => expect(p.getByRole("table")).toContainText("Daniel Student"));
    await info.attach("route-coverage", { body: JSON.stringify(coverage, null, 2), contentType: "application/json" });
    expect(overflowIssues).toEqual([]);
    expect(runtimeErrors).toEqual([]);
    return;
  }
  await json(page.request, `${org}/practice/enabled`, { enabled: true });
  await json(page.request, `${org}/practice/questions/import`, { seasonId: season.id, questions: Array.from({ length: 12 }, (_, i) => ({ contentPackId: pack.id, sourceUnitId: units[0].id, prompt: `Audit practice question ${i + 1}: name the student.`, kind: "ShortAnswer", parts: [{ acceptedAnswers: ["Daniel"], points: 1 }], ordered: false, evidence: units[0].canonicalText, reference: units[0].citation, version: 1 })) });
  const bank = await json(page.request, `${org}/practice/bootstrap`);
  for (const question of bank.questions.filter((q: { seasonId: string }) => q.seasonId === season.id)) await json(page.request, `${org}/practice/questions/${question.id}/publish`, {});
  await capture("coach-overview", "/admin", "Active season with real assignment", p => expect(p.getByRole("heading", { name: "Student progress" })).toBeVisible());
  await capture("coach-seasons", "/admin/seasons", "Active season list", p => expect(p.getByText(season.name, { exact: true }).first()).toBeVisible());
  await capture("coach-new-season", "/admin/seasons/new", "New season form", p => expect(p.getByLabel("Season name")).toBeVisible());
  for (const step of ["details", "students", "passages", "review"]) {
    const booksStep = step === "details" || step === "passages";
    await capture(`coach-season-${step}`, `/admin/seasons/${season.id}?step=${step}&studentId=${student.userId}`, `Populated active season · ${booksStep ? "Season & books" : "Assignments"}${step === "passages" || step === "review" ? " (legacy route alias)" : ""}`, async p => {
      await expect(p.locator('.season-planner > .ds-page-header .ds-badge')).toHaveText("Active");
      const steps = p.getByRole("navigation", { name: "Season setup" });
      await expect(steps.getByRole("button")).toHaveCount(2);
      await expect(steps.getByRole("button", { name: booksStep ? "1 · Season & books" : "2 · Assignments" })).toHaveAttribute("aria-current", "step");
      if (booksStep) {
        await expect(p.getByLabel("Season name")).toHaveValue(season.name);
        await expect(p.getByText("Season books are locked.", { exact: false })).toBeVisible();
      } else {
        await expect(p.getByRole("heading", { name: "Student assignments", exact: true })).toBeVisible();
        await expect(p.getByRole("heading", { name: student.displayName, exact: true })).toBeVisible();
        await expect(p.getByRole("checkbox", { name: /^Chapter / })).toHaveCount(1);
        await expect(p.locator(".planner-saved")).toContainText("Chapters 1 · saved assignments");
      }
    });
  }
  const draft = await json(page.request, `${org}/seasons`, { name: "Next season draft", yearLabel: "2026", ruleProfileKey: "PBE_STYLE_V1" });
  await json(page.request, `${org}/seasons/${draft.id}/scope`, { contentPackId: pack.id, includes: [range], excludes: [] });
  await capture("coach-season-draft-books", `/admin/seasons/${draft.id}?step=details`, "Editable draft retaining its saved partial Daniel scope", async p => {
    await expect(p.getByLabel("Season name")).toHaveValue(draft.name);
    await expect(p.getByText("DAN · Saved selection retained", { exact: true })).toBeVisible();
    await expect(p.getByText("Existing custom selections are preserved unless you remove and reselect their book.", { exact: true })).toBeVisible();
    await expect(p.getByRole("button", { name: "Save & assign students →", exact: true })).toBeEnabled();
  });
  await page.getByRole("button", { name: "Save & assign students →", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/seasons/${draft.id}\\?step=students$`));
  await capture("coach-season-draft-assignments", "", "Chapter choices stay inside the saved partial scope after saving the draft", async p => {
    const allowedChapters = [...new Set(units.filter(unit => unit.bookKey === range.bookKey && unit.chapter === range.startChapter && unit.verse >= range.startVerse && unit.verse <= range.endVerse).map(unit => unit.chapter))];
    expect(allowedChapters).toEqual([1]);
    await expect(p.getByRole("checkbox", { name: /^Chapter / })).toHaveCount(allowedChapters.length);
    await expect(p.getByRole("checkbox", { name: "Chapter 1", exact: true })).toBeEnabled();
    await expect(p.getByText("Only the saved season selection is available.", { exact: true })).toBeVisible();
    const scope = await json(p.request, `${org}/seasons/${draft.id}/scope`);
    expect(scope.packs).toEqual([{ contentPackId: pack.id, includes: [range], excludes: [] }]);
  });
  await capture("coach-students", "/admin/students", "Student directory", p => expect(p.getByRole("table")).toContainText("Daniel Student"));
  await capture("coach-assignments", `/admin/assignments?seasonId=${season.id}`, "Assignment coverage", p => expect(p.getByRole("table")).toContainText("Daniel Student"));
  await capture("coach-assignment-editor", `/admin/assignments?seasonId=${season.id}&studentId=${student.userId}`, "Individual populated chapter plan", async p => {
    await expect(p.getByRole("heading", { name: student.displayName, exact: true })).toBeVisible();
    await p.getByText("Plan settings · Standard", { exact: true }).click();
    await p.getByRole("combobox", { name: "Assignment role", exact: true }).selectOption("RequiredCoverage");
    await expect(p.getByRole("checkbox", { name: "Chapter 1", exact: true })).toBeChecked();
    await expect(p.getByRole("checkbox", { name: "Chapter 1", exact: true })).toBeDisabled();
    await expect(p.getByRole("button", { name: "Remove DAN", exact: true })).toBeVisible();
  });
  await capture("coach-library", "/admin/content", "Built-in NKJV library", p => expect(p.getByTestId("library-book")).toHaveCount(66));
  await page.getByTestId("library-book").filter({ hasText: "Daniel" }).click();
  await capture("coach-library-reader", "", "Daniel chapter reader and private study notebook", async p => {
    await expect(p.getByRole("heading", { name: "Daniel 1", exact: true })).toBeVisible();
    await expect(p.getByRole("region", { name: "Scripture verses" })).toContainText("In the third year of the reign of Jehoiakim");
    await expect(p.getByRole("button", { name: "Select verse 1", exact: true })).toBeVisible();
    await expect(p.getByRole("heading", { name: "My study notebook", exact: true })).toBeVisible();
    await expect(p.getByRole("button", { name: "Choose book", exact: true })).toBeVisible();
  });
  await capture("coach-student-progress", `/admin/seasons/${season.id}/students/${student.userId}/progress`, "Assigned student; no attempts yet", p => expect(p.getByTestId("progress-attempts")).toHaveText("0"));
  await capture("coach-design-reference", "/admin/design-system", "Shared primitives");
  await capture("coach-practice", "/admin/practice", "Enabled practice and published question bank", p => expect(p.getByRole("button", { name: "Set up PVP", exact: true })).toBeVisible());
  await page.getByRole("button", { name: "Set up PVP", exact: true }).click();
  await capture("coach-practice-setup", "", "PVP room setup dialog", p => expect(p.getByRole("dialog", { name: "PVP setup", exact: true }).getByRole("heading", { name: "Create a room", exact: true })).toBeVisible());
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await logout(page);
  await login(page, "daniel.student");
  const session = await json(page.request, "/api/v1/study/sessions", { seasonId: season.id, mode: "Practice" });
  const card: ChallengeCard = await json(page.request, `/api/v1/study/sessions/${session.id}/next`);
  const answer = card.activityType === "MissingWords"
    ? { missingWordAnswers: card.tokens.filter(token => token.hidden).map(token => ({ index: token.index, text: "audit intentionally incorrect answer" })) }
    : { submittedAnswer: "audit intentionally incorrect answer" };
  const attempt = await json(page.request, `/api/v1/study/sessions/${session.id}/attempts`, { clientSubmissionId: randomUUID(), challengeCardId: card.id, ...answer, responseTimeMs: 2500, hintsUsed: false });
  expect(attempt.isCorrect).toBe(false);
  await capture("student-study-feedback", `/student/study?seasonId=${season.id}&sessionId=${session.id}&mode=Practice`, "Accepted incorrect attempt with source feedback", async p => {
    await expect(p.getByTestId("challenge-feedback")).toContainText("Needs another pass");
    await expect(p.getByTestId("feedback-source")).toHaveText(attempt.sourceText);
  });
  await json(page.request, `/api/v1/study/sessions/${session.id}/complete`, {});
  await capture("student-home", `/student?seasonId=${season.id}`, "Assigned active season with one recorded attempt", async p => {
    await expect(p.getByTestId("current-season")).toContainText(season.name);
    await expect(p.locator(".training-journey-preview")).toContainText("DAN 1 · Assigned scope");
  });
  await capture("student-progress", `/student/progress?seasonId=${season.id}`, "Real recorded attempt", p => expect(p.getByTestId("progress-attempts")).not.toHaveText("0"));
  for (const mode of ["Practice", "Review", "Simulation"]) await capture(`student-study-${mode.toLowerCase()}`, `/student/study?seasonId=${season.id}&mode=${mode}`, mode === "Review" ? "Review route after incorrect attempt; readiness depends on due schedule" : "Real generated activity", p => expect(p.getByTestId("challenge-card").or(p.getByTestId("academy-track-unavailable"))).toBeVisible());
  await capture("student-practice", `/student/practice?seasonId=${season.id}`, "Enabled practice with active season", p => expect(p.getByRole("button", { name: "Set up PVP", exact: true })).toBeVisible());
  await page.getByRole("button", { name: "Set up PVP", exact: true }).click();
  await capture("student-practice-setup", "", "PVP room setup dialog with assigned season", async p => {
    const setup = p.getByRole("dialog", { name: "PVP setup", exact: true });
    await expect(setup).toBeVisible();
    await setup.getByRole("combobox", { name: "Season", exact: true }).selectOption(season.id);
    await expect(setup.getByRole("button", { name: "Create room", exact: true })).toBeEnabled();
  });
  await page.getByRole("dialog", { name: "PVP setup", exact: true }).getByRole("button", { name: "Create room", exact: true }).click();
  await expect(page).toHaveURL(url => /^\/student\/practice\/[a-f0-9-]+$/.test(url.pathname) && url.searchParams.get("seasonId") === season.id);
  const roomUrl = page.url();
  await capture("student-practice-lobby", roomUrl, "Real created room, one player; no match started", p => expect(p.getByText("Live connection", { exact: true })).toBeVisible());
  await info.attach("route-coverage", { body: JSON.stringify(coverage, null, 2), contentType: "application/json" });
  await info.attach("overflow-findings", { body: JSON.stringify(overflowIssues, null, 2), contentType: "application/json" });
  await info.attach("runtime-errors", { body: JSON.stringify(runtimeErrors, null, 2), contentType: "application/json" });
  expect(overflowIssues, "Route overflow findings (see attachment)").toEqual([]);
  expect(runtimeErrors, "Browser runtime errors (see attachment)").toEqual([]);
});
