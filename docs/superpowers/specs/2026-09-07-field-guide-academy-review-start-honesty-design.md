# Field Guide Academy — Review start honesty

Date: 2026-09-07
Status: Implementation-ready for this slice only
Product: Erudoza
Base: `origin/main` merge `0f9904de56529c757b19b032ca6caf321d231938` (PR #18)

## Inventory on merged main (facts)

Confirmed `origin/main` SHA after fetching: `0f9904de56529c757b19b032ca6caf321d231938` — Merge pull request #18.

| PR | What landed |
|----|-------------|
| #14 (`101e5cd`) | Learner cover on `/student`, coach overview on `/admin`, landing eyebrow, study kickers |
| #16 (`f610b51`) | Hidden Review / Rehearsal do not call `startSession`; nav maps to visible tracks; `DUE` only when reviews are due |
| #15 (`c17da40`) | Season wizard chapter uses `FieldGuideCover` with real `season.name` / `season.status` |
| #17 (`45a7c8f`) | Study and progress (learner + coach folio) use `FieldGuideCover`; session summaries use academy track copy |
| #18 (`0f9904d`) | Learner drill starts only when `seasonStatus === "Active"`; Learner chapter stays visible |

Still missing after those merges:

| Surface | After PR #18 |
|---------|----------------|
| Review CTA / start | `canStartAcademyTrack("review")` is true when `reviewDueCount > 0`, even on Draft |
| `/student/study?mode=Review` | Auto-starts when due, even if `seasonStatus` is not `Active` |
| API | `EnsureSeasonIsActiveForStudy` rejects every non-Active start, including Review |
| Student `progress/me` | Returns the latest Active season, or `seasonStatus: "None"` with empty `seasonId` when none exists |
| Coach list pages | Seasons list, students, content, assignments, questions still use generic `PaperSurface` |
| Login | Does not name Field Guide Academy |

PR #18 named the next remaining work: gating Review on Active.

## Goal

Stop offering Due review (`start-reviews` / Review start) unless the season is Active **and** `reviewDueCount > 0` — the same Active rule the study-session API already enforces. Keep the Reviews chapter visible when reviews are due so the cover can say why the drill is closed. No API, auth, study-session, idempotency, or tenant contract changes.

## Locked decisions

1. **Reuse `canStartAcademyTrack`.** Review may start only when `seasonStatus === "Active"` and `reviewDueCount > 0`. Draft, ContentReady, AssignmentsReady, None, Completed, and Archived all fail the Active check.
2. **Keep Reviews visible when due.** `visibleAcademyTracks` still adds Reviews when `reviewDueCount > 0`, including on Draft. Hiding the chapter would hide the explanation. Learner / Rehearsal visibility stays as PR #16 / #18 left it.
3. **Hide the Reviews CTA when the gate fails.** Student home shows `academy-track-unavailable` instead of `start-reviews`. Study page already skips `startSession` when the gate fails.
4. **Copy:** When reviews are due but the season is not Active: `Reviews open when this season is Active.` When the season is Active (or progress is unknown) and none are due: keep `No passages are due for review.` Do not invent readiness scores.
5. **Preserve gauntlet testids** when Review is startable: `start-reviews`, `field-guide-academy`, `academy-session-kicker`, `nav-academy-review`, `current-season`.
6. **Out of this slice:** Field Guide cover on remaining coach list pages; login chrome; new rehearsal rules or activity types.

## Out of scope

- API / schema / auth / session / idempotency / tenant changes
- Fake streaks, scores, or mastery percentages
- New UI libraries
- Deploy, DNS, Firebase mutation, NKJV upload, production secrets

## Testing

- Pure tests: review start allowed only when Active **and** due; Draft / ContentReady / None blocked even when due; unavailable copy distinguishes Active-closed vs none-due
- Student home: Draft + due reviews keeps the Reviews chapter, hides `start-reviews`, and shows the Active-season sentence
- Study page: Review on Draft with due reviews does not call `startSession`; Review on Active with due reviews still does
