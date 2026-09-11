// @vitest-environment node
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
// Build scripts are intentionally plain JavaScript, run directly by Node.
// @ts-expect-error No declaration file for the standalone build script.
import { prepareSitesOutput } from "./prepare-sites-output.mjs";

it("packages the Sites worker while excluding local environment files from all output", async () => {
  const output = await mkdtemp(join(tmpdir(), "erudoza-sites-package-"));
  try {
    const fixtures = {
      "erudoza_bible_competition/index.js": "export default {};",
      "erudoza_bible_competition/.dev.vars": "SECRET=private",
      "erudoza_bible_competition/.dev.vars.production": "SECRET=private",
      "erudoza_bible_competition/nested/.env.local": "SECRET=private",
      "erudoza_bible_competition/nested/.ENV": "SECRET=private",
      "erudoza_bible_competition/wrangler.json": "{}",
      "client/index.html": "<html></html>",
      "client/.env.production": "SECRET=private",
      ".openai/hosting.json": "{}",
    };
    for (const [relative, content] of Object.entries(fixtures)) {
      const path = join(output, relative);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, content);
    }
    await prepareSitesOutput(output);
    expect(await readFile(join(output, "server/index.js"), "utf8")).toBe("export default {};");
    expect(await readFile(join(output, "client/index.html"), "utf8")).toBe("<html></html>");
    expect(await readFile(join(output, ".openai/hosting.json"), "utf8")).toBe("{}");
    const entries = await readdir(output, { recursive: true });
    expect(entries.some((entry) => /(?:^|[\\/])\.(?:env|dev\.vars)(?:\.|$)/i.test(entry))).toBe(false);
    expect(entries).not.toContain("erudoza_bible_competition");
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
