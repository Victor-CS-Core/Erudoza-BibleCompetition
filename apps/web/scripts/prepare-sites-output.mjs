import { access, cp, rm } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

const cloudflareWorkerDirectory = fileURLToPath(
  new URL("../dist/erudoza_bible_competition", import.meta.url),
);
const sitesServerDirectory = fileURLToPath(new URL("../dist/server", import.meta.url));

await access(new URL("../dist/erudoza_bible_competition/index.js", import.meta.url));
await access(new URL("../dist/client/index.html", import.meta.url));
await access(new URL("../dist/.openai/hosting.json", import.meta.url));

await rm(sitesServerDirectory, { recursive: true, force: true });
await cp(cloudflareWorkerDirectory, sitesServerDirectory, { recursive: true });
await rm(cloudflareWorkerDirectory, { recursive: true, force: true });
