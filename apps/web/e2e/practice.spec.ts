import { expect, test, type APIRequestContext, type Browser, type Page, type TestInfo } from "@playwright/test";
import { login, assertNoOverflow } from "./helpers";
import { randomUUID } from "node:crypto";

async function json(api: APIRequestContext, path: string, data?: unknown) {
  const response = data === undefined ? await api.get(path) : await api.post(path, { data });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.status() === 204 ? undefined : response.json();
}
async function setup(page: Page) {
  await login(page);
  const me = await json(page.request, "/api/v1/me");
  const org = `/api/v1/organizations/${me.organizationId}`;
  const path = `${org}/practice`;
  await json(page.request, `${path}/enabled`, { enabled: true });
  const packs = await json(page.request, `${org}/content-packs`);
  const pack = packs.find((p: { packKey: string }) => p.packKey === "dev-daniel");
  const units = await json(page.request, `${org}/content-packs/${pack.id}/source-units`);
  const unit = units[0];
  const season = await json(page.request, `${org}/seasons`, { name: `PVP live ${randomUUID()}`, yearLabel: "2026", ruleProfileKey: "PBE_STYLE_V1" });
  const range = { bookKey: unit.bookKey, startChapter: unit.chapter, startVerse: unit.verse, endChapter: unit.chapter, endVerse: unit.verse };
  await json(page.request, `${org}/seasons/${season.id}/scope`, { contentPackId: pack.id, includes: [range], excludes: [] });
  const students = await json(page.request, `${org}/students`);
  await json(page.request, `${org}/seasons/${season.id}/assignments`, { studentUserId: students[0].userId, contentPackId: pack.id, type: "RequiredCoverage", range });
  const activation = await json(page.request, `${org}/seasons/${season.id}/activate`, {});
  expect(activation.activated).toBeTruthy();
  await json(page.request, `${path}/questions/import`, { seasonId: season.id, questions: Array.from({ length: 12 }, (_, i) => ({
    contentPackId: pack.id, sourceUnitId: unit.id, prompt: `Synthetic fixture ${i + 1}: name the student in the development passage.`,
    kind: "ShortAnswer", parts: [{ acceptedAnswers: ["Daniel"], points: 1 }], ordered: false, evidence: unit.canonicalText, reference: unit.citation, version: 1,
  })) });
  const bank = await json(page.request, `${path}/bootstrap`);
  for (const q of bank.questions.filter((q: { seasonId: string }) => q.seasonId === season.id)) await json(page.request, `${path}/questions/${q.id}/publish`, {});
  return { org, path, seasonId: season.id };
}
async function newPlayer(browser: Browser, admin: Page, org: string, name: string) {
  const userName = `pvp.${randomUUID().slice(0, 12)}`;
  const player = await json(admin.request, `${org}/students`, { userName, displayName: name, password: process.env.ERUDOZA_E2E_PASSWORD! });
  const context = await browser.newContext({ baseURL: new URL(admin.url()).origin });
  const page = await context.newPage();
  await login(page, userName);
  return { context, page, id: player.userId };
}
async function command(page: Page, path: string, room: { id: string; revision: number }, action: string, payload = {}) {
  return json(page.request, `${path}/rooms/${room.id}/commands`, { commandId: randomUUID(), revision: room.revision, action, ...payload });
}
async function capturePractice(page: Page, info: TestInfo, role: "coach" | "student", stage: string) {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.locator(".practice-page img:visible").evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await assertNoOverflow(page);
    const dock = page.getByRole("navigation", { name: "Mobile navigation" });
    const playing = await page.locator('.practice-room[data-status="Playing"]').count() > 0;
    if (width <= 760 && !playing) {
      await expect(dock).toBeVisible();
      expect(await dock.locator("a span,button span").allTextContents()).toEqual(role === "coach" ? ["Overview", "Seasons", "Students", "More"] : ["HQ", "Study", "Honors", "More"]);
      for (const target of await dock.locator("a,button").all()) {
        const bounds = await target.boundingBox();
        expect(bounds!.height).toBeGreaterThanOrEqual(44);
        expect(bounds!.width).toBeGreaterThanOrEqual(44);
      }
      await expect(page.locator(".command-shortcut-bar")).toBeHidden();
    } else await expect(dock).toBeHidden();
    await page.screenshot({ path: info.outputPath(`${role}-${stage}-${width}.png`), fullPage: true });
  }
}

