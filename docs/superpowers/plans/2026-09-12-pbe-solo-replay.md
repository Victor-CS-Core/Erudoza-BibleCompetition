# PBE Solo Learning and Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each practice session improve recall of assigned material through varied questions, targeted repair and delayed review.

**Architecture:** Use Phase A's published targets and rubric grades. Maintain separate per-target review projections and immutable session snapshots, then integrate them with daily missions and the existing student routes. Keep memory exercises available as a separate format.

**Tech Stack:** Existing TypeScript/React/native D1 and C# study/training services; Vitest/xUnit/Playwright.

**Spec:** [Replayability assessment](../../audits/2026-09-11-training-replayability.md), [PBE assessment](../../audits/2026-09-11-pbe-training-alignment.md), [index](2026-09-12-pbe-training.md). Requires Phase A.

## Global constraints

Apply the index constraints. “A recognition answer must not defer an unresolved recall failure.” Refresh/resume must preserve the question and rubric. Practice remains bounded to assigned material and coach-controlled difficulty; no infinite repair loop and no invented progress. The proposed 1/3/7/14-day intervals are a pilot policy, not an official standard.

---

## Task B1: Evidence-specific scheduling and session variation

**Files — create:** `apps/web/worker/native/pbe/review.ts`, `review.test.ts`, `selection.ts`, `selection.test.ts`, `progress.ts`; `apps/api/src/Erudoza.Domain/Study/PbeReviewRules.cs`, `PbeSelectionRules.cs`; `apps/api/tests/Erudoza.UnitTests/PbeReviewTests.cs`, `PbeSelectionTests.cs`.

**Files — modify:** native `training/store.ts`, `training/query.ts`; C# `TrainingProgressService.cs`, `TrainingQueryService.cs`; add projection access through Phase A's PBE records.

**Interfaces:** All timestamps are UTC milliseconds in pure functions, serialized as ISO timestamps at HTTP boundaries. Historical mastery fields are untouched.

```ts
export interface TargetReview {
  targetId: string; intervalIndex: number; dueAtMs: number;
  unresolved: boolean; lastAttemptId: string | null;
  lastQuestionId: string | null; lastSuccessfulAtMs: number | null;
}
export interface RecallEvidence {
  attemptId: string; targetId: string; questionId: string;
  atMs: number; earnedPoints: number; availablePoints: number;
  unaided: boolean; recall: boolean;
}
export function advanceReview(state: TargetReview, e: RecallEvidence): TargetReview {
  if (state.lastAttemptId === e.attemptId) return state;
  if (!e.recall) return state;
  const full = e.earnedPoints === e.availablePoints && e.availablePoints > 0;
  if (full && !e.unaided) return { ...state, lastAttemptId: e.attemptId };
  const index = full ? Math.min(3, state.intervalIndex + 1) : -1;
  return { ...state, intervalIndex: index, unresolved: !full,
    dueAtMs: e.atMs + (full ? [1, 3, 7, 14][index] * 86400000 : 0),
    lastAttemptId: e.attemptId, lastQuestionId: e.questionId,
    lastSuccessfulAtMs: full ? e.atMs : state.lastSuccessfulAtMs };
}
export interface SelectionCandidate {
  questionId: string; targetIds: string[]; sourceUnitIds: string[];
  sourceKind: 'Scripture' | 'Commentary'; kind: string;
  servedCount: number; lastServedAtMs: number | null;
  due: boolean; repairEligible: boolean;
}
export interface SelectionInput {
  sessionId: string; count: number; mode: 'Practice' | 'Review' | 'Simulation';
  candidates: SelectionCandidate[]; usedQuestionIds: string[];
  usedTargetIds: string[]; trueFalseMaxRatio: number;
}
// selection.ts exports selectPbeQuestions(input: SelectionInput): string[]
export interface PbeWriteBatch {
  statements: import('@cloudflare/workers-types').D1PreparedStatement[];
  guards: { kind: string; id: string; revision: number }[];
}
// progress.ts exports prepareRecallEvidence(ctx: RequestContext, seasonId: string,
//   scopeVersion: string, evidence: RecallEvidence[]): Promise<PbeWriteBatch>
```

The pure scheduling kernel above assumes validated, chronologically accepted events. `RequestContext` is the existing native type in `worker/native/types.ts`. The persistence adapter prepares statements/guards without committing: append them to the same atomic batch as the accepted attempt. Enforce positive point bounds, at-most-once attempt IDs, monotonic acceptance and optimistic revision checks; use one transaction in the C# adapter. Group per-part grades by target before producing evidence; all parts for a target must be correct for that target to advance. Do not accept client-supplied points or timestamps.

- [ ] Write the regression for the audited failure:

