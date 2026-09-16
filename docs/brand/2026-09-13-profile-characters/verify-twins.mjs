#!/usr/bin/env node
/**
 * Twin-drift guard: the production character modules under
 * apps/web/src/features/profile/character/ must stay logically identical to
 * their design-review twins under docs/brand/2026-09-13-profile-characters/.
 *
 * Rendering logic is intentionally duplicated so the sandbox can iterate
 * without the app's build; only environment plumbing may differ. Each pair
 * below lists the KNOWN plumbing differences as normalization rules. The
 * script canonicalizes both copies and diffs them: any unexpected difference
 * fails loudly instead of silently drifting.
 *
 * When you change shared rendering logic, change BOTH copies. When you add an
 * intentional environment-only difference, add a normalization rule here with
 * a comment explaining why it is safe.
 */
import {readFileSync, writeFileSync, mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const repoRoot = new URL('../../..', import.meta.url).pathname;
const docsDir = join(repoRoot, 'docs/brand/2026-09-13-profile-characters');
const appsDir = join(repoRoot, 'apps/web/src/features/profile/character');

/** Strip `type` qualifiers on import lines: `import {a,type B}` vs `import {a,B}`. */
const stripImportTypes = (text) =>
  text.replace(/^import .*$/gm, (line) => line.replaceAll('type ', ''));

/** @type {Array<{docs: string, apps: string, rules: Array<{side: 'both'|'docs'|'apps', pattern: RegExp, replacement: string}>}>} */
const pairs = [
  {
    docs: 'appearance.ts', apps: 'appearance.ts',
    rules: [
      // Production serves shipped assets from /brand/characters/v1/; the
      // sandbox uses paths relative to the review root.
      {side: 'apps', pattern: /\/brand\/characters\/v1\//g, replacement: ''},
    ],
  },
  {
    docs: 'hair.ts', apps: 'hair.ts',
    rules: [
      // Only the import type-qualifier style differs; handled below.
    ],
  },
  {
    docs: 'composition.ts', apps: 'composition.ts',
    rules: [
      // Sandbox uses inline sample Honor data; production uses the
      // characterAsset()/honorImageSrc() allowlist from ./assets.
      {side: 'docs', pattern: /export const honors = \[[\s\S]*?\] as const;/, replacement: '/* __HONOR_SOURCE__ */'},
      {side: 'apps', pattern: /import \{characterAsset,honorImageSrc\} from '\.\/assets';\nimport \{CharacterAppearance\} from '\.\.\/\.\.\/\.\.\/\.\.\/shared\/profileCharacter';/, replacement: '/* __HONOR_SOURCE__ */'},
      {side: 'docs', pattern: /const h=honors\.find\(h=>h\.key===key\); return h \? loadImage\(h\.src\) : Promise\.resolve\(null\);/, replacement: 'const src=__honorSrc(key); return src ? loadImage(src) : Promise.resolve(null);'},
      {side: 'apps', pattern: /const src=key\?honorImageSrc\(key\):undefined; return src \? loadImage\(src\) : Promise\.resolve\(null\);/, replacement: 'const src=__honorSrc(key); return src ? loadImage(src) : Promise.resolve(null);'},
      {side: 'docs', pattern: /if \(value && !honors\.some\(h=>h\.key===value\)\) throw new Error\('Unknown review Honor'\);/, replacement: `if (value && !__honorSrc(value)) throw new Error('__HONOR_ERROR__');`},
      {side: 'apps', pattern: /if \(value && !honorImageSrc\(value\)\) throw new Error\('Unknown Honor'\);/, replacement: `if (value && !__honorSrc(value)) throw new Error('__HONOR_ERROR__');`},
      // Sandbox vs production load-failure copy.
      {side: 'docs', pattern: /'Unable to load artwork\. Please reload this review\.'/g, replacement: `'__LOAD_ERROR__'`},
      {side: 'apps', pattern: /'Unable to load character artwork\. Please try again\.'/g, replacement: `'__LOAD_ERROR__'`},
      // Production evicts the oldest cached image past 80 entries; the
      // sandbox keeps every image for the session. Memory policy, not rendering.
      {side: 'apps', pattern: /\n\s*if\(images\.size>80\)images\.delete\(images\.keys\(\)\.next\(\)\.value!\);/, replacement: ''},
      // characterAsset() only prefixes the shipped base path (see appearance).
      {side: 'apps', pattern: /loadImage\(characterAsset\(`([^`]+)`\)\)/g, replacement: 'loadImage(`$1`)'},
      // Production narrows the portrait config to the shared CharacterAppearance
      // subset (bodyType/style/hairColor/skin/eyes); the sandbox passes the full
      // local Configuration. Same fields the painter reads.
      {side: 'apps', pattern: /config:CharacterAppearance/g, replacement: 'config:Configuration'},
    ],
  },
  {
    docs: 'share.ts', apps: 'share.ts',
    rules: [
      // Sandbox reaches into the app tree for the shared Me type.
      {side: 'docs', pattern: /apps\/web\/src\//g, replacement: ''},
    ],
  },
  {
    docs: 'ShareEditor.tsx', apps: 'ShareEditor.tsx',
    rules: [
      // Sandbox reaches into the app tree for shared UI primitives and types.
      {side: 'docs', pattern: /apps\/web\/src\//g, replacement: ''},
      // Sandbox copy for the design preview vs production copy (JSX text, no quotes).
      {side: 'docs', pattern: /Sample unlocks for this design preview\./g, replacement: `__UNLOCK_COPY__`},
      {side: 'apps', pattern: /Only patches you have earned can decorate your card\./g, replacement: `__UNLOCK_COPY__`},
      {side: 'docs', pattern: /Download review image/g, replacement: `__DOWNLOAD_LABEL__`},
      {side: 'apps', pattern: /Download image/g, replacement: `__DOWNLOAD_LABEL__`},
      {side: 'docs', pattern: /`erudoza-\$\{config\.style\}-sash-review\.png`/g, replacement: '`__DOWNLOAD_NAME__`'},
      {side: 'apps', pattern: /`erudoza-\$\{config\.style\}\.png`/g, replacement: '`__DOWNLOAD_NAME__`'},
    ],
  },
  {
    docs: 'animate.ts', apps: 'animate.ts',
    rules: [
      // No environment plumbing: asset paths, Honor sources, and user-facing
      // copy all live in composition.ts, which this module only calls.
    ],
  },
];

let failures = 0;
for (const pair of pairs) {
  const docsPath = join(docsDir, pair.docs);
  const appsPath = join(appsDir, pair.apps);
  let docsText, appsText;
  try {
    docsText = readFileSync(docsPath, 'utf8');
    appsText = readFileSync(appsPath, 'utf8');
  } catch (e) {
    console.error(`twins: missing file for ${pair.docs}: ${e.message}`);
    failures++;
    continue;
  }
  const apply = (text, side) => {
    let out = stripImportTypes(text);
    for (const rule of pair.rules) {
      if (rule.side === 'both' || rule.side === side) out = out.replace(rule.pattern, rule.replacement);
    }
    return out;
  };
  const docsNorm = apply(docsText, 'docs');
  const appsNorm = apply(appsText, 'apps');
  if (docsNorm === appsNorm) {
    console.log(`twins: ${pair.docs} matches`);
    continue;
  }
  const dir = mkdtempSync(join(tmpdir(), 'twins-'));
  const a = join(dir, 'docs'), b = join(dir, 'apps');
  writeFileSync(a, docsNorm);
  writeFileSync(b, appsNorm);
  let diff;
  try {
    execFileSync('diff', ['-u', a, b], {encoding: 'utf8'});
    diff = '(no diff output?)';
  } catch (e) {
    diff = e.stdout;
  }
  console.error(`twins: DRIFT in ${pair.docs} beyond known plumbing differences:\n${diff}`);
  failures++;
}

if (failures) {
  console.error(`twins: ${failures} file(s) drifted. Fix the twin that is behind, or add a normalization rule with a comment.`);
  process.exit(1);
}
console.log('twins: all 6 production/review pairs match (modulo known plumbing).');
