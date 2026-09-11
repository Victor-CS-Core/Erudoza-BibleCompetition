# Erudoza progress log

Read this file before starting repository work. `AGENTS.md` defines the required update and commit/push workflow. Times below are UTC. This log is the shared handoff; detailed audits remain the evidence for individual checks.

## Current state — 2026-09-11

- Task branch: `codex/cloudflare-free-port`. Repository: `Victor-CS-Core/Erudoza-BibleCompetition`.
- Goal: bring the existing React app, deterministic study, built-in 66-book NKJV library, and private Team Practice to Cloudflare Free, then serve it on `https://erudoza.com`.
- The native Worker is live at `https://erudoza-native.fedilms-deployment-companion.workers.dev`. Current deployed version: `00f4b6cc-0caa-47e3-b87e-d3bf8d7640b9` (read-budget fix).
- Cloudflare DNS is **Active** on Free Website. GoDaddy registration remains unchanged; its nameservers were switched to `elsa.ns.cloudflare.com` and `yevgen.ns.cloudflare.com`. Public resolution through 1.1.1.1 confirms both. All 26 portable DNS records were preserved.
- The apex and www still point to the previous Sites website. Production Worker binding and www redirect have **not** been applied. Production configuration and a separate production smoke mode are prepared.
- Hosted application data contains only the admin account/academy plus the immutable shared NKJV library. Synthetic study/PVP fixtures were removed. Credentials and backup files are private ignored artifacts under `.local/`; do not copy their contents into source control or this log.
- The workflow checkpoint `af237aa` (`docs: require shared progress log and gate checkpoints`) is pushed and confirmed on `origin/codex/cloudflare-free-port`. The integrated implementation/UX source checkpoint has passed its local validation and is ready to commit and push.

## Active work and blockers

The primary agent owns DNS cutover and repository checkpoints. Other agents may inspect or validate bounded scopes, but must coordinate before staging, changing deployment settings, or running database fixtures.

Automatic approval review stopped two operations:

1. Enabling the www redirect while www was DNS-only. Resolve this by setting and verifying the intended proxied DNS record before enabling the redirect.
2. Deploying the production Worker and replacing the legacy apex A records. Review required explicit confirmation of that exact replacement and additional target verification. Follow-up verification confirmed the current deployed version and a production dry run with the same D1 and three Durable Object bindings. The remaining confirmation concerns replacing apex A `162.159.143.30` and `172.66.3.26` with the managed `erudoza-native` custom-domain binding, and changing www from `custom-domains.chatgpt.site` to a proxied CNAME at `erudoza.com` followed by a canonical HTTPS redirect.

Do not retry the rejected deployment through another mechanism. Obtain the required exact confirmation, then carry out the verified sequence in the DNS runbook.

## Gates and evidence

