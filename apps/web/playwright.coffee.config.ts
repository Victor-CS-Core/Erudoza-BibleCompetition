import { defineConfig, devices } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const vite = path.join(path.dirname(require.resolve("vite/package.json")), "bin/vite.js");
const webUrl = "http://127.0.0.1:5195";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "native-coffee-widget.spec.ts",
  outputDir: `./test-results/coffee-widget/${process.env.COFFEE_WIDGET_SCRIPT_FILE ? "vendor" : "contract"}`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  timeout: 30_000,
  use: { baseURL: webUrl, trace: "retain-on-failure", reducedMotion: "reduce" },
  webServer: {
    command: `"${process.execPath}" "${vite}" ${process.env.COFFEE_WIDGET_PREVIEW ? "preview" : ""} --config vite.native.config.ts --host 127.0.0.1 --port 5195 --strictPort`,
    cwd: import.meta.dirname,
    url: webUrl,
    reuseExistingServer: false,
    timeout: 90_000,
    env: { VITE_BUY_ME_A_COFFEE_URL: "https://buymeacoffee.com/erudoza", VITE_API_BASE_URL: "" },
  },
  projects: [
    { name: "coffee-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "coffee-firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "coffee-webkit", use: { ...devices["Desktop Safari"] } },
    { name: "coffee-iphone", use: { ...devices["iPhone 13"] }, grep: /popup, coach and student fit 390px|support opens|installation help.*390px|home-screen app mode/ },
  ],
});
