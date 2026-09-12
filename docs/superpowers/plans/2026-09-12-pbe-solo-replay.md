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

**Integration outcome:** native `pbe/progress.ts` and canonical `Application/Study/PbeProgressService.cs` use Phase A's PBE records directly, with DI and fixture links plus actual persistence integration tests. B2 composes these adapters into study/daily routes; B1 does not modify legacy mastery/Honor stores merely to forward new evidence.

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
  if (full && !state.unresolved && state.intervalIndex >= 0 && e.atMs < state.dueAtMs)
    return { ...state, lastAttemptId: e.attemptId,
      lastQuestionId: e.questionId, lastSuccessfulAtMs: e.atMs };
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

The pure scheduling kernel above assumes validated, chronologically accepted events. Early successful recall records practice but preserves the existing future due date and interval; only a due review advances 1→3→7→14 days. Failure resets immediately, and the first unaided recovery schedules one day. This prevents rapid replay from substituting for delayed retrieval. `RequestContext` is the existing native type in `worker/native/types.ts`. The persistence adapter prepares statements/guards without committing: append them to the same atomic batch as the accepted attempt. Enforce positive point bounds, at-most-once attempt IDs, monotonic acceptance and optimistic revision checks; use one transaction in the C# adapter. Group per-part grades by target before producing evidence; all parts for a target must be correct for that target to advance. Do not accept client-supplied points or timestamps.

- [x] Write the regression for the audited failure:

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

- [x] Run `npm --workspace apps/web run test -- worker/native/pbe/review.test.ts worker/native/pbe/selection.test.ts`; expect missing behavior before implementing.
- [x] Implement the scheduler and selection. For ordinary eight-card practice, allocate the index's slots; sort the coverage slots by served count then oldest service, with `stableSeed(questionId, sessionId, slot)` as a deterministic tie-breaker. Prefer a different question ID for a target recently answered. Reserve at least three least-practiced slots so continually due targets cannot starve coverage. Fill unoccupied categories from eligible least-served candidates. Do not duplicate a question within a set; short scopes produce an explicitly shorter set. Review uses due targets only. Simulation uses balanced least-served targets and no adaptive repairs during the test. Apply rehearsal question-mix quotas only to Simulation; focused Practice/Review must still be able to teach assigned commentary.
- [x] Select the complete bounded set, including any repair slot, before start. Preserve a previously failed target for a repair after two distinct intervening targets from accepted history or earlier cards in this saved set. Other parts of the same failed multipart attempt do not count as intervening history. A new miss in the current set remains unresolved for the next session; a preselected later variant may serve it if spacing already holds. Do not append or replace cards after selection. If the scope cannot provide two intervening targets, or overlapping failed targets leave no eligible first card, permit a next-session retry to start the set without labeling it a spaced repair. Prefer proven or planned spacing whenever feasible; unresolved targets alone must not make a nonempty playable bank unavailable. Track served history separately from accepted evidence. A viewed prompt does not create a successful attempt. Store history projections by organization/season/student/question or target; no full session-history scan per card.
- [x] Add deterministic multi-session tests for 1/2/8/16/21/24/100 assigned passages, multiple targets per passage, uneven ranges, all-due banks, and only one variant. Under a fixed finite bank with no forced repair, repeated coverage slots must eventually serve every question before any question gets arbitrarily many extra services. A saved session must return identical IDs after refresh; a different session can differ while maintaining coverage. Port fixtures to C# and compare exact selected IDs and review dates.
- [x] Verify rapid successful replays preserve the future due date/interval; a success exactly at the deadline advances one interval, failure resets immediately, and recognition/aided success cannot repair failed recall. Run native tests and `dotnet test apps/api/tests/Erudoza.UnitTests/Erudoza.UnitTests.csproj --filter 'FullyQualifiedName~PbeReview|FullyQualifiedName~PbeSelection'`. Commit `feat: schedule recall targets and vary PBE replay` after idempotency and parity checks pass.

## Task B2: Deliver and score PBE questions through daily study