test("real browsers invite, synchronize and earn server-measured speed points", async ({ page: admin, browser }, info) => {
  test.setTimeout(150000);
  const fixture = await setup(admin);
  const a = await newPlayer(browser, admin, fixture.org, "Practice A");
  const b = await newPlayer(browser, admin, fixture.org, "Practice B");
  try {
    for (const [page, route, role] of [[admin, "/admin/practice", "coach"], [a.page, "/student/practice", "student"]] as const) {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: "Create a room" })).toBeVisible();
      await capturePractice(page, info, role, "hub");
    }
    await a.page.setViewportSize({ width: 1440, height: 1000 });
    await a.page.getByRole("combobox", { name: /^Season/ }).selectOption(fixture.seasonId);
    await a.page.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(a.page).toHaveURL(/\/student\/practice\/[a-f0-9-]+(?:\?seasonId=[a-f0-9-]+)?$/);
    await expect(a.page.getByText("Live connection", { exact: true })).toBeVisible();
    const roomId = new URL(a.page.url()).pathname.split("/").pop()!;
    await capturePractice(a.page, info, "student", "lobby");
    await a.page.getByRole("combobox", { name: /^Invite player/ }).selectOption(b.id);
    await a.page.getByRole("combobox", { name: /^Destination/ }).selectOption("2");
    await a.page.getByRole("button", { name: "Send invitation" }).click();
    await b.page.goto("/student/practice");
    await b.page.getByRole("button", { name: "Join Team 2", exact: true }).click();
    await expect(b.page.getByText("Live connection", { exact: true })).toBeVisible();
    await a.page.getByText("Manage Practice A", { exact: true }).click();
    await expect(a.page.getByRole("button", { name: "Move to Team 2" })).toBeDisabled();
    await a.page.getByRole("combobox", { name: /^Swap Practice A with/ }).selectOption(b.id);
    await a.page.getByRole("button", { name: "Swap teams", exact: true }).filter({ visible: true }).first().click();
    await expect.poll(async () => (await json(a.page.request, `${fixture.path}/rooms/${roomId}`)).members.find((member: { userId: string }) => member.userId === a.id).team).toBe(2);
    await a.page.getByRole("button", { name: "I’m ready" }).click();
    await b.page.getByRole("button", { name: "I’m ready" }).click();
    await expect(a.page.getByRole("button", { name: "Start match" })).toBeEnabled();
    await a.page.getByRole("button", { name: "Start match" }).click();
    await expect(a.page.getByRole("button", { name: "Lock final answer" })).toBeEnabled({ timeout: 30000 });
    await expect(b.page.getByRole("button", { name: "Lock final answer" })).toBeEnabled({ timeout: 5000 });
    await a.page.getByLabel("Suggestion", { exact: true }).fill("Private team suggestion");
    await a.page.getByRole("button", { name: "Share with team" }).click();
    await expect(a.page.getByText("Private team suggestion", { exact: false })).toBeVisible();
    expect((await json(b.page.request, `${fixture.path}/rooms/${roomId}`)).messages).toHaveLength(0);
    await a.page.getByLabel("Answer 1", { exact: true }).fill("Daniel");
    await b.page.getByLabel("Answer 1", { exact: true }).fill("Daniel");
    const submitted = a.page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(`/rooms/${roomId}/commands`) && response.request().postDataJSON().action === "submit");
    await a.page.getByRole("button", { name: "Lock final answer" }).click();
    const submitResponse = await submitted;
    expect(submitResponse.ok()).toBeTruthy();
    expect(submitResponse.request().postDataJSON()).not.toHaveProperty("responseTimeMs");
    await b.page.getByRole("button", { name: "Lock final answer" }).click();
    await expect.poll(async () => (await json(a.page.request, `${fixture.path}/rooms/${roomId}`)).results.length, { timeout: 35000 }).toBe(2);
    const room = await json(a.page.request, `${fixture.path}/rooms/${roomId}`);
    for (const result of room.results) { expect(result.accuracyHundredths).toBe(100); expect(result.speedHundredths).toBeGreaterThan(0); expect(result.speedHundredths).toBeLessThanOrEqual(25); expect(result.elapsedMs).toBeGreaterThan(0); }
    const original = room.results.find((result: { team: number }) => result.team === 2);
    await a.page.getByLabel("Reason for review", { exact: true }).fill("Please verify the accepted wording against the source.");
    await a.page.getByRole("button", { name: "Request coach review", exact: true }).click();
    await expect(a.page.getByText("Appeal pending", { exact: true })).toBeVisible();
    await admin.goto(`/admin/practice/${roomId}`);
    await expect(admin.getByRole("button", { name: "Record judgment" })).toHaveCount(1);
    await admin.getByLabel("Reason", { exact: true }).fill("Confirmed the submitted wording is an accepted answer.");
    await admin.getByRole("button", { name: "Record judgment" }).click();
    await expect.poll(async () => (await json(a.page.request, `${fixture.path}/rooms/${roomId}`)).results.find((result: { team: number }) => result.team === 2).resolved).toBe(true);
    const judged = (await json(a.page.request, `${fixture.path}/rooms/${roomId}`)).results.find((result: { team: number }) => result.team === 2);
    expect(judged.elapsedMs).toBe(original.elapsedMs);
    expect(judged.speedHundredths).toBe(original.speedHundredths);
    await capturePractice(a.page, info, "student", "match");
    await capturePractice(admin, info, "coach", "match");
    await command(a.page, fixture.path, room, "abandon");
  } finally { await a.context.close().catch(() => {}); await b.context.close().catch(() => {}); }
});

