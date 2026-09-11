# Erudoza progress log

Read this file before starting repository work. `AGENTS.md` defines the required update and commit/push workflow. Times below are UTC. This log is the shared handoff; detailed audits remain the evidence for individual checks.

## Current state — 2026-09-11

- Task branch: `codex/cloudflare-free-port`. Repository: `Victor-CS-Core/Erudoza-BibleCompetition`.
- The production pilot is live at **https://erudoza.com** on Cloudflare Free, with deterministic study, the built-in 66-book NKJV library, and private Team Practice functionality.
- Current Worker version **`c254f500-b7ad-4135-b10d-2ac4e43558b7`** includes the shared contrast fix, with the existing `PUBLIC_ORIGIN=https://erudoza.com` and managed apex custom-domain binding. The original cutover version was `4958cd54-65b8-4060-9f68-ca59bdb22a6a`: its administrator/library, HTTPS/redirect, and WebSocket rejection-guard checks passed through 14:56:46 UTC. Current live HTML/JS/CSS match the validated native build and API health passed at 15:09:57 UTC.
- Cloudflare DNS is **Active** on Free Website. Registration remains at GoDaddy; public resolution confirms `elsa.ns.cloudflare.com` and `yevgen.ns.cloudflare.com`. The 26-record pre-cutover backup remains intact. Only the two approved legacy apex A records were removed before managed binding; the other 24 imported records were retained at that step, and www was subsequently changed to its approved target.
- www is a **Proxied, Automatic-TTL CNAME to `erudoza.com`**. Active Single Redirect `269651cea73a457786211151fda5c516` sends the exact www host to HTTPS apex with status 301, preserving path and query. Public apex/www answers observed at 14:44 UTC were `104.21.66.111` and `172.67.159.115`; these are observed edge addresses, not manually configured origin records.
- Cloudflare **Always Use HTTPS** is enabled and verified. Three bounded anonymous GETs confirmed HTTP apex → HTTPS apex 301, HTTP www → HTTPS apex 301, identical path/query preservation, and final HTTPS `/login` 200 without a redirect loop.
- The workers.dev URL is the same Worker, not a concurrent staging environment. Its old browser origin is now rejected for writes and WebSocket upgrades by the production origin policy. `wrangler.staging.jsonc` is a rollback configuration.
- Hosted application data contains only the admin account/academy plus the immutable shared NKJV library. Synthetic study/PVP fixtures were removed. Credentials and backup files are private ignored artifacts under `.local/`; do not copy their contents into source control or this log.
- The fresh academy has Team Practice disabled by default (`practiceEnabled=false`). A coach can enable it through **Enable Team Practice** in the UI and prepare the academy's question bank. No new room fixture or successful post-domain WebSocket 101 connection was created for the production guard checks; earlier live staging and local full-match evidence remains the gameplay proof.
- The private administrator credential record now points to the apex URL; its password was not changed by cutover.
- The integrated implementation/UX checkpoint `912ba0a` (`feat: checkpoint team practice and Cloudflare migration`) and follow-up handoff `47732ba` (`docs: record validated checkpoint and approval blockers`) are now pushed to the approved private `origin/codex/cloudflare-free-port`. The successful push advanced the remote from `af237aa` to `47732ba`; the earlier source-upload approval blocker is resolved.
- Production documentation checkpoint `12709c3` (`docs: record verified Cloudflare production cutover`) is committed and pushed. `git ls-remote` confirmed `12709c37a62f78bd76f4e37a76447f879f80adc1` on the approved private task branch.
- The gray-text/green-background fix is implemented, locally verified, deployed, and pushed as **`fd89248`** (`fix: preserve button text contrast across states`). The push advanced `12709c3..fd89248` on the approved private task branch. Shared button variants now change foreground/background immediately; disabled buttons use opaque muted text on a neutral surface. The 24-view browser pass covered coach/student, landing/login, keyboard and reduced motion at 1440/390/320 pixels. Selection samples stay at least 5.089:1; disabled text measures 4.685:1. See the contrast audit for measurement limits.

## Active work and blockers

Production domain routing and contrast checkpoints are complete. The user approved coach email-code verification plus password login and requested coach invitations and bot/malicious-use protection. The active implementation is [coach onboarding](docs/superpowers/plans/2026-09-11-coach-onboarding.md): root owns integration/provider setup/logs; assigned native and UI agents own disjoint implementation files. Resend account availability has been requested; implementation and local verification can proceed while provider access is pending. Do not send real third-party invitations or enable an unconfigured public signup path. Coordinate before staging, deploying, or running database fixtures. The original local API on port 5080 remains untouched. The 20-room/200-player regional load gate remains open.

