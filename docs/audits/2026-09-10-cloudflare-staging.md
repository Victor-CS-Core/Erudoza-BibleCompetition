# Cloudflare staging deployment — 2026-09-10

## Scope and decisions

The user authorized a fresh hosted application preserving only the existing administrator account. The source SQLite database remains unchanged. Preserve the primary Season Admin identity and its required Erudoza Academy organization; exclude the isolation administrator, students, seasons, sessions, attempts, assignments, imported packs, and all existing practice history.

The retained administrator uses a repository development password. Rotate only the hosted credential before its first INSERT; keep the account ID and username. Store the generated password in ignored local deployment files, never public assets or console output.

## Resources created

- Account: `447a556505dd5e72b66e7c1c63d754ae` (existing user-confirmed Workers Free).
- D1: `erudoza-native`, `a1e35f1d-9d11-4379-af14-1c7c71162920`, ENAM/EWR observed.
- Worker: `erudoza-native` with `PracticeRoom`, `PracticeReports`, and internal `PasswordCrypto` SQLite-backed Durable Objects.
- Staging origin: `https://erudoza-native.fedilms-deployment-companion.workers.dev`.
- Reviewed configuration: `apps/web/wrangler.staging.jsonc`.
- No paid upgrade, registrar transfer, DNS record or nameserver change.

## Execution ledger

