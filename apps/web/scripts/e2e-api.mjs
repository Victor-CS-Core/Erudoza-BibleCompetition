// Every invocation owns its database and build output. Never reuse development servers/data.
import process from "node:process";
import console from "node:console";
import { mkdtempSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
if (!process.env.ERUDOZA_E2E_PASSWORD) throw new Error("Launch through Playwright to generate isolated credentials.");
const pidPrefix = process.env.ERUDOZA_E2E_PID_PREFIX;
if (!pidPrefix) throw new Error("Launch through Playwright to track owned fixture processes.");
mkdirSync(path.dirname(pidPrefix), { recursive: true });
writeFileSync(`${pidPrefix}.api.json`, JSON.stringify([process.pid]));
const run = mkdtempSync(path.join(tmpdir(), "erudoza-e2e-"));
const project = path.resolve(import.meta.dirname, "../../api/src/Erudoza.Api/Erudoza.Api.csproj");
copyFileSync(path.resolve(import.meta.dirname, "../../../global.json"), path.join(run, "global.json"));
const artifacts = path.join(run, "artifacts");
// Keep compilation inside this fixture, with no shared build servers or parallel child nodes.
const build = spawnSync("dotnet", ["build", project, "--artifacts-path", artifacts, "--disable-build-servers", "-m:1", "/p:UseSharedCompilation=false"], { cwd: run, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);
const application=path.join(artifacts, "bin/Erudoza.Api/debug/Erudoza.Api.dll");
const environment={ ...process.env,
    Logging__LogLevel__Default: "Warning", Logging__LogLevel__Microsoft: "Warning", ASPNETCORE_ENVIRONMENT: "Development", ASPNETCORE_URLS: "http://127.0.0.1:5083",
    DataProtection__KeyPath: path.join(run, "keys"), Logging__EventLog__LogLevel__Default: "None",
    Database__Provider: "Sqlite", Database__ConnectionString: `Data Source=${path.join(run, "e2e.db")}`,
    Database__ApplySchema: "true", Seed__Enabled: "true", Seed__AdminPassword: process.env.ERUDOZA_E2E_PASSWORD, Seed__StudentPassword: process.env.ERUDOZA_E2E_PASSWORD, RateLimiting__LoginPermitLimit: "1000", ExposeDebugAnswers: "false", PUBLIC_ORIGIN: "http://127.0.0.1:5183",
  };
for(const operation of ['--migrate-only','--install-nkjv-library']){
  const setup=spawnSync('dotnet',[application,operation],{cwd:path.dirname(project),stdio:'inherit',env:{...environment,Seed__Enabled:'false',Library__ManifestPath:path.resolve(import.meta.dirname,'../../../content/nkjv/library-manifest.json')}});
  if(setup.status!==0)process.exit(setup.status??1);
}
const server = spawn("dotnet", [application], {cwd:path.dirname(project),stdio:"inherit",env:environment});
writeFileSync(`${pidPrefix}.api.json`, JSON.stringify([server.pid, process.pid].filter(Number.isSafeInteger)));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", code => process.exit(code ?? 1));
console.log(`Isolated E2E database and artifacts: ${run}`);
