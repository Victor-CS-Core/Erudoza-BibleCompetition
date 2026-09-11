# Erudoza progress log

Read this file before starting repository work. `AGENTS.md` defines the required update and commit/push workflow. Times below are UTC. This log is the shared handoff; detailed audits remain the evidence for individual checks.

## Current state — 2026-09-11

- Task branch: `codex/cloudflare-free-port`. Repository: `Victor-CS-Core/Erudoza-BibleCompetition`.
- The production pilot is live at **https://erudoza.com** on Cloudflare Free, with deterministic study, the built-in 66-book NKJV library, and private Team Practice functionality.
- Final Worker version **`4958cd54-65b8-4060-9f68-ca59bdb22a6a`** is deployed with `PUBLIC_ORIGIN=https://erudoza.com` and the managed apex custom-domain binding. Production administrator/library, HTTPS/redirect, and WebSocket rejection-guard checks passed; final HTTPS-upgrade verification completed at 14:56:46 UTC.
- Cloudflare DNS is **Active** on Free Website. Registration remains at GoDaddy; public resolution confirms `elsa.ns.cloudflare.com` and `yevgen.ns.cloudflare.com`. The 26-record pre-cutover backup remains intact. Only the two approved legacy apex A records were removed before managed binding; the other 24 imported records were retained at that step, and www was subsequently changed to its approved target.
- www is a **Proxied, Automatic-TTL CNAME to `erudoza.com`**. Active Single Redirect `269651cea73a457786211151fda5c516` sends the exact www host to HTTPS apex with status 301, preserving path and query. Public apex/www answers observed at 14:44 UTC were `104.21.66.111` and `172.67.159.115`; these are observed edge addresses, not manually configured origin records.
- Cloudflare **Always Use HTTPS** is enabled and verified. Three bounded anonymous GETs confirmed HTTP apex → HTTPS apex 301, HTTP www → HTTPS apex 301, identical path/query preservation, and final HTTPS `/login` 200 without a redirect loop.
- The workers.dev URL is the same Worker, not a concurrent staging environment. Its old browser origin is now rejected for writes and WebSocket upgrades by the production origin policy. `wrangler.staging.jsonc` is a rollback configuration.
- Hosted application data contains only the admin account/academy plus the immutable shared NKJV library. Synthetic study/PVP fixtures were removed. Credentials and backup files are private ignored artifacts under `.local/`; do not copy their contents into source control or this log.
- The fresh academy has Team Practice disabled by default (`practiceEnabled=false`). A coach can enable it through **Enable Team Practice** in the UI and prepare the academy's question bank. No new room fixture or successful post-domain WebSocket 101 connection was created for the production guard checks; earlier live staging and local full-match evidence remains the gameplay proof.
- The private administrator credential record now points to the apex URL; its password was not changed by cutover.
- The integrated implementation/UX checkpoint `912ba0a` (`feat: checkpoint team practice and Cloudflare migration`) and follow-up handoff `47732ba` (`docs: record validated checkpoint and approval blockers`) are now pushed to the approved private `origin/codex/cloudflare-free-port`. The successful push advanced the remote from `af237aa` to `47732ba`; the earlier source-upload approval blocker is resolved.
- The user's next active request is a contrast audit of gray text on green backgrounds. The primary agent and assigned checkpoint agent own that work as a separate source/validation checkpoint after the deployment documentation checkpoint.

## Active work and blockers

The production app-domain gate is complete, with no remaining DNS or approval blocker. The primary agent owns the final deployment documentation checkpoint and push before contrast-related CSS work. The primary/checkpoint agents are taking up the new gray-text/green-background contrast audit separately. Other agents must coordinate before staging, changing deployment settings, or running database fixtures. The 20-room/200-player regional load gate remains open.

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
| Production documentation checkpoint | Prepared; commit and push pending | Current production facts and limitations are recorded in this log, README, DNS runbook, and the appended production audit. The last confirmed remote source tip remains `47732ba` until the primary agent commits and pushes this documentation gate. |
| Gray-text/green-background contrast audit | Requested; active next checkpoint | The user requested a contrast review and fixes. The primary/checkpoint agents own the audit, scoped CSS changes, and their validation; no completed contrast result is claimed in this deployment checkpoint. |

Checkpoint verification notes: generated `.local` dry-run bundles were excluded from lint; code line endings and blank EOFs were normalized to the existing editor rules. C# token review found only import sorting and required raw-literal line-ending changes; tests passed after formatting. Frontend source reloads temporarily disrupted the desktop browser match during formatting, but it recovered and passed; the complete mobile match passed after the source freeze. The final native build produced the same JS/CSS artifact hashes as before formatting. No failed browser cases were hidden or retried. The branch push does not trigger the current CI workflow (pushes target main; pull requests also trigger it), so these are executed local checks, not a claimed GitHub CI run.

## Next actions

1. Review and commit the final production documentation, push `codex/cloudflare-free-port`, verify the remote tip, and record that checkpoint. Source push, DNS replacement, deployment, and the bounded production acceptance checks are complete.
2. Complete the new gray-text/green-background contrast audit and any scoped fixes with the shared design-system checks, then record and push that separate checkpoint.
3. Use the production administrator account to prepare seasons, students, and assignments. Enable Team Practice through the coach UI when needed and prepare a coach-reviewed question bank; the fresh academy default remains disabled.
4. Keep the 20-room/200-player regional load gate open until measured successfully. The production rejection guards do not add post-domain 101/full-match evidence. Do not attach live log tails during active matches; they may replace a Durable Object runtime.

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

## Update convention

At each gate, refresh Current state/Next actions and add the result to Gates and evidence. For repository checkpoints, record the branch, commit identifier or message, and confirmed push result in the next log update; a commit cannot contain its own hash. Never mark an attempted operation successful without readback or command evidence. Retain historical failures with their resolution instead of silently changing their meaning.