**Files — create:** `apps/web/worker/native/pbe/sessions.ts`, `sessions.test.ts`, `effort.ts`; `apps/web/src/features/student/PbeAnswerInput.tsx`, `PbeAnswerInput.test.tsx`, `PbeStudyPage.tsx` and focused page tests; `apps/api/src/Erudoza.Application/Study/PbeSessionService.cs`, `PbeEffortService.cs`; `apps/api/tests/Erudoza.IntegrationTests/PbeStudyTests.cs`. The focused effort adapters share existing preference/calendar/day/week storage and concurrency, while new PBE mission/session snapshots avoid legacy source/knowledge foreign keys and Honor evaluators.

**Files — modify:** native `study/routes.ts`, `training/{store,query,routes}.ts`; `src/api/{types,client,trainingTypes}.ts`; `StudyPage.tsx`, `SessionRecapPage.tsx` and corresponding tests; C# `StudySessionService.cs`, `StudyEntities.cs`, `ApiContracts.cs`, `TrainingContracts.cs`, study endpoint registration and EF mapping if adding snapshot fields. Use Phase A's record storage for new JSON data rather than changing historical attempts in place.

**Interfaces:** New study requests add `format?: 'Memory' | 'Pbe'`, `chapter?: { contentPackId: string; chapter: number }`, and optional target IDs restricted to the current assignment. A Pbe session snapshots `questionIds`, complete private question versions, `scopeVersion`, `ruleVersion`, `selectionVersion` and format. `PbeAnswerInput({ partPoints: number[], answers: string[], onChange(answers: string[]): void, disabled: boolean })` emits only text, never scores. Submission is `{ clientSubmissionId, challengeCardId, answers: string[], hintsUsed }`; server computes grades, timestamps and target evidence.

- [x] Create an answer-input regression:

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

- [x] Run the new UI and session tests. Session regressions must cover this exact sequence: start an enabled season with published questions, receive a sanitized card, answer one of two parts correctly, refresh, retry the same submission ID, complete, and inspect one persisted target update per target. A contradictory retry returns 409. Neither the pre-answer DTO nor logs include answer keys.
- [x] Implement the version branch in existing study routes and daily mission preparation. Query Phase A scope, select via B1, persist the complete immutable set once, and deliver its next unanswered card. Empty banks return a structured coverage error; Memory remains an explicit separate choice. Revalidate active season/assignment on start, next and submit, using the existing guarded-write pattern. A changed scope invalidates the new mission without altering completed historical results.
- [x] Render short facts, lists, ExactWords and TrueFalse through answer fields or true/false controls only. Keep references visible. Practice permits source assistance and records it on the server before returning the active card's source; client `hintsUsed` can add a self-report but cannot clear saved aid. Verify assistance followed by `hintsUsed:false`, refresh and retries cannot produce unaided evidence. Review/rehearsal evidence excludes aided answers. After grading, show expected parts, source evidence and points. Daily completion records effort independently from retention. A partial answer completes that card but leaves only its missed targets due.
- [x] Support the D3 rollback contract: disabling new PBE admission rejects new starts but permits an authenticated saved PBE session to finish on compatible code. Use a trusted continuation resolver, with current membership, assignment, active season, selected-book and source/license checks intact; no client-supplied bypass. Generic student bank/reader admission remains disabled. Test this separately from actual source or assignment revocation, which rejects continuation.
- [x] Keep untimed Practice/Review operational at this gate. Connect Simulation to Phase C's presentation/deadline module before enabling the Pbe Simulation entry; until then show “Timed rehearsal is not enabled” and allow ordinary Pbe practice. Do not expose a new untimed route under a timed-rehearsal label. Keep legacy Memory sessions resumable.
- [x] Extend `apps/web/e2e/training-progression.spec.ts` and `native-study.spec.ts` for the exact flow above, an eight-verse repeat experiment, a short assignment and a full chapter. Run native tests plus canonical `PbeStudyTests`, then frontend tests/type checks. Commit `feat: add PBE questions to daily study`.

## Task B3: Remove unnecessary memory-exercise interaction and clarify progression

**Files — create:** `apps/web/src/features/student/VerseBuilderInput.tsx`, `VerseBuilderInput.test.tsx`.

**Browser prerequisite:** `apps/web/src/auth/AuthContext.tsx` and tests must preserve pending Memory/PBE attempt data across a same-owner reload only after fresh authentication matches a non-secret sessionStorage owner fingerprint. Keep query-cache/revision guards; unknown or changed identity/permissions, 401 and logout clear both attempt families and marker. The fingerprint never authorizes server access. This closes the reproduced bootstrap cleanup defect required by the real pending-answer recovery gate.

