# PBE Questions and Grading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a reusable, source-scoped PBE bank and deterministic partial-credit grading for solo and team practice.

**Architecture:** Extend published questions with explicit target/skill metadata and a v2 contract. Put private evaluation in focused native/domain modules, expose sanitized DTOs, and retain legacy evaluators for old records.

**Tech Stack:** TypeScript, native D1 store, React, C#/EF Core, Vitest and xUnit.

**Spec:** [PBE assessment](../../audits/2026-09-11-pbe-training-alignment.md), [implementation index](2026-09-12-pbe-training.md).

## Global constraints

Apply all index constraints. “Automatic grading is the default; coach-led rehearsal is explicitly selected.” “Never fill an insufficient bank with unassigned or invented material.” New rehearsal totals are 1–8 points; exact answers retain word order. Persist original answers and rubric versions. No source changes or bank publication to production during this phase's local verification.

---

## Task A1: Versioned rules, question contracts and per-part grading

**Files — create:** `apps/web/worker/native/pbe/types.ts`, `rules.ts`, `grading.ts`, `grading.test.ts`, `rubric-fixtures.json`; `apps/web/src/api/pbeTypes.ts`; `apps/api/src/Erudoza.Domain/Practice/PbeRules.cs`, `PbeRubric.cs`; `apps/api/src/Erudoza.Application/Contracts/PbeContracts.cs`; `apps/api/tests/Erudoza.UnitTests/PbeRubricTests.cs`.

**Files — modify:** `apps/web/worker/native/practice/scoring.ts`; `apps/api/src/Erudoza.Domain/Practice/PracticeQuestion.cs`; `apps/api/tests/Erudoza.UnitTests/Erudoza.UnitTests.csproj` to copy the shared fixture into test output; existing native/C# scoring tests to prove legacy stability.

**Interfaces:** Private types are defined here; later tasks import them. C# uses the same JSON names, GUID identity fields and enum strings. Put `PbeQuestionView` in the public DTO file and import it into the server module, never import private question types into the frontend. Public views omit accepted answers/evidence until reveal.

```ts
export type RecallSkill = 'FactualRecall' | 'ExactWords';
export interface PbeTarget {
  id: string; sourceUnitIds: string[]; skill: RecallSkill; label: string;
}
export interface PbeQuestion {
  schemaVersion: 2; id: string; version: number; contentPackId: string;
  sourceUnitId: string; sourceUnitIds: string[];
  sourceKind: 'Scripture' | 'Commentary'; reference: string; evidence: string;
  kind: 'ShortAnswer' | 'List' | 'ExactWords' | 'TrueFalse';
  prompt: string; ordered: boolean;
  parts: { targetId: string; acceptedAnswers: string[]; points: number }[];
}
export interface PbeGrade {
  earnedPoints: number; availablePoints: number;
  parts: { index: number; targetId: string; answerIndex: number | null;
    earnedPoints: number; availablePoints: number }[];
}
export interface PbeQuestionView {
  id: string; version: number; prompt: string; reference: string;
  kind: 'ShortAnswer' | 'List' | 'ExactWords' | 'TrueFalse'; partPoints: number[];
  points: number; durationSeconds: number;
}
// rules.ts
export const PBE_RULE_VERSION = 'nad-pbe-2023-24-v2';
export const PBE_SCORING_VERSION = 'pbe-rubric-v2';
export const responseSeconds = (points: number): number => {
  if (!Number.isInteger(points) || points < 1 || points > 8)
    throw new Error('PBE questions require 1–8 points.');
  return 20 + 5 * points;
};
// grading.ts exports:
// validatePbeQuestion(question: PbeQuestion, targets: PbeTarget[]): void
// gradePbe(question: PbeQuestion, answers: string[]): PbeGrade
// questionView(question: PbeQuestion): PbeQuestionView
```

- [ ] Add the contract and a failing rubric test. The complete synthetic question in the test avoids reliance on a hosted book:

```ts
import { expect, it } from 'vitest';
import { gradePbe } from './grading';
import type { PbeQuestion } from './types';
const q: PbeQuestion = {
  schemaVersion: 2, id: '00000000-0000-0000-0000-000000000001', version: 1,
  contentPackId: '00000000-0000-0000-0000-000000000002',
  sourceUnitId: '00000000-0000-0000-0000-000000000003',
  sourceUnitIds: ['00000000-0000-0000-0000-000000000003'],
  sourceKind: 'Scripture', reference: 'Fixture 1:1', evidence: 'Alpha and Beta',
  kind: 'List', prompt: 'Name both fixture labels.', ordered: false,
  parts: [
    { targetId: '00000000-0000-0000-0000-000000000004', acceptedAnswers: ['Alpha'], points: 1 },
    { targetId: '00000000-0000-0000-0000-000000000005', acceptedAnswers: ['Beta'], points: 1 }
  ]
};
it('awards each correct part once and preserves the missing target', () => {
  expect(gradePbe(q, ['Beta', 'wrong'])).toMatchObject({
    earnedPoints: 1, availablePoints: 2,
    parts: [{ index: 0, earnedPoints: 0 }, { index: 1, answerIndex: 0, earnedPoints: 1 }]
  });
  expect(() => gradePbe(q, ['wrong', 'Alpha', 'Beta'])).toThrow();
});
```

