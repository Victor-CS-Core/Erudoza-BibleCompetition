# Field Guide Academy — Coach list cover

Date: 2026-09-07
Status: Implementation-ready for this slice only
Product: Erudoza
Base: `origin/main` merge `78915f701d43b0a70de3c296542978f0fe122014` (PR #19)

## Inventory on merged main (facts)

Confirmed `origin/main` SHA after fetching: `78915f701d43b0a70de3c296542978f0fe122014` — Merge pull request #19.

| PR | What landed |
|----|-------------|
| #14 (`101e5cd`) | Learner cover on `/student`, coach overview on `/admin`, landing eyebrow, study kickers |
| #16 (`f610b51`) | Hidden Review / Rehearsal do not call `startSession`; nav maps to visible tracks; `DUE` only when reviews are due |
| #15 (`c17da40`) | Season wizard chapter uses `FieldGuideCover` with real `season.name` / `season.status` |
| #17 (`45a7c8f`) | Study and progress (learner + coach folio) use `FieldGuideCover`; session summaries use academy track copy |
| #18 (`0f9904d`) | Learner drill starts only when `seasonStatus === "Active"`; Learner chapter stays visible |
| #19 (`78915f7`) | Reviews start only when Active **and** `reviewDueCount > 0`; Reviews chapter stays visible when due |

Still missing after those merges:

| Surface | After PR #19 |
|---------|----------------|
| `/admin/seasons` | Generic `PaperSurface` “Seasons” list |
| `/admin/students` | Generic `PaperSurface` roster + password reset |
| `/admin/content` | Generic `PaperSurface` pack import |
| `/admin/assignments` | Generic `PaperSurface` coverage table |
| `/admin/questions` | Generic `PaperSurface` question review |
| Login | Does not name Field Guide Academy |

PR #19 named the next remaining work: Field Guide cover on remaining coach list pages.

## Goal

Give the remaining coach list pages the same Field Guide Academy cover already used on coach home, the season wizard, and the student folio. Chapter lines use only real organization or season fields. No API, auth, study-session, idempotency, or tenant contract changes.

## Locked decisions

1. **Reuse `FieldGuideCover`.** Do not invent a second academy shell or palette.
2. **Cover sits above the existing sheet.** Keep list/forms in `PaperSurface` (Season wizard pattern). Do not move or rename gauntlet controls.
3. **Chapter line helper `academyCoachChapterLine`.** When both `seasonName` and `seasonStatus` are present, show `{name} · {status}`. Otherwise show `organizationName`. Empty inputs stay empty. Do not invent readiness scores, streaks, or a season when none exists.
4. **Page mapping:**
   - Seasons list, students, content: organization name from signed-in `me`.
   - Assignments (coverage) and questions: Active season, else first season, else organization name. Prefer coverage `seasonName` / `seasonStatus` when that query has returned.
5. **Preserve gauntlet testids:** `create-season`, `student-list`, `add-student`, `reset-password-*`, `coverage-table`, `load-sample-pack`, `import-pack-json`, `import-pack-submit`, `content-pack`, `source-unit-list`, `run-generation`, `question-review-list`, `login-identifier`, `login-submit`.
6. **Out of this slice:** login chrome; new rehearsal rules or activity types.

## Out of scope

- API / schema / auth / session / idempotency / tenant changes
- Fake streaks, scores, or mastery percentages
- New UI libraries
- Deploy, DNS, Firebase mutation, NKJV upload, production secrets

## Testing

- Pure tests: season name + status wins; org name when no season; empty when nothing; no invented metrics
- Seasons / students / content: cover title, org chapter line, existing list/form testids
- Assignments / questions: cover title, `{season.name} · {season.status}` from real season/coverage fields; org name when no season
