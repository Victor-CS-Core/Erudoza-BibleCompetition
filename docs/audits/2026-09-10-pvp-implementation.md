# Team Practice implementation — September 10, 2026

## Delivered locally

Team Practice adds organization-gated private 1v1–5v5 rooms, room/team invitations, lobby reassignment and swaps, readiness, ownership transfer, captain/scribe roles, private discussion, and independent or non-playing-coach matches. Approved, published, versioned questions are constrained by the season's effective Scripture scope. Match snapshots preserve question and scoring versions. The editor and validated JSON import support deterministic scoring parts without AI grading.

Final submissions use authenticated HTTP so the API can timestamp the complete body before command queuing, authentication, and database work. SignalR carries other live commands and invalidation events. Injectable monotonic server timing controls shared acknowledged starts, deadlines, retries, automatic draft locking, and restart replacement. Scores persist accuracy and up-to-25% speed bonuses separately in integer hundredths. Appeals retain the original elapsed time.

Reports keep team evidence separate from individual mastery. Five season achievements reconcile from finalized evidence under a season-wide lock through persistence. Eight original SVG assets match the existing design system. Coach and student routes reuse shared controls and semantic tokens; practice code is loaded separately from the initial application bundle.

The implementation uses durable JSON room aggregates plus separate question versions, feature flags, and canonical achievement records. Membership, invitations, match snapshots, submissions, and adjustments are embedded in the transactional aggregate rather than separate relational tables. This preserves atomic room transitions but is an explicit architecture deviation from the proposed normalized schema; history/report scans need profiling before larger rollout.

## Verification evidence

- Web lint, TypeScript checks, production build, and all **155 tests in 26 files** passed locally. The Workers runtime test performs a genuine WebSocket 101 upgrade and frame echo; it does not establish deployed Sites authentication.
- The final backend suite passed **48 unit tests and 101 integration tests**; the separately executed opt-in load test was skipped in the regular suite. Coverage includes scoring boundaries, partial credit, authoritative ingress, delayed commands, clock changes, retries, schedule acknowledgements, restart recovery, scope exclusions, authorization, simultaneous achievement reconciliation, and migration SQL for SQLite and SQL Server.
- Browser acceptance passed for real authenticated SignalR connections, private discussion, lobby swaps, irreversible HTTP submissions, appeal corrections, and responsive layouts. A full **5v5 ten-question match passed in 5.5 minutes** with ten independent authenticated browser contexts. The scribe refreshed and reconnected before question three. Completion produced 20 results, 1,000 accuracy hundredths per team, positive speed bonuses, First Fellowship for all ten players, and Shared Scribe for both scribes.
- Coach, student, and match screenshots were checked at 1440, 390, and 320 pixels. Assets were visually inspected. Automated accessible names and keyboard checks do not substitute for a full assistive-technology audit.
- Targeted whitespace checks passed with CRLF recognized as line endings.

## Release gaps

The opt-in local load test preserved all commands and scores across 20 rooms / 200 players, but its latest 240-command burst measured **830.70 ms p95** (516.20 ms p50, 855.60 ms maximum), exceeding the requested **500 ms** target. This measures local SQLite service/database acknowledgement, not regional HTTP/WebSocket latency. SQLite writes remain serialized and durable. Do not interpret this result as production performance approval.

Azure and Sites production integration is prepared but not deployed. Read-only discovery found no Erudoza App Service or resource group in the authenticated subscription. Secure release parameters, a selected target, SQL principals/firewall configuration, and a live API binding remain required. Bicep compilation and SQL generation passed; deployed migration execution, authenticated Sites matches, regional load testing, and operational alert wiring remain unverified.

The API must run as one authoritative process; a SignalR backplane alone does not permit scale-out. Keep the organization feature flag off until the deployed acceptance checks pass. PVP victory and speed scoring are Erudoza practice adaptations. Rules are versioned to the 2023–24 NAD-linked guide, without claiming newer official conformity.

See [the operations runbook](../operations/pvp.md) for setup, timing interpretation, and deployment checks.
