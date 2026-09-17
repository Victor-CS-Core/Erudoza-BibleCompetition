#!/usr/bin/env node
/**
 * Verify the shipped character manifest: every file listed in
 * apps/web/public/brand/characters/v1/manifest.json must exist with a
 * matching sha256, and every file shipped under v1/ must be listed.
 * Catches stale or forgotten assets after artwork changes.
 * With --regenerate, rewrites manifest.json from the current directory
 * contents (sorted, deterministic) instead of verifying.
 */
import {readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join, relative} from 'node:path';

const repoRoot = new URL('../../..', import.meta.url).pathname;
const v1 = join(repoRoot, 'apps/web/public/brand/characters/v1');
const manifestPath = join(v1, 'manifest.json');

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

// Pure recursive file lister (relative paths, manifest.json excluded).
const listFiles = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else {
      const rel = relative(v1, full);
      if (rel !== 'manifest.json') out.push(rel);
    }
  }
  return out;
};

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// Regeneration mode: rewrite the manifest from the current directory contents
// (sorted, deterministic) after reviewed artwork changes. Run this, then verify.
if (process.argv.includes('--regenerate')) {
  const entries = [];
  for (const rel of listFiles(v1).sort()) {
    entries.push({path: rel, sha256: sha256(join(v1, rel))});
  }
  manifest.files = entries;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`manifest: regenerated ${entries.length} entries from ${v1}.`);
  process.exit(0);
}
const listed = new Map(manifest.files.map((f) => [f.path, f.sha256]));

let failures = 0;
for (const [rel, expected] of listed) {
  const full = join(v1, rel);
  let actual;
  try {
    actual = sha256(full);
  } catch {
    console.error(`manifest: listed but missing: ${rel}`);
    failures++;
    continue;
  }
  if (actual !== expected) {
    console.error(`manifest: hash mismatch: ${rel}`);
    failures++;
  }
}

for (const rel of listFiles(v1)) {
  if (!listed.has(rel)) {
    console.error(`manifest: shipped but unlisted: ${rel}`);
    failures++;
  }
}

if (failures) {
  console.error(`manifest: ${failures} problem(s). Regenerate or fix manifest.json after artwork changes.`);
  process.exit(1);
}
console.log(`manifest: all ${listed.size} listed files present with matching sha256; no unlisted files.`);
