import { defineConfig, devices } from "@playwright/test";

const apiUrl = "http://127.0.0.1:5080";
const webUrl = "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: webUrl,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command:
        "dotnet run --project ../../apps/api/src/Erudoza.Api/Erudoza.Api.csproj --urls http://127.0.0.1:5080",
      url: `${apiUrl}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ASPNETCORE_ENVIRONMENT: "Development",
        Database__Provider: "Sqlite",
        Database__ConnectionString: "Data Source=erudoza.e2e.db",
        Database__ApplySchema: "true",
        Seed__Enabled: "true",
        ExposeDebugAnswers: "true",
        PUBLIC_ORIGIN: webUrl,
      },
    },
    {
      command:
        "printf 'ERUDOZA_API_BASE_URL=http://127.0.0.1:5080\\n' > .dev.vars && npm run dev -- --host 127.0.0.1 --port 5173",
      url: webUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
