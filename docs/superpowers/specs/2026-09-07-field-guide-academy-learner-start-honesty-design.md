# Field Guide Academy — Learner start honesty

Date: 2026-09-07
Status: Implementation-ready for this slice only
Product: Erudoza
Base: `origin/main` merge `45a7c8f8cd33793a2dcaae0cd567651d12792494` (PR #17)

## Inventory on merged main (facts)

Confirmed `origin/main` SHA after fetching: `45a7c8f8cd33793a2dcaae0cd567651d12792494` — Merge pull request #17.

| PR | What landed |
|----|-------------|
| #14 (`101e5cd`) | Learner cover on `/student`, coach overview on `/admin`, landing eyebrow, study kickers |
| #16 (`f610b51`) | Hidden Review / Rehearsal do not call `startSession`; nav maps to visible tracks; `DUE` only when reviews are due |
| #15 (`c17da40`) | Season wizard chapter uses `FieldGuideCover` with real `season.name` / `season.status` |
| #17 (`45a7c8f`) | Study and progress (learner + coach folio) use `FieldGuideCover`; session summaries use academy track copy |

Still missing after those merges:

| Surface | After PR #17 |
|---------|----------------|
| Learner CTA | Always shown. `canStartAcademyTrack("learner")` is always true |
| `/student/study` Practice | Auto-starts even when `seasonStatus` is not `Active` |
| API | `EnsureSeasonIsActiveForStudy` rejects every non-Active start: "Study sessions can only start for an Active season." |
| Student `progress/me` | Returns the latest Active season, or `seasonStatus: "None"` with empty `seasonId` when none exists |
| Review on Draft | Helper still allows Review when `reviewDueCount > 0` even if the season is not Active |

PR #17 named the next remaining work: hiding the Learner CTA on Draft seasons.

## Goal

Stop offering Learner drill (`start-todays-deck` / Practice start) unless the season is Active — the same rule the study-session API already enforces. Keep the Learner chapter visible so the cover can say why the drill is closed. No API, auth, study-session, idempotency, or tenant contract changes.

## Locked decisions

1. **Reuse `canStartAcademyTrack`.** Learner may start only when `seasonStatus === "Active"`. Draft, ContentReady, AssignmentsReady, None, Completed, and Archived all fail that check.
2. **Keep the Learner tab and nav link.** Hiding the chapter would hide the explanation. Reviews / Rehearsal visibility stays as PR #16 left it.
3. **Hide the Learner CTA when the gate fails.** Student home shows `academy-track-unavailable` instead of `start-todays-deck`. Study page already skips `startSession` when the gate fails.
4. **Copy:** `Learner drill opens when this season is Active.` Do not invent readiness scores or empty decks.
5. **Preserve gauntlet testids** when the season is Active: `start-todays-deck`, `field-guide-academy`, `academy-session-kicker`, `nav-academy-learner`, `current-season`.
6. **Out of this slice:** gating Review on Active (API also rejects Review on Draft); Field Guide cover on remaining coach list pages (seasons list, students, content, assignments, questions); login chrome.

## Out of scope

- API / schema / auth / session / idempotency / tenant changes
- Fake streaks, scores, or mastery percentages
- New UI libraries
- Deploy, DNS, Firebase mutation, NKJV upload, production secrets

## Testing

- Pure tests: learner start allowed only when `seasonStatus === "Active"`; Draft / ContentReady / None blocked; unavailable copy
- Student home: Draft has no `start-todays-deck` and shows the unavailable sentence; Active still has the CTA
- Study page: Practice on Draft does not call `startSession`; Practice on Active still does
