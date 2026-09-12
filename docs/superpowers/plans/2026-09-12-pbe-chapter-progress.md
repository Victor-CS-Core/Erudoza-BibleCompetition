# PBE Chapter Progress and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reward retained assigned knowledge with clear chapter progress and cooperative season milestones, then validate the integrated training experience.

**Architecture:** Derive versioned chapter projections from final solo target evidence and separately track team participation. Keep dated chapter stamps distinct from permanent mastery Honors. Reuse the current training journey, recap and design primitives.

**Tech Stack:** Existing training query/projection services, React, D1/EF, Vitest/xUnit/Playwright and current deployment tooling.

**Spec:** [Replayability assessment](../../audits/2026-09-11-training-replayability.md), [PBE assessment](../../audits/2026-09-11-pbe-training-alignment.md), [index](2026-09-12-pbe-training.md). Requires Phases B and C.

## Global constraints

Apply index constraints. “Chapter stamps should reflect fresh unaided PBE-format answers after a delay.” “Track solo evidence separately from team results.” Preserve earned Honors and profile unlocks. A small assignment must have attainable progress without inventing eligibility for existing size-dependent Honors. No new reward currency or commissioned art.

---

## Task D1: Chapter evidence, readiness and dated stamps

**Files — create:** `apps/web/worker/native/pbe/chapters.ts`, `chapters.test.ts`; `apps/api/src/Erudoza.Domain/Study/PbeChapterRules.cs`; `apps/api/tests/Erudoza.UnitTests/PbeChapterTests.cs`; `apps/api/tests/Erudoza.IntegrationTests/PbeChapterProgressTests.cs`.

**Files — modify:** native `pbe/progress.ts`, `training/{query,store,routes}.ts`, `mastery/store.ts`; `src/api/{pbeTypes,trainingTypes,training}.ts`; C# `TrainingQueryService.cs`, `TrainingProgressService.cs`, `PbeContracts.cs` and PBE record adapters.

**Interfaces:**

```ts
export interface TargetProof {
  targetId: string; questionId: string; questionVersion: number;
  attemptId: string; atMs: number; fullCredit: boolean; unaided: boolean;
  final: boolean; recall: boolean; activity: 'Solo' | 'Team';
}
export interface ChapterProgress {
  chapterKey: string; scopeVersion: string;
  assignedPassages: number; questionCoveredPassages: number;
  totalTargets: number; practicedTargets: number; recalledTargets: number;
  retainedTargets: number; dueTargets: number;
  missingVariantTargets: number; stampEarnedAtUtc: string | null;
}
// chapters.ts exports:
// retainedTargets(proofs: TargetProof[], eligibleTargetIds: string[]): string[]
// projectChapter(scope, targets, reviews, proofs, questions): ChapterProgress
```

`scope` is `{ chapterKey: string; scopeVersion: string; assignedSourceUnitIds: string[] }`; `targets` are Phase A `PbeTarget[]`, `reviews` are Phase B `TargetReview[]`, `proofs` are `TargetProof[]`, and `questions` are eligible published Phase A `PbeQuestion[]`. Count distinct recall-capable question IDs per target from `questions` to derive missing variants; recognition-only TrueFalse questions do not satisfy this prerequisite. Keep first earned stamp evidence immutable; current counters recompute from final evidence and the current scope.

- [ ] Write this delayed/fresh-question test:

```ts
import { expect, it } from 'vitest';
import { retainedTargets } from './chapters';
import type { TargetProof } from './chapters';
it('requires a different question after a delay, not repeated immediate success', () => {
  const first: TargetProof = { targetId:'t', questionId:'q1', questionVersion:1,
    attemptId:'a1', atMs:0, fullCredit:true, unaided:true, final:true, recall:true, activity:'Solo' };
  expect(retainedTargets([first,{...first,attemptId:'a2',atMs:172800000}], ['t'])).toEqual([]);
  expect(retainedTargets([first,{...first,questionId:'q2',attemptId:'a3',atMs:172800000}], ['t']))
    .toEqual(['t']);
});
```