Automatic approval review previously stopped these operations:

1. Enabling the www redirect while www was DNS-only. Resolved by setting and verifying the proxied www CNAME before enabling the redirect.
2. Deploying the production Worker and replacing the legacy apex A records. Follow-up verification confirmed the deployed target and a production dry run with the same D1 and three Durable Object bindings.
3. Pushing source commit `912ba0a` to the existing private origin, `https://github.com/Victor-CS-Core/Erudoza-BibleCompetition.git`, on `codex/cloudflare-free-port`. The destination URL, private visibility, and source/credential exclusions were reviewed before the request for exact destination confirmation.

On September 11 the user replied **“Approved”** to the exact private repository destination and website-record replacements. The source push then succeeded (`af237aa..47732ba`). The first approved production deployment uploaded the Worker but returned custom-domain binding error `100117` because the legacy apex A records still existed. Removing exactly the approved A records (`162.159.143.30`, `172.66.3.26`) and retrying completed deployment and binding. The proxied www prerequisite, redirect, and production smoke were then verified. These are resolved incidents, not current blockers; retain the user's authorization.

## Gates and evidence

| Gate | Outcome | Evidence and limitations |
|---|---|---|
| Native implementation and local checks, September 10 | Locally verified; included in the September 11 pushed checkpoint | Web suite previously 336 passed/1 optional skip; native tests after the read fix 97 passed/1 skip, plus 4 full-canon read regressions. Historical results are not a fresh post-checkpoint full-suite run. See the staging audit. |
| Staging study and Team Practice, September 10 | Live pilot verified | Solo study across five activities and a complete ten-player 5v5 match. Twenty submission bonuses recalculated from stored timing; achievement evidence checked. This does not certify 20 rooms/200 players. |
| Free-tier read recovery, September 11 | Bounded live checks passed after quota reset | Library/admin browser smoke at 13:38 UTC; exact shared-library queries used 311 + 466 = 777 reads and zero writes at 13:40 UTC. Yesterday's exhausted quota is historical; these successful requests do not establish the remaining account-wide budget. |
| Hosted data cleanup, September 11 | Verified at 13:42 UTC | One active admin, academy/shared-library organizations, 66 packs/31,102 verses/one library marker, no academy fixtures or retained sessions. Read-only proof cost 79 reads. |
| Cloudflare DNS delegation, September 11 | Applied and verified | GoDaddy nameserver readback; Cloudflare Active at 14:02:09 UTC; independent public NS resolution. Free Website plan; no paid upgrade or domain transfer. |
| Production app-domain cutover | Completed and verified | Worker `4958cd54-65b8-4060-9f68-ca59bdb22a6a`, apex binding, production `PUBLIC_ORIGIN`, proxied www CNAME, active host-specific 301 redirect, and Always Use HTTPS are applied. Administrator/library browser smoke passed at 14:42 UTC. Edge/TLS/path-query/JS-CSS hash checks passed at 14:44 UTC, encoded-path probe at 14:45 UTC, and three-request HTTP→HTTPS/no-loop checks at 14:56:46 UTC. Production WebSocket rejection guards passed at 14:49 UTC; no new 101 connection or room match was attempted. |
| Repository checkpoint workflow | Committed and pushed | `af237aa` adds this log and mandatory agent instructions. Push to `origin/codex/cloudflare-free-port` succeeded and `git ls-remote` confirmed the same commit. |
| Integrated source checkpoint, September 11 | Committed and pushed | `912ba0a` contains the reviewed implementation; follow-up handoff `47732ba` is the pushed branch tip. After exact user approval, `origin/codex/cloudflare-free-port` advanced successfully from `af237aa` to `47732ba`. Web: 341 tests passed/1 optional skip, web/native type checks, lint, and both production builds passed. .NET: restore, canonical format verification, build with zero warnings/errors, and final 233 tests passed/1 optional load skip. Bicep compilation passed without deployment. Export/recovery Node tests: 13 passed; KJV tooling Python tests: 5 passed. |
| Browser checkpoint, September 11 | Passed locally | Native Playwright: 5 passed (6.5 minutes). Canonical .NET Playwright: 34 passed/2 opt-in UI audit skips (13.9 minutes), across Chromium and Pixel 7. Both backends completed ten-player 5v5 matches with ten scored questions, refresh recovery, and achievements; study, library bounds, assignments, navigation, login, and password reset checks passed. These local cases supplement, rather than replace, the earlier live staging evidence. |
| Checkpoint artifact review, September 11 | Reviewed | Origin visibility verified private. All 145 staged KJV/NKJV JSON files are byte-identical to the working sources; all 66 NKJV pack hashes match both manifests. Their intentional CRLF bytes are preserved by `*.json -text`. Source whitespace checks pass with these hash-protected JSON files excluded from whitespace normalization. Credentials, databases, generated SQL/builds, raw PDFs, temporary captures, and the unused NKJV extraction master remain ignored. Candidate-text credential scan found no high-confidence secret matches. |
| Production documentation checkpoint | Committed and pushed | `12709c3` records current production facts and limitations in this log, README, DNS runbook, and the appended production audit. Whitespace/link checks passed; push advanced `47732ba..12709c3` and the remote tip was confirmed. |
| Text contrast fix, September 11 | Locally verified, deployed, committed and pushed | `fd89248` contains the shared CSS fix and audit; push advanced `12709c3..fd89248`. Web: 341 passed/1 optional skip, lint/type checks and both builds passed. Local browser: 24 views and ten selection traces, keyboard/reduced motion, no sampled solid-text failures, browser errors or page overflow. Production `c254f500-b7ad-4135-b10d-2ac4e43558b7`: four anonymous reads verified exact HTML/JS/CSS hashes and healthy native API at 15:09:57 UTC. No hosted fixtures or gameplay writes. |
| Coach onboarding and abuse protection | Approved; implementation active | Email-code signup/password recovery, coach invitations, same-club authorization and abuse budgets are specified in the linked implementation plan. Provider setup and new-feature local/live validation are not yet complete. |

