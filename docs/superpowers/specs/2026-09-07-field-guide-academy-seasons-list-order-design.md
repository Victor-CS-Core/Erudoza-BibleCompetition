# Field Guide Academy — Seasons list SQLite order

Date: 2026-09-07
Status: Implementation-ready for this slice only
Product: Erudoza
Base: `origin/main` merge `074abcdfd78c7ba88829a55998523dc060a51f7d` (PR #27)

## Inventory on merged main (facts)

Confirmed `origin/main` SHA after fetching: `074abcdfd78c7ba88829a55998523dc060a51f7d` — Merge pull request #27.

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

Investigated remaining candidates after that merge:

| Candidate | After PR #27 |
|-----------|----------------|
| Leftover New / Review / Simulation chrome | Visible *text* is gone. Remaining pixels are baked into supplied webps. Needs new captain art, not a code overlay. |
| Seasons list SQLite `DateTimeOffset` `ORDER BY` 500 | **Still broken (reproduced).** `GET /api/v1/organizations/{orgId}/seasons` returns 500: `SQLite does not support expressions of type 'DateTimeOffset' in ORDER BY clauses.` Progress, question review, and generation jobs already sort DateTimeOffset in memory. |
| Coach empty states | Seasons / students / content lists stay blank with no sentence. Coverage and questions already explain empty. Smaller honesty cut than a 500 on the seasons folio. |
| Sanji mobile-first redesign | Parked pending captain assets. Out of this slice. |

PR #27 named remaining work as the seasons-list 500, new supplied landing artwork, or new rehearsal rules / activity types. Artwork needs assets. Rehearsal rules would change study-session behavior. This slice is the smaller honesty cut: the Field Guide coach seasons folio and home readiness list call this endpoint and currently fail on SQLite.

## Goal

List seasons newest-first without asking SQLite to `ORDER BY DateTimeOffset`. Same request, same `SeasonDto` shape. No auth, study-session, idempotency, or tenant contract changes.

## Locked decisions

1. **Load, then sort in memory.** `ToListAsync` the org seasons, then `OrderByDescending(CreatedAtUtc)` — the same pattern as `ProgressQueryService` recent attempts and `QuestionReviewService` lists.
2. **Newest first stays.** Two sequentially created seasons list as newer, then older.
3. **No DTO / route / auth change.** `GET /organizations/{orgId}/seasons` still returns `SeasonDto[]`. `CreatedAtUtc` stays off the DTO.
4. **Preserve contracts:** existing season fields, Playwright `create-season`, and API modes Practice / Review / Simulation.
5. **Out of this slice:** coach empty-state copy; new supplied landing artwork; new rehearsal rules or activity types; Progress / DeckStack number wording; mobile-first redesign.

## Out of scope

- Auth / session / idempotency / tenant changes
- Fake streaks, scores, or mastery percentages
- New UI libraries
- Deploy, DNS, Firebase mutation, NKJV upload, production secrets

## Testing

- Admin GET `/organizations/{orgId}/seasons` on the SQLite test factory returns 200
- Two sequentially created seasons appear newest-first
