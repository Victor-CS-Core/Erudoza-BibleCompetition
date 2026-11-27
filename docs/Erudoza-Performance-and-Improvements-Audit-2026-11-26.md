# Erudoza Performance and Improvement Audit

**Date:** 2026-11-26  
**Repository:** `Victor-CS-Core/Erudoza-BibleCompetition`  
**Commit reviewed:** `02b1392`  
**Scope:** Read-only performance review following the full QA/code audit. No source or deployment changes were made.

## Summary

The app is already using route-level lazy loading and the audited builds/tests pass. The main opportunities are not correctness fixes; they are reducing repeated aggregate work, tightening polling, and improving scale behavior as clubs accumulate rooms, questions, attempts, and seasons.

## Ranked opportunities

### P1 — Make Team Practice bootstrap polling adaptive

`apps/web/src/features/practice/PracticeHub.tsx` polls `/practice/bootstrap` every 15 seconds in the browser (60 seconds on the native Cloudflare path). The bootstrap is not a small health check: it loads seasons, scoped rooms, player directory data, room summaries, memberships, questions for coaches, awards, overlays, trends, and simulation achievements.

Recommended change:

- Poll quickly only while the learner/coach has an active or lobby room.
- Pause polling when `document.visibilityState === 'hidden'`.
- Use a slower interval (or manual refresh) for an idle hub.
- Return an `ETag`/revision and short-circuit unchanged bootstrap responses.
- Keep the existing server-side viewer scoping and 5,000-row safety limit.

Expected benefit: lower D1/worker load and less repeated JSON parsing without reducing live-room responsiveness.

### P1 — Cache or materialize PBE readiness aggregates

`apps/web/worker/native/pbe/readiness.ts` rebuilds readiness on every request by loading the resolved bank, all relevant projections, all solo attempts, all solo sessions, and all room summaries before calculating six dimensions. This is correct and bounded, but its cost grows with a learner's history and the season's room history.

Recommended change:

- Cache by `(orgId, studentId, seasonId, evidenceRevision)` with a short TTL.
- Invalidate on accepted PBE attempt, finalized room, projection replay, or question-bank publication.
- Prefer aggregate SQL/count queries for precision/composure where possible; fetch session-card metadata only for ExactWords and timed-mode classification.
- Keep the current null/“Not measured yet” semantics.

Expected benefit: faster PBE Readiness loads and predictable latency for experienced learners.

### P1 — Replace repeated linear scans in training views with maps

The training query path contains avoidable repeated scans:

- `trainingScope()` uses nested `some()` calls while matching assignments/introduction assignments to seasons.
- `journey()` repeatedly searches the full source/state collections for each source (`find`, `filter`, and `some`).

Recommended change: construct `Map`/`Set` indexes once per request (`seasonId → assignment`, `knowledgeUnitId → mastery`, `book/chapter → source count`) and build chapter summaries in one pass.

Expected benefit: avoids quadratic behavior when assignments or assigned passages become large.

### P2 — Reduce first-load and route-chunk weight

The production web build completed successfully, but the generated client chunks show several optimization targets:

| Chunk | Raw | Gzip |
|---|---:|---:|
| Main `index` | 277.69 kB | 83.96 kB |
| Practice page | 183.19 kB | 47.47 kB |
| Wiki page | 138.37 kB | 43.35 kB |
| Shared UI | 109.28 kB | 36.55 kB |
| Global CSS | 157.73 kB | 28.02 kB |

The route pages are already lazy-loaded, so these are not all downloaded on the first visit. The next step should be bundle analysis rather than blind splitting:

- Keep PBE/Practice authoring code out of the learner study chunk where possible.
- Split large wiki/legal content from interactive shell code.
- Audit the shared UI barrel for modules pulled into every route.
- Add Brotli/HTTP caching checks to the deployment performance gate.

### P2 — Add performance budgets to CI

The repository has correctness and read-budget tests, but no visible client bundle or route-latency budget in the audited scripts. Add thresholds for:

- main gzip size;
- Practice and Study route gzip size;
- bootstrap/readiness statement count and returned bytes;
- p95 response time in a seeded realistic dataset;
- long-task or interaction latency in the authenticated smoke path.

### P3 — Clean test-only browser API noise

The full feature suite passed, but jsdom repeatedly logs `window.scrollTo` and `HTMLCanvasElement.getContext` “Not implemented” errors from scroll locking and celebration effects. Add test shims or browser guards. This improves signal and does not indicate a confirmed production failure.

## What is already good

- Route-level lazy loading is present with chunk-failure recovery.
- Practice bootstrap scopes rooms to the viewer and caps collection size.
- Native PBE tests include HTTP/read-budget diagnostics.
- PBE mode counts and timed-mode classification are centralized.
- Typechecks, lint, wiki gate, native build, and 519 Practice/Student tests passed during the audit.

## Suggested implementation order

1. Adaptive/visibility-aware Practice bootstrap polling.
2. Readiness aggregate cache/invalidation.
3. Map-based training view indexes.
4. Bundle analysis and explicit CI budgets.
5. jsdom browser-API shims.

These recommendations are performance improvements only; none is a release-blocking defect confirmed by this audit.
