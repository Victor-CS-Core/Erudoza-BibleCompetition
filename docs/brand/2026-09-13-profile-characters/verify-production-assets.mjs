#!/usr/bin/env node
/**
 * Production asset smoke test: bundle the real production character modules
 * (hair/appearance/assets) and enumerate every artwork URL they can request,
 * then verify each file exists under apps/web/public/. Catches asset-path
 * and bundling regressions (e.g. a heads/ file present in the review sandbox
 * but missing from the shipped public tree, or an Honor allowlist entry with
 * no image) without needing a browser.
 */
import {readFileSync, writeFileSync, mkdtempSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const repoRoot = new URL('../../..', import.meta.url).pathname;
const charDir = join(repoRoot, 'apps/web/src/features/profile/character');
const publicDir = join(repoRoot, 'apps/web/public');
const esbuild = join(repoRoot, 'node_modules/.bin/esbuild');

// The Honor allowlist sets are module-private; extract the keys from source.
const assetsSrc = readFileSync(join(charDir, 'assets.ts'), 'utf8');
const honorKeys = [];
for (const m of assetsSrc.matchAll(/const (solo|team|simulation) = new Set\(\[([^\]]*)\]\)/g)) {
  for (const n of m[2].matchAll(/'([^']+)'/g)) honorKeys.push(`${m[1]}:${n[1]}`);
}
if (!honorKeys.length) {
  console.error('production-assets: could not extract the Honor allowlist from assets.ts');
  process.exit(1);
}

const entrySource = `
import {hairStyles, bodySources} from ${JSON.stringify(join(charDir, 'hair'))};
import {backgrounds} from ${JSON.stringify(join(charDir, 'appearance'))};
import {characterAsset, honorImageSrc} from ${JSON.stringify(join(charDir, 'assets'))};
const urls = [];
const bodies = [...new Set(Object.values(bodySources).flatMap((g) => Object.values(g)))];
for (const name of bodies) {
  urls.push(characterAsset('prepared/' + name + '.png'));
  urls.push(characterAsset('prepared/' + name + '-512.webp'));
  urls.push(characterAsset('body-layers/' + name + '.png'));
  urls.push(characterAsset('body-layers/' + name + '.webp'));
}
const stylesByBody = {male: hairStyles.male.map((s) => s.key), female: hairStyles.female.map((s) => s.key)};
for (const bt of ['male', 'female'])
  for (const st of stylesByBody[bt]) {
    urls.push(characterAsset('heads/' + bt + '-' + st + '.png'));
    urls.push(characterAsset('heads/' + bt + '-' + st + '.webp'));
    urls.push(characterAsset('heads/' + bt + '-' + st + '-mask.png'));
  }
for (const b of backgrounds) urls.push(b.src, b.thumbnail, b.fullSrc);
const honorKeys = (process.env.HONOR_KEYS || '').split(',').filter(Boolean);
const honors = {};
for (const k of honorKeys) honors[k] = honorImageSrc(k) || null;
console.log(JSON.stringify({urls, honors}));
`;

const dir = mkdtempSync(join(tmpdir(), 'prod-assets-'));
const entry = join(dir, 'entry.mjs');
const bundle = join(dir, 'bundle.cjs');
writeFileSync(entry, entrySource);
execFileSync(esbuild, [entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${bundle}`, '--log-level=error'], {stdio: 'inherit'});
const {urls, honors} = JSON.parse(
  execFileSync('node', [bundle], {encoding: 'utf8', env: {...process.env, HONOR_KEYS: honorKeys.join(',')}}),
);

let failures = 0;
const missing = [];
for (const u of urls) {
  if (!existsSync(join(publicDir, u.replace(/^\//, '')))) missing.push(u);
}
for (const m of missing) console.error(`production-assets: missing ${m}`);
failures += missing.length;
for (const [key, src] of Object.entries(honors)) {
  if (!src) {
    console.error(`production-assets: Honor key has no image: ${key}`);
    failures++;
  } else if (!existsSync(join(publicDir, src.replace(/^\//, '')))) {
    console.error(`production-assets: missing Honor art ${src} (key ${key})`);
    failures++;
  }
}

if (failures) {
  console.error(`production-assets: ${failures} problem(s) across ${urls.length} character URLs and ${honorKeys.length} Honor keys.`);
  process.exit(1);
}
console.log(`production-assets: all ${urls.length} character URLs and ${honorKeys.length} Honor images resolve under apps/web/public/.`);
