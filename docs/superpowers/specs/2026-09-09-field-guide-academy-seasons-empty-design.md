# Field Guide Academy — Coach seasons empty state

Date: 2026-09-09
Status: Implementation-ready for this slice only
Product: Erudoza
Base: `origin/main` merge `6eb72630d64e011e25ab03ab5d55d808b5e019ae` (PR #29)

## Inventory on merged main (facts)

Confirmed `origin/main` SHA after fetching: `6eb72630d64e011e25ab03ab5d55d808b5e019ae` — Merge pull request #29.

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

Investigated remaining candidates after those merges:

| Candidate | After PR #29 |
|-----------|----------------|
| Leftover New / Review / Simulation chrome | Visible *text* is gone. Remaining pixels are baked into supplied webps. Needs new captain art, not another code overlay. |
| Coach empty states | **Seasons lists stay blank** on `/admin` readiness folio, `/admin` paper list, and `/admin/seasons` when `GET /seasons` returns `[]`. Coverage already says `No assigned students yet.`; questions already say `No candidates yet.`; progress already says `No attempts yet.` Students and content lists are also blank — a later slice. |
| Progress / DeckStack number wording | Bare `0` / assignment count / `reviewDueCount` / `seasonStatus`. Wording change, not a missing sentence. |
| Sanji mobile-first redesign | Parked pending captain mockup approval. Out of this slice. |

PR #29 named remaining work as coach empty-state copy, new supplied landing artwork, new rehearsal rules / activity types, Progress / DeckStack number wording, or the parked mobile redesign. Artwork needs assets. Rehearsal rules would change study-session behavior. Number wording is a separate copy cut. This slice is the smaller honesty cut: the Field Guide seasons folio that #29 just made listable still says nothing when there are no seasons.

## Goal

When the seasons API returns an empty list, say `No seasons yet.` on the coach seasons folio. Keep Create season. Do not invent readiness. No API, auth, study-session, idempotency, or tenant contract changes.

## Locked decisions

1. **Empty copy is** `No seasons yet.` Same three words on every seasons list that would otherwise render a blank `<ul>`.
2. **Surfaces:** `/admin` Field Guide season-readiness folio, `/admin` paper seasons list, and `/admin/seasons`. Students and content lists stay for a later slice.
3. **Show only after a successful empty load.** `seasons.data && seasons.data.length === 0`. Do not show while `data` is undefined (loading or error).
4. **Create season stays.** Do not hide `create-season` or invent a second CTA.
5. **No invented readiness.** Still only real `season.name` and `season.status` when seasons exist. Empty copy does not add scores, streaks, or percentages.
6. **Preserve contracts:** `create-season`, `season-readiness-folio`, organization chapter line, newest-first seasons list, and API modes Practice / Review / Simulation.
7. **Out of this slice:** students / content empty-state copy; Progress / DeckStack number wording; new supplied landing artwork; new rehearsal rules or activity types; mobile-first redesign.

## Out of scope

- API / schema / auth / session / idempotency / tenant changes
- Fake streaks, scores, or mastery percentages
- New UI libraries
- Deploy, DNS, Firebase mutation, NKJV upload, production secrets

## Testing

- `/admin` with `seasons = []` shows `No seasons yet.` on the readiness folio and keeps `create-season`
- `/admin/seasons` with `seasons = []` shows `No seasons yet.` and keeps `create-season`
- Existing seasons lists still show real `season.name` / `season.status` and do not show the empty sentence
