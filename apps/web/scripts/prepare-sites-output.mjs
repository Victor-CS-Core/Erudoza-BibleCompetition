import { access, cp, readdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

function isLocalConfiguration(name) {
  return /^(?:\.env|\.dev\.vars)(?:\.|$)/i.test(name);
}

async function removeLocalConfiguration(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (isLocalConfiguration(entry.name)) {
      await rm(path, { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      await removeLocalConfiguration(path);
    }
  }
}

export async function prepareSitesOutput(outputDirectory) {
  const cloudflareWorkerDirectory = join(outputDirectory, "erudoza_bible_competition");
  const sitesServerDirectory = join(outputDirectory, "server");
  await access(join(cloudflareWorkerDirectory, "index.js"));
  await access(join(outputDirectory, "client/index.html"));
  await access(join(outputDirectory, ".openai/hosting.json"));

  await rm(sitesServerDirectory, { recursive: true, force: true });
  await cp(cloudflareWorkerDirectory, sitesServerDirectory, {
    recursive: true,
    filter: (source) => !isLocalConfiguration(basename(source)),
  });
  await rm(cloudflareWorkerDirectory, { recursive: true, force: true });
  // Vite may also copy files from public/. No local env file belongs in either artifact.
  await removeLocalConfiguration(outputDirectory);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await prepareSitesOutput(fileURLToPath(new URL("../dist", import.meta.url)));
}
