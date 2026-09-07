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

Field Guide Academy is the paper/cardboard training cover. Learner home, study, progress, coach/admin home, the coach season wizard chapter, remaining coach list pages (seasons, students, content, assignments, questions), login, and the public landing page all use `FieldGuideCover`. Coach season readiness and chapter lines show only real `season.name` and `season.status` from the seasons or coverage API (or New season when creating). `GET /organizations/{orgId}/seasons` lists newest-first in memory so SQLite is not asked to `ORDER BY DateTimeOffset`. Coach list pages without a selected season show the signed-in organization name. Login and landing have no signed-in organization or season, so they omit a chapter line. Learner and Reviews start only when `seasonStatus` is Active; Reviews also require a positive `reviewDueCount`. Learner and Reviews chapters stay visible when closed so the cover can say why (empty Reviews: `No passages are due for review.`). Rehearsal still appears only when Active. Learner / Reviews / Rehearsal tracks, student nav, and study-page start all use the same progress rules (`reviewDueCount`, `seasonStatus`). The cover `DUE` stamp means reviews are due. Finished sessions are named Learner drill / Due review / Rehearsal, not raw API mode. Landing training decks and the learner `DeckStack` use Learner / Reviews / Rehearsal labels. Landing deck cards overlay those names with `Stamp` over the supplied webps, which still print New / Review / Simulation until new art exists. `DeckStack` shows assignment count, `reviewDueCount`, and real `seasonStatus` (or an em dash). Study cards and progress recent attempts name existing activities Missing Words / Verse Builder / Reference Match / What Comes Next / True/False / Short answer, not raw API types. Landing hero and proof cards, plus Learner / Rehearsal track copy, use drill / rehearsal / deals the deck instead of leftover practice / simulation verbs. The Rehearsal CTA is Start rehearsal; `start-simulation` still starts API mode Simulation. Do not add a second palette, animation library, or invented readiness scores. See `docs/superpowers/specs/2026-09-07-field-guide-academy-learner-cover-design.md`, `docs/superpowers/specs/2026-09-07-field-guide-academy-track-honesty-design.md`, `docs/superpowers/specs/2026-09-07-field-guide-academy-study-progress-chrome-design.md`, `docs/superpowers/specs/2026-09-07-field-guide-academy-learner-start-honesty-design.md`, `docs/superpowers/specs/2026-09-07-field-guide-academy-review-start-honesty-design.md`, `docs/superpowers/specs/2026-09-07-field-guide-academy-coach-list-cover-design.md`, `docs/superpowers/specs/2026-09-07-field-guide-academy-login-cover-design.md`, `docs/superpowers/specs/2026-09-07-field-guide-academy-landing-cover-design.md`, `docs/superpowers/specs/2026-09-07-field-guide-academy-deck-labels-design.md`, `docs/superpowers/specs/2026-09-07-field-guide-academy-activity-names-design.md`, `docs/superpowers/specs/2026-09-07-field-guide-academy-leftover-verbs-design.md`, `docs/superpowers/specs/2026-09-07-field-guide-academy-landing-deck-art-labels-design.md`, and `docs/superpowers/specs/2026-09-07-field-guide-academy-due-reviews-empty-design.md`.

The final production logo remains replaceable. The current mark is a temporary text/geometry wordmark.
