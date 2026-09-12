# Independent PBE Team Rehearsal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let students complete realistic, accuracy-scored PBE rehearsals independently, with optional later review of disputed grades.

**Architecture:** Introduce a versioned room profile on the existing authoritative state machine. Reuse Phase A rubrics and Phase B question-history selection, with a shared presentation component for solo Simulation and teams. Keep disputes and score projections asynchronous to match progression.

**Tech Stack:** Existing Durable Object/native and .NET match engines, React, browser speech synthesis where available, Vitest/xUnit/Playwright.

**Spec:** [Accepted independent grading](../../audits/2026-09-11-pbe-training-alignment.md#accepted-recommendation-independent-play-with-optional-review), [index](2026-09-12-pbe-training.md). Requires Phase A and the B1 selection/history contracts.

## Global constraints

Apply index constraints. “A disputed answer enters a later-review queue without pausing the match, blocking completion or preventing another session.” Reveal answers only after every participating team locks or its deadline closes. Legacy speed-based matches remain on their saved scoring version. No browser timestamp or claimed speech duration determines points.

---

## Task C1: Independent presentation and authoritative response windows

**Files — create:** `apps/web/src/features/study/pbeSpeech.ts`, `pbeSpeech.test.ts`, `PbePresentation.tsx`, `PbePresentation.test.tsx`; `apps/web/worker/native/pbe/presentation.ts`, `presentation.test.ts`; `apps/api/src/Erudoza.Domain/Practice/PbePresentationRules.cs`; `apps/api/tests/Erudoza.UnitTests/PbePresentationTests.cs`.

**Files — modify:** native PBE session/effort and authenticated dispatch contracts, public PBE/study clients, the saved-format `PbeStudyPage.tsx` path and Training HQ; C# `PbeSessionService.cs`, study endpoints, ingress middleware, dependency registration and `PvpRoundClock.cs`. Add the dedicated solo authority, bindings/class migration, isolated runtime/browser fixtures and their tests. Full native `practice/{state,room}.ts`, `PracticePage.tsx` and C# room model/engine/command wiring belongs to C2 under the runtime boundary below.

**Interfaces:**

```ts
export interface SpeechPort {
  speak(text: string, onEnd: () => void, onError: () => void): void;
  cancel(): void;
}
// pbeSpeech.ts:
// readTwice(text: string, port: SpeechPort, signal: AbortSignal): Promise<'Audio' | 'TextFallback'>
export interface PresentationState {
  questionId: string; revision: number;
  delivery: 'Audio' | 'TextFallback' | 'Coach';
  requiredScribeIds: string[]; readyScribeIds: string[];
  responseStartsAtMs: number | null; responseEndsAtMs: number | null;
}
// presentation.ts:
// acknowledgePresentation(state, scribeId: string, questionId: string,
//   nowMs: number, points: number): PresentationState
// rehearsalPoints(earned: number, elapsedMs: number, points: number): number
```

**Runtime boundary:** C1 adds a dedicated per-session native Durable Object and a canonical singleton monotonic authority behind an Application abstraction, with necessary additive source/config/test files. Capture complete bounded-body ingress before authentication and queuing. Persist trusted frozen finals/drafts and idempotent delivery; existing direct submission routes must not bypass the authority. On unrecoverable clock loss, preserve trusted locked answers and earlier effort, expose interruption with independent restart, and avoid fabricated failure or full completion. Never reopen an armed scoring window or reconstruct canonical timing from UTC. C1 supplies tested one/two-scribe presentation/timing interfaces; C2 connects complete room routes/UI with its versioned material and roster contracts.

Canonical pending delivery uses additive `pbe-solo-outbox` training records and a scoped expiry ticker. Process a bounded, fairly advancing page of pending sessions; live authority decides expiry from its monotonic clock, while replacement recovery settles trusted persisted answers or interrupts without reopening. Offline expiry and failed projection retry must work without a later client request. Keep draft/final/retry identity and lock time durable before acknowledgement, and preserve exact earlier-card retries after settlement. D3 must include the actual outbox/recovery contract in export and rollback handling.

**Solo set size:** keep the existing shortened ten-question Simulation scope, using fewer questions only when explicitly labeled with the actual eligible count. Label it shortened timed practice, not a full event. Freeze the complete set, apply Simulation mix quotas and defer all answer/score feedback until the session ends. C2 supplies full-length team rehearsal. This resolves the unspecified C1 solo count without expanding personal assignments.

The browser presents the reference, point value and prompt twice, excluding answers and evidence. Prefer an available local speech voice; start audio from the participant's ready gesture. Use completion/error events, not an estimated reading duration. On unavailable audio or error, provide two explicit text-reading steps and record `TextFallback`; do not claim that fallback reproduced an audible event reading. A coach-led mode records `Coach`. The browser's completion acknowledgement is a readiness signal, not proof that a student listened.

Source checked during planning: the [Web Speech API specification](https://webaudio.github.io/web-speech-api/) defines speech synthesis, end/error events and local versus remote voices. Browser/device support and pronunciation still need execution-time validation. No microphone, recording, paid speech provider or external grading dependency is introduced.

- [x] Write a deterministic test driving two separate speech completions:

```ts
import { expect, it } from 'vitest';
import { readTwice } from './pbeSpeech';
it('waits for two complete readings', async () => {
  const ends: (() => void)[] = [];
  const spoken: string[] = [];
  const port = { speak: (text: string, end: () => void) => {
    spoken.push(text); ends.push(end);
  }, cancel: () => {} };
  const done = readTwice('For one point. Fixture 1:1. Name the label.', port, new AbortController().signal);
  expect(spoken).toHaveLength(1);
  ends[0](); await Promise.resolve();
  expect(spoken).toHaveLength(2);
  ends[1]();
  await expect(done).resolves.toBe('Audio');
});
```

- [x] Run speech/presentation tests; observe failure. Add separate cases for unavailable local voice, speech error, `voiceschanged`, user gesture, cancellation, hidden tab and component unmount. Cancellation rejects with `AbortError` and must never acknowledge readiness. Text fallback requires the participant's two reading confirmations; it cannot silently mark audio as completed.
- [x] Implement the browser wrapper and state transition. Required readiness is one scribe per active team, or the student in solo. Accept only authenticated authorized scribes and the current question/revision. Once all are ready, schedule response three seconds ahead using the existing acknowledgement mechanism. An expired incomplete pre-start schedule may receive a new revision; reconnect to an armed question restores its existing scoring window. Before response starts, show a waiting/connection state and let the room owner retry presentation or choose the disclosed text fallback; no coach is needed.
- [x] Add the server-only scoring kernel and boundaries:

```ts
import { responseSeconds } from './rules';
export function rehearsalPoints(earned: number, elapsedMs: number, points: number): number {
  if (!Number.isInteger(earned) || earned < 0 || earned > points ||
      !Number.isFinite(elapsedMs) || elapsedMs < 0)
    throw new Error('Invalid rehearsal score.');
  return elapsedMs <= responseSeconds(points) * 1000 ? earned : 0;
}
// Required assertions: rehearsalPoints(1, 5000, 1) === 1;
// rehearsalPoints(1, 25000, 1) === 1; rehearsalPoints(1, 25001, 1) === 0.
```

Retain native ingress timing and the canonical monotonic clock; validate finite input values. Show the warning when server-derived remaining time crosses ten seconds, once per question. A draft received before the deadline may earn accuracy at expiry under the existing policy; later text cannot replace it. A late final submission with no valid saved draft earns zero. Network failures do not justify trusting client timestamps.
- [x] Integrate into new Pbe solo Simulation, enable its timed entry from B2, and hand off the tested shared one/two-scribe contracts for C2 room wiring. Ordinary learning remains untimed. Practice feedback may reveal after a solo response locks; full solo Simulation holds feedback until the end to avoid teaching later test answers. Compare native/C# boundary fixtures and reconnect cases. Commit `feat: add independent PBE presentation and timing`.

## Task C2: Versioned rooms, six-student rosters and new question sets

**Files — modify:** native `practice/{state,room,routes,questions,awards}.ts` and their tests; `src/api/practice.ts`; `PracticeHub.tsx`, `PracticePage.tsx`, `practiceUtils.ts` and tests; C# `PracticeModels.cs`, `PracticeService.cs`, `PracticeCommands.cs`, `PracticeMatchEngine.cs`, `PracticeRuntime.cs`; `PracticeRoomHttpTests.cs`, `PracticeClockTests.cs`; `apps/web/e2e/practice.spec.ts`.

**Files — create:** `apps/web/worker/native/practice/pbe-room.test.ts`; `apps/api/tests/Erudoza.IntegrationTests/PbeRoomTests.cs`.

**Interfaces:** Room creation adds `format: 'Arcade' | 'Pbe'`, `teamCount: 1 | 2`, and `coached` defaults false for new Pbe rooms. Store all three plus rule/scoring/selection versions in the immutable room setup. `activeTeams(room): number[]` returns `[1]` or `[1,2]`; old rooms lacking `teamCount` use two. `roomScore(room, submission)` dispatches by the persisted format/version, never the current feature flag. New room question snapshots contain A1 rubrics; legacy snapshots retain their existing schema.

- [x] Add a failing native room test using the existing actor fixture shape:

```ts
import { expect, it } from 'vitest';
import { makeRoom } from './state';
import type { Actor } from '../types';
it('creates an independent one-team rehearsal with six seats', () => {
  const a: Actor = { userId:'a', organizationId:'org', organizationName:'Org',
    displayName:'A', userName:'a', email:null, kind:'Student', role:'Student', credentialVersion:'v1' };
  const room = makeRoom('room', a, { seasonId:'season', teamSize:6,
    teamCount:1, questionCount:90, coached:false, format:'Pbe' }, 'epoch', 1000);
  expect(room).toMatchObject({ teamCount:1, teamSize:6, coached:false, format:'Pbe' });
});
```

- [x] Run `npm --workspace apps/web run test -- worker/native/practice/pbe-room.test.ts`; expect current roster validation to fail. Add a complete state-machine test for both one-team six-student and two-team twelve-student rooms before adapting loops.
- [x] Replace hardcoded `[1,2]`, two-scribe and `teamSize * 2` assumptions only for versioned rooms. Apply active-team checks to joins, readiness, submission counts, deadlines, discussion, result totals and invitations. Allow role reassignment between questions for rotating scribes; do not switch the authorized submitter during an open response. Keep the captain role and optional non-playing coach. In explicitly coached PBE, the designated non-playing coach confirms two readings and every active team scribe confirms current readiness before the shared response schedule is armed. Persist Coach delivery per team; neither students claiming Coach delivery nor an adult submitting student answers is allowed. Independent Audio/TextFallback behavior remains unchanged. Independent PBE adult owners must not occupy student seats. The saved owner or any current authorized student captain may start a full/ready independent PBE room and resume an unarmed Paused replacement, using the same server/UI predicate. Do not require adult presence or ownership transfer; preserve coached/Arcade ownership rules. Test a coach-created room continuing entirely from invited student accounts after the adult leaves, including unarmed recovery control. The UI must not require opponent invitations for one-team practice.
- [x] Resolve team material through a trusted, authenticated room boundary over the coach-selected season's approved sources, including reviewed/licensed introductions for selected books. This preserves full-scope team rehearsal; solo practice remains restricted to personal assignments. Require current active season, eligible actual participants and fresh source/membership guards for start and continuation. Apply those continuation guards to Lobby/Playing start and material play. Existing-authority cleanup (lobby remove/leave and room termination) remains available after source/roster revocation under current authenticated organization/role and the existing global room control; it cannot return revoked or unanswered source content, arm a response, erase accepted evidence or fabricate completion. Keep authorized cleanup reachable from the shared recovery/error UI even when the ordinary material snapshot is unavailable. Completed/Interrupted history instead requires current organization/role access and saved participant/non-playing coach authorization, and retains only frozen previously revealed results without exposing unanswered keys or expanding generic source access. Generic student banks/readers must not gain coach-wide access. Test an assigned specialist participating in full-season rehearsal, exclusion of unreviewed/unlicensed/off-season sources, roster/source revocation and disabled new admission versus valid saved continuation. Here disabled new admission means season `PbeEnabled=false`: block new creation/start, preserve already-started frozen rooms with current guards. An unstarted lobby is a new start. Preserve the existing organization-wide Team Practice control and its access enforcement. The full-season scope is the controller's stated default after the optional product question received no answer; incorporate any later user correction before implementation.
- [x] At start, freeze a bank selected with the B1 candidate/history contract. Prefer least-served questions across current participants using the maximum served count among participants; break ties with a server session seed. Keep question ID/version and source target metadata. Apply true/false and commentary quotas to the final set, not to the whole bank before selection. Require distinct question IDs and at least one eligible reserve for runtime recovery, so a 90-question start requires at least 91 usable questions. Freeze exactly one deterministic compatible unused reserve, keeping the saved set at requested count plus one. Do not replenish it; if exhausted or unable to replace the current unarmed question legally, end incomplete with preserved evidence and independent restart. Replacement must preserve the final-set quotas and source bounds. Use reserves only before a response schedule is armed. After armed-window authority loss, settle to Review only when every active team has a trustworthy persisted final or timely draft. Otherwise interrupt with exact earlier/final evidence and independent restart, without consuming a reserve, reopening the response window or awarding full completion. Test the mixed case where one team submitted and the other has no trusted response in both runtimes and the interrupted UI. Expose shortages with counts and retain 10/30/90 choices. Never extend a shortage with repeated questions while labeling it full rehearsal.
- [x] Make the new scoreboard show earned/available rubric points, with no speed component or declared official placing. Preserve old score displays and histories. For 90-question rooms, keep exactly one five-minute break after question 45. A one-team room has no fabricated opponent or winner. Run same-bank replay tests proving later IDs are selected, old-room resume, six/twelve-player authorization, timeouts, recoveries and immutable saved rubrics. Commit `feat: add independent six-student PBE rehearsal`.

**C2 review gate:** reviewed through `277fe00` after two fix rounds, with no Critical/Important findings. Minor M1 (an unspecified one-team invitation offering Team 2) is tracked for the C3 shared invitation UI and final review. Phase C full-flow/load and external physical speech checks remain below.

## Task C3: Deferred disputes, consistent corrections and independent completion

**Files — create:** `apps/web/worker/native/pbe/disputes.ts`, `disputes.test.ts`; `apps/web/src/features/practice/DisputeQueue.tsx`, `DisputeQueue.test.tsx`; `apps/api/src/Erudoza.Api/Practice/PbeDisputeService.cs`; `apps/api/tests/Erudoza.IntegrationTests/PbeDisputeTests.cs`.

**Files — modify:** native `practice/{state,room,routes,reports,awards}.ts`, `mastery/{store,team-rules}.ts`; `AppealForm.tsx`, `PracticePage.tsx`, `PracticeHub.tsx`, `src/api/practice.ts`; C# `PracticeCommands.cs`, `PracticeService.cs`, `PracticeMasteryHonors.cs`, existing practice trends/report projection and `MasteryHonorService.cs`; existing PBE solo session/evidence adapters, student `SessionRecapPage.tsx`, and necessary route/service registrations.

**Interfaces:**

```ts
export interface PbeDispute {
  id: string; organizationId: string; seasonId: string;
  activity: 'Solo' | 'Team'; sessionId: string; attemptId: string;
  questionId: string; questionVersion: number; team: number | null;
  status: 'Pending' | 'Resolved'; reason: string; revision: number;
  resolution: { pointsByPart: number[]; reason: string; resolvedBy: string;
    resolvedAtUtc: string } | null;
}
// resolvePbeDispute(ctx, disputeId, expectedRevision, pointsByPart, reason): Promise<PbeDispute>
// All identities/permissions/timestamps are derived from authenticated server context.
```

**Routing and identity:** Use the authenticated `/api/v1/pbe/disputes` surface, deriving organization from current context. Solo flag/queue/resolve must work while Team Practice is disabled; Team flag/read/resolve and Team queue rows still enforce the existing organization-wide room control. Reuse the existing authorized coach role policy and saved-result source/privacy boundary. Generate and persist immutable `AttemptId`/`attemptId` with each first accepted team final before acknowledgement, alongside the authoritative state/outbox. Recovery and retries reuse it. For a real pre-field saved PBE submission only, derive stable `team:{roomId}:{questionId}:{team}` using matching normalized ID spelling in both runtimes. Do not derive an attempt from exposure or a missing response; keep Arcade separate. Bind the original question/version/team. Dispute identities use `activity:sessionId:attemptId`; append-only adjustments use `disputeId:resolutionRevision`. Record this additive mapping for D3.

**Carried UI finding:** Close C2 Minor M1 in the shared invitation flow: an unrestricted one-team invitation must offer only Team 1, while two-team invitations keep both valid choices. Cover the actual bootstrap/UI contract.

- [ ] Add an integration regression that completes a response, flags an appeal, advances the review deadline, and reaches the next question with the dispute still Pending. Query the new dedicated pending-review queue and assert its frozen question version and part rubric; those queue/projection assertions fail before this task's implementation. Then complete the room and create a new room as the same student, with no coach connected. Preserve the existing working non-blocking progression. Assert the original result is visible and provisional; flags must never grant points automatically.
- [ ] Run the new dispute/state tests before implementation. Add cross-organization rejection, participant-only flagging, non-playing coach-only resolution, duplicate flag/resolve IDs, contradictory retries and stale revisions.
- [ ] Keep automatic grading on every ordinary submission. Store a dispute record and an indexed pending summary accessible from Coach Team Practice. Do not use resolution status as a progression/completion condition for independent rooms. Existing coached mode may still wait for review when explicitly selected. Expose a clear “Flag answer” action and a later-review status in solo/room recaps. Limit one pending dispute per attempt; trim reason length to the existing 500-character constraint.
- [ ] Resolve per part, bounded by the frozen rubric, with source evidence and a reason. Write an append-only grade adjustment and rebuild affected evidence from chronological final grades rather than applying a second mastery increment. Preserve original response timing. Make projection updates revision-checked and idempotent; a retry cannot duplicate points or awards. Do not rewrite accepted variants for every future question as a side effect of one ruling. Enforce the immutable original and revision checks across all reachable PBE paths, including legacy appeal/judge commands and explicit coached review; adapt or reject the old mutation path without blocking the supported coached flow. Keep Arcade command behavior versioned.
- [ ] Separate participation from score-dependent awards in the new profile. A completed independent rehearsal can record participation while disputed score-based evidence waits. Group trends by rule/scoring version and exclude provisional entries from finalized accuracy aggregates while displaying pending counts. Keep earned historical permanent Honors immutable; a later correction changes current evidence/recaps and prevents new unsupported awards, rather than silently revoking profile access. Existing legacy award policies stay versioned. Exclude collaborative PBE team results from legacy Honor rules that claim personal accuracy from the scribe's submitted answer; retain existing Arcade qualification and already-earned permanent Honors. Keep separate PBE participation and team-score awards operational: a completed independent rehearsal records participation while pending relevant evidence withholds new score awards, and a finalized correction may qualify exactly once. Cover pending-to-resolved qualification, exact retries and unrelated award availability in both runtimes.
- [ ] Preserve shared visibility for genuinely reviewed earlier PBE results. A retained current final after mixed interruption that never reached Review is visible only to its own saved team and an authorized non-playing coach, across room DTOs, disputes and recaps; other teams must not receive its answers or key. Keep current organization/role/global room checks and historical Arcade behavior. Test this boundary through both actual HTTP runtimes.
- [ ] Verify storage at admitted larger input sizes, including 90 questions with two six-student teams and eight-part finals. The current pure engine permits terminal JSON above 3MB and an admitted rubric set above 2MB at start; these are size witnesses, not HTTP/storage failure evidence. Reproduce the actual persistence boundary, then use a versioned bounded room representation that retains complete frozen questions, original finals, timing, retries and atomic authority/outbox publication. Keep prior saved formats readable and authenticated history/dispute/award behavior consistent. Measure whole-request D1 statement budgets and component bytes; a batch call is not one statement. Do not truncate answers or reduce supported inputs merely to pass a size test. Record the final format and migration/export mapping for D3; canonical storage need not change just to mirror D1.
- [ ] Add UI and full-flow tests: flag, continue, finish, replay, coach resolves later, student recap refreshes, other-team unrevealed answers remain hidden, unrelated awards/practice stay available. Run native and canonical dispute/report/award suites. Commit `feat: review PBE disputes without blocking practice`.

## Phase C gate

- [ ] Complete automated 90-question one-team and two-team runs, each with one pending dispute, a scribe rotation, a reconnect and a corrected rubric. Verify timing math, one halfway break, independent completion and no extra-award retries. Use isolated synthetic users and source-backed fixtures; do not send real invitations.
- [ ] Test actual speech on supported desktop/mobile browsers with representative biblical names. Stubbed speech events test control flow, not pronunciation or device support. Exercise the labeled text fallback and record its different presentation evidence. Review 1440/390/320px, keyboard and reduced motion.
- [ ] Run existing load scenarios with the new six/twelve-player rosters. Do not reuse the old unverified 200-player capacity claim; report measured limits. Update progress and push the verified source checkpoint. No live release is implied by these local checks.
