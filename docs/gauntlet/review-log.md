# Erudoza Gauntlet Review Log

## Milestone A — Foundation

Date: 2026-08-22
Tasks: 1–6

Evidence:

- `dotnet build apps/api/Erudoza.sln` succeeds.
- Organization, membership, season, content, and study entities are organization-scoped.
- Cookie authentication rejects unauthenticated `/api/v1/me`.
- Integration tests reject student season creation and cross-organization reads.

Result: PASS

## Milestone B — Competition Core

Date: 2026-08-22
Tasks: 7–10

Evidence:

- Built-in `PBE_STYLE_V1` is versioned JSON stored on the season.
- Development content pack uses structured locators (`DAN`, chapter, verse, ordinal).
- Include/exclude scope resolver is covered by integration tests.
- Specialist assignments do not leak to another student.

Result: PASS

## Milestone C — Study Core

Date: 2026-08-22
Tasks: 11–14

Evidence:

- `MissingWordsActivityProvider` is deterministic and does not call OpenAI.
- Attempt submission is idempotent on `clientSubmissionId`.
- Mastery algorithm `v1-scaffold` updates scores and review due dates in the same transaction.

Result: PASS

## Milestone D — AI Boundary

Date: 2026-08-22
Task: 15

Evidence:

- `FakeGenerativeQuestionService` is the only registered generator.
- Out-of-scope and mismatched evidence fail validation.
- `QuestionLifecycleService` is the only promotion path to playable questions.
- API starts with `OpenAI__Enabled=false` and an empty key.

Result: PASS

## Milestone E — Full Vertical Slice

Date: 2026-08-22
Tasks: 16–21

Evidence:

- Playwright `e2e/admin-to-student-study.spec.ts` covers admin setup through student mastery.
- Playwright `e2e/brand-shell.spec.ts` covers the landing wordmark and paper shell.
- Production web build and Bicep compile are part of CI.

Result: PASS

Local evidence from this revision:

- Playwright `e2e/admin-to-student-study.spec.ts` passed on desktop Chromium and Pixel 7.
- Playwright `e2e/brand-shell.spec.ts` passed on desktop Chromium and Pixel 7.
- `dotnet test apps/api/Erudoza.sln` — 21 passing.
- `npm run typecheck:web`, `lint:web`, `test:web`, and `build:web` succeed.

## Milestone F — Deterministic activity library

Date: 2026-08-22

Adds Verse Builder, Reference Match, and What Comes Next behind the same Study Engine. The first card in a session remains Missing Words so the vertical-slice Playwright path stays stable. OpenAI is wired as an optional server-side adapter and still cannot bypass validation.

## Milestone G — Simulation and coverage

Date: 2026-08-22

Competition simulation uses the stored session mode and `PBE_STYLE_V1` (no multiple-choice). Coach coverage lists assigned students, scope, mastery, due reviews, and attempts. The OpenAI adapter parses a real chat completion when enabled and still falls back when the key or payload is missing.

## Milestone H — Question review pipeline

Date: 2026-08-22

Coaches can enqueue a generation job against season scope. Candidates are stored as Validated or Rejected after evidence checks. Approve is the only path to a playable short-answer card. Students still cannot generate or promote questions.

## Milestone I — Review mode and coach progress

Date: 2026-08-22

Review sessions refuse to start without a due passage and then draw only from due knowledge units. Coaches can open a student's progress from coverage. Missed attempts are due immediately.

## Milestone J — True/False under PBE_STYLE_V1

Date: 2026-08-22

True/False is a deterministic activity. Simulation allows at most 10% True/False cards. False statements reuse another stored verse; they do not invent Scripture wording.

## Milestone K — Content pack import

Date: 2026-08-22

Coaches can import a versioned synthetic content pack, browse stored verses, and select that pack when defining season scope. Students cannot import. Changed wording at the same pack version is rejected.
