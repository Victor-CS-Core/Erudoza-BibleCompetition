# Cloudflare port verification — 2026-09-10

The native port is implemented locally on `codex/cloudflare-free-port`. No Cloudflare resource, production data, subscription, domain registration, nameserver or DNS record was changed. The existing app remains the live host.

## Verified locally

- `npm --workspace apps/web run test`: **227 passed, 1 skipped** across 39 passing files. The skipped native load test is opt-in and was run separately. Native runtime/study/scoring tests are included in this count.
- `npm --workspace apps/web run lint`, native typecheck and `build:native`: passed.
- `dotnet test apps/api/Erudoza.sln --no-restore --verbosity quiet`: **48 unit + 108 integration tests passed, 1 integration test skipped**.
- `node --test scripts/cloudflare-export.test.mjs`: **5 passed**. The actual source file was read without modification, roundtripped through SQLite, then converted records were exercised in Miniflare for original session/card/feedback replay. The CLI `--help` was separately checked after adding argument validation.
- Real local workerd/Miniflare browser: full **5v5, ten authenticated browser contexts, ten scored questions, refresh recovery, First Fellowship and Shared Scribe awards** passed. Its initial run was interrupted by a development rebuild replacing asset files; the launcher now freezes assets per run. The successful rerun took approximately 5.4 minutes for the scenario.
- Final native browser run: **2 passed** — coach setup → all five solo activities across eight correct cards → reload/resume → student/coach progress; plus private PVP invitations, team swap/readiness, live sockets, private discussion, speed scores and appeals. Screenshots/overflow checks cover coach/student 320, 390 and 1440px. The 320px coach season overflow was a visually hidden step label outside its positioned parent; containing it in the tab button fixed the actual overflow without changing the theme.
- A complete 90-question coached state-machine rehearsal verifies judging, five-minute break, completion, accuracy-only achievements, preserved appeal timing and provisional award withdrawal. This is not a 90-question browser or deployed rehearsal.
- Controlled 1.5-second authentication delay in a **test-only compiled fixture** verifies that an earlier complete submission stays first despite later requests and forged client timing. The production bundle has no delay-header hook. Pure state tests exercise all five team sizes, start acknowledgement rescheduling, pending deadlines and epoch replacement; scoring tests cover integer boundaries, order, partial answers and .NET Unicode normalization semantics.
- Review fixes include input whitelisting for room/tenant identity, ingress queue reservation before authentication, durable outbox retries on every path, constant-parameter JSON revision guards, set-based legacy mastery rebuild across 60 sessions, and replay of original migrated duplicate-submission feedback without duplicate progress.

## Performance result and outstanding gates

The opt-in local workerd workload opened **20 active rooms / 200 authenticated players / 200 WebSockets**, then issued 200 simultaneous discussion commands and scored both teams' submissions. Functional assertions passed. Local p50 was **1523.49 ms**, p95 **1569.71 ms**, maximum **1571.92 ms**. This **misses the 500 ms target** and is not a deployment-region benchmark. The raw report is in ignored `apps/web/test-results/native-load.json`.

Do not claim production readiness, zero-cost unlimited capacity, or equivalent .NET monotonic timing. Before production cutover:

1. Confirm Workers Free in the user's Cloudflare account. Current Wrangler OAuth cannot read billing subscriptions; the browser requires sign-in. A Free DNS zone alone does not confirm Workers billing.
2. Create and verify staging bindings, import reviewed data, and measure actual regional command latency, PBKDF2/login CPU, D1 row usage, DO duration and quota failures. Keep the existing password work factor. Address the 500 ms target before claiming it is met.
3. Exercise deployed HTTPS/WebSockets, forced runtime replacement, deadline/queue races under simulated network delay/jitter and restart recovery. Local tests are evidence of implementation behavior, not Cloudflare production scheduling guarantees.
4. Review collection sizes and migration manifest blockers. Unpaginated collections over 5,000 records fail explicitly. Historical legacy PVP remains archived pending a separate native projection if such data exists; the verified development source contained none. Further production-scale indexed paging and history conversion are not implied by passing small-fixture tests.
5. Export the entire GoDaddy DNS zone and preserve iCloud Mail. Confirm the exact Cloudflare nameservers/custom-domain/redirect change and rollback before cutover. See [DNS preparation](../operations/erudoza-cloudflare-dns.md).

The implementation and operating contract are documented in [Cloudflare native operations](../operations/cloudflare-native.md). Broader pre-existing and concurrent workspace changes were preserved; no commit or push was performed in this task.
