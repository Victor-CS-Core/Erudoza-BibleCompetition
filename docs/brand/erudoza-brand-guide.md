# Erudoza — Brand & UI System

Version: 1.0
Product name: Erudoza
Primary domain: https://erudoza.com
Tagline: Study. Master. Compete.

The implementation uses the approved paper/cardboard material system.

Token contract: `apps/web/src/styles/tokens.css`
Material rules: `apps/web/src/styles/materials.css`

Required components:

- `apps/web/src/components/brand/ErudozaWordmark.tsx`
- `apps/web/src/components/material/PaperSurface.tsx`
- `apps/web/src/components/material/StudyCard.tsx`
- `apps/web/src/components/material/Stamp.tsx`
- `apps/web/src/components/material/DeckStack.tsx`
- `apps/web/src/components/material/ChapterTab.tsx`
- `apps/web/src/components/material/FieldGuideCover.tsx`

Field Guide Academy is the paper/cardboard training cover. Learner home, study, progress, coach/admin home, the coach season wizard chapter, remaining coach list pages (seasons, students, content, assignments, questions), login, and the public landing page all use `FieldGuideCover`. Coach season readiness and chapter lines show only real `season.name` and `season.status` from the seasons or coverage API (or New season when creating). Coach list pages without a selected season show the signed-in organization name. Login and landing have no signed-in organization or season, so they omit a chapter line. Learner and Reviews start only when `seasonStatus` is Active; Reviews also require a positive `reviewDueCount`. Learner Reviews / Rehearsal tracks, student nav, and study-page start all use the same progress rules (`reviewDueCount`, `seasonStatus`). The cover `DUE` stamp means reviews are due. Finished sessions are named Learner drill / Due review / Rehearsal, not raw API mode. Landing training decks and the learner `DeckStack` use Learner / Reviews / Rehearsal labels. `DeckStack` shows assignment count, `reviewDueCount`, and real `seasonStatus` (or an em dash). Do not add a second palette, animation library, or invented readiness scores. See `docs/superpowers/specs/2026-09-07-field-guide-academy-learner-cover-design.md`, `docs/superpowers/specs/2026-09-07-field-guide-academy-track-honesty-design.md`, `docs/superpowers/specs/2026-09-07-field-guide-academy-study-progress-chrome-design.md`, `docs/superpowers/specs/2026-09-07-field-guide-academy-learner-start-honesty-design.md`, `docs/superpowers/specs/2026-09-07-field-guide-academy-review-start-honesty-design.md`, `docs/superpowers/specs/2026-09-07-field-guide-academy-coach-list-cover-design.md`, `docs/superpowers/specs/2026-09-07-field-guide-academy-login-cover-design.md`, `docs/superpowers/specs/2026-09-07-field-guide-academy-landing-cover-design.md`, and `docs/superpowers/specs/2026-09-07-field-guide-academy-deck-labels-design.md`.

The final production logo remains replaceable. The current mark is a temporary text/geometry wordmark.
