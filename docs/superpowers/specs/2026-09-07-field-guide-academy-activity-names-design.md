# Field Guide Academy — Activity names

Date: 2026-09-07
Status: Implementation-ready for this slice only
Product: Erudoza
Base: `origin/main` merge `9db3926f028aac5ae0a4944e0318fb01bd4c0d0b` (PR #23)

## Inventory on merged main (facts)

Confirmed `origin/main` SHA after fetching: `9db3926f028aac5ae0a4944e0318fb01bd4c0d0b` — Merge pull request #23.

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

Still missing after those merges:

| Surface | After PR #23 |
|---------|----------------|
| Study card chrome | Shows raw API `activityType` (`MissingWords`) next to the citation |
| Progress recent attempts | Shows the same raw API `activityType` |
| Landing artwork | Supplied webp files still print New / Review / Simulation |
| Rehearsal | Still maps to existing Simulation. No new activity types |

PR #23 named the next remaining work as replacing supplied deck artwork or adding new rehearsal rules / activity types. New activity types or rehearsal rules would change study-session behavior. This slice is the smaller naming-honesty cut: name the activities that already exist.

## Goal

Name existing study activities on the study card and progress folio with the same readable Field Guide labels already used in the memorization-games spec. Keep API `activityType` values. No API, auth, study-session, idempotency, or tenant contract changes.

## Locked decisions

1. **Reuse one helper.** `academyActivityName(activityType)` maps the existing API strings. Do not invent a second naming table.
2. **Copy is the games-spec names, not new drills.** Missing Words, Verse Builder, Reference Match, What Comes Next, True/False, Short answer. These are the activities the study engine already deals.
3. **Unknown types stay raw.** If the API sends an unexpected `activityType`, show that string. Do not invent a fallback drill name.
4. **Study card uses the helper** for the activity label beside the citation. Keep `challenge-card`, `challenge-prompt`, `missing-words-answer`, and session start (`Practice` / `Review` / `Simulation`).
5. **Progress recent attempts use the same helper.** Keep `recent-attempts` and the real title / answer / exact-miss stamps.
6. **Out of this slice:** new activity types; new rehearsal rules; replacing supplied landing artwork; leftover marketing "practice" / "simulation" verbs.

## Out of scope

- API / schema / auth / session / idempotency / tenant changes
- Fake streaks, scores, or mastery percentages
- New UI libraries
- Deploy, DNS, Firebase mutation, NKJV upload, production secrets

## Testing

- Pure tests: each known API type maps to the games-spec name; unknown types stay raw
- Study page shows Missing Words, not MissingWords, after a real card is drawn
- Progress folio recent attempts show Missing Words, not MissingWords
- `startSession` still uses Practice / Review / Simulation