test("5v5 completes ten scored questions with ten authenticated players, refresh recovery and achievements", async ({ page: admin, browser }, info) => {
  test.setTimeout(600000);
  const fixture = await setup(admin);
  const players: Awaited<ReturnType<typeof newPlayer>>[] = [];
  try {
    for (let i = 0; i < 10; i++) players.push(await newPlayer(browser, admin, fixture.org, `Five-side ${i + 1}`));
    let room = await json(players[0].page.request, `${fixture.path}/rooms`, { seasonId: fixture.seasonId, teamSize: 5, questionCount: 10, coached: false });
    for (let i = 1; i < 10; i++) {
      room = await command(players[0].page, fixture.path, room, "invite", { targetUserId: players[i].id, team: i < 5 ? 1 : 2 });
      const inbox = await json(players[i].page.request, `${fixture.path}/bootstrap`);
      room = await json(players[i].page.request, `${fixture.path}/invitations/${inbox.invitations[0].id}/accept`, { team: i < 5 ? 1 : 2 });
    }
    expect(room.members.filter((m: { team: number }) => m.team === 1)).toHaveLength(5);
    expect(room.members.filter((m: { team: number }) => m.team === 2)).toHaveLength(5);
    for (const player of players) { await player.page.goto(`/student/practice/${room.id}`); await expect(player.page.getByText("Live connection", { exact: true })).toBeVisible(); room = await command(player.page, fixture.path, room, "ready"); }
    room = await command(players[0].page, fixture.path, room, "start");
    expect(room.status).toBe("Playing");
    for (let round = 0; round < 10; round++) {
      await expect(players[0].page.getByRole("heading", { name: `Question ${round + 1} of 10`, exact: true })).toBeVisible({ timeout: 45000 });
      if (round === 2) {
        await players[0].page.reload();
        await expect(players[0].page.getByText("Live connection", { exact: true })).toBeVisible();
        await expect(players[0].page.getByRole("heading", { name: "Question 3 of 10", exact: true })).toBeVisible();
      }
      for (const scribe of [players[0], players[5]]) {
        await expect(scribe.page.getByRole("button", { name: "Lock final answer" })).toBeEnabled({ timeout: 35000 });
        await scribe.page.getByLabel("Answer 1", { exact: true }).fill("Daniel");
        await scribe.page.getByRole("button", { name: "Lock final answer" }).click();
        // The second final answer can reveal the round before the lock notice paints.
        await expect(scribe.page.getByText("Answer locked. Wait for the question review.").or(scribe.page.getByRole("heading", { name: "Round review", exact: true }))).toBeVisible();
      }
      await expect.poll(async () => (await json(players[0].page.request, `${fixture.path}/rooms/${room.id}`)).results.length, { timeout: 35000 }).toBe((round + 1) * 2);
      console.info(`5v5 completed scored question ${round + 1}/10`);
    }
    await expect.poll(async () => (await json(players[0].page.request, `${fixture.path}/rooms/${room.id}`)).status, { timeout: 20000 }).toBe("Completed");
    room = await json(players[0].page.request, `${fixture.path}/rooms/${room.id}`);
    expect(room.results).toHaveLength(20);
    for (const score of room.scores) { expect(score.accuracyHundredths).toBe(1000); expect(score.speedHundredths).toBeGreaterThan(0); expect(score.totalHundredths).toBe(score.accuracyHundredths + score.speedHundredths); }
    await expect(players[0].page.getByText("Finalized result", { exact: true })).toBeVisible();
    await capturePractice(players[0].page, info, "student", "results");
    for (const player of players) {
      const bootstrap = await json(player.page.request, `${fixture.path}/bootstrap`);
      expect(bootstrap.achievements.some((award: { key: string; seasonId: string }) => award.key === "first-fellowship" && award.seasonId === fixture.seasonId)).toBe(true);
      if (player === players[0] || player === players[5]) expect(bootstrap.achievements.some((award: { key: string; seasonId: string }) => award.key === "shared-scribe" && award.seasonId === fixture.seasonId)).toBe(true);
      const profile = await json(player.page.request, "/api/v1/profile/me");
      const earned = profile.honors.filter((honor: { earnedAtUtc: string | null }) => honor.earnedAtUtc).map((honor: { key: string }) => honor.key);
      expect(earned).toEqual(player === players[0] || player === players[5] ? ["team:first-fellowship"] : []);
    }
    await players[0].page.goto("/student/profile");
    await players[0].page.getByRole("button", { name: "Use First Fellowship as profile image", exact: true }).click();
    await expect(players[0].page.locator('[data-profile-honor="team:first-fellowship"]')).toHaveCount(2);
    await players[0].page.reload();
    await expect(players[0].page.locator('[data-profile-honor="team:first-fellowship"]')).toHaveCount(2);
    const locked = await players[1].page.request.put("/api/v1/profile/me/avatar", { data: { honorKey: "team:first-fellowship" } });
    expect(locked.status()).toBe(403);
  } finally { for (const player of players) await player.context.close().catch(() => {}); }
});

