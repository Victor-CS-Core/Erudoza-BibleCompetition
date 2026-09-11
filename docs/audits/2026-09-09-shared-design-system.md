# Shared coach and student design system

Applied Impeccable and bm-design-system to the existing Erudoza interface. The approved artwork and palette remain the visual authority. Coach season setup, assignments and student practice behavior are preserved.

## Changes

- Centralized color, typography, spacing, radius and control tokens; shared native React controls, panels, headings, badges and notices.
- Migrated coach overview, seasons, guided setup, students, assignments and content library to those components.
- Migrated student home, practice and progress, plus login and the shared app frame. Progress now uses the same readable data presentation as coach screens.
- Retained mountain imagery in the student banner and milestone artwork, with clear surfaces behind forms and tables.
- Added an authenticated component reference at `/admin/design-system`, implementation rules in `DESIGN.md`, and repository guidance in `AGENTS.md`.
- Installed Impeccable as an agent skill. No AI capability or dependency was added to the app runtime.

## Verification

- `npm run test:web`: 121 tests passed across 20 files.
- `npm run lint:web`: passed.
- `npm run build:web`: TypeScript and production build passed.
- Impeccable manual detector over migrated UI, layouts and styles: no findings (`[]`).
- Browser checks: desktop, 390px mobile and selected 320px stress views; no page overflow, missing images or uncaught exceptions in checked views.
- Shared component examples: local save feedback, difficulty radio selection, dialog open and Escape dismissal; consistent computed primary control styles.
- Fixture-based practice checks: answer submission, duplicate-submit prevention, refresh recovery and next-card flow.
- Isolated API/browser flow: create a season, save Daniel passages, assign Foundation difficulty, reload, change to Advanced, reload, review and activate, confirm active passages are read-only, then sign in as the student and start Advanced practice.

The end-to-end write checks used a separate test database. Existing local demo data was preserved. Backend code was not changed or independently retested in this visual pass. Browser coverage was Chromium; a dedicated screen-reader audit and other browser engines were not performed.
