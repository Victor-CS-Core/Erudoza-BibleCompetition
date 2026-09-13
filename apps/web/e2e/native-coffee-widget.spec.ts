import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Me, Progress } from "../src/api/types";
import { todayFixture } from "../src/features/student/trainingFixtures";
import { assertNoOverflow } from "./helpers";

const scriptUrl = "https://cdnjs.buymeacoffee.com/1.0.0/widget.prod.min.js";
const paymentForm = `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test payment form</title><style>body{margin:0;padding:24px;box-sizing:border-box;font:16px system-ui;color:#173346}h1{font-size:24px}label,input,button{display:block;margin:16px 0;max-width:100%;box-sizing:border-box}input,button{padding:12px;font:inherit}</style><h1>Test payment form</h1><p>Browser test only. No payment service is connected.</p><label for="amount">Coffee amount</label><input id="amount" type="number" value="5"><button disabled>Payments disabled in test</button></html>`;

const coach: Me = { userId: "coffee-coach", organizationId: "coffee-test-org", organizationName: "Coffee test academy", displayName: "Test Coach", userName: "coffee.coach", email: "coffee.coach@example.test", kind: "Adult", role: "Owner" };
const student: Me = { ...coach, userId: "coffee-student", displayName: "Test Student", userName: "coffee.student", email: null, kind: "Student", role: "Student" };
const emptyProgress: Progress = { seasonId: "", seasonName: "", seasonStatus: "None", assignments: [], masteredCount: 0, reviewDueCount: 0, attemptCount: 0, mastery: [], recentAttempts: [] };

async function installFixtures(page: Page, blocked = false, delay?: Promise<void>) {
  let account: Me | null = null;
  await page.route("https://fonts.googleapis.com/**", route => route.abort("blockedbyclient"));
  await page.route("https://fonts.gstatic.com/**", route => route.abort("blockedbyclient"));
  const calls = { scripts: 0, frames: 0, unexpectedApi: [] as string[] };
  const override = process.env.COFFEE_WIDGET_SCRIPT_FILE;
  if (override && !path.isAbsolute(override)) throw new Error("COFFEE_WIDGET_SCRIPT_FILE must be an absolute path to a locally inspected vendor script.");
  const cup = await readFile(new URL("./fixtures/bmc-coffee-cup.svg", import.meta.url), "utf8");
  const provider = await readFile(override ?? new URL("./fixtures/coffee-widget-contract.js", import.meta.url), "utf8");
  await page.route(scriptUrl, async route => {
    calls.scripts++;
    await delay;
    return blocked ? route.abort("blockedbyclient") : route.fulfill({ contentType: "application/javascript", body: provider });
  });
  await page.route("https://www.buymeacoffee.com/widget/page/erudoza*", route => {
    calls.frames++;
    return route.fulfill({ contentType: "text/html", body: paymentForm });
  });
  // Keep official-script runs offline too; only its local script and test frame execute.
  await page.route("https://cdn.buymeacoffee.com/**", route => route.request().url().includes("coffee%20cup.svg")
    ? route.fulfill({ contentType: "image/svg+xml", body: cup })
    : route.abort("blockedbyclient"));
  await page.route("**/api/v1/**", route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/v1/me") return account ? route.fulfill({ json: account }) : route.fulfill({ status: 401, json: { title: "Test session signed out" } });
    if (pathname === "/api/v1/auth/login" && request.method() === "POST") {
      account = String(request.postDataJSON().identifier).includes("student") ? student : coach;
      return route.fulfill({ json: account });
    }
    if (pathname === "/api/v1/auth/logout" && request.method() === "POST") { account = null; return route.fulfill({ status: 204 }); }
    if (request.method() === "GET" && pathname === "/api/v1/profile/identities") return route.fulfill({ json: account ? [{ userId: account.userId, avatarHonorKey: null }] : [] });
    if (request.method() === "GET" && pathname === "/api/v1/progress/me/today") return route.fulfill({ json: todayFixture({ seasonId: null, seasonStatus: "None", mission: { id: null, revision: null, status: "Unavailable", scopeVersion: null, explanation: null, steps: [] }, nextAction: null }) });
    if (request.method() === "GET" && pathname === "/api/v1/progress/me") return route.fulfill({ json: emptyProgress });
    if (request.method() === "GET" && ["/api/v1/progress/me/seasons", "/api/v1/organizations/coffee-test-org/seasons", "/api/v1/organizations/coffee-test-org/students"].includes(pathname)) return route.fulfill({ json: [] });
    calls.unexpectedApi.push(`${request.method()} ${pathname}`);
    return route.fulfill({ status: 500, json: { title: "Unexpected test API request" } });
  });
  return calls;
}

