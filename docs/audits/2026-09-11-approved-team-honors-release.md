# Approved Team Honor asset release — September 11

The user approved all five designs, explicitly authorized local background removal, and instructed commit, push and production deployment. This release includes the already-reviewed daily training, public/account artwork, mobile navigation, Team Practice and mastery profile implementation, plus the final approved Team Honor patches.

## Final asset preparation

- Preserved five original masters and five archived review images exactly; source hashes are in the brand package.
- Retained original alpha for First Fellowship and Rehearsal Complete. Removed the border-connected checkerboard from Team Steady, Shared Scribe and Team Precision, with two-pixel edge dematting and unchanged opaque embroidery RGB.
- Created ten responsive 256/512px WebPs, 763,268 bytes total, with true alpha. Original framing is preserved. All five were inspected against navy, ivory and white surfaces.
- The shared component now serves the approved WebPs in the Honors collection, profile picker, named-user avatars and legacy milestone display. Shared pointer lift/dip/shadows and accessibility behavior apply; mastery criteria and eligibility are unchanged.

## Local verification

- 28 focused frontend tests, web TypeScript, scoped ESLint and whitespace checks passed for the two consumer changes. Final native and canonical production builds passed, including both TypeScript targets. Existing chunk-size and punycode deprecation advisories remain.
- Independent asset review verified original/review hashes, all ten output hashes/dimensions/alpha corners, and exact RGB preservation for every fully opaque pixel in the three prepared PNGs. No actionable source finding remained.
- Production dry run passed with the existing D1, three Durable Objects, rate limits, sender, public origin and Turnstile configuration.
- Final profile browser run passed27views at1440/390/320, three identity/reset flows and three motion checks at22:03:08UTC, with no page overflow or JavaScript errors. The dedicated patch browser run passed ten served/local hashes, six responsive Honors/profile views and15motion cases at22:04:25UTC, with transparent corners, shadows and no overflow/image/page errors. Representative final screenshots were inspected. An initial harness-only CSS parser rejected Chrome’s normalized `0px` translation; the corrected full run passed without an app change, and the initial failed report remains ignored. Earlier complete gameplay/backend evidence is in [the implementation audit](2026-09-11-team-practice-and-mastery-profiles.md): 579 frontend/native tests passed with one optional skip, 267 .NET tests passed with one optional load skip, 13 exporter tests passed, native2/2 and canonical4/4 full-match browser cases passed. Those larger suites were not repeated for this artwork-only delta.

## Release preparation and limits

A private D1 export was saved under ignored `.local/deployment/honors-release-20260911`; its24,765,575 bytes hash to `7708ca613020146fa46d78d815ca8c0f665685cf08cdbb55b27f8f3c2dcafc74`. Isolated SQLite import/integrity validation passed. No backup data, credentials or generated browser artifacts are checked in.

Read-only preflight found Worker `1e9d199c-3562-4706-897d-daf92e46e05f` at100%, exactly additive native migration0004 pending, no uniqueness conflicts and zero projected rooms. Version/migration/room state must be refreshed immediately before rollout. Projection is asynchronous. Main maintenance source through `b291af4` is included; existing configuration/auth source has no drift.

The prepared anonymous production smoke uses bounded GETs, DNS and TLS checks for public pages, private API rejection, redirects and exact published entry/art hashes. Authenticated production smoke is not available: automatic approval review rejected creation of a script that would read the private admin credential file because that conflicted with the preflight's no-credential-read constraint. No retry or credential read occurred. Local authenticated Coach/student/profile/gameplay verification remains separate evidence.

No synthetic hosted accounts, matches, content, messages or email are part of this release. The existing regional20-room/200-player capacity gate remains open. Deployment execution and live results are recorded below.

## Production result

- Committed and pushed the24-file approved asset/integration gate as `838a066` to the existing private `codex/honors-public` branch before deployment. No merge was performed.
- Applied only `0004_training_progression.sql`; subsequent remote migration listing reports none pending.
- Deployed `erudoza-native` to https://erudoza.com with `wrangler.production.jsonc`. Worker `257f14ee-6d2d-4896-9319-de0f4fc283f2` receives100%traffic; deployment54feb062-2ac5-4131-8da1-ff62bac50a03was created22:08:10UTC. The Worker and native frontend were deployed together.
- Live smoke passed22:08:47UTC: database/APIhealthy, anonymousprivateAPIguards, publiclanding/login/signup, DNS/TLS/wwwredirects, exact entryJS/CSS and all ten approvedWebPhashes. Native entryJS SHA256:`2176796a05640df8353002ddee3718d43076e59cc4a4e1d4a0d8c84010e87251`. Full bounded GET evidence remains in ignored release storage.
- Authenticated production workflows and regional capacity were not tested in this final live smoke. These limits do not change the separately documented local authenticated/browser/full-match results. No production accounts, content, matches, messages or emails were created for verification.
