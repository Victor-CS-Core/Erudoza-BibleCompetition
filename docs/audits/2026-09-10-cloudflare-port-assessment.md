# Cloudflare free-tier port assessment

Status: researched proposal, not a completed port or deployment. September 10, 2026.

## Recommended target

Host the React application and its existing brand assets with Cloudflare Workers Static Assets. Route `/api/*` to a TypeScript Worker using the current JSON API contracts. Use D1 for organizations, users, seasons, approved source content, individual study evidence, question versions, and finalized reports. Use one SQLite-backed Durable Object per practice room for serialized membership, invitations, private discussion, drafts, questions, and scoring. Persist an idempotent result export outbox in each room; D1 projection retries must never grant duplicate achievements or replace a newer correction with an older result.

Cloudflare DNS and Worker custom domains can serve erudoza.com and www.erudoza.com. Keep the current registrar initially; DNS hosting does not require moving registration. Registration/renewal charges remain with either registrar. Inventory and preserve all existing MX/TXT and other service records before nameserver changes. Cut over only after the Cloudflare deployment passes acceptance on a staging hostname and data is reconciled. Keep the old deployment available for rollback until the new origin is verified.

The existing frontend already has Wrangler and the Cloudflare Vite plugin. Its Worker currently proxies to .NET; it is not a Cloudflare implementation of the backend. The project has at least 44 explicit REST mappings, six deterministic solo activities, cookie authentication, credential invalidation, and a SignalR practice protocol. Moving only PVP leaves the rest dependent on an external server and therefore does not achieve the requested full port.

## Cost boundaries

Use Workers Free, D1 Free, SQLite-backed Durable Objects, static assets, and the free DNS plan. Do not provision Azure, Containers, Workers Paid, paid log services, or R2 for this first target. Store shipped art as static assets and approved textual content in indexed database tables. These choices avoid a recurring cloud hosting bill only within the account's shared quotas; domain renewal is separate.

Current documented limits include 100,000 Worker requests per day and 10 ms Worker CPU per invocation; D1 permits 5 million row reads and 100,000 row writes daily, with 500 MB per database on Free. Durable Objects have their own compute/request/storage allowances. Static asset requests are free and unlimited. Exceeding free quotas can stop service; it must not trigger an automatic upgrade.

The current unconditional room refresh every two seconds would produce 360,000 requests in one hour with 200 connected players, before login, study, or submissions. Replace it with authenticated WebSocket updates and bounded reconnect resynchronization. Avoid counting browser animation as network activity. Batch imports and projections; index tenant/scope queries; paginate reports. Measure actual rows read/written, CPU, room duration, and request usage for each acceptance workload. A 200-player service is not proven sustainable on the free tier merely because 5v5 works.

## Approved timing adaptation

Cloudflare documents that `performance.now()` equals `Date.now()` and timers advance after I/O. It does not document the same wall-clock-independent elapsed-time contract as .NET TimeProvider. Do not silently claim that substituting this clock satisfies the approved strict monotonic requirement.

User-approved adaptation: server-observed Cloudflare event time, with first accepted final submission timestamps retained and the existing integer speed formula unchanged. Capture time after complete body ingress into the authoritative room and before application queuing or grading. This includes routing/transport delay before that room receives the request, unlike timestamps from a separate frontend Worker. Never mix clocks across Worker locations or accept browser timestamps for scoring. Bind active questions to a runtime epoch; replacement after eviction/restart prevents cross-epoch comparisons. Detect backwards timestamps and invalid schedules and void affected questions for both teams. Clock anomaly checks cannot prove detection of every forward clock adjustment; this is a documented weaker guarantee, not an equivalent monotonic implementation.

The scheduling and storage design must additionally demonstrate that a deadline alarm cannot overtake an already admitted on-time final request. Durable Object event ordering and input/output gates need runtime tests; a TypeScript command mutex alone is not evidence. Hibernation is desirable between rounds, but active-question timing may require retaining the current epoch. Include that duration in the free-tier budget.

## Authentication and data compatibility

Existing passwords use PBKDF2-SHA256 with 100,000 iterations, a 16-byte salt, and a 32-byte result. A Worker implementation can target Web Crypto compatibility, but must benchmark deployed CPU limits without lowering the work factor. Existing ASP.NET encrypted authentication cookies are not portable: require a fresh login after cutover. Use secure HttpOnly same-site session cookies, hashed session tokens, expiry, immediate credential revocation, tenant checks, origin/CSRF checks, and login throttling. Do not rely on eventually consistent caches for password-reset revocation.

Use explicit export/import transformations for GUIDs, enums, decimals, dates, and archived content. Preserve user IDs, season IDs, source references, question identity/version, and mastery evidence. Existing match JSON aggregates require conversion into the new room storage model and finalized projections. Rehearse import and verify counts/checksums using synthetic or approved data before moving student records. Back up both the source data and Cloudflare data, and test restoration.

## Implementation order and acceptance

1. Native Worker build target, local D1 migrations, contract fixtures, and auth CPU/clock feasibility checks. Keep the current app usable during development.
2. Authentication, tenant authorization, seasons, roster and content management, preserving existing API shapes and UI.
3. Port all five deterministic study activities and mastery logic; compare generated activities and results against the .NET implementation on shared fixtures.
4. Port rooms and scoring into Durable Objects; replace SignalR with an explicit versioned WebSocket protocol and first-submission HTTP handling. Preserve team privacy and permission revocation.
5. Finalized report projection, appeal corrections, season achievements, retention, data migration, and backup restoration.
6. Deploy on the user's Free account to a staging hostname; run full student/coach and ten-browser 5v5 acceptance, restart/race tests, and 20-room load/quota measurement. Cloudflare account access and actual free-plan status must be verified before deployment.
7. Prepare the exact DNS change set, preserve unrelated records, migrate data during a write freeze, and cut over the domain only after acceptance. Verify HTTPS, login, WebSockets, canonical-host redirects, and rollback.

Alternative: retaining .NET behind the existing Worker is less work but still requires an external host. Cloudflare Containers do not provide the intended free-tier deployment. A full native port is recommended only if the user accepts the timing adaptation and measured workloads fit the quotas.

## Sources

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Worker performance and timers](https://developers.cloudflare.com/workers/runtime-apis/performance/) and [web standards](https://developers.cloudflare.com/workers/runtime-apis/web-standards/)
- [Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [Worker custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare plans and registrar](https://www.cloudflare.com/plans/)
