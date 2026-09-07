# Field Guide Academy — Review / Rehearsal track honesty

Date: 2026-09-07
Status: Implementation-ready for this slice only
Product: Erudoza
Base: `origin/main` merge `101e5cd0e0338482e8640c59e60aa0d41a357c18` (PR #14)

## Why this spec exists

PR #14 landed the Field Guide Academy **learner cover** on `/student` and a **coach overview** on `/admin`. Tracks on the learner cover are already honest: Reviews appear only when `reviewDueCount > 0`, Rehearsal only when `seasonStatus === "Active"`.

That honesty does not hold past the cover:

| Surface | After PR #14 |
|---------|----------------|
| Student nav | Always links **Simulate** → `/student/study?mode=Simulation` |
| Study page | Auto-starts whatever `mode` is in the URL |
| API | Review start fails with "There are no passages due for review." Simulation/Practice require an Active season |
| Cover stamp | `DUE` is shown when the season is Active, not when reviews are due |

Deep links and the always-on Simulate item can start (or attempt to start) tracks the cover would hide.

## Goal

Keep Review and Rehearsal **honest on every student entry**: nav, study URL, and the due stamp. Use only progress fields already returned by `/api/v1/progress/me`. Do not change API, auth, study-session, idempotency, or tenant contracts.

## Locked decisions

1. **Reuse `visibleAcademyTracks`.** A requested study mode may start only when its academy track is in that list.
2. **Do not call `startSession` for a hidden track.** Show existing kicker copy plus an unavailable sentence. Do not invent empty decks, streaks, or mastery.
3. **Student nav maps to academy tracks.** Home and Progress stay. Learner is always linked. Reviews and Rehearsal appear only when `visibleAcademyTracks` includes them. Remove the always-on Simulate item.
4. **`DUE` means reviews are due.** Stamp the cover only when `reviewDueCount > 0`.
5. **Coach / landing / session kickers stay as PR #14 left them.** This slice does not add coach chrome or new activity types.
6. **Preserve gauntlet testids** on the learner CTA and study flow: `start-todays-deck`, `academy-session-kicker`, `field-guide-academy`, `assignment-range`.

## Copy (honest, no invented metrics)

- Reviews unavailable: `No passages are due for review.`
- Rehearsal unavailable: `Rehearsal opens when this season is Active.`

## Out of scope

- Stronger study-card chrome / Field Guide cover on `/student/study` or `/student/progress`
- API or rule-profile changes
- Fake gamification
- Deploy, DNS, Firebase mutation, NKJV upload, production secrets
- New UI libraries

## Testing

- Pure tests: mode → track; start allowed only when the track is visible; unavailable copy
- Study page: Review with `reviewDueCount: 0` does not call `startSession`; Simulation on Draft does not; allowed modes still start
- Student shell: Simulate/Rehearsal absent until Active progress; Reviews absent until `reviewDueCount > 0`
- Existing learner-cover tests: `DUE` only when reviews are due
