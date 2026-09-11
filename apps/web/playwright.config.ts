import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
process.env.ERUDOZA_E2E_PASSWORD ??= `E2e!${randomUUID()}`;
const runId = process.env.ERUDOZA_E2E_RUN_ID ??= randomUUID();
process.env.ERUDOZA_E2E_PID_PREFIX = resolve(`test-results/e2e-pids-${runId}`);
const apiUrl = "http://127.0.0.1:5083";
const webUrl = "http://127.0.0.1:5183";
export default defineConfig({
  testDir: "./e2e", outputDir: `./test-results/e2e-${runId}`, fullyParallel: false, forbidOnly: !!process.env.CI,
  globalTeardown: "./scripts/e2e-teardown.mjs",
  testIgnore: "**/native-*.spec.ts",
  retries: 0, workers: 1, reporter: "list", timeout: 60_000,
  use: { baseURL: webUrl, trace: "retain-on-failure" },
  webServer: [
    { command: "node ./scripts/e2e-api.mjs", url: `${apiUrl}/api/v1/health`, reuseExistingServer: false, timeout: 180_000 },
    { command: "node ./scripts/e2e-web.mjs", url: webUrl, reuseExistingServer: false, timeout: 120_000 },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],
});
