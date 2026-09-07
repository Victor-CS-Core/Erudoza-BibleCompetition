# Field Guide Academy — Deck labels

Date: 2026-09-07
Status: Implementation-ready for this slice only
Product: Erudoza
Base: `origin/main` merge `9058dfb80b49a2c6edfbba39ec264c72f1323130` (PR #22)

## Inventory on merged main (facts)

Confirmed `origin/main` SHA after fetching: `9058dfb80b49a2c6edfbba39ec264c72f1323130` — Merge pull request #22.

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

Still missing after those merges:

| Surface | After PR #22 |
|---------|----------------|
| `/` training decks | Artwork still labeled New / Review / Simulation while the kicker already says Learner · Reviews · Rehearsal |
| Learner `DeckStack` | Still labeled Due / New / Review. `due` and `review` both show `reviewDueCount` |
| Rehearsal | Still maps to existing Simulation. No new activity types |

PR #22 named the next remaining work as renaming landing decks or `DeckStack` labels, or new rehearsal rules / activity types. New rehearsal rules would change study-session behavior. This slice is the smaller naming-honesty cut.

## Goal

Name landing training decks and the learner `DeckStack` with the same Field Guide Academy tracks already used on the cover, nav, and session kickers. Keep supplied artwork and real progress fields. No API, auth, study-session, idempotency, or tenant contract changes.

## Locked decisions

1. **Landing deck names** become Learner deck / Reviews deck / Rehearsal deck. Keep the three supplied image sources and existing `er-deck-*` classes. Do not replace artwork.
2. **`DeckStack` labels** become Learner / Reviews / Rehearsal. Drop Due / New / Review.
3. **Honest counts only.** Learner shows `assignments.length`. Reviews shows `reviewDueCount` once. Do not show the same review count twice.
4. **Rehearsal has no count.** Show the real `seasonStatus` string, or `—` when it is missing. Do not invent a rehearsal score, streak, or session count.
5. **Preserve contracts:** `start-studying`, `build-a-season`, `deck-stack`, landing heading “Choose today’s training deck”, and API modes Practice / Review / Simulation.
6. **Out of this slice:** new rehearsal rules or activity types.

## Out of scope

- API / schema / auth / session / idempotency / tenant changes
- Fake streaks, scores, or mastery percentages
- New UI libraries
- Deploy, DNS, Firebase mutation, NKJV upload, production secrets

## Testing

- Landing images are named Learner deck / Reviews deck / Rehearsal deck and keep the three supplied sources
- Landing no longer exposes New deck / Review deck / Simulation deck alt text
- `DeckStack` shows Learner / Reviews / Rehearsal
- Learner count is assignment length; Reviews count is `reviewDueCount`; Rehearsal is the real season status or `—`
- `start-studying` and `build-a-season` stay
