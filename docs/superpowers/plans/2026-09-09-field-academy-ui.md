# Field Academy UI implementation plan

**Goal:** Implement the user-approved Training HQ, focused practice, and coach workspace mockup.
**Architecture:** Keep React Router, authentication, study mutations, and organization-scoped APIs. Introduce a responsive shared application frame and dashboard components; scope visual styling to the authenticated app.
**Tech stack:** React 19, TypeScript, React Query, CSS, Vitest, Playwright.
**Design:** Approved image in this task: navy navigation, parchment surfaces, teal controls, mountain banner, compact progress table. Mobile uses compact navigation and a focused study view.

## Constraints
- No API or schema changes; no sample progress, invented awards, or unsupported season-mastery denominator.
- Preserve active-season and due-review gating, all existing routes, sign-out and activity behavior.
- Keep imagery decorative and UI text accessible; use real buttons, labels, focus states and responsive layouts.

## Tasks
- [x] Add regression coverage for dashboard gating, real progress, coach season selection, navigation and errors.
- [x] Build a shared frame with responsive role-specific navigation and active-mode routing.
- [x] Replace learner deck/folio dashboard with training banner, next action, progress and review panels.
- [x] Build coach overview from seasons and coverage, deduplicating student metrics across assignments.
- [x] Restyle focused study and progress without changing scoring, persisted attempts, or session completion.
- [x] Run frontend tests, typecheck, lint and production build; inspect desktop and mobile views with API fixtures clearly separated from production data.

## Verification
105 frontend tests pass; lint, typecheck and production build pass. Playwright checks cover desktop and 320/390px mobile views with isolated API fixtures. The installed SDKs do not include the required .NET 10.0.400, so a live backend end-to-end run was not performed. No deployment or database changes.
