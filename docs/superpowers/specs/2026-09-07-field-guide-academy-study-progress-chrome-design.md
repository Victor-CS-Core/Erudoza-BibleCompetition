# Field Guide Academy — Study / Progress chrome

Date: 2026-09-07
Status: Implementation-ready for this slice only
Product: Erudoza
Base: `origin/main` merge `f610b512e01ed6a23ec40aee251598526b46688a` (PR #16)

## Inventory on merged main (facts)

PR #14 (`101e5cd`) landed:

- Kraft-bound `FieldGuideCover` on `/student` and `/admin`
- Honest Learner / Reviews / Rehearsal tabs from `reviewDueCount` and `seasonStatus`
- Landing eyebrow and study kickers (`Learner drill` / `Due review` / `Rehearsal`)
- Coach season-readiness folio from real `season.name` and `season.status`

PR #16 (`f610b51`) landed:

- Hidden Review / Rehearsal do not call `startSession`
- Student nav maps to the same visible tracks (no always-on Simulate)
- Cover `DUE` stamp only when reviews are due

Still missing after those merges:

| Surface | After PR #16 |
|---------|----------------|
| `/student/study` | Session kicker only; no Field Guide cover or season chapter line |
| `/student/progress` | Generic “Progress” paper sheet; no Field Guide cover |
| Coach student folio (`/admin/seasons/:id/students/:id/progress`) | Same ProgressPage, same generic sheet |
| Session summary | `Last {mode.toLowerCase()} session` — raw API `practice` / `review` / `simulation` |

## Goal

Give study and progress the same Field Guide Academy cover already used on learner home and coach home, and name a finished session with academy track copy instead of the raw API mode. No API, auth, study-session, idempotency, or tenant contract changes.

## Locked decisions

1. **Reuse `FieldGuideCover`.** Do not invent a second academy shell.
2. **Study page:** cover wraps the session kicker and season chapter line (`current-season` from progress). `StudyCard` stays below for an allowed start. Unavailable copy stays on the cover. `DUE` stamp when `reviewDueCount > 0`.
3. **Progress page:** cover wraps the existing folio (attempts, due reviews, strong passages, mastery, recent attempts). Student heading is a chapter line, not a second `h1`. Coach view of the same page uses the same cover. `DUE` stamp when `reviewDueCount > 0`.
4. **Session summary copy** maps API `Practice` / `Review` / `Simulation` (any case) onto `Learner drill` / `Due review` / `Rehearsal`. Unknown mode: `Last session: {correct} / {attempted} exact` — no invented track name.
5. **Preserve gauntlet testids:** `field-guide-academy`, `academy-session-kicker`, `challenge-card`, `complete-session`, `progress-mastery`, `progress-attempts`, `recent-attempts`, `session-summary`, `current-season`.
6. **Out of this slice:** hiding Learner CTA on Draft seasons (API still rejects non-Active starts). That remains named remaining work.

## Out of scope

- API / schema / auth / session / idempotency / tenant changes
- Fake streaks, scores, or mastery percentages
- New UI libraries
- Deploy, DNS, Firebase mutation, NKJV upload, production secrets

## Testing

- Pure tests for session-summary copy (Practice/Review/Simulation, case-insensitive, unknown mode)
- Study page: cover title, season line, kicker, `DUE` only when reviews due; hidden tracks still skip `startSession`
- Progress page (learner + coach path): cover title, honest summary line, existing progress testids
