# Field Guide Academy — Due Reviews empty/due states

Date: 2026-09-07
Status: Implementation-ready for this slice only
Product: Erudoza
Base: `origin/main` merge `16f7e87434dcf5c09aa09720d10edb2a6e612aa1` (PR #26)

## Inventory on merged main (facts)

Confirmed `origin/main` SHA after fetching: `16f7e87434dcf5c09aa09720d10edb2a6e612aa1` — Merge pull request #26.

| PR | What landed |
|----|-------------|
| #14 (`101e5cd`) | Learner cover on `/student`, coach overview on `/admin`, landing eyebrow, study kickers |
| #16 (`f610b51`) | Hidden Review / Rehearsal do not call `startSession`; nav maps to visible tracks; `DUE` only when reviews are due |
| #15 (`c17da40`) | Season wizard chapter uses `FieldGuideCover` with real `season.name` / `season.status` |
| #17 (`45a7c8f`) | Study and progress (learner + coach folio) use `FieldGuideCover`; session summaries use academy track copy |
| #18 (`0f9904d`) | Learner drill starts only when `seasonStatus === "Active"`; Learner chapter stays visible |
| #19 (`78915f7`) | Reviews start only when Active **and** `reviewDueCount > 0`; Reviews chapter stays visible when due |
| #20 (`a841972`) | Remaining coach list pages (seasons, students, content, assignments, questions) use `FieldGuideCover` with honest org/season chapter lines |
| #21 (`e78fa7e`) | `/login` uses `FieldGuideCover` above the existing sign-in sheet; no chapter line |
| #22 (`9058dfb`) | `/` uses `FieldGuideCover` above the existing hero; no chapter line |
| #23 (`9db3926`) | Landing decks and learner `DeckStack` use Learner / Reviews / Rehearsal labels |
| #24 (`7aa0cd8`) | Study card and progress recent attempts name existing activities with games-spec labels |
| #25 (`7778af4`) | Leftover landing / track practice and simulation *text* verbs replaced |
| #26 (`16f7e87`) | Landing deck cards overlay Stamp labels Learner / Reviews / Rehearsal over supplied webps |

Investigated remaining candidates after those merges:

| Candidate | After PR #26 |
|-----------|----------------|
| Leftover New / Review / Simulation chrome | Visible *text* is gone. Remaining pixels are baked into supplied webps. Needs new art, not a code overlay. |
| Seasons list SQLite `DateTimeOffset` `ORDER BY` 500 | Still broken: `GET /organizations/{orgId}/seasons` orders `CreatedAtUtc` in SQL (`ApiEndpoints.cs`). Progress already sorts DateTimeOffset in memory. Backend bug, not this UI slice. |
| Due Reviews empty / due states | Learner chapter stays visible when closed. Reviews chapter and nav still hide when `reviewDueCount === 0`. Empty explanation exists only on the Review study deep-link. DeckStack / Progress show a bare `0`. |

PR #26 named remaining work as new supplied landing artwork or new rehearsal rules / activity types. Those need assets or study-session changes. This slice is the smaller honesty cut: make the empty Due Reviews state visible on the same cover as the due state.

## Goal

Keep the Reviews chapter (and student nav) visible when no passages are due, and explain the empty state with the existing sentence. Start still requires Active **and** `reviewDueCount > 0`. No API, auth, study-session, idempotency, or tenant contract changes.

## Locked decisions

1. **`visibleAcademyTracks` always includes `review` after `learner`.** Rehearsal still appears only when `seasonStatus === "Active"`.
2. **Start gate unchanged.** `canStartAcademyTrack("review")` stays Active + `reviewDueCount > 0`. Hidden start does not call `startSession`.
3. **Empty copy stays** `No passages are due for review.` Due-but-not-Active copy stays `Reviews open when this season is Active.`
4. **`DUE` stamp still only when `reviewDueCount > 0`.** Empty Reviews does not invent a due stamp.
5. **Student home default tab stays Learner.** Selecting Reviews when none are due shows `academy-track-unavailable` and hides `start-reviews`.
6. **Nav follows `visibleAcademyTracks`.** `nav-academy-review` is present even when none are due. The Review href still opens `/student/study?mode=Review`, which already refuses start and shows the same empty sentence.
7. **Preserve contracts:** `start-reviews`, `nav-academy-review`, `academy-track-review`, `academy-track-unavailable`, `deck-stack` counts, and API modes Practice / Review / Simulation.
8. **Out of this slice:** seasons list SQLite `ORDER BY` 500; new supplied landing artwork; new rehearsal rules or activity types; Progress / DeckStack number wording; mobile-first redesign.

## Out of scope

- API / schema / auth / session / idempotency / tenant changes
- Fake streaks, scores, or mastery percentages
- New UI libraries
- Deploy, DNS, Firebase mutation, NKJV upload, production secrets

## Testing

- `visibleAcademyTracks` always includes `review`; rehearsal still Active-only
- Student home with `reviewDueCount` 0 shows `academy-track-review`, hides `start-reviews`, and shows `No passages are due for review.`
- Student home with due + Active still shows `start-reviews` and the `DUE` stamp
- Student nav shows `nav-academy-review` when none are due
- `canStartAcademyTrack("review")` still false when count is 0
