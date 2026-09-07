# Field Guide Academy — Leftover verbs

Date: 2026-09-07
Status: Implementation-ready for this slice only
Product: Erudoza
Base: `origin/main` merge `7aa0cd825786a7a88f798f578522f8ab9a569e41` (PR #24)

## Inventory on merged main (facts)

Confirmed `origin/main` SHA after fetching: `7aa0cd825786a7a88f798f578522f8ab9a569e41` — Merge pull request #24.

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

Still missing after those merges:

| Surface | After PR #24 |
|---------|----------------|
| Landing hero and proof cards | Visible copy still says “competition practice”, “builds the practice”, “Practice only…”, and “Timed simulation” |
| Learner / Rehearsal track copy | Learner description still says “Practice…”. Rehearsal description still says “PBE-style simulation”. CTA still says “Start competition simulation” |
| Landing artwork | Supplied webp files still print New / Review / Simulation |
| Rehearsal rules | Still maps to existing Simulation. No new activity types |

PR #24 named the next remaining work as leftover marketing “practice” / “simulation” verbs on landing proof cards and the Rehearsal CTA, or replacing supplied artwork, or new rehearsal rules / activity types. New rehearsal rules would change study-session behavior. Replacing artwork is a visual-asset cut. This slice is the smaller naming-honesty cut: name the leftover verbs.

## Goal

Replace leftover visible “practice” / “simulation” copy on the landing page and academy track descriptions/CTA with the same Field Guide labels already used on decks, nav, and session kickers. Keep API modes, hrefs, and gauntlet testids. No API, auth, study-session, idempotency, or tenant contract changes.

## Locked decisions

1. **Landing hero summary** becomes “Turn your assigned Scripture into focused memorization games, due reviews, and realistic rehearsal.” Drop “competition practice”.
2. **Landing hero note** becomes “Your team chooses the passage. Erudoza deals the deck.” Drop “builds the practice”.
3. **Landing proof card 1 heading** becomes “Drill only the assigned Scripture.” Drop “Practice only…”.
4. **Landing proof card 3 body** becomes “Timed rehearsal turns growing recall into confident Bible Bowl performance.” Drop “Timed simulation”.
5. **Learner track description** becomes “Drill the assigned passage with memorization games.”
6. **Rehearsal track description** becomes “Run a PBE-style rehearsal from the assigned Scripture.”
7. **Rehearsal CTA** becomes “Start rehearsal”. Keep `ctaTestId` `start-simulation` and `href` `/student/study?mode=Simulation`.
8. **Preserve contracts:** `start-studying`, `build-a-season`, landing heading “Choose today’s training deck”, supplied image sources, `er-deck-*` classes, and API modes Practice / Review / Simulation.
9. **Out of this slice:** replacing supplied landing artwork; new rehearsal rules or activity types.

## Out of scope

- API / schema / auth / session / idempotency / tenant changes
- Fake streaks, scores, or mastery percentages
- New UI libraries
- Deploy, DNS, Firebase mutation, NKJV upload, production secrets

## Testing

- Landing visible copy uses rehearsal / drill / deals the deck, not practice or simulation
- Landing keeps the three supplied image sources and `start-studying` / `build-a-season`
- Learner description is “Drill the assigned passage with memorization games.”
- Rehearsal description is “Run a PBE-style rehearsal from the assigned Scripture.”
- Rehearsal CTA label is “Start rehearsal”; `start-simulation` still points at `mode=Simulation`
