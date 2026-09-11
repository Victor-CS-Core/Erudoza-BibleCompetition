# Team Practice UI Implementation Plan

> **For agentic workers:** Use subagent-driven-development for the independent hub, room and shared-navigation tasks. Root owns integration, original artwork, verification and checkpoints.

**Goal:** Implement the user-approved Team Practice preview faithfully, improve Room setup & Invitations, and verify both roles across phone and desktop layouts.

**Architecture:** Preserve the existing practice APIs, room transport, command revisions/timestamps and query ownership. Split the hub into `PracticeHub.tsx`; retain room behavior in `PracticePage.tsx` while reorganizing its presentation. Apply the approved responsive composition with shared primitives/tokens and `PatchArtwork`. Implement stable mobile destination bars through the existing shared frame.

**Tech Stack:** Existing React/TypeScript, React Query, React Router, shared UI primitives, native Cloudflare and canonical .NET transports; no new runtime dependency.

**Spec:** [Source-grounded redesign brief](../../product/2026-09-11-team-practice-redesign.md). Visual authority: [approved interactive preview](../../product/mockups/2026-09-11-team-practice.html), including its CSS/JS. User approved everything except requesting refinement of Room setup & Invitations; approval includes the shown mobile navigation and three core patches.

## Global constraints

- Reproduce the preview's dimensions, hierarchy, palette, text branding, patch silhouettes and mobile composition. Real server data replaces demonstration values; never copy the mockup's simulation controls, fabricated counts or timer into application code.
- Preserve native/canonical request contracts, revisions, roles, deadlines, scoring, private discussion, readiness, appeals and finality. No backend migration or API change is planned.
- Use shared controls and semantic tokens. Every patch uses `PatchArtwork`, with stationary hit bounds, contour shadows, reduced motion and touch rest.
- Room setup/invitations should show current team capacity, a clear invite action/destination and separate roster management. Do not promise unavailable invitation tracking or editable persisted setup.
- New Team Honor artwork must be shown before application, per the user's standing asset-review request. Core patches are already approved. Keep artwork/implementation approval distinct from deployment.
- Preserve desktop navigation and saved pins; mobile has HQ/Study/Honors/More for students and Overview/Seasons/Students/More for Coaches. Focused active matches have explicit return navigation and no obstructing dock.

## Work allocation and interfaces

### 1. Approved assets and visual reference — root

- [ ] Record approval in design guidance; preserve the approved mockup as the comparison reference.
- [ ] Create `/brand/practice/{team-a,team-b,team-practice}-{256,512}.webp` from exact approved masters and verify hashes/dimensions/alpha.
- [ ] Create `features/practice/PracticePatch.tsx`: export `PracticePatch({kind,size?,className?})`, with `kind` limited to `team-a | team-b | team-practice`, default size 120, delegating to shared `PatchArtwork`.
- [ ] Generate/show five dedicated Team Honor patch proposals; integrate only after their asset approval.

### 2. Hub — hub agent

Files: new `features/practice/PracticeHub.tsx`, `practice-hub.css`, focused hub tests. Export `PracticeHub()` with no props; it owns the existing hub's auth/bootstrap/create/invitation/query state. Do not edit `PracticePage.tsx` or shared room CSS.

- [ ] Reproduce the approved hub's identity/room-action and setup columns; map real active room/invitation/empty/disabled states accurately.
- [ ] Preserve supported 1v1–5v5, 10/30/90 questions, actual Coach format choice, scope, season requirements and command destinations.
- [ ] Keep existing rooms, invitations, earned Team Honors/trends and Coach question editor findable with their current anchors.
- [ ] Use root's `PracticePatch` for core art. Preserve unapproved Team Honor assets until root supplies the approved mapping.
- [ ] Run meaningful focused tests for invitation destinations, real form choices and empty/disabled/error behavior. Report exact outcomes.

### 3. Room states and setup — room agent

Files: `features/practice/PracticePage.tsx`, `practice.css`, optional focused presentation helpers and room tests. This agent is the sole editor of `PracticePage.tsx`. Replace its hub body with `<PracticeHub />`; preserve `PracticeRoomPage` transport/query/action effects.

- [ ] Reproduce opposing lobby team cards and top Ready/Start controls with actual capacity/readiness/roles.
- [ ] Improve setup/invitations: readable immutable match summary, two capacity indicators, clearly labeled available-player/destination selection and send result, separate owner roster management. Disable impossible full-team choices. Preserve teammate/owner invite restrictions and join/leave/move/swap/remove/ownership/captain/scribe commands.
- [ ] Put approved scoreboard/phase above question; retain multipart answers, authoritative timer, scribe draft/final answer, private discussion and connection recovery.
- [ ] Preserve Coach presentation/review controls, paused/break behavior and required judgments. No early Response advancement.
- [ ] Reproduce result composition with actual accuracy/speed totals, unresolved finality, evidence disclosure and appeals. Treat abandoned/empty states correctly.
- [ ] Keep mobile order/geometry consistent with preview; retain all role-specific controls with 44px touch targets and no page overflow.
- [ ] Run focused role/readiness/timer/judgment tests and report exact outcomes.

### 4. Mobile navigation — navigation agent

Files: `layouts/TrainingAppFrame.tsx`, `styles/command-center.css`, relevant navigation tests and support-widget CSS only if required. No practice-page edits.

- [ ] Add fixed four-item mobile destination bar, preserving stable order, selected-season links and More selection for remaining destinations.
- [ ] Keep top text-brand/search/account row; remove duplicate mobile shortcut strip; preserve desktop pins and commands.
- [ ] Use current command center for More/search and restore focus. Preserve nested Coach navigation.
- [ ] Avoid active-match bottom overlap through a query-backed room status or scoped CSS driven by real room presentation; coordinate with room agent. Offset the support widget using the shared dock dimension, safe-area padding and scrolling room.
- [ ] Verify current/unpinned routes, role scopes, selected-season navigation and desktop retention in focused tests.

### 5. Integrated verification and checkpoint — root

- [ ] Review task diffs against source constraints and preview; resolve concrete review findings in a bounded correction batch.
- [ ] Run full frontend tests with bounded workers, ESLint, web/native type checks and both production builds.
- [ ] Reuse `e2e/practice.spec.ts` and native/canonical local recipes for genuine creation/invite/accept/ready/swap, private discussion, final answer, judgment/appeal, refresh and a complete 5v5 match. Repair stale UI selectors exposed by the changed layout only.
- [ ] Compare approved preview and app at 1440/390/320 with equivalent local synthetic data. Capture Coach/student hub/lobby/live/results and setup/invitation open/full/empty states. Check long labels, 5v5, multipart answers, form controls, safe area, keyboard focus and no horizontal overflow.
- [ ] Verify actual patch pointer lift/dip, reduced motion and coarse input in the application, plus landing/login and student/Coach shared-header regressions.
- [ ] Record precise validation/limits in audit and PROGRESS; explicitly stage scoped changes, commit/push the authorized private task branch and show local implementation. No merge/deployment without its separate authorized action.