- Confirmed target Worker did not exist and target database name was unused; left `fedilms-deployment-companion` database untouched.
- Created the empty database and applied `0001_native.sql`; Users and Records counts both zero.
- Native build, web/native type checks, lint and 329 tests passed (one optional load test skipped).
- Reviewed the deployment bundle and 28 public assets; no credentials, source database, or complete Bible JSON in public assets.
- Deployed initial version `0e55a8b9-ab50-4551-b1f0-7e1eba72efeb`; pinned PUBLIC_ORIGIN in version `693d4a6a-b472-4cdc-9a2c-ed11636de53d`.
- HTTPS `/login` and `/api/v1/health` returned 200; health reported Cloudflare runtime and connected database.
- Pre-import D1 usage: target30 writes/24h, other account database0 writes/24h. These rolling figures are a conservative upper bound for today's usage at the read time, not a reservation.
- Full NKJV seed locally measured124,679 writes with ordinary Records,93,510 with WITHOUT ROWID. Same-version identical rerun writes0. Retain primary key and both secondary indexes.
- Verified admin-only exporter with7 tests; imported1 user/1 organization using a fresh credential in the first INSERT (8 metered writes). Original SQLite/WAL fingerprints unchanged.
- Live browser smoke22:11UTC passed: admin login, secure HttpOnly cookie, empty students/seasons, cross-origin/organization rejection, logout/session revocation and no browser exceptions.
- Applied tested0002 migration while Records remained empty. NKJV batches metered29,997 +29,958 +29,952 +3,603 =93,510 writes remotely. Reconciled66 books,1,189 chapters,31,102 verses; no academy Records; foreign-key check empty.
- Saved a private bootstrap D1 export under ignored `.local/deployment/backups/`.
- Monitoring found login consumed 23 ms CPU in the ordinary Worker, above its Free 10 ms allowance despite a successful response. Moved the unchanged 100,000-round PBKDF2 work to an internal `PasswordCrypto` Durable Object, whose documented default CPU budget is 30 seconds per invocation. This uses the existing Free Durable Object allowance; it does not weaken password security. Subsequent deployed measurements verified the separation.
- Deployed PasswordCrypto in version `f9304fce-34f6-4587-bff9-766aa08d9e12`; independent review confirmed exact KDF compatibility and authorization-before-RPC. Full web suite336 passed/1 optional skipped; native build/type checks/lint passed. A dry-run generated bundle was moved out of the web source tree after lint correctly flagged generated code.
- Live browser at22:19UTC passed authenticated66-book library access, Ephesians6-chapter/Jude1-chapter selectors, actual verse counts and no horizontal overflow at1440/390/320px. Desktop/mobile screenshots inspected. Login/logout/security checks passed again.
- Inspected the authenticated Cloudflare Workers plans dashboard: **Free / $0 / Current plan**. No upgrade was selected.
- Initial live5v5 smoke joined10 independent browsers/private sockets and denied a nonparticipant coach; first answer-phase wait failed. Room abandoned; fresh-room reproduction and diagnosis underway. Do not treat socket connectivity as completed-match verification.
- Final sanitized telemetry captured 28 login requests: ordinary Worker CPU 2–6 ms, including 26 successful and two invalid credentials; PasswordCrypto handled its 15–41 ms verification work separately. Observed ordinary Worker study and administration routes were at most 9 ms. No CPU-limit/resource-limit outcomes were observed. These are pilot measurements, not proof of 200-player capacity. A room exception and socket closures during the live-log runtime replacement are recorded separately below.
- A fresh5v5 room reached Presentation/Scheduled/Response correctly. A subsequent failure was isolated to the smoke harness's exact accessible-label locator after saving a draft; corrected only the harness. Full-match verification is running.
- The stable-version match scored5 questions, then entered Paused with a reserve question and prior scores intact. Tail activation at22:27:32 preceded socket replacement at22:27:38 and recovery at22:27:40. Cloudflare's known-issues documentation confirms enabling live logs requires a software update and can replace DOs, explaining why the unchanged deployment ID was insufficient evidence of an unchanged runtime. Future full-match runs keep live-log subscriptions stable.
- Live individual study passed 38 checks and eight cards across all five activity types, resume before/after feedback, idempotent retries/completion, duplicate rejection and student/coach progress. Extra session-start/next CPU samples were 7 ms/9 ms, both HTTP 200. The actual card, assigned Scripture reader, and progress screens were inspected at 390 px with no horizontal overflow or captured browser/API errors. Cleanup at 22:32 UTC proved zero remaining fixture organizations, users, Records, sessions, or username rate-limit keys. Sanitized evidence is under ignored `.local/study-live-smoke/`.
- Added owner/authorized-coach-only recovery diagnostics containing just timestamps and fixed reasons, with no answer or internal epoch disclosure. Independent review found no issue; nine state tests, both type checks, native build, and lint passed. Deployed version `157987b5-1dfd-427f-ac41-8a7762726dcb` before the final full-match run. No live-log attachment or deployment is allowed during that run.
- The stable live 5v5 match completed at 22:41:48 UTC: ten independent browser contexts, ten questions, twenty accepted answers, private team drafts, denied outsider access, and a reconnect retaining the active question. No runtime recovery occurred. Team 1 earned 10.00 accuracy + 2.39 speed = 12.39; Team 2 earned 10.00 + 2.38 = 12.38. Root independently recalculated all twenty speed bonuses and totals from stored elapsed durations. D1 verification found a completed match and exactly ten First Fellowship and two Shared Scribe awards. The completed desktop screen was inspected. Sanitized evidence is under ignored `.local/deployment/pvp-smoke/`. Temporary fixture cleanup is briefly held for query-fix verification.
- Read accounting exposed a release issue: `d1 info` reported 5,373,926 rows read over 24 hours and 94,471 written, exceeding the documented 5 million daily Free read allowance despite currently successful requests. Query insights and local full-canon reproduction traced this to scope/source queries choosing a full-canon scan. Authentication queries used only 1–4 reads each. A fix using existing indexes and constrained join order is being verified; no new index or paid upgrade is needed. Do not interpret currently successful requests as guaranteed quota headroom.
- Corrected the four confirmed query paths using constrained join order and the existing `Records_owner` index, without changing schema, authorization predicates, ordering, or limits. Full-canon metering: scope sources 62,205 → 311 reads; season summary 93,462 → 315; Ephesians source list 31,257 → 466; study revision guards 31,243 → 12. Four new regression tests passed, including pre/post result parity, foreign/missing/inactive/unapproved packs, includes/excludes, and cursor pagination. Native suite: 97 passed, one optional load test skipped; root native build, both type checks, and lint passed. Deployed version `00f4b6cc-0caa-47e3-b87e-d3bf8d7640b9` after the full match completed. Final authenticated reads, remote query metering, and fixture cleanup are underway.
- The post-optimization live login returned HTTP 503 at 22:53:31 UTC. Remote metering confirmed Cloudflare error `7500`: the account exceeded its Free daily row-read limit. No paid upgrade was made. The documented reset is 2026-09-11 00:00 UTC (September 10 at 8:00 PM America/New_York). Small operator reads and targeted cleanup were still accepted; this does not establish that ordinary application traffic is available.
- Targeted PVP cleanup succeeded: removed 45 sessions, 11 username rate-limit rows, 58 fixture Records, 11 users, and one organization, with 126 metered writes. All fixture rooms were completed or abandoned and browsers closed. No new fixture is needed for the remaining check.
- Root independently reconciled the destination at 22:56:51 UTC using 78 indexed reads and zero writes: exactly one active `admin@erudoza.local` user; only the academy and shared-library organizations; no academy or either test organization's Records; 66 built-in packs and one completed-library marker; zero sessions. One shared IP login-limit row remains as normal security metadata. The prior full import reconciliation established 31,102 verses; it was not rescanned after the read limit. Proof: ignored `.local/deployment/final-database-proof.json`.
- Final recorded rolling usage: 5,378,435 rows read and 94,692 written, with a 36,634,624-byte database. The read allowance was exceeded; the write count remained below 100,000. These are observed counters, not a guarantee of remaining account-wide allowance. Snapshot: ignored `.local/deployment/final-usage.json`.
- Read-only zone API returned no erudoza.com zone; DNS cutover still requires a reviewed GoDaddy export and registrar access.

