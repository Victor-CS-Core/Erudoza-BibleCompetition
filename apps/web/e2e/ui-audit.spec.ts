import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { assertNoOverflow, login, logout } from "./helpers";

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
  const units = await json(page.request, `${org}/content-packs/${pack.id}/source-units`);
  const student = (await json(page.request, `${org}/students`)).find((s: { userName: string }) => s.userName === "daniel.student");
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
    return;
  }
  await json(page.request, `${org}/practice/enabled`, { enabled: true });
  await json(page.request, `${org}/practice/questions/import`, { seasonId: season.id, questions: Array.from({ length: 12 }, (_, i) => ({ contentPackId: pack.id, sourceUnitId: units[0].id, prompt: `Audit practice question ${i + 1}: name the student.`, kind: "ShortAnswer", parts: [{ acceptedAnswers: ["Daniel"], points: 1 }], ordered: false, evidence: units[0].canonicalText, reference: units[0].citation, version: 1 })) });
  const bank = await json(page.request, `${org}/practice/bootstrap`);
  for (const question of bank.questions.filter((q: { seasonId: string }) => q.seasonId === season.id)) await json(page.request, `${org}/practice/questions/${question.id}/publish`, {});
  await capture("coach-overview", "/admin", "Active season with real assignment", p => expect(p.getByRole("heading", { name: "Student progress" })).toBeVisible());
  await capture("coach-seasons", "/admin/seasons", "Active season list", p => expect(p.getByText(season.name, { exact: true }).first()).toBeVisible());
  await capture("coach-new-season", "/admin/seasons/new", "New season form", p => expect(p.getByTestId("season-name")).toBeVisible());
  for (const step of ["details", "passages", "students", "review"]) await capture(`coach-season-${step}`, `/admin/seasons/${season.id}?step=${step}`, "Populated active season", p => expect(p.getByTestId("season-status")).toHaveText("Active"));
  const draft = await json(page.request, `${org}/seasons`, { name: "Next season draft", yearLabel: "2026", ruleProfileKey: "PBE_STYLE_V1" });
  await json(page.request, `${org}/seasons/${draft.id}/scope`, { contentPackId: pack.id, includes: [range], excludes: [] });
  await capture("coach-season-draft-passages", `/admin/seasons/${draft.id}?step=passages`, "Editable stored pack scope with bounded chapter/verse options", async p => {
    await p.getByRole("button", { name: "Edit season passages", exact: true }).click();
    await expect(p.getByTestId("scope-start").locator("option")).toHaveCount(new Set(units.filter((unit: { bookKey: string; chapter: number }) => unit.bookKey === "DAN" && unit.chapter === 1).map((unit: { verse: number }) => unit.verse)).size);
  });
  await capture("coach-students", "/admin/students", "Student directory", p => expect(p.getByRole("table")).toContainText("Daniel Student"));
  await capture("coach-assignments", `/admin/assignments?seasonId=${season.id}`, "Assignment coverage", p => expect(p.getByRole("table")).toContainText("Daniel Student"));
  await capture("coach-assignment-editor", `/admin/assignments?seasonId=${season.id}&studentId=${student.userId}`, "Individual populated plan", p => expect(p.getByRole("button", { name: /Correct passage/ }).first()).toBeVisible());
  await capture("coach-library", "/admin/content", "Built-in NKJV library", p => expect(p.getByTestId("library-book")).toHaveCount(66));
  await page.getByTestId("library-book").filter({ hasText: "Daniel" }).click();
  await capture("coach-library-preview", "", "Selected stored pack and actual verse preview", p => expect(p.getByTestId("source-unit-list")).toContainText("Daniel 1:1"));
  await capture("coach-student-progress", `/admin/seasons/${season.id}/students/${student.userId}/progress`, "Assigned student; no attempts yet", p => expect(p.getByTestId("progress-attempts")).toHaveText("0"));
  await capture("coach-design-reference", "/admin/design-system", "Shared primitives");
  await capture("coach-practice", "/admin/practice", "Enabled practice and published question bank", p => expect(p.getByRole("heading", { name: "Create a room" })).toBeVisible());
  await logout(page);
  await login(page, "daniel.student");
  const session = await json(page.request, "/api/v1/study/sessions", { seasonId: season.id, mode: "Practice" });
  const card = await json(page.request, `/api/v1/study/sessions/${session.id}/next`);
  await json(page.request, `/api/v1/study/sessions/${session.id}/attempts`, { clientSubmissionId: randomUUID(), challengeCardId: card.id, submittedAnswer: "audit intentionally incorrect answer", responseTimeMs: 2500, hintsUsed: false });
  await capture("student-study-feedback", `/student/study?seasonId=${season.id}&sessionId=${session.id}&mode=Practice`, "Accepted incorrect attempt with source feedback", p => expect(p.getByTestId("challenge-feedback")).toBeVisible());
  await json(page.request, `/api/v1/study/sessions/${session.id}/complete`, {});
  await capture("student-home", `/student?seasonId=${season.id}`, "Assigned active season with one recorded attempt", p => expect(p.getByTestId("assignment-range")).toContainText("DAN"));
  await capture("student-progress", `/student/progress?seasonId=${season.id}`, "Real recorded attempt", p => expect(p.getByTestId("progress-attempts")).not.toHaveText("0"));
  for (const mode of ["Practice", "Review", "Simulation"]) await capture(`student-study-${mode.toLowerCase()}`, `/student/study?seasonId=${season.id}&mode=${mode}`, mode === "Review" ? "Review route after incorrect attempt; readiness depends on due schedule" : "Real generated activity", p => expect(p.getByTestId("challenge-card").or(p.getByTestId("academy-track-unavailable"))).toBeVisible());
  await capture("student-practice", "/student/practice", "Enabled practice with active season", p => expect(p.getByRole("heading", { name: "Create a room" })).toBeVisible());
  await page.getByRole("combobox", { name: /^Season/ }).selectOption(season.id);
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(page).toHaveURL(/\/student\/practice\/[a-f0-9-]+$/);
  const roomUrl = page.url();
  await capture("student-practice-lobby", roomUrl, "Real created room, one player; no match started", p => expect(p.getByText("Live connection", { exact: true })).toBeVisible());
  await info.attach("route-coverage", { body: JSON.stringify(coverage, null, 2), contentType: "application/json" });
  await info.attach("overflow-findings", { body: JSON.stringify(overflowIssues, null, 2), contentType: "application/json" });
  expect(overflowIssues, "Route overflow findings (see attachment)").toEqual([]);
});