**Files — modify:** `StudyPage.tsx`, `StudyPage.test.tsx`, native `study/engine.ts`, `study/engine.test.ts`, `mastery/solo-rules.ts`, `mastery/rules.test.ts`; C# `Erudoza.Domain/Study/VerseBuilderGenerator.cs`, `MissingWordsGenerator.cs`, `MasteryHonorRules.cs`; `ActivityDifficultyTests.cs`, `DeterministicActivityTests.cs` and `MasteryHonorRulesTests.cs`.

**Interfaces:** `VerseBuilderInput({ tokens: { index:number; display:string }[], selected:number[], onChange(ids:number[]):void, disabled:boolean })`. Preserve token IDs even for duplicate words. New memory cards snapshot `generatorVersion` and `evidenceProfile: 'memory-cued-v3' | 'memory-honor-v2'`; missing fields on existing cards retain the legacy evaluator/proof rules. Warmups use the former, original Advanced challenges the latter. Honor eligibility reads the saved profile rather than difficulty alone. New Memory requests add optional `memoryChallenge: 'Warmup' | 'Advanced'`. In an enabled PBE season, default new Memory sessions to Warmup; offer Advanced explicitly only under existing coach-set Advanced eligibility. Save that purpose with the generator/profile and resume from saved values. Seasons without the new enablement retain legacy new-start behavior; an explicit new purpose does not bypass admission. Missing historical fields preserve the legacy generator/evaluator, including cards generated later during resume. This is an exercise-purpose choice, not a difficulty promotion.

- [x] Add a test with duplicate labels and an interaction bound:

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

- [x] Run that test before implementation. Add a 47-word fixture verifying at most one append action per chunk plus submit; no adjacent-move requirement. Provide undo and clear with focus maintained. Keyboard activation and touch use the same buttons.
- [x] Generate at most 12 phrase chunks for new long-verse Builder cards: `chunkSize = Math.max(baseChunkSize, Math.ceil(wordCount / 12))`. Keep sequence evidence separate from exact-word recall. Add varied-gap warmups with `hiddenCount = eligibleCount <= 1 ? eligibleCount : Math.min(eligibleCount - 1, Math.max(1, Math.ceil(eligibleCount * 0.7)))` and the stored deterministic seed. Cap this supported exercise's wording evidence at 70; do not make the less demanding cue pattern eligible for existing Advanced mastery proof. Keep the original Advanced Missing Words challenge available with its original evidence requirements, and label the two purposes clearly. Very short verses may have only one mask; do not force invalid variation.
- [x] Label memory activities as study aids, offer optional full-verse recitation, and show coach-set difficulty prerequisites in the current progress UI. Do not auto-promote a student or change Foundation/Standard mastery ceilings. Pbe questions use their authored answer requirements regardless of memory-game difficulty.
- [x] Verify new generator fixtures in both runtimes, old session resume, duplicate-word scoring, mobile input and zero uncontrolled horizontal overflow at 320px. Commit `fix: simplify long verse practice and vary recall cues`.

## Phase B gate

- [x] Run native study/PBE/training suites, frontend student tests and equivalent canonical study/training tests. Repeat the earlier 8/24-verse and simulated 28-day audit scenarios using the new bank/target evidence; report target coverage and delayed accuracy separately from exercise counts.
- [x] Review student and coach views at 1440/390/320px. Publish no production fixtures. Update progress, explicitly commit and push the verified implementation checkpoint. Phase C completes timed Simulation; Phase D consumes retained target evidence.

## Task B4: Type directly into missing-word blanks

**User addition — September 12:** The supplied mobile Missing Words example (Esther 1:22) shows several blanks in the verse followed by a single answer textarea. Students must instead type directly into each missing word or phrase. The server must verify the corresponding position, without asking students to invent comma-separated answer formatting. This task was added after the original Phase B gate; execute it after the active C3 checkpoint and before D1/D2 integration. The earlier reviewed B1–B3 work remains accepted.