- [ ] Run `npm --workspace apps/web run test -- worker/native/pbe/grading.test.ts --maxWorkers=2`; expect a missing implementation or behavioral failure before implementation.
- [ ] Implement validation: nonempty source/ref/evidence; all source IDs in target source coverage; each part references a declared target; correct skill for exact-word questions; supported kind; total 1–8; part count matches requested answer fields; no empty variants. Preserve NFC/case/whitespace rules from current practice scoring. No automatic edit-distance acceptance. Use the existing weighted matching algorithm for unordered answers, exposing its chosen answer indexes; ordered/ExactWords compare each corresponding part. Reject extra fields at both evaluator and command boundaries.
- [ ] Add boundary cases for reversed exact words, duplicated answers, overlapping variants, unequal part weights, recognizable-but-unlisted spelling, 1/8/9 points and no answer-key leak in `questionView`. Hand-author the expected grades in `rubric-fixtures.json` and load it from both native and xUnit tests; never derive expected points from the evaluator under test. Do not overwrite existing C# generator fixtures.
- [ ] Run native PBE/scoring tests and `dotnet test apps/api/tests/Erudoza.UnitTests/Erudoza.UnitTests.csproj --filter 'FullyQualifiedName~PbeRubric|FullyQualifiedName~PracticeScoring'`. Commit the explicitly listed files as `feat: add versioned PBE rubrics`. Missing .NET execution leaves this task's parity gate open.

## Task A2: Scoped bank queries and additive target storage

**Files — create:** `apps/web/worker/native/pbe/bank.ts`, `bank.test.ts`, `pbe.integration.test.ts`; `apps/web/migrations/0005_pbe_training.sql`; `apps/api/src/Erudoza.Domain/PbeTrainingRecord.cs`; `apps/api/src/Erudoza.Application/Abstractions/IPbeQuestionBank.cs`; `apps/api/src/Erudoza.Application/Study/PbeQuestionBank.cs`; `apps/api/tests/Erudoza.IntegrationTests/PbeQuestionBankTests.cs`.

**Files — modify:** native `practice/questions.ts`, `application/model.ts`; C# `CompetitionEntities.cs`, `Abstractions/IErudozaDbContext.cs`, `ErudozaDbContext.cs`, `PracticeService.cs`, and generated EF migration/snapshot. All C# paths are under the corresponding `apps/api/src` project directories named in the index.

**Interfaces:** `BankScope = { organizationId, seasonId, studentId?: string, sourceUnitIds: string[] }`; `loadPbeBank(ctx, scope): Promise<{ questions: PbeQuestion[]; targets: PbeTarget[]; missingSourceUnitIds: string[] }>`; pure `filterPbeBank(questions, targets, allowedSourceUnitIds)` returns the same shape. Team callers supply season scope; solo callers supply the student's effective assignment. A multi-source question is eligible only if **all** its sources are allowed.

- [ ] Extend the A1 synthetic question with a second source ID and write this negative boundary test in `bank.test.ts`:

```ts
import { expect, it } from 'vitest';
import { filterPbeBank } from './bank';
import type { PbeQuestion, PbeTarget } from './types';
it('cannot admit a question spanning an excluded passage', () => {
  const allowed = '00000000-0000-0000-0000-000000000003';
  const excluded = '00000000-0000-0000-0000-000000000006';
  const target: PbeTarget = { id:'00000000-0000-0000-0000-000000000004',
    sourceUnitIds:[allowed,excluded], skill:'FactualRecall', label:'Both labels' };
  const q: PbeQuestion = { schemaVersion:2, id:'00000000-0000-0000-0000-000000000001',
    version:1, contentPackId:'00000000-0000-0000-0000-000000000002',
    sourceUnitId:allowed, sourceUnitIds:[allowed,excluded], sourceKind:'Scripture',
    reference:'Fixture 1:1–2', evidence:'Alpha and Beta', kind:'ShortAnswer',
    prompt:'Name both fixture labels.', ordered:false,
    parts:[{targetId:target.id,acceptedAnswers:['Alpha and Beta'],points:1}] };
  const result = filterPbeBank([q], [target], [allowed]);
  expect(result.questions).toEqual([]);
  expect(result.missingSourceUnitIds).toEqual([allowed]);
});
```

