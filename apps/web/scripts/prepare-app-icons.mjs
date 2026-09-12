// Package the existing approved emblem for OS icon slots; no new artwork.
import { URL } from "node:url";
import sharp from "sharp";
import { readFile, mkdir } from "node:fs/promises";
const source = new URL("../../../docs/brand/2026-09-11-original-assets/masters/pathfinder-v2/erudoza-logo-patch-v2.png", import.meta.url);
const tokens = await readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const background = tokens.match(/--er-paper:\s*(#[0-9a-f]{6})/i)?.[1];
if (!background) throw new Error("Missing paper token");
const out = new URL("../public/icons/", import.meta.url);
await mkdir(out, { recursive: true });
for (const [size, name] of [[180, "apple-touch-icon"], [192, "erudoza-192"], [512, "erudoza-512"]]) {
  // The full emblem fits in the central safe area when Android masks its icon.
  const inset = Math.ceil(size * 0.16);
  await sharp(await readFile(source)).resize(size - inset * 2, size - inset * 2, { fit: "contain", background })
    .flatten({ background }).extend({ top: inset, bottom: inset, left: inset, right: inset, background })
    .png().toFile(new URL(`${name}.png`, out).pathname);
}