## September 11 post-reset verification

The quota-blocked staging checks were resumed manually after the September 11 00:00 UTC daily reset. The bounded checks below passed against deployment `00f4b6cc-0caa-47e3-b87e-d3bf8d7640b9`; the September 10 HTTP 503/error `7500` remains part of the incident history above, rather than a current blocker for these checks. No new student, season, or match fixtures were created.

- At 13:38:47–13:38:54 UTC, the real administrator browser smoke passed health, anonymous and cross-origin rejection, rotated-credential login, secure cookie attributes, empty student/season lists, organization isolation, all 66 library books, actual Ephesians/Jude chapter and verse selectors, and desktop/mobile layouts. Logout revoked the session and no browser runtime exceptions were captured. Sanitized report: ignored `.local/deployment/smoke/library-report.json`.
- At 13:40:56 UTC, the deployed query code's exact shared-library SQL was metered remotely for Ephesians 6:1–3. `scopeSources` returned the three requested verses using 311 rows read; the owner-scoped Ephesians source list returned 155 verses using 466 rows read. The two queries used **777 rows read and zero rows written**, below the harness's 5,000-read ceiling. Sanitized SQL hashes, counts, and scope: ignored `.local/nkjv-d1-budget/live-read-meter-2026-09-11.json`. Populated season-summary and study revision-guard queries were not rerun remotely; their evidence remains the local full-canon regression checks recorded above.
- At 13:42:42 UTC, fresh database proof used 79 indexed reads and zero writes. It confirmed exactly the academy and shared-library organizations, one active administrator, no academy/test activity Records, 66 built-in packs and one library marker, and zero sessions. Two login-limit keys remain as normal security metadata. Database size was 36,634,624 bytes. This refreshed ignored `.local/deployment/final-database-proof.json`; the September 10 proof remains recorded in the execution ledger. The full 31,102-verse count was not rescanned during this bounded verification.

The daily read quota no longer blocked these observed requests. The September 10 rolling counters are historical, and these checks do not establish the remaining account-wide allowance or certify 200-player capacity. No paid upgrade was made.

## Verified acceptance

- Admin-only import with a new hosted credential, full library import, and reconciliation.
- Live authenticated coach/student study workflows, chapter limits, session revocation, and organization isolation.
- Deployed authentication CPU measurements and exact library import write accounting.
- A complete live 5v5 match with persisted scores, timing-formula reconciliation, awards, and reconnect behavior.
- Fresh destination reconciled after all temporary users, sessions, and academy/test activity were removed. The only retained user is the administrator.
- September 11 post-reset administrator/library browser smoke and live metering of the corrected shared-library scope and owner-scoped source queries, with no new fixtures.

## Remaining acceptance

- Regional 20-room/200-player load and quota evidence. The local load previously missed the 500 ms p95 target; this scale is not approved for rollout by the small pilot checks.
- Published coach-reviewed question bank before enabling usable Team Practice for the academy.
- NKJV redistribution permission is not established by the supplied PDF; production audience rollout remains subject to the publisher's terms.
- Domain and iCloud Mail DNS review/cutover after acceptance.

## Handoff

Staging deployment verified on September 11: `00f4b6cc-0caa-47e3-b87e-d3bf8d7640b9`. Hosted administrator login details are in ignored `.local/deployment/admin-credentials.json`; the hosted credential was rotated from the development default. Never copy that file into source control, public assets, or a report. The original local database was not modified.

At the September 10 handoff, the user had been asked about an automatic continuation and GoDaddy access was pending. No automation was scheduled. The previously quota-blocked checks were completed manually on September 11, as recorded above. DNS cutover is tracked separately; this staging audit does not establish production-domain acceptance.

## September 11 production-domain acceptance

This appended section supersedes the earlier handoff's open domain-cutover status. Production is now live at **https://erudoza.com**, final Worker version **`4958cd54-65b8-4060-9f68-ca59bdb22a6a`**, with `PUBLIC_ORIGIN=https://erudoza.com` and the managed custom-domain binding. The user explicitly approved the exact private repository destination and apex/www replacements. Source implementation `912ba0a` and handoff `47732ba` were pushed successfully to private `origin/codex/cloudflare-free-port`; the remote tip was verified as `47732ba`. The final production documentation commit/push remains the next checkpoint.

### Deployment and DNS ledger

