# Field Guide Academy — Coach students empty state

Date: 2026-09-09
Status: Implementation-ready for this slice only
Product: Erudoza
Base: `origin/main` merge `ea112195fd7c59cd84cb82930543b2be4f9603d0` (PR #30)

## Inventory on merged main (facts)

Confirmed `origin/main` SHA after fetching: `ea112195fd7c59cd84cb82930543b2be4f9603d0` — Merge pull request #30.

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

Investigated remaining candidates after that merge:

| Candidate | After PR #30 |
|-----------|----------------|
| Leftover New / Review / Simulation chrome | Visible *text* is gone. Landing tests reject New / Review / Simulation deck names and leftover practice / simulation verbs. Remaining pixels are baked into supplied webps (`deck-new.webp`, `deck-review.webp`, `deck-simulation.webp`). Needs new captain art, not another code overlay. |
| Coach empty states | **Students list stays blank** on `/admin/students` when `GET /students` returns `[]`. Seasons already say `No seasons yet.`; coverage already says `No assigned students yet.`; questions already say `No candidates yet.`; progress already says `No attempts yet.`; season-wizard roster already says `No assignments yet.` Content packs list is also blank — a later slice. |
| Progress / DeckStack number wording | Progress already labels Attempts / Due reviews / Strong passages. `DeckStack` already labels Learner / Reviews / Rehearsal. Bare numbers remain a wording cut, not a missing sentence. |
| Sanji mobile-first redesign | Parked pending captain mockup / logo revision. Out of this slice. |

PR #30 named remaining work as coach students / content empty-state copy, Progress / DeckStack number wording, new supplied landing artwork, new rehearsal rules / activity types, or the parked mobile redesign. Artwork needs assets. Rehearsal rules would change study-session behavior. Number wording is a separate copy cut. Content packs stay for a later slice. This slice is the smaller honesty cut: the Field Guide students folio still says nothing when there are no students.

## Goal

When the students API returns an empty list, say `No students yet.` on the coach students folio. Keep Add student. Do not invent readiness. No API, auth, study-session, idempotency, or tenant contract changes.

## Locked decisions

1. **Empty copy is** `No students yet.` Same three words on the students list that would otherwise render a blank `<ul>`.
2. **Surface:** `/admin/students` (`StudentsPage`). Content packs stay for a later slice. Coverage already has its own assigned-students sentence.
3. **Show only after a successful empty load.** `students.data && students.data.length === 0`. Do not show while `data` is undefined (loading or error).
4. **Add student stays.** Do not hide `add-student` or invent a second CTA.
5. **No invented readiness.** Still only real `displayName` / `userName` when students exist. Empty copy does not add scores, streaks, or percentages.
6. **Preserve contracts:** `student-list`, `add-student`, organization chapter line, and API modes Practice / Review / Simulation.
7. **Out of this slice:** content empty-state copy; Progress / DeckStack number wording; new supplied landing artwork; new rehearsal rules or activity types; mobile-first redesign.

## Out of scope

- API / schema / auth / session / idempotency / tenant changes
- Fake streaks, scores, or mastery percentages
- New UI libraries
- Deploy, DNS, Firebase mutation, NKJV upload, production secrets

## Testing

- `/admin/students` with `students = []` shows `No students yet.` and keeps `add-student`
- Existing students lists still show real `displayName` / `userName` and do not show the empty sentence
