# Production character profile — September 13, 2026

## Scope and cause

All prior character work was merged, but remained a separate `docs/brand/2026-09-13-profile-characters/review.tsx` application with sample data and in-memory selections. The production `/admin/profile` and `/student/profile` routes still rendered the initials/Honor page. Redeploying that tree could not deliver the reviewed creator.

This release integrates the approved Profile, Character, Honors and Share pages with authenticated accounts. Appearance, three unique sash Honors, avatar kind and share decorations/preferences persist through native and canonical profile APIs. Real earned eligibility and coach-only Master Guide attire are enforced on both backends. Existing Honor/initials choices and the legacy avatar endpoint remain supported. The shared identity endpoint returns only the selected five-field portrait appearance for directory/header avatars.

The 63 approved runtime images are copied unchanged to `apps/web/public/brand/characters/v1/`, with a source/hash manifest. The production renderer retains the reviewed head registration, skin/hair/eye masks, sash direction and clean transparent portrait. Every current Honor category uses production artwork. The Share card uses the account username, independent visibility switches, public landing QR and an exact composed PNG. The PNG is prepared before a phone tap so native file sharing keeps user activation; download remains available.

## Local verification

Commands run from `apps/web` unless noted:

- `npm run build:native`: web/native TypeScript and production build passed. `npm run build`: canonical-hosted frontend build passed. Existing main-bundle size advisory remains.
- `npm run lint`: full ESLint passed. `git diff --check` passed. Scoped canonical formatting passed.
- `node scripts/verify-profile-assets.mjs` and `--built`: all 63 hashes match reviewed sources, and individual files are below the static-asset limit; 19.7 MiB total.
- `NODE_OPTIONS=--no-experimental-webstorage npm test -- --run src worker/native/mastery worker/native/profile-artwork.test.ts --maxWorkers=2`: 582 tests passed across 72 suites. Two subsequent eligibility/export recovery regressions were added; final focused profile/mastery/art sweep passed 42 tests across seven suites, including all 18 profile UI tests and 23 native mastery tests. The environment switch avoids Node 26's experimental storage overriding jsdom; it is not a product workaround.
- Broad native regression run: 584 passed, two optional skips, one new foreign-owner legacy-write regression failed while backend work was still underway. Its atomic ownership guard was fixed; all 23 mastery cases then passed in both backend and final root runs. No unrelated native regressions failed. This records the actual broad run and targeted recovery, rather than claiming a second complete native run.
- Canonical SDK 10.0.303 built the API and passed all 11 character/existing profile cases. A subsequent combined profile/mastery/simulation run passed 15 cases. No full canonical suite is claimed for this change.
- `npm run test:e2e -- --config playwright.profile-character.config.ts`: two comprehensive Chromium scenarios passed against an isolated real native backend. Coach and student logins, saved/reloaded appearance/attire/sash/headshot, all three loaded Honor images, zero-unlock restrictions, account isolation, stale-save conflict/recovery, transparent portrait corners, exact downloaded/reloaded PNG, touch patch dragging and 1440/390/320 layouts passed. Only unavailable OS `navigator.share/canShare` boundaries are substituted for the native-sharing case; the PNG, user gesture, assets and persistence are real. Desktop/phone captures were visually inspected.
- Test-harness corrections during acceptance: production Honor titles use `Chapter Strong`, and direct CDP touch coordinates must center the patch clear of the fixed phone navigation. Image capture explicitly awaits decoding. These did not require product workarounds.

## Review

Independent review checked backend ownership/revision transactions, legacy endpoint interoperability, account cache cancellation, appearance rendering and canvas/file sequencing. Its one actionable issue was fixed and re-reviewed: if a refresh makes a draft's sash Honor or coach attire unavailable, ShareEditor now unmounts until the user removes unavailable choices. Other edits remain intact. Two regressions reproduced the issue before the fix. No remaining actionable findings.

Other integration regressions cover stale reads arriving during a successful save, failed saves retaining drafts, and account switching. The browser fixture seeds three synthetic unlock records only in an isolated test database; no demo unlocks or sample username enter production.

## Release preflight and limits

Current live source before release is `8c66eb0` and Worker `be956cce-2486-4ca9-b670-1db63d80a534`. Fresh main remains `7e3e0e0`, the task base. No D1 migrations are pending. A restricted, ignored D1 export (24,857,019 bytes) restored in memory with `integrity_check=ok`, 13 tables. This covers D1, not a full Durable Object backup. No schema, feature-flag, binding or secret changes are part of this release.

Physical iPhone/AirDrop or Android recipient delivery is not claimed. Full authenticated acceptance uses isolated local accounts, not production users. Git checkpoint and live deployment are recorded separately below once verified.

## Merged and live

Implementation `7a86a93c79175acc38f8fa30a2273ea57ea2d0f1` was normally pushed to `codex/profile-production`, fast-forwarded into clean main, and normally pushed. Both remote refs were read back at that exact SHA. The merged application tree is the final tested tree; no conflict resolution or additional product edits were required.

Cloudflare deployed that source at `2026-09-13T14:59:27.301Z`. Worker `ac023f3b-b307-46fb-92a6-caae10e8840c` serves 100% at `https://erudoza.com`. All 16 binding metadata entries and runtime configuration match the previous version. No schema, flag or secret changes occurred.

Live verification at `14:59:52 UTC` passed all 75 local/served SHA256 comparisons: HTML, every top-level JS/CSS bundle, the character manifest and all 63 character images. Public `/`, `/login`, `/admin/profile` and `/student/profile` returned 200. Health reports `database=true`; anonymous self/profile reads and the new character PUT return 401. The authenticated production browser then rendered all four profile sections, the actual account defaults/locked collection, six hairstyle previews, background/appearance options and a ready Share card. This was read-only: no production appearance, Honor or share choices were saved, downloaded or sent. The live Profile page is left open for review.

Final responsive refinement preserved whole labels at 320px, then the native build, both real native browser scenarios and production dry run passed again. A focused image capture confirmed the third Honor's actual browser paint before the full-page capture. Local tests cover writes and phone API behavior; physical device recipient delivery and hosted CI success remain unclaimed. Restricted backup/deployment outputs and browser artifacts stay ignored; this audit contains no account data.
