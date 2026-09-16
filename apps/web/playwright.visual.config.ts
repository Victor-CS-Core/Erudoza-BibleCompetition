import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Visual screenshot tour: builds on the self-contained Miniflare fixture
// (scripts/e2e-native.mjs) — no dotnet, no Cloudflare account. Captures key
// public, coach, and student pages at desktop and phone widths on every push
// to main so UI changes get visual evidence before production deploys.
process.env.ERUDOZA_E2E_PASSWORD ??= `E2e!${randomUUID()}`;
const runId = (process.env.ERUDOZA_VISUAL_RUN_ID ??= randomUUID());
process.env.ERUDOZA_NATIVE_RUN_ID ??= runId;
process.env.ERUDOZA_NATIVE_PID_FILE = `test-results/visual-server-${runId}.pid`;
// Seed profile unlocks so the character creator renders with Honors.
process.env.ERUDOZA_PROFILE_FIXTURE = "1";
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["visual-screenshots.spec.ts"],
  outputDir: `./test-results/visual-${runId}`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 90_000,
  use: {
    baseURL: "http://localhost:8789",
    extraHTTPHeaders: { Origin: "http://localhost:8789" },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/e2e-native.mjs",
    url: "http://127.0.0.1:8790/ready",
    reuseExistingServer: false,
    timeout: 180_000,
    env: { ...process.env },
  },
  projects: [
    { name: "desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile-390", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "mobile-320", use: { ...devices["Pixel 7"], viewport: { width: 320, height: 568 } } },
  ],
});