- GoDaddy saved and read back `elsa.ns.cloudflare.com` and `yevgen.ns.cloudflare.com`; Cloudflare zone `c65e6d9c75bf399c8d726ec2414859d3` became Active on Free Website at 14:02:09 UTC. Public DNS resolution confirmed the assigned nameservers. Registration remained at GoDaddy, DNSSEC was verified off in its UI, and no paid upgrade occurred.
- The original 26 portable records were preserved in a [reviewed UI backup](../../.local/deployment/dns/godaddy-portable26-reviewed-ui-2026-09-11.json), not a provider-generated zone export. The first 16 imported records used Automatic TTL at Cloudflare; the missing ten retained their original numeric TTLs. The backup preserves all original numeric TTLs and known prior authority details.
- Automatic approval review initially rejected the source push and exact website-record replacements. Follow-up target checks and the user's **“Approved”** resolved those authorization blockers. The first approved deploy uploaded the Worker but returned custom-domain binding error **`100117`** because the legacy apex A records remained. Removing exactly `162.159.143.30` and `172.66.3.26`, then retrying, completed the final deployment/binding. The other 24 imported records were retained before managed binding; www was subsequently updated. No fresh final UI record count is asserted here.
- www is now a Proxied CNAME to `erudoza.com`, Automatic TTL, verified in the operator UI. Active Single Redirect `269651cea73a457786211151fda5c516` matches `(http.host eq "www.erudoza.com")`, targets `concat("https://erudoza.com", http.request.uri.path)`, uses status 301, and preserves the query string.
- The existing administrator credential was retained; only the URL in the ignored private credential record was updated to the apex. No credentials were copied into documentation or public assets.

### Production verification

- **14:42:27–14:42:34 UTC:** administrator/library browser smoke passed HTTPS health, anonymous and cross-origin rejection, rotated-credential login, secure cookies, empty student/season lists, organization isolation, all 66 library books, actual chapter/verse bounds, layouts at 1440/390/320 pixels, and logout/session revocation. No browser runtime exceptions were captured. [Sanitized report](../../.local/deployment/production-smoke/library-report.json).
- **14:44:41 UTC:** edge checks passed public nameserver and apex/www resolution, trusted hostname-valid TLS 1.3 certificates on both hosts, native health with connected D1 and the expected timing contract, direct HTTP/HTTPS www-to-apex redirects preserving path/query, and served entry JS/CSS hashes matching the validated native build. Observed apex/www addresses were `104.21.66.111` and `172.67.159.115`; the observed certificates expire on November 21, 2026. These are observed edge results, not a claim that the addresses or certificates are permanent. [Edge report](../../.local/deployment/production-edge/latest.json).
- **14:45:21 UTC:** one encoded-path/query probe returned 301 with the exact expected encoded location. [Probe report](../../.local/deployment/production-edge/encoded-redirect.json).
- **14:49:48–14:49:50 UTC:** production WebSocket upgrade rejection guards passed: anonymous request 401, forged Origin 403, and authenticated invalid-room request 403 at the feature/route guard while `practiceEnabled=false`; logout returned 204. [Guard report](../../.local/deployment/production-ws-guards.json).
- **14:56:46 UTC:** a final routing check found HTTP apex initially returned 200. Cloudflare Always Use HTTPS was enabled and verified in the UI. Exactly three anonymous GETs then passed: HTTP apex → HTTPS apex 301, HTTP www → HTTPS apex 301 with identical path/query, and HTTPS `/login` 200 without a Location header or redirect loop. [Final HTTPS-upgrade report](../../.local/deployment/production-edge/https-upgrade-latest.json).

### Scope limits and current operation

No production room fixture was created, and the post-domain checks did not attempt a successful WebSocket **101** connection or another complete match. Gameplay evidence remains the earlier live staging 5v5 match and 39 passing local browser cases (5 native and 34 .NET, with two opt-in UI-audit skips). The complete mobile .NET match passed after the source freeze; the earlier desktop HMR disruption and recovery remain recorded in [PROGRESS.md](../../PROGRESS.md). These checks do not certify 20-room/200-player regional capacity, which remains **open**.

The fresh administrator academy has Team Practice disabled by default. A coach can use **Enable Team Practice** in the UI and prepare a coach-reviewed question bank. The 403 feature guard is the expected fresh-state result, not evidence of a live room connection. Existing unused iCloud mail records were retained at the user's request; an extra email delivery test is not a production acceptance gate. The supplied NKJV PDF and private repository checkpoint do not establish public redistribution permission.

The workers.dev address and apex use the **same Worker**. Production origin enforcement now rejects writes and WebSocket upgrades from the old browser origin. `wrangler.staging.jsonc` is a rollback configuration targeting the shared Worker/D1/DO resources, not a concurrently available staging environment. Production DNS/application acceptance is complete; no DNS blocker remains. Review, commit, and push the final documentation checkpoint next, and keep the separate regional load gate open. The user's new gray-text/green-background contrast audit is active under the primary/checkpoint agents and belongs to the next source/validation checkpoint.
