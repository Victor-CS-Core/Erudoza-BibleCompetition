# Release readiness audit — 10 September 2026

> Follow-up: the approved code fixes and current release gates are recorded in [Release fixes](2026-09-10-release-fixes.md). This report remains the historical pre-fix audit.

## Decision

**Not ready for public release.** The core coach/student training flow is functioning in local tests, but privacy, production setup, security controls and workflow corrections remain release gates. Appropriate for continued supervised testing with synthetic data; this is not a production certification.

This was a read-only application audit. No application source or production configuration was changed, no real student records were modified, and no deployment was performed. Test artifacts and this report were created locally.

## Priority findings

### P1 — Student data survives account switching in the browser

`apps/web/src/features/student/StudentHomePage.tsx:11` uses shared `assigned-seasons` and `progress` query keys without the authenticated user or organization. `apps/web/src/app/providers.tsx:5` creates a persistent QueryClient, and `apps/web/src/auth/AuthContext.tsx` changes authentication state without clearing private cached queries.

**Reproduced with browser fixtures:** Student A loads a private season, signs out, and Student B signs in in the same SPA. When B's progress request fails, A's season name remains in B's current-season header. The progress panel correctly shows an error, but the header still reveals cached data. While a fresh request is pending, cached query data is also eligible for rendering.

**Release gate:** cancel in-flight private queries and clear user-specific caches on auth changes; include user/organization identity in private query keys. Add same-device account-switch tests, including failed and slow requests. Do not infer a server authorization bypass from this client-side disclosure.

Evidence: `apps/web/test-results/release-cache-check.mjs` and `release-cache-leak.png` (ignored local artifacts).

### P1 — Production configuration is incomplete and unsafe by default

`apps/api/src/Erudoza.Api/appsettings.json` enables seeded accounts with documented demo credentials and `ExposeDebugAnswers=true`. `Program.cs` seeds in any non-Testing environment unless explicitly disabled. `ApiEndpoints.cs:556` checks only configuration for debug answers, not environment.

The local running API was previously launched with debug answers disabled; that does not make a fresh deployment safe. A deployment inheriting repository defaults can expose answer data and create known credentials.

**Release gate:** production-safe defaults, fail-fast validation of required production settings, explicit development-only seeding/debug behavior, and production smoke tests proving demo login and answer leakage are unavailable.

### P1 — Hosting and database configuration do not form a deployable release

`README.md` states the .NET production API is not yet connected. `apps/web/worker/index.ts` returns 503 without `ERUDOZA_API_BASE_URL`. No production binding is present in the checked-in Worker configuration; an external configured binding was not inspected.

The checked-in Azure template sets `Database__Provider=SqlServer` but supplies no SQL connection string or managed-identity database access configuration. The application otherwise falls back to the SQLite-style `Data Source=erudoza.dev.db` connection string. It also lacks safe seed/debug overrides. Sites and the legacy Azure template need an explicit, coherent deployment choice.

**Release gate:** choose and provision the actual API/database host, configure the same-origin bridge and secrets, verify HTTPS authentication, run migrations on the chosen database, and execute a deployed coach-to-student journey. Establish backup/restore, rollback, key persistence and operational alerts. These were not validated against production resources.

### P1 — Authentication needs release hardening

`StudentDirectoryService.ResetPasswordAsync` updates only PasswordHash. Cookie authentication in `Program.cs` has sliding 12-hour tickets and no principal/security-version validation. Existing signed-in sessions therefore have no implemented invalidation mechanism after a password reset or account-state change. Login contains no application-level throttling or lockout policy. An external gateway policy, if any, was not inspected.

**Release gate:** invalidate prior sessions after credential/security changes, revalidate account status, add login abuse controls, and test the deployed cookie/CSRF/origin behavior. Cookie HttpOnly and SameSite=Lax are present; no CSRF exploit was claimed or attempted.

### P1 — Coaches cannot correct the full assignment lifecycle

`SeasonWizardPage.tsx` lists saved passages, adds new assignments, and changes difficulty. The API exposes assignment creation and difficulty updates, but no assignment removal or passage replacement endpoint. A coach who assigns the wrong range cannot remove it through the app. Adding the correct range leaves the incorrect range available too.

