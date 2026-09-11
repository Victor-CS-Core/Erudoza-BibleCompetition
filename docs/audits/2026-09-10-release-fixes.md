# Release fixes — 10 September 2026

This is the remediation follow-up to `2026-09-10-release-readiness.md`. That earlier report records the pre-fix audit. No production service was provisioned or deployed in this work.

## Implemented

- **Account isolation:** cancel and clear cached queries at login/logout/expired authentication, remove pending answer storage, scope student queries to user and organization, and discard late authentication refreshes from a previous account. Regression tests cover a failed request, a delayed request and account switching.
- **Session security:** validate every cookie against the current active user, organization membership, role and credential fingerprint. Password changes revoke existing cookies; a persisted SecurityStamp prevents deactivation/reactivation from resurrecting a cookie. The additive migration preserves existing data. Existing pre-update cookies require a fresh sign-in.
- **Login abuse control:** fixed-window rate limiting with HTTP 429 and Retry-After guidance. Production tuning and shared proxy egress limitations are explicit in the runbook.
- **Coach lifecycle:** correct or remove individual assignment passages, close active seasons, archive seasons, deactivate/reactivate students. Existing attempts, mastery and review history are preserved. Closed seasons reject further edits and study. Student scope checks reject stale open cards after assignment removal/correction. Destructive or access-changing actions use the existing shared confirmation dialog.
- **Outages:** authentication distinguishes HTTP 401 from connection/server failures; protected pages offer retry. The Worker returns non-cacheable 503 responses for network/timeout/upstream failures and strips untrusted forwarding headers.
- **Production safety:** demo seeding/debug answers disabled by default, seeding limited to Development, debug answers limited to Development/Testing, production startup validation, Secure cookies and configurable persistent Data Protection keys. Offline migration, initial coach bootstrap and coach-password recovery commands are implemented without passwords in command arguments.
- **Deployment preparation:** secure SQL connection parameter, narrow firewall configuration, backup retention, matching .NET SDK/CI pin, operational runbook, and packaged output excluding local environment files.
- **Browser journeys:** current selectors and confirmation flows, real deterministic activity solving without debug answers, isolated API/Worker configuration, temporary databases/artifacts and randomized test credentials. Long season names wrap on narrow screens.
- **Theme payload:** lossless WebP copies reduce the two delivered images from 5,696,832 to 3,858,096 bytes (32.3%). Decoded RGBA pixels were compared byte-for-byte. Original PNG assets are retained. Rehearsal copy now describes competition-style practice.

## Verification

A passing local suite does not establish production acceptance. Another active task, **Design Bible Bowl PVP Mode**, is concurrently modifying this checkout; validation below distinguishes the audited fixes from that evolving combined tree.

- Before the concurrent PVP integration: 142 frontend tests, 99 .NET tests and 24 real-API desktop/mobile E2E checks passed; frontend lint, typecheck and build passed.
- After the packaging regression test and concurrent frontend additions: 150 frontend tests and lint passed. A transient frontend build failure in unfinished PracticePage files cleared on the next typecheck and full production build. That combined frontend build passed, with a bundle-size warning after the PVP additions.
- The final combined API build is currently blocked by 14 missing-symbol errors in the in-progress `PracticeCommands.cs`/`PracticeService.cs` (View, Advance, Presentation, AddSubmission, Schedule, Next, ReconcileAwards). Consequently the final combined E2E rerun could not start. Those files belong to the other active task and were preserved. The running local API remains the successfully tested audit-fix build.
- The production packaging regression passed and generated output was checked for absence of .env/.dev.vars variants.

- .NET: 29 unit tests and 70 integration tests passed, including password revocation, deactivation/reactivation, throttling, lifecycle operations, migration preservation and unsafe production configuration rejection.
- Offline `--migrate-only`, `--bootstrap-admin`, and `--reset-admin-password`: all exited successfully on a fresh temporary SQLite database using synthetic credentials and production configuration safeguards. Azure SQL execution remains an external gate.
- Bicep template and parameter file compiled; no resources were created.
- Local API and same-origin frontend bridge health endpoints returned HTTP 200. Coach sign-in and the student directory were verified in the in-app browser after restarting the updated API.

## Local data and running app

The API is running at http://localhost:5080 and frontend at http://localhost:5173. A SQLite online backup passed `PRAGMA integrity_check` before the local migration: `apps/web/test-results/before-release-fixes-20260910-135256.db` (ignored local artifact).

An initial E2E attempt exposed a configuration-isolation bug: the Worker followed the existing `.dev.vars` local API address rather than the intended temporary API. It created these synthetic local records:

- Season `E2E study 1789062009993` (`20e2f4c2-212d-4b49-bcfc-bd66ea5f0d74`) and its test assignment/attempt.
- Season `Imported dev-joshua-1789062018526` (`0ef16a0d-dd40-436a-af9e-e03489199443`).
- Pack `dev-joshua-1789062018526`.
- Student `reset.student.1789062027669` (`cddd7263-6627-47df-81ee-572e3e999e94`).

They were left intact, not automatically deleted. The final test launcher uses a fresh Worker configuration and randomly generated seed credentials, so accidentally targeting the normal local API cannot authenticate. The original `.dev.vars` remains unchanged. Final test data was verified in the isolated database.

## Release decision

**The audit fixes are implemented and locally tested. The full moving checkout is not release-ready:** finish and verify concurrent PVP integration, then complete external release validation. See `../operations/production-release.md` for the procedure.

Outstanding release gates: authorized Azure/Sites configuration, migration and realistic concurrency/load checks on Azure SQL, HTTPS/cookie/bridge acceptance, persistent key verification across restart and scale, tested backup restoration, monitoring and alerts, and passing remote CI for the chosen release revision. Validate login throttling behind actual Worker egress before onboarding a class. No production deployment, load-test result, restore-drill result or remote CI result is claimed.

Dedicated screen-reader/zoom/contrast checks, constrained-network performance measurement and Safari/Firefox validation remain unperformed. No formal accessibility or performance certification is claimed.
