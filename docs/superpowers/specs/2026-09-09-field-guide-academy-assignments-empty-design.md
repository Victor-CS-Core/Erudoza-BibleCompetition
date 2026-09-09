# Field Guide Academy — Coach assignments empty state

Date: 2026-09-09
Status: Implementation-ready for this slice only
Product: Erudoza
Base: `origin/main` merge `8d7f981c7349c3556bcc96cb3ab968abf25a4768` (PR #32)

## Inventory on merged main (facts)

Confirmed `origin/main` SHA after fetching: `8d7f981c7349c3556bcc96cb3ab968abf25a4768` — Merge pull request #32.

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
| #27 (`074abcd`) | Reviews chapter and student nav stay visible when none are due |
| #28 (`6639faf`) | Stamp band covers baked-in landing deck titles |
| #29 (`6eb7263`) | Seasons list newest-first without SQLite `DateTimeOffset` `ORDER BY` |
| #30 (`ea11219`) | Coach seasons lists say `No seasons yet.` when empty |
| #31 (`7434a8f`) | Coach students list says `No students yet.` when empty |
| #32 (`8d7f981`) | Coach content packs list says `No content packs yet.` when empty |

Investigated remaining candidates after that merge:

| Candidate | After PR #32 |
|-----------|----------------|
| Leftover New / Review / Simulation chrome | Visible *text* is gone. Landing tests reject New / Review / Simulation deck names and leftover practice / simulation verbs. Remaining pixels are baked into supplied webps (`deck-new.webp`, `deck-review.webp`, `deck-simulation.webp`). Needs new captain art, not another code overlay. |
| Coach empty states | **Coverage on `/admin/assignments` still says `No assigned students yet.` when `coverage.data` is undefined** (no season, still loading, or error). Seasons / students / content / questions only speak after a successful empty load. Questions already say `No candidates yet.` when `questions.data && questions.data.length === 0`. Season-wizard roster already says `No assignments yet.` Progress already says `No attempts yet.` |
| Season-wizard content-pack / student selects | Empty `<select>` when no packs or students exist. Not a folio list; leave for a later cut if needed. |
| Stored-verses empty list | Blank `<ul>` after a pack is selected and units are `[]`. Separate folio; leave for a later cut. |
| Progress / DeckStack number wording | Progress already labels Attempts / Due reviews / Strong passages. `DeckStack` already labels Learner / Reviews / Rehearsal. Bare numbers remain a wording cut, not a missing sentence. |
| Sanji mobile-first redesign | Parked pending captain mockup / logo revision. Out of this slice. |

PR #32 named remaining work as season-wizard empty pack select, stored-verses empty list, Progress / DeckStack number wording, new supplied landing artwork, new rehearsal rules / activity types, or the parked mobile redesign. Artwork needs assets. Rehearsal rules would change study-session behavior. Number wording is a separate copy cut. Questions already follow the successful-empty-load rule. This slice is the smaller honesty cut: the Field Guide assignments folio still claims there are no assigned students before coverage has loaded.

## Goal

Show `No assigned students yet.` on the coach coverage folio only after a successful empty coverage load. Keep the no-season helper. Do not invent readiness. No API, auth, study-session, idempotency, or tenant contract changes.

## Locked decisions

1. **Empty copy stays** `No assigned students yet.` Same words already on the coverage folio. Do not rename the page heading or invent a second sentence.
2. **Surface:** `/admin/assignments` (`AssignmentsPage`). Season-wizard roster copy stays unchanged. Questions already have their own sentence.
3. **Show only after a successful empty load.** `coverage.data && coverage.data.students.length === 0`. Do not show while `coverage.data` is undefined (no season, loading, or error).
4. **No-season helper stays.** When coverage has not loaded, keep `Open a season to create specialist and required coverage assignments.`
5. **Coverage table stays.** Do not hide `coverage-table` when students exist, or invent a second CTA.
6. **No invented readiness.** Still only real coverage `seasonName` / `seasonStatus` / student rows when coverage exists. Empty copy does not add scores, streaks, or percentages.
7. **Preserve contracts:** `coverage-table`, organization / season chapter line, and API modes Practice / Review / Simulation.
8. **Out of this slice:** season-wizard roster / empty pack or student select; stored-verses empty list; questions copy; Progress / DeckStack number wording; new supplied landing artwork; new rehearsal rules or activity types; mobile-first redesign.

## Out of scope

- API / schema / auth / session / idempotency / tenant changes
- Fake streaks, scores, or mastery percentages
- New UI libraries
- Deploy, DNS, Firebase mutation, NKJV upload, production secrets

## Testing

- `/admin/assignments` with a season and `coverage.students = []` shows `No assigned students yet.`
- `/admin/assignments` with no season does not show `No assigned students yet.` and keeps the open-a-season helper
- Existing coverage rows still show real student names and do not show the empty sentence
