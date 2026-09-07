# Field Guide Academy — Landing cover

Date: 2026-09-07
Status: Implementation-ready for this slice only
Product: Erudoza
Base: `origin/main` merge `e78fa7ec4f165fd9fc3911ae3e2b69ba6df79152` (PR #21)

## Inventory on merged main (facts)

Confirmed `origin/main` SHA after fetching: `e78fa7ec4f165fd9fc3911ae3e2b69ba6df79152` — Merge pull request #21.

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

Still missing after those merges:

| Surface | After PR #21 |
|---------|----------------|
| `/` | Marketing hero names Field Guide Academy in the eyebrow only. Does not use `FieldGuideCover`. Deck artwork still labeled New / Review / Simulation. |
| Learner `DeckStack` | Still labeled Due / New / Review. |
| Rehearsal | Still maps to existing Simulation. No new activity types. |

PR #21 named the next remaining work as new rehearsal rules or activity types. That slice would change study rules. This slice is the last unsigned page still missing the academy cover.

## Goal

Give `/` the same Field Guide Academy cover already used on login, learner, and coach surfaces. Keep the existing hero, three supplied deck images, and landing CTAs. No API, auth, study-session, idempotency, or tenant contract changes.

## Locked decisions

1. **Reuse `FieldGuideCover`.** Do not invent a second academy shell or palette.
2. **Cover sits above the existing hero.** Keep “Know the passage. Own the moment.”, the three deck images, and the proof cards. Do not replace the training-deck heading or artwork.
3. **Academy name lives on the cover.** Remove the hero eyebrow that only repeated “Field Guide Academy”.
4. **No invented chapter line.** Landing has no signed-in organization or season. Omit `academy-chapter-line`. Do not invent readiness, streaks, or an academy name other than the cover title.
5. **Preserve landing contracts:** `start-studying`, `build-a-season`, the three supplied deck image sources, and “Choose today’s training deck”.
6. **Out of this slice:** renaming landing decks or `DeckStack` labels; new rehearsal rules or activity types.

## Out of scope

- API / schema / auth / session / idempotency / tenant changes
- Fake streaks, scores, or mastery percentages
- New UI libraries
- Deploy, DNS, Firebase mutation, NKJV upload, production secrets

## Testing

- Landing shows `field-guide-academy` and the Field Guide Academy heading
- Cover does not invent a chapter line, `%`, or `streak`
- Hero title, training-deck heading, and the three supplied deck images stay
- `start-studying` and `build-a-season` stay