```ts
import { expect, it } from 'vitest';
import { advanceReview } from './review';
it('recognition cannot postpone an unresolved factual recall', () => {
  const failed = { targetId:'t', intervalIndex:-1, dueAtMs:1000,
    unresolved:true, lastAttemptId:'wrong', lastQuestionId:'q1', lastSuccessfulAtMs:null };
  expect(advanceReview(failed, { attemptId:'choice', targetId:'t', questionId:'q2',
    atMs:2000, earnedPoints:1, availablePoints:1, unaided:true, recall:false })).toEqual(failed);
  expect(advanceReview(failed, { attemptId:'right', targetId:'t', questionId:'q3',
    atMs:2000, earnedPoints:1, availablePoints:1, unaided:true, recall:true }).dueAtMs)
    .toBe(2000 + 86400000);
});
```

- [ ] Run `npm --workspace apps/web run test -- worker/native/pbe/review.test.ts worker/native/pbe/selection.test.ts`; expect missing behavior before implementing.
- [ ] Implement the scheduler and selection. For ordinary eight-card practice, allocate the index's slots; sort the coverage slots by served count then oldest service, with `stableSeed(questionId, sessionId, slot)` as a deterministic tie-breaker. Prefer a different question ID for a target recently answered. Reserve at least three least-practiced slots so continually due targets cannot starve coverage. Fill unoccupied categories from eligible least-served candidates. Do not duplicate a question within a set; short scopes produce an explicitly shorter set. Review uses due targets only. Simulation uses balanced least-served targets and no adaptive repairs during the test. Apply rehearsal question-mix quotas only to Simulation; focused Practice/Review must still be able to teach assigned commentary.
- [ ] Preserve a failed target for a repair after two intervening targets. If the scope cannot provide two, offer repair on the next session without blocking completion. Track served history separately from accepted evidence. A viewed prompt does not create a successful attempt. Store history projections by organization/season/student/question or target; no full session-history scan per card.
- [ ] Add deterministic multi-session tests for 1/2/8/16/21/24/100 assigned passages, multiple targets per passage, uneven ranges, all-due banks, and only one variant. Under a fixed finite bank with no forced repair, repeated coverage slots must eventually serve every question before any question gets arbitrarily many extra services. A saved session must return identical IDs after refresh; a different session can differ while maintaining coverage. Port fixtures to C# and compare exact selected IDs and review dates.
- [ ] Run native tests and `dotnet test apps/api/tests/Erudoza.UnitTests/Erudoza.UnitTests.csproj --filter 'FullyQualifiedName~PbeReview|FullyQualifiedName~PbeSelection'`. Commit `feat: schedule recall targets and vary PBE replay` after idempotency and parity checks pass.

## Task B2: Deliver and score PBE questions through daily study

**Files — create:** `apps/web/worker/native/pbe/sessions.ts`, `sessions.test.ts`; `apps/web/src/features/student/PbeAnswerInput.tsx`, `PbeAnswerInput.test.tsx`; `apps/api/src/Erudoza.Application/Study/PbeSessionService.cs`; `apps/api/tests/Erudoza.IntegrationTests/PbeStudyTests.cs`.

**Files — modify:** native `study/routes.ts`, `training/{store,query,routes}.ts`; `src/api/{types,client,trainingTypes}.ts`; `StudyPage.tsx`, `SessionRecapPage.tsx` and corresponding tests; C# `StudySessionService.cs`, `StudyEntities.cs`, `ApiContracts.cs`, `TrainingContracts.cs`, study endpoint registration and EF mapping if adding snapshot fields. Use Phase A's record storage for new JSON data rather than changing historical attempts in place.

**Interfaces:** New study requests add `format?: 'Memory' | 'Pbe'`, `chapter?: { contentPackId: string; chapter: number }`, and optional target IDs restricted to the current assignment. A Pbe session snapshots `questionIds`, complete private question versions, `scopeVersion`, `ruleVersion`, `selectionVersion` and format. `PbeAnswerInput({ partPoints: number[], answers: string[], onChange(answers: string[]): void, disabled: boolean })` emits only text, never scores. Submission is `{ clientSubmissionId, challengeCardId, answers: string[], hintsUsed }`; server computes grades, timestamps and target evidence.

