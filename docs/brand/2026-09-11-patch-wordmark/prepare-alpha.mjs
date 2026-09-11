// Run from the repository root: node docs/brand/2026-09-11-patch-wordmark/prepare-alpha.mjs
// Local background removal explicitly approved by the user on September 11, 2026.
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const directory = new URL('./', import.meta.url);
const source = await readFile(new URL('erudoza-wordmark-concept.png', directory));
const hash = value => createHash('sha256').update(value).digest('hex');
assert.equal(hash(source), '94483a6e88593a589fb43493ed487c0055d1c2eb4f27b048ab8b036109ace893');
const { data, info: { width, height } } = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const count = width * height, seen = new Uint8Array(count), background = new Uint8Array(count), queue = new Int32Array(count);
const neighbors = index => {
  const x = index % width, y = Math.floor(index / width);
  return [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1];
};
const isPaper = index => {
  const rgb = [data[index * 3], data[index * 3 + 1], data[index * 3 + 2]];
  return Math.min(...rgb) > 210 && Math.max(...rgb) - Math.min(...rgb) < 18;
};
const removedRegions = [];
// Only the eight substantial paper regions are removed. Small ivory-thread
// highlights remain opaque; no general white-to-alpha threshold touches them.
for (let start = 0; start < count; start++) {
  if (seen[start] || !isPaper(start)) continue;
  let head = 0, tail = 1; queue[0] = start; seen[start] = 1;
  while (head < tail) {
    for (const next of neighbors(queue[head++])) {
      if (next >= 0 && !seen[next] && isPaper(next)) { seen[next] = 1; queue[tail++] = next; }
    }
  }
  if (tail >= 1500) {
    for (let index = 0; index < tail; index++) background[queue[index]] = 1;
    removedRegions.push({ seed: [start % width, Math.floor(start / width)], area: tail });
  }
}
assert.equal(removedRegions.length, 8, 'Approved source has eight paper regions');

// Remove isolated background noise; retain every connected stitched shape.
seen.fill(0);
for (let start = 0; start < count; start++) {
  if (seen[start] || background[start]) continue;
  let head = 0, tail = 1; queue[0] = start; seen[start] = 1;
  while (head < tail) for (const next of neighbors(queue[head++])) {
    if (next >= 0 && !seen[next] && !background[next]) { seen[next] = 1; queue[tail++] = next; }
  }
  if (tail < 40) for (let index = 0; index < tail; index++) background[queue[index]] = 1;
}

// Resolve only the three-pixel antialiased border against nearby opaque thread.
// Interior RGB bytes are untouched. This removes the white matte fringe on navy.
const distance = new Uint8Array(count); distance.fill(255);
let head = 0, tail = 0;
for (let index = 0; index < count; index++) if (background[index]) { distance[index] = 0; queue[tail++] = index; }
while (head < tail) {
  const index = queue[head++]; if (distance[index] >= 4) continue;
  for (const next of neighbors(index)) if (next >= 0 && distance[next] > distance[index] + 1) {
    distance[next] = distance[index] + 1; queue[tail++] = next;
  }
}
const rgba = Buffer.alloc(count * 4); let opaqueInterior = 0, edgePixels = 0;
for (let index = 0; index < count; index++) {
  if (background[index]) continue;
  const rgb = [data[index * 3], data[index * 3 + 1], data[index * 3 + 2]];
  let alpha = 1;
  if (distance[index] < 4) {
    const x = index % width, y = Math.floor(index / width); let best = Infinity, reference = -1;
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      const nx = x + dx, ny = y + dy, other = ny * width + nx, separation = dx * dx + dy * dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && distance[other] >= 4 && separation < best) { best = separation; reference = other; }
    }
    if (reference >= 0) {
      let numerator = 0, denominator = 0;
      for (let channel = 0; channel < 3; channel++) { const delta = 255 - data[reference * 3 + channel]; numerator += (255 - rgb[channel]) * delta; denominator += delta * delta; }
      alpha = Math.min(1, Math.max(0, numerator / Math.max(1, denominator)));
    }
    edgePixels++;
  } else opaqueInterior++;
  for (let channel = 0; channel < 3; channel++) rgba[index * 4 + channel] = Math.round(Math.min(255, Math.max(0, (rgb[channel] - 255 * (1 - alpha)) / Math.max(alpha, .001))));
  rgba[index * 4 + 3] = Math.round(alpha * 255);
}
let left = width, top = height, right = 0, bottom = 0;
for (let index = 0; index < count; index++) if (rgba[index * 4 + 3]) {
  left = Math.min(left, index % width); right = Math.max(right, index % width); top = Math.min(top, Math.floor(index / width)); bottom = Math.max(bottom, Math.floor(index / width));
}
const padding = 8;
const crop = { left: left - padding, top: top - padding, width: right - left + 1 + padding * 2, height: bottom - top + 1 + padding * 2 };
const master = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
await writeFile(new URL('erudoza-wordmark-alpha-v1.png', directory), master);
const files = [{ file: 'erudoza-wordmark-alpha-v1.png', bytes: master.length, width, height, sha256: hash(master), hasAlpha: true }];
for (const size of [320, 640]) {
  const path = new URL(`../../../apps/web/public/brand/erudoza-wordmark-${size}.webp`, directory);
  const encoded = await sharp(master).extract(crop).resize({ width: size }).webp({ quality: 92, alphaQuality: 100, effort: 6 }).toBuffer();
  const metadata = await sharp(encoded).metadata(); assert.equal(metadata.hasAlpha, true);
  await writeFile(path, encoded);
  files.push({ file: `apps/web/public/brand/erudoza-wordmark-${size}.webp`, bytes: encoded.length, width: metadata.width, height: metadata.height, sha256: hash(encoded), hasAlpha: metadata.hasAlpha });
}
const report = { method: 'Local connected-paper extraction and edge dematting; original interior RGB preserved', sourceSha256: hash(source), removedRegions, opaqueInterior, edgePixels, crop, files };
await writeFile(new URL('alpha-manifest.json', directory), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