const launcher = (page: Page) => page.getByRole("button", { name: "Buy me a coffee", exact: true });
const popup = (page: Page) => page.getByRole("dialog", { name: "Support Erudoza", exact: true });
const close = (page: Page) => page.getByRole("button", { name: "Close donation popup", exact: true });

async function signIn(page: Page, kind: "coach" | "student") {
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email or username").fill(`coffee.${kind}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill("Synthetic-test-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId(kind === "coach" ? "coach-app-shell" : "learner-app-shell")).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByTestId("logout").click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("#bmc-wbtn")).toBeHidden();
  await expect(popup(page)).toBeHidden();
}

async function assertWithinViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  return box!;
}

test("public popup opens by keyboard, closes and reopens without leaving the page", async ({ page, browserName }) => {
  const calls = await installFixtures(page);
  await page.goto("/");
  await expect(launcher(page)).toBeVisible();
  await expect(popup(page)).toBeHidden();
  expect(calls.frames).toBe(0);
  await expect(page.locator('script[data-name="BMC-Widget"]')).toHaveAttribute("data-message", "");
  const color = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--er-teal").trim());
  await expect(page.locator('script[data-name="BMC-Widget"]')).toHaveAttribute("data-color", color);
  const initialUrl = page.url();
  await launcher(page).focus();
  await page.keyboard.press("Enter");
  await expect(popup(page)).toBeVisible();
  await expect(close(page)).toBeFocused();
  await expect(page.frameLocator("#bmc-iframe").getByRole("heading", { name: "Test payment form" })).toBeVisible();
  await expect(page.locator("#root")).toHaveJSProperty("inert", true);
  await close(page).press("Tab");
  const support = page.getByRole("link", { name: "Open support page (opens in a new tab)" });
  await expect(support).toBeFocused();
  await support.press("Tab");
  const amount = page.frameLocator("#bmc-iframe").getByLabel("Coffee amount");
  // Firefox focuses the frame document before its first form field.
  if (browserName === "firefox") {
    await expect(page.locator("#bmc-iframe")).toBeFocused();
    await page.keyboard.press("Tab");
  }
  await expect(amount).toBeFocused();
  await amount.press("Tab");
  await expect(close(page)).toBeFocused();
  await close(page).press("Enter");
  await expect(popup(page)).toBeHidden();
  await expect(launcher(page)).toBeFocused();
  await expect(page.locator("#root")).toHaveJSProperty("inert", false);
  await page.keyboard.press("Space");
  await expect(popup(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popup(page)).toBeHidden();
  await expect(launcher(page)).toBeFocused();
  expect(page.url()).toBe(initialUrl);
  expect(page.context().pages()).toHaveLength(1);
  expect(calls).toEqual({ scripts: 1, frames: 1, unexpectedApi: [] });
});

test("coach navigation keeps a single widget, command dialogs suspend it, and students never see it", async ({ page }) => {
  const calls = await installFixtures(page);
  await page.goto("/");
  await expect(launcher(page)).toBeVisible();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#bmc-wbtn")).toBeHidden();
  await signIn(page, "coach");
  await expect(launcher(page)).toBeVisible();
  await launcher(page).click();
  await expect(popup(page)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  const command = page.getByRole("dialog", { name: "Command center" });
  await expect(command).toBeHidden();
  await expect(popup(page)).toBeVisible();
  await close(page).click();
  await page.getByRole("button", { name: "Search sections, students, or actions", exact: true }).click();
  await expect(command).toBeVisible();
  await expect(page.locator("#bmc-wbtn")).toBeHidden();
  await expect(popup(page)).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(command).toBeHidden();
  await expect(launcher(page)).toBeVisible();
  await page.getByTestId("coach-tab-students").click();
  await expect(page).toHaveURL(/\/admin\/students$/);
  await expect(launcher(page)).toBeVisible();
  await page.getByRole("link", { name: "Erudoza home", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator("#bmc-wbtn")).toHaveCount(1);
  await expect(page.locator("#bmc-iframe")).toHaveCount(1);
  await expect(page.locator('script[data-name="BMC-Widget"]')).toHaveCount(1);
  await launcher(page).click();
  await expect(popup(page)).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/students$/);
  await expect(popup(page)).toBeHidden();
  await expect(page.locator("#root")).toHaveJSProperty("inert", false);
  await signOut(page);
  await signIn(page, "student");
  await expect(page.getByRole("heading", { name: "Training HQ", exact: true })).toBeVisible();
  await expect(page.locator("#bmc-wbtn")).toBeHidden();
  await expect(popup(page)).toBeHidden();
  expect(calls).toEqual({ scripts: 1, frames: 1, unexpectedApi: [] });
});

test("blocked provider script leaves public navigation and coach sign-in usable", async ({ page }) => {
  const calls = await installFixtures(page, true);
  await page.goto("/");
  await expect(page.getByTestId("landing-phone-column")).toBeVisible();
  await expect(page.locator("#bmc-wbtn")).toHaveCount(0);
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await signIn(page, "coach");
  await expect(page.getByRole("heading", { name: "Season overview", exact: true })).toBeVisible();
  await expect(page.locator("#bmc-wbtn")).toHaveCount(0);
  expect(calls).toEqual({ scripts: 1, frames: 0, unexpectedApi: [] });
});

test("a slow provider script never blocks rendering or coach sign-in", async ({ page }) => {
  let release!: () => void;
  const delay = new Promise<void>(resolve => { release = resolve; });
  const calls = await installFixtures(page, false, delay);
  const requested = page.waitForRequest(scriptUrl);
  await page.goto("/", { waitUntil: "commit" });
  await requested;
  try {
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible({ timeout: 4_000 });
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await signIn(page, "coach");
    await expect(page.locator("#bmc-wbtn")).toHaveCount(0);
  } finally {
    release();
  }
  await expect(launcher(page)).toBeVisible();
  expect(calls).toEqual({ scripts: 1, frames: 0, unexpectedApi: [] });
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 812 }]) {
  test(`popup, coach and student fit ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const calls = await installFixtures(page);
    await page.goto("/");
    await expect(launcher(page)).toBeVisible();
    await assertWithinViewport(page, launcher(page));
    await assertNoOverflow(page);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await assertWithinViewport(page, launcher(page));
    await launcher(page).click();
    await expect(popup(page)).toBeVisible();
    await expect(page.frameLocator("#bmc-iframe").getByRole("heading", { name: "Test payment form" })).toBeVisible();
    const frame = await assertWithinViewport(page, page.locator("#bmc-iframe"));
    const dismiss = await assertWithinViewport(page, close(page));
    expect(dismiss.y + dismiss.height <= frame.y || dismiss.y >= frame.y + frame.height).toBe(true);
    await assertNoOverflow(page);
    await page.screenshot({ path: info.outputPath(`public-popup-${viewport.width}.png`) });
    await close(page).click();
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await signIn(page, "coach");
    await expect(launcher(page)).toBeVisible();
    await assertWithinViewport(page, launcher(page));
    await assertNoOverflow(page);
    await page.screenshot({ path: info.outputPath(`coach-${viewport.width}.png`), fullPage: true });
    await signOut(page);
    await signIn(page, "student");
    await expect(page.locator("#bmc-wbtn")).toBeHidden();
    await expect(page.getByText("Your coach will add your study assignment here.")).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: info.outputPath(`student-${viewport.width}.png`), fullPage: true });
    expect(calls).toEqual({ scripts: 1, frames: 1, unexpectedApi: [] });
  });
}

const supportLink = (page: Page) => page.getByRole("link", { name: "Open support page (opens in a new tab)" });
const fallbackLink = (page: Page) => page.getByRole("link", { name: "Buy me a coffee (opens in a new tab)" });

for (const blockedScript of [true, false]) {
  test(`support opens a real link when ${blockedScript ? "the script" : "the payment frame"} is blocked`, async ({ page }) => {
    await installFixtures(page, blockedScript);
    await page.route("https://www.buymeacoffee.com/widget/page/**", route => route.abort("blockedbyclient"));
    await page.context().route("https://buymeacoffee.com/erudoza", route => route.fulfill({ contentType: "text/html", body: "<h1>Test support destination</h1>" }));
    await page.goto("/");
    if (!blockedScript) await launcher(page).click();
    const link = blockedScript ? fallbackLink(page) : supportLink(page);
    await expect(link).toBeVisible();
    await assertWithinViewport(page, link);
    const opened = page.waitForEvent("popup");
    await link.click();
    const destination = await opened;
    await expect(destination).toHaveURL("https://buymeacoffee.com/erudoza");
    await expect(destination.getByRole("heading", { name: "Test support destination" })).toBeVisible();
    await expect(page).toHaveURL("http://127.0.0.1:5195/");
    await destination.close();
    if (!blockedScript) await close(page).click();
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await signIn(page, "student");
    await expect(fallbackLink(page)).toHaveCount(0);
    await expect(supportLink(page)).toHaveCount(0);
  });
}

test("the manifest and home-screen icons are usable from nested entry routes", async ({ page, request }) => {
  await installFixtures(page);
  await page.goto("/login");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({ id: "/", start_url: "/", scope: "/", display: "standalone" });
  for (const icon of manifest.icons) {
    const dimensions = await page.evaluate(async src => {
      const image = new Image(); image.src = src; await image.decode();
      return `${image.naturalWidth}x${image.naturalHeight}`;
    }, icon.src);
    expect(dimensions).toBe(icon.sizes);
  }
  const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  expect((await request.get(appleIcon!)).ok()).toBe(true);
});

for (const width of [1440, 390, 320]) {
  test(`installation help is accessible and fits at ${width}px for public, coach and student`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await installFixtures(page);
    await page.goto("/");
    for (const role of ["public", "coach", "student"] as const) {
      if (role !== "public") {
        if (role === "coach") await page.getByRole("link", { name: "Sign in", exact: true }).click();
        else await signOut(page);
        await expect(page).toHaveURL(/\/login$/);
        await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Download app", exact: true }).scrollIntoViewIfNeeded();
        await assertNoOverflow(page);
        await page.screenshot({ path: info.outputPath(`footer-login-${role}-${width}.png`) });
        await signIn(page, role);
      }
      const install = page.getByRole("button", { name: "Download app", exact: true });
      await install.scrollIntoViewIfNeeded();
      await assertNoOverflow(page);
      await page.screenshot({ path: info.outputPath(`footer-${role}-${width}.png`) });
      await install.click();
      const dialog = page.getByRole("dialog", { name: "Install Erudoza" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Close dialog" })).toBeFocused();
      await expect(dialog.getByRole("heading", { name: "iPhone or iPad" })).toBeVisible();
      await expect(launcher(page)).toBeHidden();
      await expect(fallbackLink(page)).toBeHidden();
      await assertWithinViewport(page, dialog);
      await assertNoOverflow(page);
      await page.screenshot({ path: info.outputPath(`install-${role}-${width}.png`) });
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(install).toBeFocused();
    }
  });
}

for (const result of ["accepted", "dismissed", "error"]) {
  test(`browser installation handles ${result} and never reuses a consumed prompt`, async ({ page }) => {
    await installFixtures(page);
    await page.goto("/");
    await page.evaluate(outcome => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.assign(event, { prompt: async () => {
        document.documentElement.dataset.installCalls = String(Number(document.documentElement.dataset.installCalls ?? 0) + 1);
        if (outcome === "error") throw new Error("Browser denied prompt");
        return { outcome };
      } });
      window.dispatchEvent(event);
    }, result);
    // A saved browser event must survive navigation and account transitions.
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await signIn(page, "coach");
    const install = page.getByRole("button", { name: "Download app", exact: true });
    await install.click();
    await expect(page.locator("html")).toHaveAttribute("data-install-calls", "1");
    if (result === "accepted") await expect(install).toBeHidden();
    else {
      if (result === "dismissed") await install.click();
      await expect(page.getByRole("dialog", { name: "Install Erudoza" })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-install-calls", "1");
    }
  });
}

test("home-screen app mode suppresses redundant installation controls", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
  await installFixtures(page);
  await page.goto("/");
  await expect(page.getByTestId("landing-phone-column")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download app" })).toHaveCount(0);
});

test("browser installation also supports the separate userChoice result", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/");
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, { prompt: async () => undefined, userChoice: Promise.resolve({ outcome: "accepted" }) });
    window.dispatchEvent(event);
  });
  await page.getByRole("button", { name: "Download app", exact: true }).click();
  await expect(page.getByRole("button", { name: "Download app", exact: true })).toHaveCount(0);
});

const minimizeSupport = (page: Page) => page.getByRole("button", { name: "Minimize support widget" });
const restoreSupport = (page: Page) => page.getByRole("button", { name: "Show support button" });
const footerSupport = (page: Page) => page.getByRole("link", { name: "Support Erudoza (opens in a new tab)" });

for (const width of [1440, 390, 320]) {
  test(`support minimization persists through reload and account transitions at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await installFixtures(page);
    await page.goto("/");
    await expect(launcher(page)).toBeVisible();
    const before = await page.locator("footer").evaluate(el => parseFloat(getComputedStyle(el).paddingBottom));
    const box = await assertWithinViewport(page, minimizeSupport(page));
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    const providerBox = await launcher(page).boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(providerBox!.x);
    const glyph = await minimizeSupport(page).locator("span").boundingBox();
    expect(providerBox!.x - (glyph!.x + glyph!.width)).toBeLessThanOrEqual(8);
    expect(Math.abs(glyph!.y + glyph!.height / 2 - (providerBox!.y + providerBox!.height / 2))).toBeLessThanOrEqual(1);
    await expect(launcher(page).locator("img")).toHaveAttribute("src", "https://cdn.buymeacoffee.com/widget/assets/coffee%20cup.svg");
    await page.screenshot({ path: info.outputPath(`support-expanded-${width}.png`) });
    await minimizeSupport(page).click();
    await expect(launcher(page)).toBeHidden(); await expect(fallbackLink(page)).toHaveCount(0);
    await expect(footerSupport(page)).toBeFocused();
    expect(await page.locator("footer").evaluate(el => parseFloat(getComputedStyle(el).paddingBottom))).toBeLessThan(before);
    await footerSupport(page).scrollIntoViewIfNeeded();
    await assertNoOverflow(page);
    await page.screenshot({ path: info.outputPath(`support-minimized-${width}.png`) });
    await page.addInitScript(() => {
      if (localStorage.getItem("erudoza:coffee-minimized:v1") !== "1") return;
      new MutationObserver(() => {
        if (document.documentElement?.dataset.erudozaCoffeeReady === "true") document.documentElement.dataset.coffeeFlashed = "true";
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-erudoza-coffee-ready"] });
    });
    await page.reload();
    await expect(restoreSupport(page)).toBeVisible(); await expect(launcher(page)).toBeHidden();
    await expect(page.locator("html")).not.toHaveAttribute("data-coffee-flashed", "true");
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await expect(restoreSupport(page)).toHaveCount(0);
    await signIn(page, "coach");
    await expect(restoreSupport(page)).toBeVisible(); await expect(launcher(page)).toBeHidden();
    await signOut(page); await signIn(page, "student");
    await expect(footerSupport(page)).toHaveCount(0); await expect(minimizeSupport(page)).toHaveCount(0);
    await signOut(page); await signIn(page, "coach");
    await restoreSupport(page).click();
    await expect(minimizeSupport(page)).toBeFocused(); await expect(launcher(page)).toBeVisible();
    await page.reload(); await expect(launcher(page)).toBeVisible();
  });
}

test("support minimization works with a blocked provider and unavailable storage", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Denied", "SecurityError"); } }));
  await page.setViewportSize({ width: 320, height: 844 });
  await installFixtures(page, true);
  await page.goto("/");
  await assertWithinViewport(page, minimizeSupport(page));
  await assertWithinViewport(page, fallbackLink(page));
  await minimizeSupport(page).click();
  await expect(fallbackLink(page)).toHaveCount(0);
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await signIn(page, "coach");
  await expect(restoreSupport(page)).toBeVisible();
  await expect(footerSupport(page)).toHaveAttribute("href", "https://buymeacoffee.com/erudoza");
  await restoreSupport(page).click();
  await expect(fallbackLink(page)).toBeVisible(); await expect(minimizeSupport(page)).toBeFocused();
});

test("support minimization synchronizes tabs and safely closes an open popup", async ({ page, context }) => {
  await installFixtures(page); await page.goto("/");
  const other = await context.newPage();
  await installFixtures(other); await other.goto("/");
  await launcher(other).click(); await expect(other.locator("#root")).toHaveJSProperty("inert", true);
  await minimizeSupport(page).click();
  await expect(launcher(other)).toBeHidden(); await expect(other.locator("#bmc-iframe")).toBeHidden();
  await expect(other.locator("#root")).toHaveJSProperty("inert", false);
  await expect(footerSupport(other)).toBeFocused();
  await restoreSupport(other).click();
  await expect(launcher(page)).toBeVisible(); await expect(launcher(other)).toBeVisible();
  await minimizeSupport(page).click();
  await other.evaluate(() => localStorage.clear());
  await expect(launcher(page)).toBeVisible();
  await other.close();
});
