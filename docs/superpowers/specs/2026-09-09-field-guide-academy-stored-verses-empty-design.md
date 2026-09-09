# Field Guide Academy — Coach stored verses empty state

Date: 2026-09-09
Status: Implementation-ready for this slice only
Product: Erudoza
Base: `origin/main` merge `8d7f981c7349c3556bcc96cb3ab968abf25a4768` (PR #32)

## Inventory on merged main (facts)

Confirmed `origin/main` SHA after fetching: `8d7f981c7349c3556bcc96cb3ab968abf25a4768` — Merge pull request #32.

PR #33 (`Field Guide Academy: say No assigned students yet only after coverage loads`) is still **open** on that SHA. This slice does not take its assignments change.

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

Investigated remaining candidates after that merge (and after reading open PR #33):

| Candidate | After PR #32 |
|-----------|----------------|
| Empty coach questions list | Already says `No candidates yet. Generate from the stored season scope.` only when `questions.data && questions.data.length === 0`. Query stays disabled with no season. Not a blank folio. |
| Leftover New / Review / Simulation chrome | Visible *text* is gone. Landing tests reject New / Review / Simulation deck names and leftover practice / simulation verbs. Remaining pixels are baked into supplied webps (`deck-new.webp`, `deck-review.webp`, `deck-simulation.webp`). Needs new captain art, not another code overlay. |
| Assignments empty copy timing | Open PR #33. `/admin/assignments` already says `No assigned students yet.` even when `coverage.data` is undefined. Leave that PR to gate the sentence. |
| Stored verses after a selected pack | **Blank folio.** Selecting a content pack on `/admin/content` opens `Stored verses` with an empty `<ul data-testid="source-unit-list">` when `GET .../source-units` returns `[]`. |
| Season-wizard empty content-pack / student `<select>` | Empty dropdowns when those lists are `[]`. Not a blank folio list; leave for a later cut. |
| Progress / DeckStack number wording | Progress already labels Attempts / Due reviews / Strong passages. `DeckStack` already labels Learner / Reviews / Rehearsal. Bare numbers remain a wording cut, not a missing sentence. |
| Sanji mobile-first redesign | Parked pending captain mockup / logo revision. Out of this slice. |

PR #32 named remaining work as season-wizard empty selects, stored-verses empty list, Progress / DeckStack number wording, new supplied landing artwork, new rehearsal rules / activity types, or the parked mobile redesign. Open PR #33 listed the same leftover cuts after assignments. Artwork needs assets. Rehearsal rules would change study-session behavior. Number wording is a separate copy cut. Questions and leftover New / Review / Simulation *text* are already done. This slice is the smaller honesty cut: the Field Guide stored-verses folio still says nothing when a pack is selected and has no units.

## Goal

When a coach selects a content pack and the source-units API returns an empty list, say `No stored verses yet.` on the stored-verses folio. Keep the pack list, Import translation, and Import pack. Do not invent readiness. No API, auth, study-session, idempotency, or tenant contract changes.

## Locked decisions

1. **Empty copy is** `No stored verses yet.` Same four words on the stored-verses list that would otherwise render a blank `<ul>`.
2. **Surface:** `/admin/content` stored-verses folio (`ContentPage`, `data-testid="source-unit-list"`). Season-wizard pack / student `<select>` stays unchanged. Content packs empty copy stays `No content packs yet.`
3. **Show only after a selected pack and a successful empty load.** `selectedPackId && units.data && units.data.length === 0`. Do not show while `units.data` is undefined (loading or error). Do not show when no pack is selected (the folio stays hidden).
4. **Import and pack list stay.** Do not hide `content-pack`, `import-catalog-submit`, `load-sample-pack`, or `import-pack-submit`, or invent a second CTA.
5. **No invented readiness.** Still only real `citation` / `canonicalText` when units exist. Empty copy does not add scores, streaks, or percentages.
6. **Preserve contracts:** `content-pack`, `source-unit-list`, `import-catalog-submit`, `load-sample-pack`, `import-pack-submit`, organization chapter line, and API modes Practice / Review / Simulation.
7. **Out of this slice:** season-wizard empty selects; assignments empty-copy timing (PR #33); Progress / DeckStack number wording; new supplied landing artwork; new rehearsal rules or activity types; mobile-first redesign.

## Out of scope

- API / schema / auth / session / idempotency / tenant changes
- Fake streaks, scores, or mastery percentages
- New UI libraries
- Deploy, DNS, Firebase mutation, NKJV upload, production secrets

## Testing

- `/admin/content` with a selected pack and `sourceUnits = []` shows `No stored verses yet.` and keeps import controls
- Selecting a pack that has units still shows real `citation` / `canonicalText` and does not show the empty sentence
- Empty content-packs list still says `No content packs yet.` and does not open the stored-verses folio
