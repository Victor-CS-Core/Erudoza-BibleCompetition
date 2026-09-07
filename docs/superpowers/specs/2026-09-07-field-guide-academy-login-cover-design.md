# Field Guide Academy — Login cover

Date: 2026-09-07
Status: Implementation-ready for this slice only
Product: Erudoza
Base: `origin/main` merge `a8419729cf64e123aed069a9db13c1fa92079158` (PR #20)

## Inventory on merged main (facts)

Confirmed `origin/main` SHA after fetching: `a8419729cf64e123aed069a9db13c1fa92079158` — Merge pull request #20.

| PR | What landed |
|----|-------------|
| #14 (`101e5cd`) | Learner cover on `/student`, coach overview on `/admin`, landing eyebrow, study kickers |
| #16 (`f610b51`) | Hidden Review / Rehearsal do not call `startSession`; nav maps to visible tracks; `DUE` only when reviews are due |
| #15 (`c17da40`) | Season wizard chapter uses `FieldGuideCover` with real `season.name` / `season.status` |
| #17 (`45a7c8f`) | Study and progress (learner + coach folio) use `FieldGuideCover`; session summaries use academy track copy |
| #18 (`0f9904d`) | Learner drill starts only when `seasonStatus === "Active"`; Learner chapter stays visible |
| #19 (`78915f7`) | Reviews start only when Active **and** `reviewDueCount > 0`; Reviews chapter stays visible when due |
| #20 (`a841972`) | Remaining coach list pages (seasons, students, content, assignments, questions) use `FieldGuideCover` with honest org/season chapter lines |

Still missing after those merges:

| Surface | After PR #20 |
|---------|----------------|
| `/login` | Generic centered `PaperSurface` “Sign in” card. Does not name Field Guide Academy. |
| Rehearsal | Still maps to existing Simulation. No new activity types. |

PR #20 named the next remaining work: login chrome that names Field Guide Academy.

## Goal

Give `/login` the same Field Guide Academy cover already used on learner and coach surfaces. Keep the existing sign-in sheet and auth contract. No API, auth, study-session, idempotency, or tenant contract changes.

## Locked decisions

1. **Reuse `FieldGuideCover`.** Do not invent a second academy shell or palette.
2. **Cover sits above the existing sheet.** Keep wordmark, “Sign in”, tagline, and the login form in `PaperSurface`. Do not move or rename gauntlet controls.
3. **No invented chapter line.** Login has no signed-in organization or season. Omit `academy-chapter-line`. Do not invent readiness, streaks, or an academy name other than the cover title.
4. **Keep the existing product tagline** on the sign-in sheet: `Study. Master. Compete.`
5. **Preserve auth routing:** `login(identifier, password)` still navigates Student → `/student` and Adult → `/admin`. Failed login still shows the existing error sentence and stays on `/login`.
6. **Preserve gauntlet testids:** `login-identifier`, `login-password`, `login-submit`.
7. **Out of this slice:** new rehearsal rules or activity types.

## Out of scope

- API / schema / auth / session / idempotency / tenant changes
- Fake streaks, scores, or mastery percentages
- New UI libraries
- Deploy, DNS, Firebase mutation, NKJV upload, production secrets

## Testing

- Login page shows `field-guide-academy` and the Field Guide Academy heading
- Sign-in sheet keeps `login-identifier`, `login-password`, `login-submit`
- Cover does not invent a chapter line, `%`, or `streak`
- Student login still navigates to `/student`; Adult login still navigates to `/admin`
- Failed login still shows the error and does not navigate
