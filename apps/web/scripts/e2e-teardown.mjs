import process from "node:process";
import { readFile, unlink } from "node:fs/promises";

// Stop only PIDs recorded by this invocation, before Playwright waits for its shell wrappers.
export default async function teardown() {
  const prefix = process.env.ERUDOZA_E2E_PID_PREFIX;
  if (!prefix) return;
  for (const fixture of ["web", "api"]) {
    const file = `${prefix}.${fixture}.json`;
    let pids;
    try { pids = JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    for (const pid of pids) {
      if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw new Error("Invalid owned fixture PID.");
      try { process.kill(pid, "SIGTERM"); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    await unlink(file);
  }
}
