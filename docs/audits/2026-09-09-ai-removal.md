# Deterministic-only training

The user requested removal of all AI capabilities. The app now uses only stored Scripture and programmed activity rules.

Removed:

- Model requests, parsers, model/key settings and environment-variable support.
- AI generation services and fake generation fallback.
- Generation jobs, status endpoints, question approval/rejection APIs and related runtime interfaces.
- Coach question-generation/review pages, navigation, API clients and DTOs.
- New generated Short Answer cards and their provider selection path.
- AI setup guidance and deployment settings.

Retained:

- Missing Words, Verse Builder, Reference Match, What Comes Next and True/False.
- Per-student/per-season difficulty, rule snapshots, scoring safeguards, reviews and session recovery.
- Scripture catalog imports and versioned content packs.
- Historical database tables and migration records, for data preservation only. No runtime generation service reads them to create new activities. Saved old cards can still be resumed and evaluated against their stored answer keys.
- Existing hosting integration. The Sites build package is hosting infrastructure; it does not add model calls or AI activity generation to the app.

Tests check that the former endpoints are unavailable and the provider registry contains only deterministic activities. Existing activity, difficulty, retry, scope and migration tests remain. Obsolete AI-specific tests were removed with the deleted functionality.

Validation passed: 29 backend unit tests, 51 backend integration tests and 114 frontend tests (194 total), plus frontend lint and production build. Tests also verify recovery of historical Short Answer cards and compatibility with old rule snapshots. Changes are local and have not been deployed.