- [ ] Create an answer-input regression:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PbeAnswerInput } from './PbeAnswerInput';
it('provides the requested answer fields without revealing options', () => {
  const changed = vi.fn();
  render(<PbeAnswerInput partPoints={[1,1]} answers={['','']} onChange={changed} disabled={false} />);
  expect(screen.getAllByRole('textbox')).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('Answer 1'), { target:{value:'Alpha'} });
  expect(changed).toHaveBeenCalledWith(['Alpha','']);
  expect(screen.queryByRole('radio')).toBeNull();
});
```

- [ ] Run the new UI and session tests. Session regressions must cover this exact sequence: start an enabled season with published questions, receive a sanitized card, answer one of two parts correctly, refresh, retry the same submission ID, complete, and inspect one persisted target update per target. A contradictory retry returns 409. Neither the pre-answer DTO nor logs include answer keys.
- [ ] Implement the version branch in existing study routes and daily mission preparation. Query Phase A scope, select via B1, persist the complete immutable set once, and deliver its next unanswered card. Empty banks return a structured coverage error; Memory remains an explicit separate choice. Revalidate active season/assignment on start, next and submit, using the existing guarded-write pattern. A changed scope invalidates the new mission without altering completed historical results.
- [ ] Render short facts, lists, ExactWords and TrueFalse through answer fields or true/false controls only. Keep references visible. Practice permits source assistance and records hints; review/rehearsal evidence excludes aided answers. After grading, show expected parts, source evidence and points. Daily completion records effort independently from retention. A partial answer completes that card but leaves only its missed targets due.
- [ ] Keep untimed Practice/Review operational at this gate. Connect Simulation to Phase C's presentation/deadline module before enabling the Pbe Simulation entry; until then show “Timed rehearsal is not enabled” and allow ordinary Pbe practice. Do not expose a new untimed route under a timed-rehearsal label. Keep legacy Memory sessions resumable.
- [ ] Extend `apps/web/e2e/training-progression.spec.ts` and `native-study.spec.ts` for the exact flow above, an eight-verse repeat experiment, a short assignment and a full chapter. Run native tests plus canonical `PbeStudyTests`, then frontend tests/type checks. Commit `feat: add PBE questions to daily study`.

## Task B3: Remove unnecessary memory-exercise interaction and clarify progression

**Files — create:** `apps/web/src/features/student/VerseBuilderInput.tsx`, `VerseBuilderInput.test.tsx`.

**Files — modify:** `StudyPage.tsx`, `StudyPage.test.tsx`, native `study/engine.ts`, `study/engine.test.ts`, `mastery/solo-rules.ts`, `mastery/rules.test.ts`; C# `Erudoza.Domain/Study/VerseBuilderGenerator.cs`, `MissingWordsGenerator.cs`, `MasteryHonorRules.cs`; `ActivityDifficultyTests.cs`, `DeterministicActivityTests.cs` and `MasteryHonorRulesTests.cs`.

**Interfaces:** `VerseBuilderInput({ tokens: { index:number; display:string }[], selected:number[], onChange(ids:number[]):void, disabled:boolean })`. Preserve token IDs even for duplicate words. New memory cards snapshot `generatorVersion` and `evidenceProfile: 'memory-cued-v3' | 'memory-honor-v2'`; missing fields on existing cards retain the legacy evaluator/proof rules. Warmups use the former, original Advanced challenges the latter. Honor eligibility reads the saved profile rather than difficulty alone.

- [ ] Add a test with duplicate labels and an interaction bound:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { VerseBuilderInput } from './VerseBuilderInput';
it('appends a chosen token directly rather than moving it repeatedly', () => {
  const changed = vi.fn();
  render(<VerseBuilderInput tokens={[{index:0,display:'one'},{index:1,display:'one'}]}
    selected={[]} onChange={changed} disabled={false} />);
  fireEvent.click(screen.getAllByRole('button', { name:'Add one' })[1]);
  expect(changed).toHaveBeenCalledWith([1]);
});
```

- [ ] Run that test before implementation. Add a 47-word fixture verifying at most one append action per chunk plus submit; no adjacent-move requirement. Provide undo and clear with focus maintained. Keyboard activation and touch use the same buttons.
- [ ] Generate at most 12 phrase chunks for new long-verse Builder cards: `chunkSize = Math.max(baseChunkSize, Math.ceil(wordCount / 12))`. Keep sequence evidence separate from exact-word recall. Add varied-gap warmups with `hiddenCount = eligibleCount <= 1 ? eligibleCount : Math.min(eligibleCount - 1, Math.max(1, Math.ceil(eligibleCount * 0.7)))` and the stored deterministic seed. Cap this supported exercise's wording evidence at 70; do not make the less demanding cue pattern eligible for existing Advanced mastery proof. Keep the original Advanced Missing Words challenge available with its original evidence requirements, and label the two purposes clearly. Very short verses may have only one mask; do not force invalid variation.
- [ ] Label memory activities as study aids, offer optional full-verse recitation, and show coach-set difficulty prerequisites in the current progress UI. Do not auto-promote a student or change Foundation/Standard mastery ceilings. Pbe questions use their authored answer requirements regardless of memory-game difficulty.
- [ ] Verify new generator fixtures in both runtimes, old session resume, duplicate-word scoring, mobile input and zero uncontrolled horizontal overflow at 320px. Commit `fix: simplify long verse practice and vary recall cues`.

## Phase B gate

- [ ] Run native study/PBE/training suites, frontend student tests and equivalent canonical study/training tests. Repeat the earlier 8/24-verse and simulated 28-day audit scenarios using the new bank/target evidence; report target coverage and delayed accuracy separately from exercise counts.
- [ ] Review student and coach views at 1440/390/320px. Publish no production fixtures. Update progress, explicitly commit and push the verified implementation checkpoint. Phase C completes timed Simulation; Phase D consumes retained target evidence.
