# Team Practice operations

This document's original scoring, team-size and recovery procedure describes the historical Arcade profile. The new PBE implementation is still in progress; its separate [PBE release procedure](pbe-training.md) records the accuracy-only profile, independent completion, deferred review and remaining release gates. Read saved profiles when interpreting old results. No PBE deployment is implied by this documentation update.

Team Practice is an Erudoza preparation activity. Its head-to-head results and speed bonus are not official Pathfinder Bible Experience scoring. The versioned baseline is the [NAD 2023–24 guide](https://nadpbe.org/wp-content/uploads/2023/11/How-to-Bible-Experience-2023-24.pdf); verify newer regional and NAD instructions with the competition organizer before a rehearsal. Do not advertise current official certification.

## Enable a pilot

Apply the new EF migration through the established release/migration procedure before running the new API. Production schema changes must not be delegated to an unprivileged runtime account. Existing solo-study and archived generated-question data are separate from practice records.

Persistence uses an organization-scoped `PracticeRoomRecord` aggregate: roster, invitations, snapshotted questions/rules, submissions, score adjustments, discussion, contributions, and timing diagnostics are serialized in `StateJson` and saved with a revision under the room coordinator. Question versions, feature settings, and reconciled season achievements have their own relational records. This is not a table per room sub-entity. Back up the full aggregate together; do not manually edit individual JSON fields in production.

Practice is disabled by default. A persisted organization practice setting, controlled by its coach/admin, takes precedence over the fallback `Practice:EnabledOrganizations` configuration array. For a pilot with no stored setting, configure `Practice__EnabledOrganizations__0` to the actual organization GUID. Remove bootstrap entries when managing rollout entirely through stored settings. Disabling a persisted setting overrides the configuration fallback.

Use an active season with approved content. Import and review questions as a coach, then explicitly publish them. Question sets must contain enough eligible distinct questions plus restart replacements before starting. Invite authenticated members of the same organization; public matchmaking is not enabled. Coaches moderate and do not occupy a playing seat.

## Hosting and transport

The API is the single authority for clocks, rosters, commands, and scores. Run **exactly one API process against the practice database**. Do not scale out, run a second active deployment slot, or use multiple workers against that database: an in-process room lock is not distributed coordination. A future scale-out release needs explicit room ownership and routing, not merely a SignalR backplane.

`infra/bicep/main.bicep` keeps Azure SQL, .NET 10, Always On, and explicitly selects one B1 App Service instance with WebSockets enabled. The template is a deployment scaffold, not evidence that resources are provisioned or that a region supports the requested runtime. Provide database credentials from the secret store and retain the existing approved-egress SQL firewall policy. Apply the existing production release checks before provisioning or deployment.

Configure the Sites worker's `ERUDOZA_API_BASE_URL` with the HTTPS API origin. The bridge accepts WebSocket upgrades only for `GET /api/v1/pvp/hub`; negotiation remains ordinary HTTP. Authentication cookies, origin, query parameters, and WebSocket headers are forwarded; caller-supplied proxy identity headers are removed. Successful upstream 101 responses are returned intact to preserve their Workers `webSocket`. Upgrades do not use the ordinary 15-second HTTP abort signal. Ordinary HTTP responses retain private caching and outage sanitization. The Vite `/api` development proxy enables WebSocket forwarding too.

See [Cloudflare's response API](https://developers.cloudflare.com/workers/runtime-apis/response/) for the Workers-specific upgraded response and [SignalR hosting](https://learn.microsoft.com/en-us/aspnet/core/signalr/scale?view=aspnetcore-10.0) for hosting considerations. Do not record authentication cookies, query credentials, team discussion, or unrevealed answers in telemetry.

## Timing and score interpretation

The authoritative monotonic interval begins at the shared server response start and ends when a complete final submission reaches the API, before command queuing, grading, or database work. `PracticeIngressMiddleware` buffers command bodies up to 32 KiB and records the monotonic timestamp after the final body byte is read, before authentication and model binding. Final submissions must use the authenticated HTTP room-command endpoint; the SignalR hub rejects `submit` because SignalR invocation queuing precedes the hub method. Browser time is never a scoring input. Both scribes acknowledge a shared schedule before the response window opens. Retries preserve the original final submission and interval; draft saves do not reserve time. Deadline drafts may earn accuracy points, but earn no speed bonus. Restart recovery replaces an interrupted question rather than comparing timestamps from different processes.

Keep accuracy, speed bonus, and combined score separately visible. Speed is proportional to earned accuracy points, capped at 25%, and rounded down to integer hundredths after rounding elapsed seconds upward. For a one-point question with 25 seconds available, a correct response at five seconds earns 1.00 accuracy + 0.20 speed = 1.20 total. Wrong answers earn no speed bonus. Appeals preserve original elapsed time and recompute the score.

This is server-observed response time, including network transit, not exact human thinking time. One-second steps reduce sensitivity to small timing variations but do not eliminate boundary effects. Observe round-trip latency/jitter without subtracting client claims from scores. Preserve accuracy-only criteria for Team Precision; team scores must never overwrite individual mastery.

The hub's `Probe(org, room)` returns a server-generated nonce and server time. The browser immediately echoes the nonce through `AckProbe(org, room, nonce)`. The server measures the monotonic round trip; it accepts no client duration. Nonces are bound to the user/room, single-use, replaced by newer probes, and expire after ten seconds. Diagnostics retain the last 20 successful samples: RTT is the latest sample, jitter is the mean absolute difference of adjacent samples. The next room save copies current diagnostics into the aggregate. Idle in-memory diagnostics expire after 30 minutes, with a 10,000-pair cap. These include browser processing and transport delays and are informational only.

## Verification and staged release

Run from the repository root:

```powershell
npm --workspace apps/web run test -- worker/index.test.ts worker/websocket.test.ts
```

The runtime test uses Miniflare/workerd at the production Wrangler compatibility date to perform a genuine 101 upgrade and echo frames through the bridge. It does not establish live Azure/Sites support, real authentication, or production latency. The regular worker tests cover HTTP timeout behavior, preserved authentication failures, and rejection of upgrades outside the hub.

Before enabling a pilot on the deployed environment, record the build revision and environment and verify:

- Authenticated negotiation and a real 101 upgrade through the deployed Sites hostname; two independent browser sessions complete a 1v1 match, then ten players complete 5v5.
- Same-organization invitation/role boundaries, private team messages, final answer locking, a disconnect/refresh, duplicate submission retries, and intentional API restart recovery.
- The three scoring components and original timing survive an appeal and correction; achievements are reconciled only from finalized evidence.
- Coach and student views work at 1440px, 390px, and 320px with keyboard navigation, meaningful screen-reader labels, and reduced motion.
- A controlled 20-room/200-player load run stays below 500ms p95 command acknowledgement in the deployment region. Record latency/jitter, errors, and hardware alongside the result; do not infer this from unit tests.

Monitor failed upgrades, connection drops, rejected/stale commands, prolonged acknowledgement phases, stuck rooms, restart replacements, and scoring failures. Track operational timings without recording answers or personal discussion. Verify the 30-day discussion cleanup on persisted records. Disable the organization pilot flag if correctness checks fail; retain match evidence for investigation, and avoid restarting during live rehearsal when possible.

The API exposes the `Erudoza.Practice` .NET meter: `practice.command.duration` (milliseconds), `practice.command.rejected`, `practice.phase.transitions`, `practice.start.rescheduled`, and `practice.match.recovered`. Subscribe the deployment's metrics collector to this meter and configure alerts; instrument availability alone does not configure collection or alert delivery. See the [local implementation audit](../audits/2026-09-10-pvp-implementation.md) for the benchmark that currently exceeds the latency target.

## Deployment discovery — September 10, 2026

Read-only Azure CLI checks found an authenticated account in **Azure subscription 1** (`bfc8f890-2681-43dc-8eac-51644341ae12`). `az webapp list` returned no App Services. The subscription's listed resource groups belong to Filosage staging, Kbot recovery, and Network Watcher; none is an Erudoza deployment target. No resources were provisioned or modified during this check.

The checked-in `main.test.bicepparam` is a validation fixture with placeholder credentials, not a production parameter set. `main.pvp.bicepparam` is an environment-driven release template: it requires a resource prefix, region, public origin, SQL administrator secret, and dedicated runtime connection secret. Supply `ERUDOZA_SQL_ALLOWED_IPS_JSON` as an approved JSON address list; its default is no allowed addresses. The current process has none of these release variables and no Azure service-principal variables. The CLI login establishes read access, not a tested deployment identity.

CI builds Bicep but contains no Azure login or deployment job. The existing Sites project association is in `apps/web/.openai/hosting.json`; it does not supply an Azure API origin. Before external deployment there is still no selected Erudoza resource group/runtime app, populated secure release parameters, runtime and migration SQL principals, approved firewall addresses, or verified live API binding. Do not reuse the unrelated listed resource groups. These are concrete release prerequisites, separate from passing local feature tests.

The Bicep template compiled successfully with compiler 0.47.16. A regression test generates the two new practice migrations through EF's SQL Server provider without opening a database connection; it verifies `uniqueidentifier`, `bigint`, `bit`, `datetimeoffset`, and bounded/indexable Unicode string columns. Both the migration operations and their practice target-model annotations are provider-neutral. This proves SQL generation for these additions, not execution against an Azure SQL instance or compatibility of every historical migration.

## Artwork

`apps/web/public/brand/practice/` contains five original SVG achievement medals, two team emblems, and the Team Practice illustration. They use the existing navy, teal, ivory, coral, and restrained gold palette with book, mountain, laurel, and medal motifs. Achievement titles belong in accessible interface text; displaying an asset alone must never imply an earned award.
