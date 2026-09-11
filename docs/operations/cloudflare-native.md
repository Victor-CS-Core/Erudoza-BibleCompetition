# Cloudflare native pilot

This target runs the existing React interface on Workers Static Assets, the API on Workers, relational records in D1, and private PVP rooms in SQLite-backed Durable Objects. An internal PasswordCrypto Durable Object performs the existing PBKDF2 password work. It does not call Azure, the ASP.NET host, or the Sites bridge. The legacy build remains available during migration. Domain registration/renewal is separate from free DNS and hosting.

The first staging deployment is recorded in [the deployment audit](../audits/2026-09-10-cloudflare-staging.md). `wrangler.staging.jsonc` contains its explicit account/database binding and HTTPS origin. The generic `wrangler.native.jsonc` remains a local/deployment template. erudoza.com DNS has not changed.

## Local commands

From the repository root:

```powershell
npm ci
npm --workspace apps/web run build:native
npm --workspace apps/web run lint
npm --workspace apps/web run test
node --test scripts/cloudflare-export.test.mjs
```

From `apps/web`, run `npx playwright test --config playwright.native.config.ts`. The launcher creates isolated, ephemeral fixture data, an explicit test password inherited from Playwright, and a frozen copy of the native assets. It binds only loopback. Never use this seed server as a production bootstrap. For the 20-room workload, set `ERUDOZA_NATIVE_LOAD=1` and run `npx vitest run worker/native/practice/load.test.ts`; the report is `test-results/native-load.json`. Local acknowledgement latency is not deployment-region evidence.

For persistent local development, use `npx wrangler d1 migrations apply erudoza-native --local --config wrangler.native.jsonc`, then import a reviewed local migration export with `wrangler d1 execute ... --local --file <native.sql>`. Provision the shared [66-book NKJV library](../../content/nkjv/README.md) once before user traffic. The seed is idempotent with an export that already contains that library. Run `npm run dev:native`. The all-zero database ID in the checked-in config is a placeholder, not an existing remote database.

## Timing contract

The user approved this adaptation after research: `accuracy-plus-speed-25-cf-event-v1` measures elapsed **server-observed event time at the authoritative room**, including transit before that room receives a complete request. It is not an exact measurement of human thinking time or the .NET monotonic contract.

