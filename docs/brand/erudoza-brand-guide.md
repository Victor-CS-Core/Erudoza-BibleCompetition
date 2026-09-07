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

Field Guide Academy is the paper/cardboard training cover. Learner home, study, progress, coach/admin home, and the coach season wizard chapter all use `FieldGuideCover`. Coach season readiness and the season chapter line show only real `season.name` and `season.status` from the seasons API (or New season when creating). Learner Reviews / Rehearsal tracks, student nav, and study-page start all use the same progress rules (`reviewDueCount`, `seasonStatus`). The cover `DUE` stamp means reviews are due. Finished sessions are named Learner drill / Due review / Rehearsal, not raw API mode. Do not add a second palette, animation library, or invented readiness scores. See `docs/superpowers/specs/2026-09-07-field-guide-academy-learner-cover-design.md`, `docs/superpowers/specs/2026-09-07-field-guide-academy-track-honesty-design.md`, and `docs/superpowers/specs/2026-09-07-field-guide-academy-study-progress-chrome-design.md`.

The final production logo remains replaceable. The current mark is a temporary text/geometry wordmark.
