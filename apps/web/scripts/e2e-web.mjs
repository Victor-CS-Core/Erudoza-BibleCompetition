import process from "node:process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { sites } from "@openai/sites-vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
const root = path.resolve(import.meta.dirname, "..");
const pidPrefix = process.env.ERUDOZA_E2E_PID_PREFIX;
if (!pidPrefix) throw new Error("Launch through Playwright to track owned fixture processes.");
mkdirSync(path.dirname(pidPrefix), { recursive: true });
writeFileSync(`${pidPrefix}.web.json`, JSON.stringify([process.pid]));
const dir = mkdtempSync(path.join(tmpdir(), "erudoza-e2e-worker-"));
const configPath = path.join(dir, "wrangler.json");
// Resolve secrets beside a fresh configuration, never beside the user's .dev.vars.
writeFileSync(configPath, JSON.stringify({ name: "erudoza-e2e", compatibility_date: "2026-05-22", main: path.join(root, "worker/index.ts"), assets: { not_found_handling: "single-page-application", run_worker_first: ["/api/*"] }, vars: { ERUDOZA_API_BASE_URL: "http://127.0.0.1:5083" } }));
const server = await createServer({ root, configFile: false,
  plugins: [react(), tailwindcss(), sites(), cloudflare({ configPath, persistState: false, inspectorPort: false })],
  resolve: { alias: { "@": path.join(root, "src") } },
  server: { host: "127.0.0.1", port: 5183, strictPort: true },
});
await server.listen();
server.printUrls();
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await server.close(); process.exit(0); });
