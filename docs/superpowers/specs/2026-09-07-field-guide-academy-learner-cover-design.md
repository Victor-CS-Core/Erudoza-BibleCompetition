# Field Guide Academy — Learner Cover (first slice)

Date: 2026-09-07
Status: Implementation-ready for this slice only
Product: Erudoza
Base: remote `main` at `c382cdb` (2026-08-23)

## Why this spec exists

Remote `main` has **no** Field Guide Academy specs, plans, routes, or UI. Local-only work on `codex/field-guide-academy` (SHAs `621238a` / `b84e792` / `4be1a5d` / `36e9d1a`, Learner 1–4 claims) is **out of scope and must not be treated as done here**.

This file reconstructs only the first vertical slice from documents that actually exist on this remote:

- `docs/brand/erudoza-brand-guide.md` — paper/cardboard material system and required components
- `docs/product/erudoza-prd.md` — Pathfinder-style / Bible bowl scaffold
- `docs/superpowers/specs/2026-08-22-bible-bowl-memorization-games-design.md` — games-only study engine
- `docs/architecture/adr-004-study-engine.md` — Practice / Review / Simulation
- Landing copy already in `apps/web/src/features/marketing/LandingPage.tsx` (Learn / Remember / Rehearse)

## Inventory of remote `main` (facts)

| Area | What exists |
|------|-------------|
| Apps | `apps/web` (React 19.2, Vite 8, Tailwind 4) and `apps/api` (.NET 10) |
| Student UI | `/student` home, `/student/study` (Practice / Review / Simulation), `/student/progress` |
| Coach UI | `/admin` seasons, roster, content, assignments, questions, coverage progress |
| Material system | `PaperSurface`, `StudyCard`, `Stamp`, `DeckStack`, `ChapterTab`, `ErudozaWordmark` |
| Honest data | Progress API: season name/status, assignments, `reviewDueCount`, `attemptCount`, `masteredCount` |
| Tests | Vitest + Playwright e2e (`start-todays-deck`, `assignment-range`, landing decks) |
| Bundle gates | None in `vite.config.ts` / CI |
| Field Guide Academy | **Absent** |

Official stack docs used for this slice:

- React 19.2: https://react.dev and https://react.dev/blog/2025/10/01/react-19-2
- Vite: https://vite.dev/guide/
- Tailwind CSS 4: https://tailwindcss.com/docs
- Vitest 4: https://vitest.dev/guide/
- React Router 7: https://reactrouter.com/home
- Testing Library: https://testing-library.com/docs/react-testing-library/intro/

## Goal

Give the signed-in student a **Field Guide Academy learner cover** that names the training system and maps existing study modes onto academy tracks, using only real progress data.

This is visual + information architecture. It does not change API, auth, study-session, idempotency, or tenant contracts.

## Locked decisions

1. **Learner is first.** Coach academy chrome and new rehearsal rules are later slices.
2. **Tracks map 1:1 to existing modes.** Learner → Practice (`/student/study`). Reviews → Review (`?mode=Review`). Rehearsal → Simulation (`?mode=Simulation`).
3. **Coach is not a student track.** The assignment packet remains the honest coach-sourced object (“Your coach will add it here.” when empty). No fake coach dashboard.
4. **Honest UI only.** Show Review only when `reviewDueCount > 0`. Show Rehearsal only when `seasonStatus === "Active"`. Do not invent streaks, badges, mastery percentages, or achievements beyond values the progress API already returns.
5. **Keep the material system.** Kraft spine + paper page built with existing tokens. No new UI/animation libraries.
6. **Preserve gauntlet contracts.** Keep `data-testid` values `start-todays-deck`, `start-simulation`, `start-reviews`, `current-season`, `assignment-range`, `assignment-packet`, `deck-stack`.
7. **Default tab is Learner** so existing Playwright still finds “Start today’s deck” without extra clicks.

## Visual system (this slice)

Field Guide Academy uses the existing paper/cardboard language as a bound handbook cover:

- Kraft spine (left on desktop, top bar on small screens)
- Serif title “Field Guide Academy”
- Eyebrow “Pathfinder Bible Experience”
- Season name as the current chapter line
- `ChapterTab` row for visible tracks
- Existing `Stamp` / `DeckStack` / assignment `PaperSurface`

Landing names the academy in the existing eyebrow (`Field Guide Academy`) without replacing the training-deck heading or artwork.

Study sessions show an honest kicker: `Learner drill`, `Due review`, or `Rehearsal`.

## Out of scope

- Coach Field Guide home, rehearsal rule changes, new activity types
- API/schema/auth/session/idempotency/tenant changes
- Fake gamification
- Deploy, DNS, Firebase mutation, NKJV upload, production secrets
- New general-purpose UI libraries

## Testing

- Pure function tests for which tracks are visible
- Component tests for the learner cover (default Learner CTA; Rehearsal/Reviews appear only from real progress)
- Landing still presents the three supplied deck images and now names Field Guide Academy
- Playwright gauntlet still completes; after student login the cover is titled Field Guide Academy

## Alternatives considered

- **New `/academy` route.** Rejected: duplicates `/student` and breaks the smallest-change rule.
- **Ship learner + coach + rehearsal chrome together.** Rejected: coach UI already exists as `/admin`; mixing it into this PR invents completion that is not on remote main.
- **Redesign tokens or add animation libraries.** Rejected: brand guide already locks the paper system.
