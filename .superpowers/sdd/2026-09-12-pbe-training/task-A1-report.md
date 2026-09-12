# Task A1 implementation report

Status: DONE

## Outcome

Implemented versioned PBE v2 question, target, grade, rule and public-view contracts in native TypeScript and C#. The new evaluator awards partial credit per part, returns the selected answer index, preserves exact ordering when required, and uses deterministic weighted one-to-one matching for unordered answers. The public question view contains timing and point metadata without accepted answers, evidence, or target identities.

Validation rejects malformed or extra fields, absent required JSON fields, empty/invalid GUID identities, duplicate or invalid arrays, unsupported enum values, empty answer variants, unknown targets, source-coverage mismatches, wrong ExactWords skills, extra/missing response fields, and totals outside 1–8. Question source coverage equals the union of referenced target sources: every target source must be present in the question and every question source must be covered. GUID joins are case-insensitive in TypeScript to match C# `Guid` identity semantics.

The existing practice scoring implementations were left unchanged. Regression tests explicitly prove that their historical 9-point behavior is not constrained by the new versioned 1–8 point rubric.

## TDD evidence

The first native rubric test was added before `grading.ts`. Its required command failed because `./grading` did not exist. After the minimal implementation, it passed. Subsequent hand-authored shared fixtures exposed the answer-index bookkeeping path for overlapping variants and were made green. During self-review, the missing-required-field JSON case was added first and observed failing because deserialization accepted an omitted `sourceKind`; `[JsonRequired]` was then applied and the test passed.

Initial native RED command:

```text
NODE_OPTIONS=--no-experimental-webstorage npm --workspace apps/web run test -- worker/native/pbe/grading.test.ts --maxWorkers=2
FAIL worker/native/pbe/grading.test.ts
Error: Cannot find module './grading'
Test Files  1 failed (1)
```

Initial native GREEN command and excerpt:

```text
NODE_OPTIONS=--no-experimental-webstorage npm --workspace apps/web run test -- worker/native/pbe/grading.test.ts --maxWorkers=2
Test Files  1 passed (1)
Tests  1 passed (1)
```

The expanded shared-fixture run then produced the expected behavioral RED for overlapping weighted variants before its bookkeeping correction:

```text
FAIL shared rubric fixtures > unordered answers receive unequal points once
Expected earnedPoints: 4; Received earnedPoints: 1
Expected part 0 answerIndex: 1; Received: null
```

The C# required-field self-review RED was observed with:

```text
DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 .local/dotnet/dotnet test apps/api/tests/Erudoza.UnitTests/Erudoza.UnitTests.csproj --filter 'FullyQualifiedName~Missing_json_fields'
FAIL PbeRubricTests.Missing_json_fields_are_rejected_before_default_enum_or_boolean_values_can_be_used
Expected a System.Text.Json.JsonException to be thrown, but no exception was thrown.
```

## Tests and validation

- Final focused native PBE plus legacy scoring: 2 files, 11 tests passed.
- Final focused .NET PBE plus legacy scoring: 24 tests passed.
- Shared `rubric-fixtures.json` loaded independently by Vitest and xUnit; expected grades are literal fixture data, not computed by either evaluator.
- Full web/native regression run: 78 files passed, 1 optional file skipped; 587 tests passed, 1 optional test skipped.
- Full .NET unit regression run: 79 tests passed.
- Final native TypeScript and frontend TypeScript checks passed.
- `git diff --check` passed.

The full regression runs occurred before the final strict evaluator-field checks and C# `[JsonRequired]` hardening:

```text
NODE_OPTIONS=--no-experimental-webstorage npm --workspace apps/web test -- --maxWorkers=2
Test Files  78 passed | 1 skipped (79)
Tests  587 passed | 1 skipped (588)

DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 .local/dotnet/dotnet test apps/api/tests/Erudoza.UnitTests/Erudoza.UnitTests.csproj
Passed: 79, Failed: 0, Skipped: 0
```

After those final changes, the exact relevant checks against the committed production code were:

```text
NODE_OPTIONS=--no-experimental-webstorage npm --workspace apps/web run test -- worker/native/pbe/grading.test.ts worker/native/practice/scoring.test.ts --maxWorkers=2
Test Files  2 passed (2)
Tests  11 passed (11)

npm --workspace apps/web run typecheck:native
tsc -p tsconfig.native.json

npm --workspace apps/web run typecheck
tsc --noEmit

DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 .local/dotnet/dotnet test apps/api/tests/Erudoza.UnitTests/Erudoza.UnitTests.csproj --filter 'FullyQualifiedName~PbeRubric|FullyQualifiedName~PracticeScoring'
Passed: 24, Failed: 0, Skipped: 0

git diff --check
exit 0
```

## Self-review and limits

The implementation is isolated from legacy scoring to reduce historical behavior risk. Matching follows the existing exact normalization rules: NFC, case, and .NET-compatible whitespace only. It performs no edit-distance, punctuation, spelling, or AI-based acceptance. The fixtures include reversed exact words, duplicate answers, overlapping variants, unequal weights, and recognizable but unlisted spelling.

This task defines and verifies contracts and grading only. It does not add bank persistence, routes, authoring UI, rehearsal selection, deployment, or live-pilot evidence. No A1 blocker or unresolved concern remains.

## Review fix round 1: exact PBE enum JSON

Review found that the application-wide `JsonStringEnumConverter` accepts numeric enum tokens, numeric strings, and case-insensitive names. Native v2 validation accepts only the exact contract names. The behavior was reproduced before production changes with property-level JSON regressions for `sourceKind`, `kind`, and target `skill`: nine invalid cases were accepted and failed their expected `JsonException` assertions. The one exact-name serialization test passed.

RED command and excerpt:

```text
DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 .local/dotnet/dotnet test apps/api/tests/Erudoza.UnitTests/Erudoza.UnitTests.csproj --filter 'FullyQualifiedName~Question_enum_json|FullyQualifiedName~Target_skill_json|FullyQualifiedName~Pbe_enums_serialize'
Failed: 9, Passed: 1, Skipped: 0, Total: 10
Expected a System.Text.Json.JsonException to be thrown, but no exception was thrown.
```

The fix binds an ordinal, exact-name converter to the three v2 enum properties. Property-level binding takes precedence over the existing global converter, which remains unchanged for legacy API contracts. Numeric tokens, numeric strings, and lowercase names now fail; valid values serialize as `Scripture`, `ShortAnswer`, and `ExactWords`.

GREEN regression command and excerpt:

```text
DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 .local/dotnet/dotnet test apps/api/tests/Erudoza.UnitTests/Erudoza.UnitTests.csproj --filter 'FullyQualifiedName~Question_enum_json|FullyQualifiedName~Target_skill_json|FullyQualifiedName~Pbe_enums_serialize'
Passed: 10, Failed: 0, Skipped: 0, Total: 10
```

Final relevant check after the review fix:

```text
DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 .local/dotnet/dotnet test apps/api/tests/Erudoza.UnitTests/Erudoza.UnitTests.csproj --filter 'FullyQualifiedName~PbeRubric|FullyQualifiedName~PracticeScoring'
Passed: 34, Failed: 0, Skipped: 0, Total: 34
```
