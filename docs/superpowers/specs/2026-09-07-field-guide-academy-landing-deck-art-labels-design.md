# Field Guide Academy — Landing deck art labels

Date: 2026-09-07
Status: Implementation-ready for this slice only
Product: Erudoza
Base: `origin/main` merge `7778af4cd98f3106d372e6a63abc263c7ccdea1b` (PR #25)

## Inventory on merged main (facts)

Confirmed `origin/main` SHA after fetching: `7778af4cd98f3106d372e6a63abc263c7ccdea1b` — Merge pull request #25.

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

Still missing after those merges:

| Surface | After PR #25 |
|---------|----------------|
| Landing deck artwork | Supplied webps still print NEW DECK / REVIEW DECK / SIMULATION DECK. Alt text and kicker already say Learner / Reviews / Rehearsal. |
| Rehearsal rules | Still maps to existing Simulation. No new activity types |

PR #25 named the next remaining work as replacing supplied landing artwork, or new rehearsal rules / activity types. New rehearsal rules would change study-session behavior. Replacing artwork needs new assets. This slice is the smaller code-side naming-honesty cut: overlay the labels the web app controls.

## Goal

Align visible landing training-deck labels to Learner / Reviews / Rehearsal — the same names as the learner `DeckStack` — without replacing supplied artwork or changing API modes. No API, auth, study-session, idempotency, or tenant contract changes.

## Locked decisions

1. **Keep the three supplied image sources** and existing `er-deck-*` classes. Do not redraw, crop-replace, or invent new deck art.
2. **Overlay existing `Stamp`.** Each landing deck card gets a parchment label band with a `Stamp`: Learner / Reviews / Rehearsal. This is the same overlay chrome `FieldGuideCover` already uses.
3. **Cover the baked-in title line.** The band sits over NEW DECK / REVIEW DECK / SIMULATION DECK so the controlled visible label is the academy track name.
4. **Reuse existing stamp tones that read on parchment:** Learner `new`, Reviews `review`, Rehearsal `due`. Do not add a rehearsal tone. Do not use `simulation` (card-colored, invisible on parchment).
5. **Preserve contracts:** `start-studying`, `build-a-season`, heading “Choose today’s training deck”, #23 image alts, and API modes Practice / Review / Simulation.
6. **Out of this slice:** new rehearsal rules or activity types; new supplied webp/png art.

## Remaining after this slice (needs new art)

The supplied files `deck-new.webp`, `deck-review.webp`, and `deck-simulation.webp` still contain baked-in New / Review / Simulation titles plus leftover description and ribbon copy. New artwork is still required to remove those pixels. This overlay is the code-side fix until that art exists.

## Out of scope

- API / schema / auth / session / idempotency / tenant changes
- Fake streaks, scores, or mastery percentages
- New UI libraries
- Deploy, DNS, Firebase mutation, NKJV upload, production secrets

## Testing

- Each landing deck link shows a stamp labeled Learner, Reviews, or Rehearsal
- The three supplied image sources stay
- No stamp labeled New or Simulation
- `start-studying` and `build-a-season` stay