The UI understands Active/Completed/Archived states, but the exposed workflow has no close/archive transition. Students likewise have no administrative deactivation action. Content-pack deletion is correctly blocked by season/assignment references, making abandoned setup cleanup harder without lifecycle operations.

**Release gate:** safe assignment correction/removal with explicit treatment of active sessions and historical progress, plus an agreed minimal season/student lifecycle. Avoid deleting study history as a shortcut.

### P1 — Checked-in end-to-end tests no longer match the product

`apps/web/e2e/admin-to-student-study.spec.ts` still expects `assign-student-select`, old chapter tabs, old learner chrome and pre-confirmation activation. `login-phone.spec.ts` expects removed kraft/field-guide elements. `student-password-reset.spec.ts` expects the old reset submit test ID and navigation. The current source no longer provides these interactions.

`playwright.config.ts` may reuse a running local API and contains a shell-specific `printf` startup command. Running the full configured suite against this workspace would risk using the user's development data, so it was not run. A read-only login-test-only runner attempt did not complete and was stopped; no passing E2E/CI result is claimed.

**Release gate:** update E2E journeys to current UI, use isolated reproducible databases, remove dependence on debug answers, and obtain a clean CI result for the exact release revision. Local fixture scripts passing are not a replacement for the checked-in CI journey.

## Additional gaps

- **Coach account recovery:** login has no adult password-recovery/change flow, and the exposed password-reset endpoint only handles students. Define an operational recovery path before onboarding real coaches.
- **Outage handling:** AuthContext treats all `/me` failures as signed-out state, so a backend outage looks like a login problem. Worker upstream fetch errors have no explicit user-oriented recovery handling. Distinguish expired authentication from service unavailability.
- **Content/product wording:** student rehearsal says “Short-answer training” although the supported engine uses five deterministic activity types and no generated Short Answer provider. Clarify what competition rehearsal actually simulates before advertising competition fidelity.
- **Mobile payload:** training landscape and badge PNGs are approximately 2.7 MB and 3.0 MB respectively. Optimize delivered assets and measure performance on a constrained connection. No Lighthouse/Core Web Vitals or load-test result is claimed.
- **Accessibility:** native controls, labels, shared confirmations and fixture desktop/mobile layouts are encouraging. Dedicated screen-reader testing, text zoom, contrast measurement and Safari/Firefox coverage remain unperformed. No accessibility compliance certification is implied.
- **Documentation drift:** older activity audit reports contain superseded AI/activity descriptions and historical test counts. The README also mixes Sites, future Firebase storage and optional Azure infrastructure. Consolidate a release runbook around the actual supported architecture.

## Current validation

- Frontend: **126 tests passed**, 20 test files; lint passed.
- Backend: **29 unit + 56 integration tests passed** (85 total), isolated test databases. This includes scope/difficulty, study integrity, authorization, migration and content deletion tests present in the repository.
- Production frontend build: passed, including TypeScript checking. JavaScript bundle approximately 420 kB / 126 kB gzip; referenced raster assets are additional payload.
- Browser regression script: passed 10 desktop/mobile fixture views, coach navigation, difficulty preview/update, study submission, duplicate-submit prevention, refresh recovery and next-card behavior.
- Account-switching isolation probe: reproduced cached season disclosure using synthetic users and a simulated failed network response.
- Backend suite was run from outside the checkout using installed SDK 10.0.303 because `global.json` pins unavailable 10.0.400. This is a toolchain reproducibility gap, not proof that the pinned SDK build passes.

**Not verified:** production endpoint/configuration, current remote CI, SQL Server migration execution, backup restoration, multi-instance concurrency/load, external perimeter security, dependency vulnerability scanning, and a fresh full real-API browser journey. Existing earlier real-API evidence is historical, not a current release sign-off.

## Recommended order

1. Fix account-switch cache isolation and authentication revocation/abuse controls.
2. Make production configuration safe and connect the chosen persistent API/database deployment.
3. Implement assignment correction/removal and required lifecycle operations.
4. Repair E2E/CI and test the exact deployment with debug answers disabled.
5. Validate backup/restore, monitoring, accessibility and mobile performance; resolve the remaining product-copy and recovery gaps.

Then reassess a limited pilot before a public launch.
