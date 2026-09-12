# Task A1 implementation report

Status: DONE

## Outcome

Implemented versioned PBE v2 question, target, grade, rule and public-view contracts in native TypeScript and C#. The new evaluator awards partial credit per part, returns the selected answer index, preserves exact ordering when required, and uses deterministic weighted one-to-one matching for unordered answers. The public question view contains timing and point metadata without accepted answers, evidence, or target identities.

Validation rejects malformed or extra fields, absent required JSON fields, empty/invalid GUID identities, duplicate or invalid arrays, unsupported enum values, empty answer variants, unknown targets, source-coverage mismatches, wrong ExactWords skills, extra/missing response fields, and totals outside 1–8. Question source coverage equals the union of referenced target sources: every target source must be present in the question and every question source must be covered. GUID joins are case-insensitive in TypeScript to match C# `Guid` identity semantics.

The existing practice scoring implementations were left unchanged. Regression tests explicitly prove that their historical 9-point behavior is not constrained by the new versioned 1–8 point rubric.

## TDD evidence

The first native rubric test was added before `grading.ts`. Its required command failed because `./grading` did not exist. After the minimal implementation, it passed. Subsequent hand-authored shared fixtures exposed the answer-index bookkeeping path for overlapping variants and were made green. During self-review, the missing-required-field JSON case was added first and observed failing because deserialization accepted an omitted `sourceKind`; `[JsonRequired]` was then applied and the test passed.

## Tests and validation

- Final focused native PBE plus legacy scoring: 2 files, 11 tests passed.
- Final focused .NET PBE plus legacy scoring: 24 tests passed.
- Shared `rubric-fixtures.json` loaded independently by Vitest and xUnit; expected grades are literal fixture data, not computed by either evaluator.
- Full web/native regression run: 78 files passed, 1 optional file skipped; 587 tests passed, 1 optional test skipped.
- Full .NET unit regression run: 79 tests passed.
- Final native TypeScript and frontend TypeScript checks passed.
- `git diff --check` passed.

## Self-review and limits

The implementation is isolated from legacy scoring to reduce historical behavior risk. Matching follows the existing exact normalization rules: NFC, case, and .NET-compatible whitespace only. It performs no edit-distance, punctuation, spelling, or AI-based acceptance. The fixtures include reversed exact words, duplicate answers, overlapping variants, unequal weights, and recognizable but unlisted spelling.

This task defines and verifies contracts and grading only. It does not add bank persistence, routes, authoring UI, rehearsal selection, deployment, or live-pilot evidence. No A1 blocker or unresolved concern remains.