**Files — create:** `apps/web/src/features/student/MissingWordsInput.tsx`, `MissingWordsInput.test.tsx`; `apps/web/worker/native/study/missing-word-answers.ts`, `missing-word-answers.test.ts`; `apps/api/src/Erudoza.Domain/Study/MissingWordAnswers.cs`; `apps/api/tests/Erudoza.UnitTests/MissingWordAnswersTests.cs`; `apps/api/tests/Erudoza.IntegrationTests/MissingWordAnswerTests.cs`.

**Files — modify:** `StudyPage.tsx`, `StudyPage.test.tsx`; shared `src/api/{types,client}.ts`; native `study/{routes,engine}.ts` and covering tests; canonical `Contracts/ApiContracts.cs`, `Study/StudySessionService.cs`, `Domain/StudyEntities.cs`, `Persistence/ErudozaDbContext.cs` and generated EF model/migration files. Extend the shared Input primitive/styles only if an inline layout variant is needed; keep page CSS to layout. Add the accepted structured-answer fixture to `e2e/pbe-training.spec.ts` and the D3 exporter tests. These paths are relative to their existing application roots; existing files must be handed off after C3 before parallel edits.

**Interfaces and persistence:**

```ts
export interface MissingWordAnswer { index: number; text: string }
export interface MissingWordAnswerPayload {
  format: 'missing-words-slots/v1';
  answers: MissingWordAnswer[];
  results: { index: number; isCorrect: boolean; expected: string }[]; // server-generated
}
// Native pure adapter (new missing-word-answers.ts):
// evaluateMissingWordAnswers(tokens: Token[], answers: MissingWordAnswer[]):
//   { isCorrect: boolean; results: {index:number; isCorrect:boolean; expected:string}[] };
// Token is the existing private study/engine.ts type. Invalid index shape throws.
// MissingWordsInput props:
// tokens: ChallengeCard['tokens']; values: Record<number, string>;
// onChange(values: Record<number, string>): void; disabled: boolean;
// results?: { index: number; isCorrect: boolean; expected: string }[];
// Extend the existing attempt request with exactly one answer representation:
type MissingWordsAnswerBody =
  | { submittedAnswer: string; missingWordAnswers?: never }
  | { submittedAnswer?: never; missingWordAnswers: MissingWordAnswer[] };
```

Keep the existing submission ID, card ID, elapsed-time and hints fields. The structured path is valid only for MissingWords. Derive slots and expected text from the private **saved card**, never client-provided text, positions or points. Require exactly the saved hidden-index set, with one string per index; reject duplicates, visible/unknown/missing indices, malformed values, simultaneous representations and existing body/aggregate answer-size violations. Retain explicit empty strings and canonicalize array order by saved token order without normalizing the original text. Compare each value to its own private token using that card's existing MissingWords normalization; binary overall correctness requires every slot correct. Empty/whitespace-only input cannot be correct. If a private punctuation-only token normalizes to empty, compare nonempty trimmed original text for that slot. Do not impose a single-word regex: frozen tokens can contain embedded whitespace.

Persist new structured submissions as a versioned native `answerPayload` on the immutable attempt and nullable canonical `AnswerPayloadJson` on `Attempt` in `Domain/StudyEntities.cs`. The existing `SubmittedAnswer` remains a server-derived readable rendering for legacy recap consumers; it is not the grading or retry authority for the structured path. Generate the additive EF migration named `MissingWordsSlotAnswers` and retain the model snapshot; native JSON storage needs no new table solely for this payload. Exact retries compare the saved format and original indexed text plus existing request identity/timing/hints; two layouts that join to the same string are still different answers. Preserve historical string-only attempts and retries without reparsing, regrading or changing their scores/Honors. D3 must preserve the new payload and prove populated restore/retry.
Return optional `missingWordResults` on the accepted attempt result/DTO from the saved server-generated payload results, and feed those into the component's `results` prop only after the existing feedback boundary. The client request contains answers only; it cannot supply expected text or correctness. Persist the original per-slot results so later code changes cannot silently reinterpret historical feedback.

A concrete pure grading regression for the new adapter is:

```ts
import { expect, it } from 'vitest';
import { evaluateMissingWordAnswers } from './missing-word-answers';
it('does not move words across an empty blank', () => {
  const tokens = [
    {index: 2, text: 'in', hidden: true},
    {index: 3, text: 'the', hidden: true},
  ];
  expect(evaluateMissingWordAnswers(tokens, [
    {index: 2, text: 'in the'}, {index: 3, text: ''},
  ]).isCorrect).toBe(false);
});
```

- [ ] Add the failing inline-input test before implementation. Use the public token shape with redacted hidden display, including two adjacent hidden indices and separated/repeated blanks. For a controlled wrapper, type `sent` and `letters` into “Blank 1 of 2” and “Blank 2 of 2”; assert values remain keyed to their own indices and the page submits `missingWordAnswers: [{index:2,text:'sent'},{index:3,text:'letters'}]`. Assert the separate “Type the missing phrase” textarea is absent. Run `npm --workspace apps/web run test -- src/features/student/MissingWordsInput.test.tsx src/features/student/StudyPage.test.tsx` and record genuine behavioral RED.
- [ ] Add matching pure and actual HTTP grading regressions in both runtimes: expected `['in','the']` with entered `['in the','']` must be incorrect; swapped different words must fail; repeated equal words retain distinct positions; an empty middle slot cannot shift later entries; duplicate/unknown/missing indices fail validation. Cover case, spaces, apostrophes, commas, hyphens, embedded whitespace and punctuation-only source tokens under the defined policy. Verify legacy `submittedAnswer` strings retain their original meaning. Run the new focused native/Vitest and canonical unit/integration files before adding their adapters.
- [ ] Render the passage once from the frozen public token sequence, replacing every hidden token with the shared Input control. Keep visible words as Scripture text and controls in system sans. Use stable card/index keys and labels “Blank N of M.” Size fields from a neutral minimum and user-entered text only; do not leak expected word lengths, letters, punctuation or answers through HTML, placeholders or accessibility labels. Use clear focus, at least 44px touch targets, natural wrapping and no page overflow. Disable autocomplete, spelling correction and automatic capitalization for recall inputs.
- [ ] Support Tab/Shift+Tab and mobile Next/Done navigation without submitting mid-composition or moving focus based on guessed answer length. Keep an explicit Submit action; allow a deliberately unfilled slot to remain an incorrect answer rather than silently filling or compacting it. Preserve entered fields on rerender, clear only when card identity changes, and lock them while a saved submission is pending or accepted. After the existing authorized feedback boundary, show per-blank correctness with text/icons and source review; color alone is insufficient. Keep timed/deferred feedback boundaries unchanged.
- [ ] Implement the structured server adapters and atomic immutable payload persistence described above. Apply existing authority, assignment, assistance, mastery ceilings and version rules. Do not award per-word partial mastery or change the Memory/PBE scoring policies as a side effect of the input change. Verify original raw slot values, result and submission identity survive reload and a lost-response retry; reject a reused ID with different slot values even when the readable joined string matches.
- [ ] Preserve saved legacy pending requests exactly: keep their existing read-only answer notice and retry their original text, ID, elapsed time and hints. Never guess how a comma-separated legacy answer maps to blanks or replace it with a newly generated request. New pending requests restore their indexed fields under the existing same-owner authentication guard. Cover unknown/changed identity and logout clearing without weakening B3 recovery checks.
- [ ] Apply inline entry across current MissingWords modes and saved Warmup/Advanced profiles. Reuse the component for any activity with explicit frozen blank positions. Current PBE cards expose rubric parts, not blank positions: do not parse underscores, treat every part as a blank, or fabricate missing words for full-quotation/list/short-answer questions. Authored PBE blank templates require explicit validated/frozen slot metadata before this renderer can consume them; retain their distinct grading rules.
- [ ] Run focused student UI, native study, canonical slot/unit/HTTP checks, both type checks, lint and applicable format/build checks. Verify native and canonical browser journeys at 1440/390/320px with keyboard, reduced motion, adjacent/separated blanks, long entries, correct/incorrect feedback, and saved-answer recovery. Include coach/student views if shared Input styling changes. Test the additive EF migration against an isolated populated database and preserve earlier records. Commit `feat: answer missing words directly in verse blanks`, complete independent task review, and push the verified checkpoint before D1/D2 integration. A plan update is not implementation or deployment evidence.