The integration test must import a complete valid two-source question, publish it as a coach, and assert it is absent from a student bank restricted to one source. Also deny foreign organizations, unassigned students, unpublished versions, inactive seasons and removed sources. Use the existing isolated native runtime pattern, not real accounts.
- [ ] Run `npm --workspace apps/web run test -- worker/native/pbe/bank.test.ts worker/native/pbe/pbe.integration.test.ts --maxWorkers=2`; observe the access/coverage failures before changing query behavior.
- [ ] Load published v2 questions with explicit pagination; join declared targets and effective source scope; choose the newest published version by question ID. Leave legacy questions usable in legacy matches but do not invent target equivalence or silently certify them as v2. Use an admin republish flow for conversion. Empty banks return coverage data, not fabricated questions. Add the season enable flag with an absent-value default of false.
- [ ] Implement projection storage. Native indexes must match organization/season/owner/kind queries and be idempotent. C# `PbeTrainingRecord` properties are `OrganizationId: Guid`, `Kind: string`, `Id: string`, `SeasonId: Guid`, `OwnerId: Guid?`, `DataJson: string`, `Revision: long`; primary key `(OrganizationId, Kind, Id)`, index `(OrganizationId, SeasonId, OwnerId, Kind)`. Register its DbSet and mapping. Generate with `dotnet ef migrations add PbeTrainingRecords --project apps/api/src/Erudoza.Infrastructure --startup-project apps/api/src/Erudoza.Api --output-dir Persistence/Migrations` using the repository's EF tooling. Verify upgrading an existing database with old sessions and Honors intact.
- [ ] Test a bank larger than 5,000 entries using pagination, cross-scope edits during selection and a cached bank whose scope revision changed. Bound reads to the relevant season/source set; record read-budget measurements instead of scanning all student history for each card. Run the native integration file and canonical `PbeQuestionBankTests`; commit `feat: add scoped PBE question banks` after migration/legacy tests pass.

## Task A3: Prepare banks before play and expose honest coverage

**Files — create:** `apps/web/src/features/practice/PbeTargetFields.tsx`, `PbeTargetFields.test.tsx`, `PbeBankCoverage.tsx`, `PbeBankCoverage.test.tsx`.

**Files — modify:** `QuestionEditor.tsx`, `QuestionEditor.test.tsx`, `PracticeHub.tsx`, `PracticeHub.test.tsx`, `src/api/practice.ts`, native `practice/questions.ts`, canonical `PracticeEndpoints.cs`/`PracticeService.cs`, and their existing integration tests.

**Interfaces:** `PbeTargetFields({ targets: PbeTargetView[], selectedTargetId: string | null, onSelect(id: string): void })`, where `PbeTargetView = { id: string; label: string; skill: 'FactualRecall' | 'ExactWords' }` is public authoring metadata. `PbeBankCoverage({ coveredSources: number, assignedSources: number, singleVariantTargets: number })`. Coach import/publish accepts the A1 contract; student bootstrap returns counts only, never the unrevealed bank.

- [ ] Add failing UI checks for a missing target and a sparse bank:

```tsx
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PbeBankCoverage } from './PbeBankCoverage';
it('shows gaps without claiming chapter readiness', () => {
  render(<PbeBankCoverage coveredSources={3} assignedSources={8} singleVariantTargets={2} />);
  expect(screen.getByText('3 of 8 assigned passages have questions')).toBeVisible();
  expect(screen.getByText('2 targets need another question variant')).toBeVisible();
  expect(screen.queryByText('Chapter ready')).toBeNull();
});
```

- [ ] Run `npm --workspace apps/web run test -- src/features/practice/PbeBankCoverage.test.tsx src/features/practice/QuestionEditor.test.tsx`; expect the new coverage assertions to fail.
- [ ] Add source/target selection, kind/point constraints, per-part accepted answers and source preview to the existing editor. Reword a question by creating another question ID attached to the same target; correcting a rubric creates a new version of the same ID. Require explicit publish after source review. Use existing primitives, preview validation and friendly errors. Include a bank coverage panel with links to add questions; do not imply one question covers every fact in a verse.
- [ ] Verify student/coach role separation and no answer keys in student bootstrap, assignment cuts through multi-source questions, commentary source labels, short chapters and import validation. Review at 1440/390/320px with keyboard. Run relevant frontend and native/canonical integration tests, then commit `feat: add PBE bank preparation and coverage`.

## Phase A gate

- [ ] Run the three task suites, native/frontend type checks and existing study/practice compatibility tests. Confirm zero changed historical grades against saved fixtures and no new production content.
- [ ] Update progress with tests actually executed, migration checks and SDK limitations; explicitly stage, commit and push the implementation branch. The next phase consumes the exact contracts above, not private frontend copies of answer keys.
