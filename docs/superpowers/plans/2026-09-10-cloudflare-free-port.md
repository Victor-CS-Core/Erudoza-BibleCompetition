# Cloudflare Free Port Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for bounded implementation and review tasks. Preserve the dirty baseline and do not commit unrelated work.

**Goal:** Run Erudoza on Cloudflare Free without a .NET origin, including domain hosting and authoritative team practice.

**Architecture:** React assets and a native TypeScript Worker share one origin. D1 stores indexed tenant records and credentials; SQLite Durable Objects serialize rooms. Event-driven WebSockets replace SignalR and polling. Domain cutover follows parity, migration, and live free-quota checks.

**Tech Stack:** Existing Vite/React/TypeScript, Wrangler, Miniflare/workerd, D1, Durable Objects, Web Crypto.

**Spec:** `docs/audits/2026-09-10-cloudflare-port-assessment.md`, approved by user, including conditional approval for the server event-time adaptation.

## Global constraints

- Preserve routes, API DTOs, approved content, six deterministic activities, mastery semantics, privacy, and shared UI.
- No paid products or plan upgrades. Domain renewal remains external to free hosting.
- No client-provided timing for PVP scores. Original accepted timestamps survive retries and appeals. Accuracy and speed remain separate integer hundredths.
- Research native Cloudflare clocks first; if no stronger documented option exists use the approved event clock, with explicit limitations and epoch replacement.
- Keep existing .NET host usable during the port. No live data or DNS replacement before a verified staging build and a concrete change set.
- Work on `codex/cloudflare-free-port`; preserve pre-existing uncommitted work. Review changed files rather than treating the entire baseline as this task.

## Task 1: Runtime, storage and authentication

Create `apps/web/worker/native/{types,store,auth,index}.ts`, `apps/web/migrations/0001_native.sql`, and `apps/web/wrangler.native.jsonc`. Add isolated native scripts to package.json. Native bindings: `DB`, `ROOMS`, `ASSETS`. `Actor` exposes userId, organizationId, organizationName, displayName, userName, email, kind, role, credentialVersion. `RequestContext` exposes request, env, actor, path (org-relative), orgId. `handleApplication(context): Promise<Response | null>` is the management handler; `handleStudy(context)` and `handlePractice(context)` follow that contract.

Store credentials in Users and Sessions. Store domain records in Records(kind,id,org_id,season_id,owner_id,data,revision), indexed by tenant/kind/scope and with compare-and-swap writes. JSON is canonical camelCase, dates ISO, IDs lowercase GUIDs. `Store` exports get<T>(kind,id,org), list<T>(kind,org,{seasonId?,ownerId?}), insert, put(expectedRevision), remove, and prepare helpers for transactional batches. Do not use unbounded scans for credentials. Session revocation consults current credentialVersion on each request.

- [x] Write Miniflare tests for unauthenticated rejection, PBKDF2 compatibility, origin rejection, tenant isolation, logout/reset revocation and CAS conflict.
- [ ] Run red tests before implementation.
- [x] Implement schema, native routing, body bounds, secure cookies and JSON errors. Local-only bootstrap requires an explicit local seed command; no public production bootstrap endpoint.
- [x] Run native typecheck and tests; review implementation before widening routes.

## Task 2: Deterministic activity engine

Create `apps/web/worker/native/study/engine.ts` and tests. Inputs and outputs mirror the C# Domain/Study and activity providers; expose typed pure generation/evaluation functions to the session service. Port exact normalization, deterministic selection, difficulty, repeated-token identity and mastery rules from source.

- [x] Establish reference fixtures for all five activities at all three difficulties and ordered answers.
- [x] Implement pure equivalents with tests that reject reversed, incomplete and duplicate-token answers.
- [x] Compare outcomes against existing C# tests and document any deterministic RNG mapping; preserve stored cards verbatim.

## Task 3: Organization, seasons and content APIs

Create `apps/web/worker/native/application.ts` and focused modules. Implement `handleApplication(context)` using Store and existing API contracts. Include students/password resets, content import/catalog, season CRUD/scope/activation/lifecycle, assignments/difficulty, coverage and roster semantics. Enforce admin roles and effective include-minus-exclude scope, approved content only, and no cross-tenant identifiers.