- [ ] Run the new chapter tests before implementation. Add zero-target, one-verse, excluded-range, partial-chapter, multiple-book and scope-change cases; team evidence, hints and pending disputes must not satisfy individual retention.
- [ ] Derive practiced from an accepted attempt, recalled from full unaided final recall credit, and retained from two qualifying recall successes at least 48 hours apart with different question IDs. A later wrong recall answer resets current retained status until recovery; a later correct sequence must follow that failure. Group only currently eligible targets. A chapter stamp requires nonzero targets, complete assigned-passage question coverage and retention of all declared targets. Display that readiness concerns the published practice bank, not an exhaustive guarantee of all possible exam questions.
- [ ] Store `pbe-chapter-stamp` with organization/season/student/chapter/scope version, rule version, qualifying attempt IDs and earned time. New assignment scope gets a new projection; old stamps remain historical and cannot prove new scope coverage. Keep pending corrections out of new score-based awards, and replay affected target proof chronology when C3 resolves a dispute. Corrected current readiness may differ from an old dated keepsake; label both honestly.
- [ ] Verify transaction races, repeat completions, two simultaneous qualifying sessions, corrected grades and migration from existing Honors. Run native chapter/projection tests and canonical chapter unit/integration tests. Commit `feat: derive chapter readiness from delayed PBE recall`.

## Task D2: Chapter expeditions, comeback actions and season cooperation

**Files — create:** `apps/web/src/features/student/PbeChapterProgress.tsx`, `PbeChapterProgress.test.tsx`, `SeasonCoverage.tsx`, `SeasonCoverage.test.tsx`.

**Files — modify:** student `StudentHomePage.tsx`, `PassageJourney.tsx`, `ProgressPage.tsx`, `SessionRecapPage.tsx`, `HonorsPage.tsx` and tests; native `training/query.ts` and `pbe/progress.ts`; C# `TrainingQueryService.cs`; public PBE/training contracts. Existing shared controls/CSS only need changes if a reusable missing primitive is found.

**Interfaces:** `PbeChapterProgress({ progress: ChapterProgress, onPractice: () => void })`; `SeasonCoverage({ retainedAssignedPassages: number, assignedPassages: number, lastCheckedLabel: string })`. Student-specific “Practice this chapter” links preserve the selected season and filter only within that student's current assignment. Cooperative counts use assigned-passage proportions per student, capped once per passage; they never sum unlimited repeat attempts.