| Gate | Outcome | Evidence and limitations |
|---|---|---|
| Native implementation and local checks, September 10 | Locally verified; source checkpoint pending | Web suite previously 336 passed/1 optional skip; native tests after the read fix 97 passed/1 skip, plus 4 full-canon read regressions. Historical results are not a fresh post-checkpoint full-suite run. See the staging audit. |
| Staging study and Team Practice, September 10 | Live pilot verified | Solo study across five activities and a complete ten-player 5v5 match. Twenty submission bonuses recalculated from stored timing; achievement evidence checked. This does not certify 20 rooms/200 players. |
| Free-tier read recovery, September 11 | Bounded live checks passed after quota reset | Library/admin browser smoke at 13:38 UTC; exact shared-library queries used 311 + 466 = 777 reads and zero writes at 13:40 UTC. Yesterday's exhausted quota is historical; these successful requests do not establish the remaining account-wide budget. |
| Hosted data cleanup, September 11 | Verified at 13:42 UTC | One active admin, academy/shared-library organizations, 66 packs/31,102 verses/one library marker, no academy fixtures or retained sessions. Read-only proof cost 79 reads. |
| Cloudflare DNS delegation, September 11 | Applied and verified | GoDaddy nameserver readback; Cloudflare Active at 14:02:09 UTC; independent public NS resolution. Free Website plan; no paid upgrade or domain transfer. |
| Production app-domain cutover | Pending exact confirmation | Local dry run passed; no managed custom-domain binding or active www redirect yet. Production-domain HTTPS/login/library acceptance is still unperformed. |
| Repository checkpoint workflow | Committed and pushed | `af237aa` adds this log and mandatory agent instructions. Push to `origin/codex/cloudflare-free-port` succeeded and `git ls-remote` confirmed the same commit. |
| Integrated source checkpoint, September 11 | Local validation passed; commit/push pending | Web: 341 tests passed/1 optional skip, web/native type checks, lint, and both production builds passed. .NET: restore, canonical format verification, build with zero warnings/errors, and final 233 tests passed/1 optional load skip. Bicep compilation passed without deployment. Export/recovery Node tests: 13 passed; KJV tooling Python tests: 5 passed. |
| Browser checkpoint, September 11 | Passed locally | Native Playwright: 5 passed (6.5 minutes). Canonical .NET Playwright: 34 passed/2 opt-in UI audit skips (13.9 minutes), across Chromium and Pixel 7. Both backends completed ten-player 5v5 matches with ten scored questions, refresh recovery, and achievements; study, library bounds, assignments, navigation, login, and password reset checks passed. These local cases supplement, rather than replace, the earlier live staging evidence. |
| Checkpoint artifact review, September 11 | Reviewed | Origin visibility verified private. All 145 staged KJV/NKJV JSON files are byte-identical to the working sources; all 66 NKJV pack hashes match both manifests. Their intentional CRLF bytes are preserved by `*.json -text`. Source whitespace checks pass with these hash-protected JSON files excluded from whitespace normalization. Credentials, databases, generated SQL/builds, raw PDFs, temporary captures, and the unused NKJV extraction master remain ignored. Candidate-text credential scan found no high-confidence secret matches. |

Checkpoint verification notes: generated `.local` dry-run bundles were excluded from lint; code line endings and blank EOFs were normalized to the existing editor rules. C# token review found only import sorting and required raw-literal line-ending changes; tests passed after formatting. Frontend source reloads temporarily disrupted the desktop browser match during formatting, but it recovered and passed; the complete mobile match passed after the source freeze. The final native build produced the same JS/CSS artifact hashes as before formatting. No failed browser cases were hidden or retried. The branch push does not trigger the current CI workflow (pushes target main; pull requests also trigger it), so these are executed local checks, not a claimed GitHub CI run.

## Next actions

1. Finish scope/artifact review and required validation, commit the coherent implementation checkpoint, and push `codex/cloudflare-free-port`. Update this log with the actual result and remaining work.
2. Obtain the exact website-record replacement confirmation required by automatic approval review.
3. Deploy `apps/web/wrangler.production.jsonc` to the active zone. Review managed apex DNS changes and certificate readiness.
4. Set and verify the proxied www record, then enable the host-specific 301 redirect to HTTPS apex with path and query preserved.
5. Run production-domain smoke checks, record the final version/DNS/certificate state, update this log and the runbooks, then commit and push that gate.
6. Keep the 20-room/200-player regional load gate open until measured successfully. Do not attach live log tails during active matches; they may replace a Durable Object runtime.

## Evidence index

- [Cloudflare staging audit](docs/audits/2026-09-10-cloudflare-staging.md)
- [DNS cutover, review, and rollback](docs/operations/erudoza-cloudflare-dns.md)
- [Native Cloudflare operations](docs/operations/cloudflare-native.md)
- [Administrator recovery](docs/operations/native-admin-recovery.md)
- [Cloudflare port implementation plan](docs/superpowers/plans/2026-09-10-cloudflare-free-port.md)
- [Production Worker configuration](apps/web/wrangler.production.jsonc)

## Update convention

At each gate, refresh Current state/Next actions and add the result to Gates and evidence. For repository checkpoints, record the branch, commit identifier or message, and confirmed push result in the next log update; a commit cannot contain its own hash. Never mark an attempted operation successful without readback or command evidence. Retain historical failures with their resolution instead of silently changing their meaning.