- [x] Add real D1 handler tests for lifecycle, cross-tenant operations and import rollback.
- [x] Implement handlers with bounded imports and transactional batches.
- [x] Replay existing coach setup flow against native API and fix contract mismatches.

## Task 4: Solo sessions and progress

Create `apps/web/worker/native/study/routes.ts`. Implement `handleStudy(context)` with persisted immutable cards, one accepted attempt per card, versioned mastery changes and resumable sessions. Scope must use season plus assignment and active approved content. Keep mastery independent from PVP. Atomic CAS ensures duplicate concurrent attempts cannot double-grant progress.

- [x] Add session start/next/attempt/resume/summary, difficulty and invalid answer tests.
- [x] Implement all DTOs consumed by current frontend.
- [x] Run browser student flow and source parity fixtures.

## Task 5: PVP room authority and timing

Create `apps/web/worker/native/practice/{room,scoring,routes,questions}.ts` and transport adapter `apps/web/src/api/practiceTransport.ts`. Export `PracticeRoom` Durable Object from native entry. Use durable room-local transactions, epoch identity and alarms for transitions; first complete submission ingress precedes app queue/validation. No external Worker clock is compared to room clock. Submission admission and deadline interactions receive runtime race tests.

- [x] Port all lobby commands, question validation, 1v1–5v5 flow, independent/coached roles, team-only events, caps, readiness and invitations.
- [x] Port scoring/appeals and tests for ceil seconds, partial accuracy, irreversible lock and original-time retries.
- [ ] Add clock anomaly/restart and deadline admission tests. Research hrtime, performance and alarms; record findings.
- [x] Replace unconditional two-second polling with event-driven updates and bounded reconnect; retain .NET transport when configured for legacy host.
- [x] Persist finalized result outbox and idempotent ordered D1 projections, achievements and retention.

## Task 6: Migration, free-tier deployment and DNS

Create `scripts/cloudflare-export.mjs`, operational setup/runbook and native e2e launchers. Preserve IDs, archive records, immutable cards, password hashes and score evidence; new login is required after cookie format change. Validate migration counts and referential integrity before import. Build static assets independently of the Sites-managed publication flow for the user's Cloudflare account.

- [x] Exercise native build, lint, typecheck, tests and migration round-trip.
- [ ] Run coach/student browsers and full ten-player PVP, restart/correction and quota/load tests.
- [ ] Read Cloudflare account/zone/plan availability; deploy only free resources with explicit verified account and bindings.
- [ ] Verify staging HTTPS/auth/WebSockets before preparing nameserver/domain changes; preserve existing DNS/mail records and establish rollback.

## Execution ledger

- Ruling: use the current working tree on a new feature branch because the approved app exists in extensive uncommitted baseline changes; a clean HEAD worktree would omit the implementation being ported.
- Ruling: do not commit baseline changes to manufacture review diffs. New modules and task-scoped diff files are review surfaces.
- Preflight: tasks 1/3/4/5 share RequestContext and Store; task 2/4 share the pure engine; task 5 owns transport only; task 6 consumes bindings/build outputs. Parent owns shared entry/config/schema to avoid conflicts.
- Timing research verified: neither performance.now, process.hrtime nor alarms supplies the original monotonic contract. User-approved server-event adaptation implemented; operational details in docs/operations/cloudflare-native.md.



- Local evidence: 227 web/runtime tests passed (opt-in load test separately passed); 5 migration tests passed; native build/lint passed; browser solo and private PVP flows passed at 320/390/1440px; full ten-question 5v5 completed with refresh and achievements. A 90-question coached state-machine rehearsal and delayed-auth ingress ordering also passed.
- Local load: 20 active rooms, 200 users/sockets, 200 simultaneous discussion commands; p95 1569.71ms, above 500ms. Regional latency, deployed CPU/quota behavior, forced remote eviction and DNS cutover remain release gates.
- Domain confirmed: erudoza.com registered at GoDaddy. Preserve iCloud Mail records; see docs/operations/erudoza-cloudflare-dns.md. Workers Free billing verification still unavailable through current OAuth scope.