Checkpoint verification notes: generated `.local` dry-run bundles were excluded from lint; code line endings and blank EOFs were normalized to the existing editor rules. C# token review found only import sorting and required raw-literal line-ending changes; tests passed after formatting. Frontend source reloads temporarily disrupted the desktop browser match during formatting, but it recovered and passed; the complete mobile match passed after the source freeze. The final native build produced the same JS/CSS artifact hashes as before formatting. No failed browser cases were hidden or retried. The branch push does not trigger the current CI workflow (pushes target main; pull requests also trigger it), so these are executed local checks, not a claimed GitHub CI run.

## Next actions

1. Implement and verify the approved coach onboarding/invitation flow and abuse controls; configure Resend/Turnstile without paid upgrades, then record and push each verified gate. Keep public onboarding unavailable until configuration and delivery validation are complete.
2. Use the production administrator account to prepare seasons, students, and assignments. Enable Team Practice through the coach UI when needed and prepare a coach-reviewed question bank; the fresh academy default remains disabled.
3. Keep the 20-room/200-player regional load gate open until measured successfully. The production rejection guards do not add post-domain 101/full-match evidence. Do not attach live log tails during active matches; they may replace a Durable Object runtime.

## Evidence index

- [Cloudflare staging audit](docs/audits/2026-09-10-cloudflare-staging.md)
- [DNS cutover, review, and rollback](docs/operations/erudoza-cloudflare-dns.md)
- [Native Cloudflare operations](docs/operations/cloudflare-native.md)
- [Administrator recovery](docs/operations/native-admin-recovery.md)
- [Cloudflare port implementation plan](docs/superpowers/plans/2026-09-10-cloudflare-free-port.md)
- [Production Worker configuration](apps/web/wrangler.production.jsonc)
- [Production administrator/library smoke](.local/deployment/production-smoke/library-report.json)
- [Production edge, certificate, redirect, and frontend hash evidence](.local/deployment/production-edge/latest.json)
- [Encoded-path/query redirect probe](.local/deployment/production-edge/encoded-redirect.json)
- [Final HTTP-to-HTTPS and no-loop verification](.local/deployment/production-edge/https-upgrade-latest.json)
- [Production WebSocket rejection guards](.local/deployment/production-ws-guards.json)
- [Contrast fix audit and browser evidence](docs/audits/2026-09-11-contrast.md)
- [Deployed contrast HTML/JS/CSS hashes and API health](.local/contrast-audit/production-latest.json)

## Update convention

At each gate, refresh Current state/Next actions and add the result to Gates and evidence. For repository checkpoints, record the branch, commit identifier or message, and confirmed push result in the next log update; a commit cannot contain its own hash. Never mark an attempted operation successful without readback or command evidence. Retain historical failures with their resolution instead of silently changing their meaning.