Cloudflare documents that performance timers advance after I/O. `performance.now()` does not supply a separate high-resolution monotonic solution; Node `process.hrtime` is a compatibility implementation with documented inaccuracy. Durable Object alarms schedule work and are not elapsed-time clocks. See [performance timers](https://developers.cloudflare.com/workers/runtime-apis/performance/), [Node process](https://developers.cloudflare.com/workers/runtime-apis/nodejs/process/), and [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).

Complete-body ingress reserves command order before authentication, application queuing, grading, or result export. Both scribes acknowledge a future shared schedule. Invalid submissions do not earn a timestamp; accepted final answers are immutable. The one-second ceil/floor integer scoring formula is unchanged. A deadline uses the latest persisted draft with no bonus. Pending admitted requests defer deadline finalization; retries and appeals preserve original elapsed time. Browser time and measured RTT/jitter never adjust scores.

Each active match retains a runtime epoch. A new epoch or detected backwards clock replaces the interrupted question for both teams, or abandons the match if no reserve exists. Forward wall-clock adjustments cannot all be detected: that remains a limitation of this adaptation. A keep-alive timer prevents ordinary hibernation during a playing match; this consumes Durable Object duration quota, including coached pauses. Completed/abandoned/lobby rooms can hibernate. Coaches should abandon forgotten active rooms.

Enabling `wrangler tail` or dashboard live logs can itself replace a Durable Object's runtime, even when the deployed version ID is unchanged. Cloudflare documents this under [global uniqueness and software updates](https://developers.cloudflare.com/durable-objects/platform/known-issues/). Attach live diagnostics before starting a match, and keep them stable through the test. Prefer stored metrics for passive monitoring during real competitions. A replaced active question pauses with prior scores preserved; the room owner resumes with a reserve question.

Room snapshots preserve questions, scoring/rule identifiers, acknowledgements, elapsed submissions, corrections, diagnostics and anomalies. SQLite commits precede acknowledgement. An outbox exports room directories and finalized results; every export failure schedules retry without postponing an earlier question alarm. A separate per-season Durable Object serializes finalized evidence and achievement reconciliation. Team results never update solo mastery.

## Free-plan prerequisites and capacity

Verify **Workers Free** in the target account, independently of a domain's Free DNS plan. The user confirmed Workers Free for the staging account, and the authenticated dashboard was independently inspected on 2026-09-10: Free, $0, Current plan. The current OAuth login can read/write Workers/D1 but cannot read billing subscriptions; a 403 is not evidence of a Free subscription. Staging resources have been created without any paid upgrade or DNS change.

Current documented shared allowances: 100,000 Worker requests/day and 10 ms Worker CPU; D1 5 million rows read and 100,000 rows written/day, 500 MB/database; Durable Objects 100,000 requests/day, 13,000 GB-seconds/day and 5 GB total storage. Check the current [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), and [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) pricing before provisioning. Static asset delivery is free and unlimited. Exceeding Free quotas can stop service. Never enable automatic paid upgrades or create paid fallback infrastructure.

Twenty active room objects at the documented 128 MB allocation consume roughly 9,000 GB-seconds per hour, before other Durable Objects. That is only about 1.44 hours of 20-room activity within 13,000 GB-seconds, not continuous all-day capacity. Browsers use event invalidations instead of two-second room polling; connection probes run every ten seconds. Every probe still has runtime and authentication/storage work. Measure those D1 reads as well as message accounting. A 200-player pilot is not yet proven to fit Free quotas in production.

Keep PBKDF2-SHA256 at the existing 100,000 iterations. A measured staging login used 23 ms in an ordinary Worker; authentication therefore delegates expensive hashing/verification to the internal PasswordCrypto Durable Object through RPC. It exposes no HTTP route, stores no passwords, and uses bounded shards. The Worker still checks origin, rate limits and authorization before dispatch. Configure PASSWORD_CRYPTO and append its SQLite class migration; missing configuration fails closed. Deployed samples after this change measured 2–6 ms in the login Worker and 15–41 ms for separate DO verification. Measure both budgets after future authentication changes. See [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/). Measure import, solo-session, report projection and match commands under real regional latency. Unpaginated collections above 5,000 records fail explicitly rather than silently dropping records; solo progress pages its evidence. Large scopes/reports require further indexed pagination before expanding pilot size.

Migration0002 removes the redundant rowid table from Records while retaining its logical primary key and both query indexes. A fresh66-book NKJV installation consumes93,510 metered D1 writes, measured both locally and remotely, compared with124,679 on the original schema. Check the entire account's remaining daily allowance and allow room for user traffic. Apply migrations before seeding; splitting the seed into guarded portions permits usage checks before continuing. Mark the library ready only after all66 books and31,102 verses exist. An identical completed-seed rerun writes zero rows.

Test query plans with the full shared library installed. A small fixture hid SQLite choosing a scan of all canonical sources for a narrow passage. Scope resolution, season summaries, and study revision guards now constrain join order from selected packs to sources and use the existing `Records_owner` index; source lists scoped to a pack also select that index. The regression in `worker/native/application/read-budget.test.ts` meters actual D1 reads against the full canon and compares logical results, isolation, and pagination. Do not remove these query-plan constraints or indexes based only on small-fixture timings. Use passive `wrangler d1 insights` and query `meta.rows_read` for budget review; these do not attach live logs to match objects.

For a fresh launch retaining only an administrator, use the [admin-only export procedure](../../scripts/cloudflare-export-admin.md). It excludes students, seasons, history, sessions and prior content. Apply the admin SQL before the NKJV seed. If the retained account uses a development password, rotate the hosted credential in the initial INSERT while keeping its ID and username; do not publish the development credential. The source database remains unchanged. [Administrator recovery](native-admin-recovery.md) is an offline operator procedure.

## Migration and staging

1. Confirm the source database path and take an offline backup. Freeze writes for the final export; do not rely only on the main SQLite file while a live WAL exists.
2. Run `node scripts/cloudflare-export.mjs --help`, then export the explicit source. Outputs contain password hashes and student records: keep them under ignored `apps/web/test-results/migration/`, not public assets or Git. Read the manifest and [migration report](../audits/cloudflare-migration-report.md).
3. The adapter preserves IDs, exact stored cards/feedback, legacy duplicate evidence and algorithm versions. It rejects unsupported mappings and active/lobby PVP. Historical PVP is archived; if the manifest reports such history, native result/achievement projections require a separate validated conversion before claiming history parity. Current actual development data had no PVP history.
4. After confirming the Free account, create one staging D1 database, record its actual ID/account in a deployment-specific config, and apply all ordered migrations. Confirm the destination is empty before importing. Do not replace any existing database. Reconcile manifest counts, referential checks and sampled credential/card/feedback equality against the selected migration scope.
5. Deploy `wrangler.native.jsonc` with the real staging binding using `npx wrangler deploy --config <reviewed-config>`. Use a workers.dev hostname first. Set `PUBLIC_ORIGIN` to that exact HTTPS origin, or rely on same-request origin during initial staging. Keep all cloud secrets outside source files. Enable Team Practice only for the pilot organization.
6. Verify login, reset/revocation, tenant isolation, study resume, private sockets, full 5v5, timing/restart/race behavior, report corrections and the regional load/CPU/quota budget. Local Miniflare results do not replace these checks.

## Domain and rollback

Confirm the user's owned domain first. Add its zone on Cloudflare Free and export/review all current records at the existing DNS provider, including MX, SPF, DKIM, DMARC, verification and application records. Read-only DNS lookup cannot discover every existing record. Nameserver changes require access to the registrar; the current Wrangler OAuth scope is zone-read only.

After staging acceptance, prepare a concrete change set: Cloudflare nameservers, preserved records, the selected apex/app hostname as a Worker custom domain, and any canonical-host redirect. Validate HTTPS and cookies on the final hostname before opening the pilot. Do not register or transfer a domain as part of a zero-cost change. Registration renewal continues at the existing registrar unless separately requested.

Record the old nameservers/records, deployed Worker version and source backup. During rollback, freeze native writes, export D1/room evidence, restore the old host/DNS, and reconcile new native records before reopening the legacy app. The export adapter is one-way; it is not an automatic reverse migration. Never discard post-cutover student attempts or finalized scores to roll back.

Monitor Worker exceptions/CPU-limit failures, D1 row usage, DO duration, socket failures, projection retries, timing anomalies, stuck active matches, and score corrections. Free quotas and unresolved production acceptance are release gates, not reasons to silently remove functionality.