- [ ] Add this actionable short-assignment UI test:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PbeChapterProgress } from './PbeChapterProgress';
it('gives a small assignment an honest next action', () => {
  const practice = vi.fn();
  render(<PbeChapterProgress onPractice={practice} progress={{chapterKey:'p:1',scopeVersion:'v1',
    assignedPassages:3,questionCoveredPassages:2,totalTargets:4,practicedTargets:3,
    recalledTargets:2,retainedTargets:1,dueTargets:2,missingVariantTargets:1,stampEarnedAtUtc:null}} />);
  expect(screen.getByText('2 of 3 assigned passages have questions')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Practice this chapter'}));
  expect(practice).toHaveBeenCalledOnce();
  expect(screen.queryByText('Chapter retained')).toBeNull();
});
```

- [ ] Run the new tests before implementation. Add tests distinguishing participation, current readiness, dated chapter stamps and permanent Honors; progress percentages must handle zero denominators without fabricating 100%.
- [ ] Add selectable chapter groups of roughly 3–5 assigned verses, splitting at excluded gaps and book boundaries. Render approved commentary as a separately labeled book-introduction group, with a stable `intro:<contentPackId>` group key and target IDs; do not invent chapter/verse coordinates. Show practiced/recalled/retained counts with question coverage and next due targets. Use B2's scoped action to continue a chapter or B1's repair targets for a small comeback quest. If an old Honor requires more passages or higher difficulty, explain its exact prerequisite while offering achievable chapter progress; never enlarge assignments to unlock it.
- [ ] Add a cooperative season map showing covered versus assigned material and maintenance needs, with own contribution available to the student and detailed student breakdown restricted to coaches. Deduplicate overlapping assignments for team-wide passage coverage; show individual assigned-scope fractions separately so large assignments do not dominate. Team match results do not fabricate solo recall. Dated text pennants/stamps use existing primitives; retain the current patch collection and earned avatar rules.
- [ ] Verify accessible announcements, coach/student navigation, keyboard focus, screen-reader labels, reduced motion and 1440/390/320px layouts. Inspect full, empty, partial and overdue states with actual fixtures. Run student UI tests and training query tests; commit `feat: add PBE chapter journeys and cooperative progress`.

## Task D3: Integrated quality, pilot and controlled rollout

**Files — create:** `apps/web/e2e/pbe-training.spec.ts`; `docs/operations/pbe-training.md`; `docs/audits/2026-09-12-pbe-implementation.md` for executed evidence, not copied planning claims.

**Files — modify:** `apps/web/playwright.native.config.ts` to include the new spec; default Playwright config only if an explicit test match requires it; native/canonical regression files from prior phases; `scripts/cloudflare-export.mjs` and populated export/resume tests for new PBE records; `docs/operations/{cloudflare-native,pvp}.md`; `PROGRESS.md`.

**Interfaces:** No new product API. Use A–D's published requests/DTOs and existing isolated browser/server harnesses. Add fixtures only under test directories or ignored local output, never real student records.

- [ ] Write end-to-end cases before the final integration fixes: coach publishes a scoped v2 bank and enables the season; student completes daily questions with one failure; a later reference game leaves that failure due; replay varies the set; delayed fresh questions earn a chapter stamp; new assignment content removes current readiness until practiced. Separately complete a 90-question independent six-student rehearsal, flag/continue/replay, then resolve as a coach and verify corrections. Add a twelve-student two-team case and legacy-session resume.
- [ ] Assert answer secrecy, canonical/native grade parity, source/assignment invalidation, 1–8-point deadlines, same-score early/late in-window answers, rejected extra fields and idempotent retries. Run these behavioral tests as failures until their integration defects are fixed; do not weaken assertions to preserve a passing count.
- [ ] Run the following from repository root after the code is integrated:

```bash
npm --workspace apps/web run test -- --maxWorkers=2
npm --workspace apps/web run typecheck
npm --workspace apps/web run typecheck:native
npm --workspace apps/web run lint
npm --workspace apps/web run build
npm --workspace apps/web run build:native
dotnet restore apps/api/Erudoza.sln
dotnet format apps/api/Erudoza.sln --verify-no-changes --severity warn
dotnet build apps/api/Erudoza.sln --no-restore
dotnet test apps/api/Erudoza.sln --no-build
npm --workspace apps/web run test:e2e -- --config playwright.native.config.ts
npm --workspace apps/web run test:e2e -- pbe-training.spec.ts
```

Use .NET SDK `10.0.303` or its allowed latest patch from root `global.json`. If unavailable, record the exact blocked canonical gate and use a suitable execution host before release. A frontend build alone does not type-check native code; both checks are required. Install test browser dependencies only when missing, using the repository's existing setup. Read every result; an optional load skip is not a capacity pass.
- [ ] Execute the earlier synthetic replay scenarios with the new PBE bank. Report target/variant coverage, due recovery, partial credit, session completion and input action counts. Run a coached student pilot with the selected season's approved content, measuring first-attempt unaided accuracy after 48 hours and seven days plus return rates. Record the sample and limits; do not claim effectiveness from synthetic correct answers. Pilot participation and scheduling require the user's real-world coordination, not automated contact with children or coaches.
- [ ] Prepare the rollout artifact: selected rules/season, bank coverage, flags initially off, additive migrations tested on an isolated restored database, backup instructions, exact build, rollback-compatible version, and active-room drain strategy. Recheck official seasonal resources and any conference variation before enabling a real cohort. Do not silently swap the selected book or source edition.
- [ ] Review and push coherent source checkpoints. The release runbook must enable new sessions for a chosen season while existing rooms finish on their snapshots; rollback disables new PBE starts while allowing already-created v2 sessions to finish on a compatible build. Retain additive schema and historical evidence. Reverting to code that cannot read v2 snapshots is not a safe rollback.
- [ ] Only under deployment authorization, apply the reviewed migration, publish the verified build and read back the active version/bindings. Perform separate public and authenticated smoke checks with authorized accounts, proving new PBE start, answer, finish, replay and preserved old results. Record exactly which live steps ran. No automatic merge, deployment or real messaging is part of this planning request.

## Final acceptance

- [ ] Students can practice assigned PBE questions, finish and replay independent matches without a coach online, and see useful evidence-based progress.
- [ ] Official-format differences, text-presentation fallback, missing question coverage and provisional disputes are visible rather than concealed.
- [ ] All required local/runtime/browser gates have fresh evidence; source checkpoint and any live pilot/deployment are recorded separately. Remaining capacity or learning-study limits are explicit.