test("coach in Student mode joins by invitation, completes a match and wears an earned Honor in both workspaces", async ({ page: coach, browser }, info) => {
  test.setTimeout(420000);
  const fixture = await setup(coach);
  const me = await json(coach.request, '/api/v1/me');
  const other = await newPlayer(browser, coach, fixture.org, 'Coach practice partner');
  try {
    await other.page.goto('/student/practice');
    await other.page.getByRole('combobox', { name: /^Season/ }).selectOption(fixture.seasonId);
    await other.page.getByRole('button', { name: 'Create room', exact: true }).click();
    await expect(other.page).toHaveURL(/\/student\/practice\/[a-f0-9-]+(?:\?seasonId=[a-f0-9-]+)?$/);
    const roomId = new URL(other.page.url()).pathname.split('/').pop()!;
    await other.page.getByRole('combobox', { name: /^Invite player/ }).selectOption(me.userId);
    await other.page.getByRole('combobox', { name: /^Destination/ }).selectOption('2');
    await other.page.getByRole('button', { name: 'Send invitation' }).click();
    await coach.goto('/student/practice');
    await coach.getByRole('button', { name: 'Join Team 2', exact: true }).click();
    await expect(coach).toHaveURL(new RegExp(`/student/practice/${roomId}`));
    await expect(coach.getByText('Live connection', { exact: true })).toBeVisible();
    await capturePractice(coach, info, 'student', 'coach-player-lobby');
    await coach.getByRole('button', { name: 'I’m ready' }).click();
    await other.page.getByRole('button', { name: 'I’m ready' }).click();
    await other.page.getByRole('button', { name: 'Start match' }).click();
    for (let round = 0; round < 10; round++) {
      for (const player of [coach, other.page]) {
        await expect(player.getByRole('button', { name: 'Lock final answer' })).toBeEnabled({ timeout: 35000 });
        await player.getByLabel('Answer 1', { exact: true }).fill('Daniel');
        await player.getByRole('button', { name: 'Lock final answer' }).click();
        await expect(player.getByText('Answer locked. Wait for the question review.').or(player.getByRole('heading', { name: 'Round review', exact: true }))).toBeVisible();
      }
      await expect.poll(async () => (await json(coach.request, `${fixture.path}/rooms/${roomId}`)).results.length, { timeout: 35000 }).toBe((round + 1) * 2);
      if (round === 0) {
        await coach.goto(`/admin/practice/${roomId}`);
        await expect(coach.getByRole('button', { name: 'Record judgment' })).toHaveCount(0);
        const room = await json(coach.request, `${fixture.path}/rooms/${roomId}`);
        expect(room.isCoach).toBe(false);
        const forbidden = await coach.request.post(`${fixture.path}/rooms/${roomId}/commands`, { data: { commandId: randomUUID(), revision: room.revision, action: 'judge', questionId: room.results[0].questionId, team: 2, points: 1, text: 'Cannot judge own match' } });
        expect(forbidden.status()).toBe(403);
        await coach.goto(`/student/practice/${roomId}`);
      }
      console.info(`Coach player completed question ${round + 1}/10`);
    }
    await expect.poll(async () => (await json(coach.request, `${fixture.path}/rooms/${roomId}`)).status, { timeout: 20000 }).toBe('Completed');
    const completedRoom = await json(coach.request, `${fixture.path}/rooms/${roomId}`);
    expect(completedRoom.members.find((member: { userId: string }) => member.userId === me.userId)).toMatchObject({ team: 2, scribe: true });
    expect(completedRoom.results.filter((result: { team: number }) => result.team === 2)).toHaveLength(10);
    for (const result of completedRoom.results) expect(result.accuracyHundredths).toBe(100);
    for (const score of completedRoom.scores) {
      expect(score.accuracyHundredths).toBe(1000);
      expect(score.totalHundredths).toBe(score.accuracyHundredths + score.speedHundredths);
    }
    const earnedHere = await json(coach.request, `${fixture.path}/bootstrap`);
    expect(earnedHere.achievements.some((award: { seasonId: string; key: string }) => award.seasonId === fixture.seasonId && award.key === 'first-fellowship')).toBe(true);
    await capturePractice(coach, info, 'student', 'coach-player-results');
    console.info('Coach match finalized; checking mastery profile');
    const profile = await json(coach.request, '/api/v1/profile/me');
    expect(profile.honors.find((honor: { key: string }) => honor.key === 'team:first-fellowship').earnedAtUtc).toBeTruthy();
    // Reproduce a previous project's saved avatar before exercising a fresh UI save.
    const existingAvatar = await coach.request.put('/api/v1/profile/me/avatar', { data: { honorKey: 'team:first-fellowship' } });
    expect(existingAvatar.ok()).toBeTruthy();
    expect((await existingAvatar.json()).avatarHonorKey).toBe('team:first-fellowship');
    const resetAvatar = await coach.request.put('/api/v1/profile/me/avatar', { data: { honorKey: null } });
    expect(resetAvatar.ok()).toBeTruthy();
    expect((await resetAvatar.json()).avatarHonorKey).toBeNull();
    await coach.goto('/student/profile');
    await expect(coach.getByRole('button', { name: 'Use initials', exact: true })).toBeDisabled();
    await coach.getByRole('button', { name: 'Use First Fellowship as profile image', exact: true }).click();
    await expect(coach.locator('[data-profile-honor="team:first-fellowship"]')).toHaveCount(2);
    await coach.reload();
    await expect(coach.locator('[data-profile-honor="team:first-fellowship"]')).toHaveCount(2);
    console.info('Coach avatar saved and reloaded; checking Coach mode');
    await coach.goto('/admin/profile');
    await expect(coach.locator('[data-profile-honor="team:first-fellowship"]')).toHaveCount(2);
    expect((await json(coach.request, '/api/v1/me')).userId).toBe(me.userId);
    const locked = await coach.request.put('/api/v1/profile/me/avatar', { data: { honorKey: 'team:rehearsal-complete' } });
    expect(locked.status()).toBe(403);
    console.info('Coach scores, Honor, cross-mode avatar and locked selection verified');
  } finally { await other.page.goto('about:blank').catch(() => {}); await other.context.close(); }
});
