import { rm } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { fileURLToPath, URL } from "node:url";

const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
const outputDirectory = fileURLToPath(new URL("../dist", import.meta.url));

if (dirname(outputDirectory) !== projectDirectory.replace(/[\\/]$/, "") || basename(outputDirectory) !== "dist") {
  throw new Error("Refusing to clean an unexpected build directory.");
}

await rm(outputDirectory, { recursive: true, force: true });
