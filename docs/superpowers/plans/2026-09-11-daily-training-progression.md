# Daily Training and Progression Implementation Plan

## Implementation execution record — September 11

The user authorized implementation after approving the student concept, patch family/logo and public-entry scope. The original checklists below are the planning recipe; the execution gates and deviations are recorded here and in the linked audits.

| Scope | Execution gate |
|---|---|
| Tasks 1–6: contracts, atomic backend, calendar, mission, Honors, export | Implemented in native and .NET. Full .NET 252 tests, populated all-migration export/import 9 tests, and bounded native read/atomicity regressions pass. |
| Tasks 7–10: shared UI/assets, HQ, study recap, Honors/journey/navigation | Implemented with approved assets. Full web/native Vitest 486 tests pass; pointer/focus/motion and selected-season/conflict recovery verified. |
| Task 11: integrated review and release preparation | Fresh backend/UI/acceptance reviews resolved eight P2 findings. Both builds/type checks, lint/format, full native browser six cases pass. Full canonical browser 36 cases pass, with two opt-in audit skips. Final types/lint/builds and 486-test suite pass after the legacy correction. Implementation checkpoint `c569f2c` is committed and pushed to `origin/codex/honors-public`; browser suites precede the separately tested legacy-only display correction. |
| P1/P2: public compositions and asset integration | Combined under the later proceed instruction. The working local implementation serves as the concrete review preview; no additional standalone static mockup or repeated asset approval was required. |
| P3: public/account verification | 55 isolated native views pass at 1440/390/320, including signup/recovery/invitations and motion. Real provider/email tests are outside this visual change. |
| Coach | Shared branding implemented. New Coach HQ layout/aggregation remains the separate documented recommendation. |

Evidence: [Honors audit](../../audits/2026-09-11-honors-implementation.md), [public entry audit](../../audits/2026-09-11-public-entry.md), [prepared release change set](../../operations/honors-release.md). No Honors production migration or deployment has been performed. An exhaustive same-payload matrix for every calendar/scope permutation is not claimed; focused rules/HTTP tests plus explicit populated export DTO comparison and both browser runtimes establish the recorded local scope.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved student Training HQ, session recap, Honors collection, and passage journey with durable, evidence-based progress.

**Architecture:** React consumes authenticated, server-authoritative training projections. The native Cloudflare Worker/D1 backend and the existing .NET/EF Core backend implement the same contracts and pure progression rules; existing deterministic generation, answer evaluation, mastery, and Team Practice remain separate. Actual study writes update bounded day/week/mission projections and immutable awards within the existing transaction boundaries.

**Tech Stack:** Existing React 19, TypeScript, TanStack Query, React Router, shared Erudoza UI primitives, Vite/Vitest/Playwright, Cloudflare Worker/D1, .NET 10/EF Core/SQLite.

**Spec:** [Daily training progression design](../specs/2026-09-11-daily-training-progression-design.md). Read this specification and this plan together before execution.

**Public entry scope:** The [public landing and account entry brief](../../product/2026-09-11-public-entry-design.md) is included through companion Tasks P1–P3 below. It covers landing, sign-in, coach signup, password recovery and coach invitations. Its design/preview can proceed independently of the training backend; approved public-page implementation is a separate checkpoint.

## Global Constraints

- Preserve the Field Guide Academy brand and Option C command navigation.
- Reuse shared primitives in `apps/web/src/components/ui/index.tsx` and semantic tokens in `apps/web/src/styles/tokens.css`.
- Use system sans for interface text and Georgia only for Scripture and branding.
- Preserve deterministic study selection, evaluation, difficulty ceilings, hints, source-reader rules, authorization, and existing routes.
- Preserve early session completion after at least one accepted attempt; partial completion does not qualify as an eight-card drill.
- Award progress only from server-accepted evidence; never award on a page read or a frontend animation.
- Keep Cloudflare native and canonical .NET contracts and behavior equivalent.
- Use Monday-based weeks, default weekly target 5, and choices 3, 4, or 5 days.
- Count at most one practice day per organization, student, and calendar day across seasons.
- Keep all new historical records additive and preserve earned evidence after scope changes.
- Do not add currency, purchases, locked study content, public student rankings, or punitive streak resets.
- Obtain user approval of the original artwork before integrating it into production screens.
- Verify both roles at 1440px and 390px, plus a 320px stress check, after shared UI changes.

## Implementation safeguards

- Product naming is **Honors System**; navigation and collection headings use **Honors**. The collection route is `/student/honors`, with matching `trainingApi.honors`, cache keys, and `HonorsPage`. Internal badge/evidence records remain technical names and never appear in product labels.
- This document is a plan; the planning task does not authorize application implementation or deployment.
- Implement the approved student design. Coach changes remain a separate recommendation requiring a concrete Coach mockup and approval.
- Include the public landing and account pages in the shared visual rollout. Preview their compositions before implementation; preserve the current auth flow, role routing, security challenge and service-availability behavior. Existing approval of the patch logo/art is sufficient for those assets.
- Read `PROGRESS.md` and coordinate active file/fixture ownership before repository work. Preserve unrelated working-tree changes.
- Read `DESIGN.md` and `PRODUCT.md` before UI changes. Retain the navy, ivory, teal, and mountain identity; page CSS controls layout.
- Preserve the September 11 button-contrast fix, disabled foregrounds, keyboard focus, reduced motion, and 320px layouts.
- Initialize timezone on the first authorized preference/session write. Later goal/timezone changes take effect next local Monday; historic days and weeks retain their snapshots.
- Use the authoritative instant of the qualifying attempt to choose the credited day/week, even when the mission or session began on an earlier date. Keep the original mission date and show the distinction in the recap.
- Daily review selects at most 8 frozen, eligible knowledge IDs. Each needs one real accepted attempt; correctness does not determine this effort step.
- The review honor is named **Review Complete**. Incorrect answers remain due and never manufacture mastery.
- The daily drill requires 8 distinct persisted card attempts in one Practice session. Full Simulation and full ordinary Review also qualify effort days without satisfying that Practice step.
- Preserve `v2-skill-evidence`, immutable cards, accepted-attempt replay, licensing, active scope, and tenant boundaries.
- GET requests do not award progress or create preferences, missions, awards, or recaps.
- New original artwork is a separate review gate: [asset package](../../brand/2026-09-11-original-assets/README.md). Integrate approved assets only after approval is recorded there.
- Existing honors may remain earned after later score changes; display the evidence date and awarded scope. Current skill values can rise or fall.
- No AI-generated questions or Team Practice scoring changes are included.
- The documentation/artwork planning gate follows `AGENTS.md`: the coordinating agent reviews and commits/pushes the in-scope artifacts and records that checkpoint; those actions do not constitute application implementation.

---

## Existing behavior the implementation must preserve

| Area | Current evidence | Implementation consequence |
|---|---|---|
| Session resume | `worker/native/study/routes.ts` and `StudySessionService.ResumeCoreAsync` return persisted card, accepted answer, and minimal completed summary. | Extend this flow; route state must not be the only recap source. |
| Early completion | Both completion handlers accept one persisted nonlegacy attempt, and integrity tests verify it. | Keep early finish; add qualification fields rather than changing `Completed` to mean full drill. |
| Difficulty | Practice targets 8, Simulation targets 10, Review targets min(8, due count); session difficulty and rules are frozen. | Do not replace frozen targets or use UI counters as evidence. |
| Mastery | Both runtimes store exact wording, recognition, reference, sequence, and factual recall; Progress exposes only two skills. | Expose stored fields; do not invent readiness percentages. |
| Transactions | Native `atomic` batches revision guards and mutations; .NET `StudyWriteCoordinator` uses serializable transactions and bounded retry. | Extend these boundaries for day/award consistency across simultaneous sessions. |
| Read cost | Existing Progress loads historical attempts before counting/taking 20; native next aggregates exposure from historical session JSON. | Do not reuse full-history reads for every HQ render or every student in a Coach roster. |
| Export | `scripts/cloudflare-export.mjs` has a table allowlist and explicit session/attempt mappings. | New .NET tables and evidence fields need conversion and export tests. |

All source paths below are relative to the repository. New paths are deliberate additions. Read current surrounding code rather than relying on line numbers from the planning date.

## File responsibilities and delivery order

| Unit | Main files | Responsibility |
|---|---|---|
| Shared transport types | `apps/web/src/api/training.ts`, `trainingTypes.ts`; `apps/api/src/Erudoza.Application/Contracts/TrainingContracts.cs` | Stable camelCase API contract; no React-only rules |
| Pure training rules | `apps/web/worker/native/training/rules.ts`, `calendar.ts`; `apps/api/src/Erudoza.Domain/Study/TrainingRules.cs`; `apps/api/src/Erudoza.Application/Study/TrainingCalendar.cs` | Qualification, badge criteria, time boundaries |
| Persistence | `worker/native/training/store.ts`; `Erudoza.Domain/TrainingEntities.cs`; EF mappings/migration; `apps/web/migrations/0004_training_progression.sql` | Scoped identities, unique awards, bounded projections |
| Study integration | Native `study/routes.ts`; .NET `StudySessionService.cs`, `StudyEngine.cs`, `MasteryService.cs` | Snapshot mission at start; write attempt evidence; freeze recap at completion |
| Read APIs | `worker/native/training/routes.ts`; `TrainingQueryService.cs`; `TrainingEndpoints.cs` | Today, honors, journey, recap, preference save |
| Shared UI | `components/ui/index.tsx`, `styles/design-system.css`, `components/design-system/DesignSystemPage.tsx` | Accessible progress, week strip, reusable dialog |
| Student experience | `StudentHomePage.tsx`, `StudyPage.tsx`, new `SessionRecapPage.tsx`, `HonorsPage.tsx`, `PassageJourney.tsx` | Approved screens using server evidence |
| Navigation | `app/router.tsx`, existing navigation registry used by `LearnerAppShell.tsx` | Real student destinations with season identity retained |
| Verification | Native/.NET contract tests, export tests, `e2e/training-progression.spec.ts`, audit document | Parity, persistence, concurrency, browser evidence |

Tasks 1–6 are the data gate. Tasks 7–10 are the student presentation gate. Task 11 is final integration and handoff. Commit/push only reviewed, in-scope verified checkpoints, recording the result in `PROGRESS.md`. The current planning checkpoint contains documentation/design artifacts; application execution begins only after its separate authorization.

## Task 1: Freeze transport contracts and pure qualification rules

**Files**

- Create: `apps/web/src/api/trainingTypes.ts`, `apps/web/src/api/training.ts`.
- Create: `apps/web/worker/native/training/rules.ts` and `apps/web/worker/native/training/rules.test.ts`.
- Create: `apps/api/src/Erudoza.Application/Contracts/TrainingContracts.cs`.
- Create: `apps/api/src/Erudoza.Domain/Study/TrainingRules.cs` and `apps/api/tests/Erudoza.UnitTests/TrainingRulesTests.cs`.
- Add fixture: `apps/web/src/test/trainingFixtures.ts` for UI API mocks; keep all sample values test-only.

**Interfaces**

Define these transport types once and use matching .NET records with enum strings:

```ts
export type WeeklyTarget = 3 | 4 | 5;
export type TrainingStepKind = "Review" | "Practice";
export type MissionStatus = "Suggested" | "Active" | "Complete" | "Invalidated" | "Unavailable";
export type BadgeKey = "exact-recall" | "reference-ready" | "chapter-strong" |
  "full-coverage" | "steady-study" | "review-complete";
export type SkillScores = {
  exactWording: number; recognition: number; reference: number;
  sequence: number; factualRecall: number;
};
export type TrainingPreferences = {
  timeZone: string; weeklyTarget: WeeklyTarget;
  pending: { timeZone: string; weeklyTarget: WeeklyTarget; effectiveAtUtc: string } | null;
};
export type TrainingStep = {
  kind: TrainingStepKind; target: number; completed: number;
  status: "NotNeeded" | "Pending" | "Active" | "Complete" | "Invalidated";
  sessionId: string | null;
};
export type BadgeProgress = {
  key: BadgeKey; ruleVersion: "training-v1"; title: string;
  completed: number; target: number; earnedAtUtc: string | null;
  scopeLabel: string; evidenceSessionId: string | null;
};
export type TrainingWeek = {
  weekStartLocalDate: string; timeZone: string; target: WeeklyTarget;
  completedDays: number;
  days: { localDate: string; credited: boolean; isToday: boolean }[];
};
export type TrainingToday = {
  seasonId: string | null; seasonName: string; seasonStatus: string;
  localDate: string; preferences: TrainingPreferences; week: TrainingWeek;
  mission: {
    id: string | null; revision: number | null; status: MissionStatus;
    scopeVersion: string | null; steps: TrainingStep[]; explanation: string | null;
  };
  nextAction: { label: string; mode: "Practice" | "Review" | "Simulation"; sessionId: string | null } | null;
  honors: BadgeProgress[];
};
export type SessionRecap = {
  version: "training-v1" | "legacy-counts";
  sessionId: string; seasonId: string; mode: string; completedAtUtc: string | null;
  attempted: number; correct: number; targetCardCount: number;
  fullTargetReached: boolean; newlyCreditedDay: boolean;
  missionLocalDate: string | null; creditedLocalDate: string | null;
  missionSteps: TrainingStep[]; earnedBadges: BadgeProgress[];
  passageChanges: {
    knowledgeUnitId: string; title: string; delta: SkillScores;
    before: SkillScores | null; after: SkillScores | null;
    events: { attemptId: string; acceptedAtUtc: string; before: SkillScores; after: SkillScores }[];
  }[];
};
export type StartTrainingContext = {
  clientStartId: string; timeZone?: string;
  missionId?: string; missionRevision?: number; step?: TrainingStepKind;
};
```

Preserve the existing complete-session response contract: retain every `SessionSummary` field including `status` and add optional `recap?: SessionRecap`. Existing resume responses retain their summary shape. The dedicated recap GET returns `SessionRecap`; repeated completion returns the same stored recap within the additive summary envelope. Do not replace the old summary with a shape that drops fields used by older clients.

Backend-only `AcceptedEvidence` contains `cardId`, `knowledgeUnitId`, `isLegacyDuplicate`, `isCorrect`, and per-skill before/after snapshots. Define `fullTargetReached(target: number, attempts: AcceptedEvidence[]): boolean` using distinct accepted card IDs; reject invalid/nonpositive targets. Define `reviewSetComplete(requiredIds: string[], attempts: AcceptedEvidence[]): boolean` as a nonempty set inclusion over distinct nonlegacy knowledge IDs; correctness is deliberately ignored.

- [ ] Write failing unit tests for full vs partial targets and review effort:

```ts
it("cannot turn an early finish or replay into an eight-card drill", () => {
  const evidence = [{ cardId: "c1", knowledgeUnitId: "k1", isLegacyDuplicate: false,
    isCorrect: false, before: zeroSkills(), after: zeroSkills() }];
  expect(fullTargetReached(8, evidence)).toBe(false);
  expect(fullTargetReached(8, Array(8).fill(evidence[0]))).toBe(false);
});
it("counts an incorrect review once without claiming it is mastered", () => {
  const evidence = [{ cardId: "c1", knowledgeUnitId: "k1", isLegacyDuplicate: false,
    isCorrect: false, before: zeroSkills(), after: zeroSkills() }];
  expect(reviewSetComplete([], evidence)).toBe(false);
  expect(reviewSetComplete(["k1"], evidence)).toBe(true);
  expect(reviewSetComplete(["k1", "k2"], evidence)).toBe(false);
});
```

`zeroSkills(): SkillScores` is a local test factory returning five zero values; implement it in the test file. Repeat these assertions as .NET theories, including 8 distinct accepted cards and legacy duplicates.

- [ ] Run `npm --workspace apps/web run test -- worker/native/training/rules.test.ts` and `dotnet test apps/api/Erudoza.sln --filter FullyQualifiedName~TrainingRulesTests`. Confirm absence of the new rules is the initial failure.
- [ ] Implement pure rules using `Set`/`HashSet` membership; no clock, network, storage, or score changes in these functions.
- [ ] Add API client signatures: `today(seasonId?: string): Promise<TrainingToday>`, `savePreferences(input: { weeklyTarget: WeeklyTarget; timeZone: string }): Promise<TrainingPreferences>`, `recap(sessionId: string): Promise<SessionRecap>`, and `honors(seasonId: string): Promise<BadgeProgress[]>`. Use existing `request` from `client.ts`.
- [ ] Run both targeted tests and both type checks. Review/commit this contract gate with explicit paths.

## Task 2: Add durable calendar, preference, and projection storage

**Files**

- Create: `apps/web/worker/native/training/calendar.ts`, `apps/web/worker/native/training/calendar.test.ts`, `apps/web/worker/native/training/store.ts`, `apps/web/worker/native/training/store.test.ts`.
- Create: `apps/api/src/Erudoza.Domain/TrainingEntities.cs`, `apps/api/src/Erudoza.Application/Study/TrainingCalendar.cs`, `apps/api/src/Erudoza.Application/Study/TrainingProgressService.cs`.
- Modify: `apps/api/src/Erudoza.Application/Abstractions/IErudozaDbContext.cs`, `apps/api/src/Erudoza.Infrastructure/Persistence/ErudozaDbContext.cs`.
- Add: EF migration `TrainingProgression` and its generated designer/snapshot; `apps/web/migrations/0004_training_progression.sql`.
- Coordinate the migration number again at execution: concurrent coach onboarding owns `0003_coach_onboarding.sql`. Never reuse or edit another feature's historical migration.
- Test: `apps/api/tests/Erudoza.UnitTests/TrainingCalendarTests.cs`, `apps/api/tests/Erudoza.IntegrationTests/SchemaUpgradeTests.cs`.

**Interfaces and storage**

`resolveTrainingCalendar(nowUtc: string, preferences: TrainingPreferences): { localDate: string; weekStartLocalDate: string; nextWeekAtUtc: string; timeZone: string }` is mirrored by `TrainingCalendar.Resolve(DateTimeOffset now, TrainingPreferencesDto preferences)`. Validate a supported IANA zone in both runtimes; browser timezone is a suggestion on first write, never the authority for event timestamps. Reject invalid zones with HTTP 400.

Create these uniquely identified records/entities:

| Record | Unique identity | Stored evidence |
|---|---|---|
| `training-preferences` / `TrainingPreference` | org + student | current and pending preferences, revision |
| `training-day` / `TrainingDay` | org + student + local date | timezone snapshot, first qualifying UTC event/session, one credited flag |
| `training-week` / `TrainingWeek` | org + student + week start | frozen timezone/target, seven date keys, credited count, qualification event |
| `daily-mission` / `DailyMission` | org + student + season + local date + revision | scope fingerprint, eligible IDs snapshot, frozen due IDs, fixed drill target, accepted review IDs, invalidation state |
| `training-season-progress` / `TrainingSeasonProgress` | org + student + season + scope fingerprint | bounded distinct seen IDs, current badge counters, qualifying chapter data |
| `solo-badge-award` / `SoloBadgeAward` | org + student + badge key + rule version + award scope | earned time, immutable evidence and displayed scope |

Mission scope IDs must obey the existing 5,000-verse scope bound. Projection arrays store unique IDs, never full attempts or Scripture. Update large bounded seen-ID sets only when an ID is first seen or scope changes; ordinary duplicate practice must not rewrite growing history.

- [ ] Write calendar tests using explicit UTC instants around Monday and both daylight-saving transitions. Verify `2026-09-14T03:59:59Z` is Sunday September 13 in `America/New_York`, and `04:00:00Z` begins Monday September 14.
- [ ] Write persistence tests proving a unique day cannot be inserted twice across different seasons; preferences accept only 3/4/5; changing a goal on Wednesday does not rewrite the current week's target.
- [ ] Run the new tests and confirm missing storage/calendar failures.
- [ ] Implement timezone validation/resolution and pending settings. Store next week's effective UTC instant using the current zone, so a requested zone change cannot move its own activation boundary. Keep a monotonic persisted event time and never reinterpret credited historic date keys.
- [ ] Add unique EF indexes and deterministic native record IDs. Native new partial/composite indexes should serve day/week lookup and scoped projection reads; verify `EXPLAIN QUERY PLAN` instead of adding indexes to every JSON property.
- [ ] Add fresh-database/restart and legacy-upgrade cases to `SchemaUpgradeTests.cs`. Existing users get no fabricated awards/days; old sessions remain readable without new fields.
- [ ] Run targeted tests, native migration tests and both type checks. Review/commit the storage gate.

## Task 3: Snapshot and resume real daily missions

**Files**

- Modify: `apps/web/worker/native/study/routes.ts`, `apps/web/worker/native/study/routes.test.ts`.
- Modify: `apps/api/src/Erudoza.Application/Study/StudySessionService.cs`, `apps/api/src/Erudoza.Application/Study/StudyEngine.cs`, `apps/api/src/Erudoza.Domain/StudyEntities.cs`, `apps/api/src/Erudoza.Application/Abstractions/StudyContracts.cs`, `apps/api/src/Erudoza.Application/Contracts/ApiContracts.cs`.
- Modify: `apps/web/src/api/client.ts`.
- Create: `apps/api/tests/Erudoza.IntegrationTests/TrainingMissionTests.cs`.

**Interfaces**

Extend the existing start request with optional `StartTrainingContext`. Existing ordinary study requests stay valid. Persist `clientStartId`, mission identity/revision, frozen `reviewKnowledgeUnitIds`, calendar snapshot and target on the session. The mission stores `acceptedReviewKnowledgeUnitIds: string[]` across its linked sessions. The client creates one start ID per navigation/start intent and reuses it during retry; the server's unique start identity prevents Strict Mode, response loss, and retries creating duplicate missions/sessions. A provided mission identity requires its revision and a matching Review/Practice step; inconsistent mode/step combinations return 400.

- [ ] Write failing handler tests: first mission start snapshots the currently eligible due set capped at 8; two identical start intents return one session; a different payload reusing the start ID returns 400.
- [ ] Write a two-passage review case: answer the first incorrectly; make another session move the second item's due date forward; the original mission still serves the second frozen passage once.
- [ ] Run `npm --workspace apps/web run test -- worker/native/study/routes.test.ts` and `dotnet test apps/api/Erudoza.sln --filter FullyQualifiedName~TrainingMissionTests`.
- [ ] Put mission creation, preferences initialization, session start and start deduplication in one native guarded batch / .NET serializable operation. A provided mission revision mismatch returns 409 with a reload action; it does not discard accepted evidence.
- [ ] For mission Review only, select frozen IDs minus accepted IDs, intersect with current active scope. Preserve existing source ordering, deterministic provider selection, card seeds, immutable card replay, and ordinary Review behavior.

```ts
// These IDs derive only from accepted nonlegacy attempts in every linked session.
const acceptedIds = new Set(mission.acceptedReviewKnowledgeUnitIds);
const remainingIds = new Set(session.reviewKnowledgeUnitIds
  .filter(knowledgeUnitId => !acceptedIds.has(knowledgeUnitId)));
// Feed eligible candidates into the existing deterministic sort and generator.
const candidates = activeSources.filter(source =>
  remainingIds.has(source.knowledgeUnitId ?? source.id));
```

Before this filter, compare the snapshot scope with authoritative season/assignment/licensing state. If an unattempted required ID is unavailable, persist invalidation via a write operation and return a recoverable state. A read may report stale scope but must not mutate it. The updated mission gets a new revision; neither reducing targets nor deleting due IDs can complete the prior mission.

- [ ] Replace direct `DateTimeOffset.UtcNow` in `StudyEngine` with `IClock` and use an injectable native clock at the training boundary; do not change generation seeds.
- [ ] Test loss of assignment, retired content, scope additions/removals, inactive season, cross-tenant IDs and concurrent start. Ordinary existing study integrity tests must still pass.
- [ ] Run both targeted suites and existing deterministic engine tests; review/commit.

## Task 4: Award day effort atomically and freeze recap evidence

**Files**

- Modify: `apps/web/worker/native/training/store.ts`, `apps/web/worker/native/training/rules.ts`, `apps/web/worker/native/study/routes.ts`.
- Modify: `apps/api/src/Erudoza.Application/Study/TrainingProgressService.cs`, `apps/api/src/Erudoza.Application/Study/StudySessionService.cs`, `apps/api/src/Erudoza.Application/Study/MasteryService.cs`, `apps/api/src/Erudoza.Application/Abstractions/StudyContracts.cs`, `apps/api/src/Erudoza.Domain/StudyEntities.cs`.
- Create: `apps/web/worker/native/training/progression.test.ts`; `apps/api/tests/Erudoza.IntegrationTests/TrainingProgressionTests.cs`.

**Interfaces**

`TrainingProgressService.ApplyAcceptedAttemptAsync` consumes the authorized session, accepted attempt, before/after skill evidence, authoritative scope and server timestamp. `CompleteSessionAsync` freezes the final `SessionRecap` in the existing completion transaction. Native `applyAcceptedAttempt` returns prepared statements and revision guards to combine with the existing native batch, not a separate post-response operation.

Qualifying effort: a fully attempted fixed Practice/Simulation target, a fully attempted ordinary Review session using its original nonzero target, or completion of a nonempty frozen daily review set. The review step may accumulate accepted distinct IDs across partial review sessions on the same mission. Qualify on the accepted evidence transition; completion freezes recap and reports it. A partial drill never qualifies by itself.

Resolve the credited day/week from the qualifying attempt's authoritative accepted instant and the preferences effective at that instant. The session/mission's original calendar snapshot remains unchanged. A Sunday mission completed Monday advances that Sunday mission and credits Monday's week; a retried submission reuses the originally persisted accepted instant and credit event. Return both `missionLocalDate` and `creditedLocalDate` for honest recap copy.

- [ ] Write failing atomicity tests using two sessions for the same student/date:

```ts
it("credits one day when review and a drill finish concurrently", async () => {
  const review = await fixture.reviewBeforeFinal({ seasonId: "s1", requiredIds: ["k1"] });
  const drill = await fixture.drillBeforeFinal({ seasonId: "s2", cardCount: 8 });
  await Promise.all([fixture.submitFinal(review), fixture.submitFinal(drill)]);
  await Promise.all([fixture.complete(review), fixture.complete(drill)]);
  expect(await fixture.dayCount("student", "2026-09-11")).toBe(1);
  expect((await fixture.currentWeek()).completedDays).toBe(1);
  await fixture.replayLastAttempt(drill);
  expect((await fixture.currentWeek()).completedDays).toBe(1);
});
```

Define the local `fixture` in this test file using `createNativeTestApp`, real HTTP study routes and direct read-only test DB assertions. Its `reviewBeforeFinal` and `drillBeforeFinal` helpers create scoped test users/seasons/cards in isolated Miniflare storage and stop one accepted attempt before their target. `submitFinal` submits that last stored card answer through HTTP, so the test races the actual qualifying writes. Other helpers complete through HTTP, count credited day rows, and replay the exact saved submission. Mirror the scenario against `ErudozaApiFactory` in .NET; no production fixtures.

- [ ] Add a rollback test that deliberately fails an award/day write and asserts neither attempt nor mastery changed.
- [ ] Add a recap test: complete a session, capture GET recap, train the same passage again, refresh the first recap and assert byte-equivalent evidence fields.
- [ ] Add a midnight/Monday test: snapshot a Sunday mission, accept its qualifying attempt at Monday 00:01 in the saved zone, then assert Sunday mission advancement, exactly one Monday credit in the new week, and distinct mission/credit dates in the persisted recap.
- [ ] Run these tests to observe failures before implementation.
- [ ] Capture before/after mastery inside the accepted attempt transaction, after any legacy-score rebuild. Save the immutable per-attempt snapshots and sum only this session's attributable deltas for each passage. For a single event, the passage-level `before`/`after` pair is that event's pair. For multiple events, populate an aggregate pair only when contiguous provenance is proven; otherwise leave the aggregate pair null and render each event's real before/after values. Never subtract live completion-time scores from session-start totals or silently attribute interleaved-session changes.
- [ ] Update day/week projections only on the first qualifying transition; use day and week revision guards plus unique identities. A changed existing projection must cause retry rather than silently dropping a concurrent update.
- [ ] Save recap once; repeated complete returns it unchanged. Derive count-only legacy recaps in memory on GET without writing or inventing improvement/award dates. Preserve existing zero-attempt rejection and completed-session freeze.
- [ ] Run native and .NET concurrency, replay, legacy and study-integrity tests. Review/commit the evidence gate.

## Task 5: Implement honest solo honors and bounded read APIs

**Files**

- Create: `apps/web/worker/native/training/routes.ts`, `apps/web/worker/native/training/query.ts`, `apps/web/worker/native/training/routes.test.ts`.
- Create: `apps/api/src/Erudoza.Application/Study/TrainingQueryService.cs`, `apps/api/src/Erudoza.Api/Endpoints/TrainingEndpoints.cs`, `apps/api/tests/Erudoza.IntegrationTests/TrainingQueryTests.cs`.
- Modify: `apps/web/worker/native/index.ts`, `apps/api/src/Erudoza.Api/Program.cs`, `apps/web/worker/native/training/rules.ts`, `apps/api/src/Erudoza.Domain/Study/TrainingRules.cs`.
- Modify: `apps/api/src/Erudoza.Application/Progress/ProgressQueryService.cs`, `apps/web/worker/native/study/routes.ts`, `apps/web/src/api/types.ts`, `apps/api/src/Erudoza.Application/Contracts/ApiContracts.cs` to expose stored skills.

**Interfaces and routes**

| Method/path | Result/behavior |
|---|---|
| `GET /api/v1/progress/me/today?seasonId=...` | `TrainingToday`, no writes; preview before first start |
| `PUT /api/v1/progress/me/preferences` | `TrainingPreferences`, validates 3/4/5 and zone, returns effective settings |
| `GET /api/v1/study/sessions/{id}/recap` | `SessionRecap`; incomplete returns 409 with resume destination |
| `GET /api/v1/progress/me/honors?seasonId=...` | `BadgeProgress[]` including earned and nearly-there |
| `GET /api/v1/progress/me/journey?seasonId=...&after=...` | Bounded `PassageJourneyPage` defined in Task 10 |

All own-student APIs require current student identity; request bodies never choose student/org. Session recap ownership uses the existing same-org/same-student lookup. Keep existing Coach Progress endpoint authorized and compatible, but add no Coach HQ endpoint in this student scope.

Badge definitions are versioned `training-v1`:

| Key / label | Earn rule | Scope and progress |
|---|---|---|
| exact-recall / Exact Recall | 5 distinct eligible IDs with exact wording >=80, current `v2-skill-evidence` | Student and season; progress 0–5 |
| reference-ready / Reference Ready | 10 distinct eligible IDs with reference >=70, current algorithm | Student and season; progress 0–10 |
| chapter-strong / Chapter Strong | Every assigned eligible verse in one nonempty chapter is Strong or Mastered, current algorithm | Student and season; capture chapter/scope, label **Assigned scope** and exact denominator |
| full-coverage / Full Coverage | At least one accepted nonlegacy attempt for every ID in one nonempty season eligible-scope snapshot | Student and season; retain scope fingerprint and denominator |
| steady-study / Steady Study | 4 qualifying weeks meeting each saved weekly target | Organization/student across seasons; weeks need not be consecutive |
| review-complete / Review Complete | Every ID in one nonempty frozen daily review set has an accepted attempt | Student and season; retain first qualifying mission evidence |

Every earned award is inserted once per student/key/rule version/award scope at an actual attempt/completion transition. Changes that merely shrink assignments cannot mint Chapter Strong or Full Coverage; a new current-scope award evaluation requires fresh accepted evidence under that scope. Capture chapter/scope as evidence without minting a duplicate same-season award for every scope edit. Keep enough immutable IDs/counters to explain earned evidence without replaying all historical attempts on reads.

Compatible historic mastery may contribute to a future skill award evaluated on a new evidence write with its actual timestamp. New effort days, coverage, weekly qualification and recap deltas begin with the new projection version; do not backfill them unless a separately audited migration establishes their evidence. Explain Advanced practice where the exact-skill criterion exceeds Foundation/Standard ceilings; if fewer than 5/10 eligible passages exist, state that assignment limit without fabricating progress or offering student assignment editing.

- [ ] Write rule tests for exactly 4/5 recall passages, 9/10 reference passages, empty chapter/scope, a mixed algorithm version, removed assignments, and 4 qualifying nonconsecutive weeks.
- [ ] Write API tests for empty/unassigned/stale mission, retryable failure, unsupported preference values, cross-org/cross-student recap, and GET creating zero rows.
- [ ] Run targeted native/.NET tests and confirm absent routes/rules fail.
- [ ] Implement badge evaluation in pure rules and invoke it within Task 4's write boundary. Reuse evidence projections; avoid querying all attempts per badge.
- [ ] Implement current/next-week reads using day/week identities and scoped projections. Cap journey pages at 100 and recent recap summaries at 10. Do not call `listAll("attempt")` in Today/honor/journey.
- [ ] Return a zero-target review step with `status: "NotNeeded"` when no eligible reviews are selected. Show **No reviews due**, lead with the drill action, and never award `review-complete` from that state. A mission can complete after its Practice step when its Review step is NotNeeded.
- [ ] Extend mastery rows with `referenceScore`, `sequenceScore`, `factualRecallScore` and source metadata. Use explicit Unknown/legacy presentation when required evidence is absent.
- [ ] Run targeted tests plus the full native read-budget suite. Review/commit the query gate.

## Task 6: Prove migration, export, and dual-backend parity

**Files**

- Modify: `scripts/cloudflare-export.mjs`, `scripts/cloudflare-export.test.mjs`.
- Modify: `apps/web/scripts/native-migrations.test.ts`; `apps/api/tests/Erudoza.IntegrationTests/SchemaUpgradeTests.cs`.
- Create: `apps/web/worker/native/training/read-budget.test.ts`.
- Add: `docs/audits/2026-09-11-training-progression.md` when implementation begins.

**Interfaces**

`convertSnapshot(snapshot)` continues to accept existing schema snapshots and converts new populated training tables to equivalent native record kinds. Persisted session recap, mission identity, timestamps, skill evidence and award criteria retain exact values.

- [ ] Add failing export tests with populated new entities; verify native roundtrip preserves the first day-credit event, pending preference boundary, recap evidence, award scope, and legacy-count-only state.
- [ ] Run `node --test scripts/cloudflare-export.test.mjs` and both schema-upgrade test groups.
- [ ] Extend the allowlist and explicit mappings; do not silently archive current training entities as inaccessible legacy rows.
- [ ] Add bounded read instrumentation using the existing wrapper pattern in `worker/native/application/read-budget.test.ts`. Seed substantial history and the full canon; measure `rows_read`/`rows_written` and query count.
- [ ] Require Today after snapshot creation to use a fixed bounded number of scoped projection queries independent of historical attempt count; GET must report zero writes. Compare 100 vs 10,000 past attempts with equal current scope and week, requiring unchanged Today read shape and no attempt-history query.
- [ ] Run the native and .NET same-payload scenarios: partial/full completion, duplicate replay, scope invalidation, week boundary, pending timezone change, and recap after later training. Compare public DTO fields while ignoring generated IDs only.
- [ ] Record actual commands, test totals, read measurements and limits in the audit and `PROGRESS.md`. Review/commit/push this verified backend gate before wiring the new UI.

## Task 7: Extend the shared design system and review original artwork

**Files**

- Review: `docs/brand/2026-09-11-original-assets/README.md` and its referenced original files.
- Modify: `apps/web/src/components/ui/index.tsx`, `apps/web/src/styles/design-system.css`, `apps/web/src/components/design-system/DesignSystemPage.tsx`.
- Create: `apps/web/src/components/ui/ProgressMeter.test.tsx`, `apps/web/src/components/ui/WeeklyProgressStrip.test.tsx`, `apps/web/src/components/ui/TrainingDialog.tsx`, `apps/web/src/components/ui/TrainingDialog.test.tsx`.
- Add production art only after approval: `apps/web/public/assets/training/` and an explicit asset map in `apps/web/src/features/student/trainingAssets.ts`.
- Create: `apps/web/src/components/ui/HonorArtwork.tsx` and `apps/web/src/components/ui/HonorArtwork.test.tsx` for the shared pointer-tilt presentation.
- Coordinate shared brand integration with companion Task P2: `apps/web/src/components/brand/ErudozaWordmark.tsx` and optimized assets in `apps/web/public/brand/`. Public routes must not import student feature code to obtain the logo.

**Interfaces**

`ProgressMeter({ label, value, max }: { label: string; value: number; max: number })` exposes a labeled native `progress` element plus readable fraction. `WeeklyProgressStrip({ week }: { week: TrainingWeek })` renders seven labeled date/status items. `TrainingDialog({ open, title, onClose, children }: { open: boolean; title: string; onClose(): void; children: ReactNode })` provides focus trap, Escape, initial focus and restoration without deletion-specific copy.

- [ ] Write failing accessibility tests:

```tsx
render(<ProgressMeter label="Today's drill" value={3} max={8} />);
expect(screen.getByRole("progressbar", { name: "Today's drill" }))
  .toHaveAttribute("value", "3");
expect(screen.getByText("3 of 8")).toBeVisible();
```

- [ ] Test week days through accessible text (including missed and today), and dialog keyboard focus/close restoration. Run targeted Vitest tests.
- [ ] Implement small primitives using existing semantic tokens; do not change primary/disabled foregrounds or reinstate color/background transitions that produced the contrast bug.
- [ ] Add the new patterns to the actual design-system reference page. Use reduced-motion rules for any fill/reveal animation.
- [ ] Inspect the original asset package at desktop and phone size. Record asset approval before copying production files; if artwork is pending, use the existing approved brand artwork so functional work can continue.
- [ ] Follow the public entry brief's asset placement rules. Reuse one optimized shared logo across landing, auth and both workspaces; verify actual 36/48px wordmark slots and 40/56px auth overrides as well as 24/32px compact uses. Keep public asset loading independent of authenticated training requests.
- [ ] Review the user's requested Seventh-day Adventist Pathfinders direction in the asset README: use outdoor exploration, mountain trails, field guides, compass/lantern details, a restrained neckerchief accent, Scripture study, teamwork and service as supporting motifs. Use the approved embroidered Erudoza logo derivative, preserving its recognizable flame-and-Bible silhouette and the existing navigation icon system. The Coach field-guide artwork may support public account pages while Coach workspace composition remains separately proposed.
- [ ] For approved art, produce optimized responsive derivatives, genuine badge transparency, explicit width/height, and appropriate lazy loading. Labels and criteria remain HTML outside images; decorative art uses empty alt when adjacent copy supplies its meaning. Keep source masters out of the initial application bundle and record prompts/source lineage in the asset README.
- [ ] Inspect badges at 48, 96 and 160 pixels and landscape/completion art in actual 320/390px crops. Earned/unearned differences must remain understandable through HTML status text without lowering label contrast or making study appear locked.
- [ ] Run component tests, visual checks at 1440/390/320, and shared coach/student contrast smoke. Review/commit the design-system gate.

The user approved the patch family and requested the Erudoza logo in that style. Read the recorded approval and selected logo derivative in the asset README; preserve the flame-and-Bible identity. Review 24/32/48px navigation samples before using a detailed master in a compact slot.

- [ ] Implement `HonorArtwork({ src, alt, size }: { src: string; alt: string; size: number })` with a stable wrapper, image-only `perspective(650px) rotateX(...) rotateY(...)`, and a maximum 7-degree rotation. Map pointer position to normalized coordinates inside the wrapper. Use `requestAnimationFrame` interpolation `1 - Math.exp(-elapsedMs / 70)`; clamp elapsed time after background pauses.
- [ ] Test pointer exit/cancel returns the image to zero, rotation remains within bounds, unmount cancels the animation frame/listeners, and reduced-motion or coarse-pointer media changes reset motion immediately. Use an injected/fake frame clock and media-query adapter to avoid real-time flaky assertions.
- [ ] Add browser checks that moving to opposite corners produces opposite rotation signs, text/focus bounds do not move, an idle image schedules no more frames, touch gestures scroll normally, and reduced motion keeps the transform at rest. Reuse the component for honor images in HQ, Honors, and recap; do not tilt the click target, labels, or logo by default.

## Task 8: Build Training HQ and the flexible weekly goal

**Files**

- Modify: `apps/web/src/features/student/StudentHomePage.tsx`, `apps/web/src/features/student/StudentHomePage.test.tsx`, `apps/web/src/features/student/TrainingHome.test.tsx`, `apps/web/src/features/student/student.css`.
- Create: `apps/web/src/features/student/DailyMissionCard.tsx`, `apps/web/src/features/student/WeeklyGoalDialog.tsx`, `apps/web/src/features/student/DailyMissionCard.test.tsx`, `apps/web/src/features/student/WeeklyGoalDialog.test.tsx`.
- Modify: `apps/web/src/api/training.ts` and `apps/web/src/api/trainingTypes.ts` only if earlier defined contracts need additive fields verified in both backends.

**Interfaces**

`DailyMissionCard({ today }: { today: TrainingToday })` renders the suggested/saved mission, step fractions, and actual next action. `WeeklyGoalDialog({ preferences, open, onClose, onSaved }: { preferences: TrainingPreferences; open: boolean; onClose(): void; onSaved(value: TrainingPreferences): void })` persists one validated preference request.

- [ ] Write failing page tests using `TrainingToday` fixtures: review first, no-due drill-only, unassigned student, unavailable season, restored session, invalidated mission, and a recoverable API failure that must not render zero progress.
- [ ] Add a goal-save test selecting 3 days; verify the current week remains target 5 and pending copy names next Monday.
- [ ] Run `npm --workspace apps/web run test -- src/features/student/StudentHomePage.test.tsx src/features/student/WeeklyGoalDialog.test.tsx`.
- [ ] Replace the separate oversized greeting/banner/continue areas with the approved compact mission feature, week strip, progress overview and honor preview. Preserve season selection and pass its identity to every study/journey/honor link.
- [ ] Query `trainingApi.today` with a key containing org, user and selected season. Refetch on actual relevant mutations; do not poll, start sessions on render, or save rewards from the browser.
- [ ] Keep rehearsal, ordinary due review, Team Practice and assigned-passage access available through existing routes. New goal control uses shared Select/Button/dialog primitives, including pending lock and inline retry.
- [ ] Run updated student-home tests, empty/error cases, lint and type checks. Render/check at 1440/390/320; review/commit.

## Task 9: Connect study completion to a refresh-safe session recap

**Files**

- Modify: `apps/web/src/features/student/StudyPage.tsx`, `apps/web/src/features/student/StudyPage.test.tsx`, `apps/web/src/features/student/ProgressPage.tsx`, `apps/web/src/features/student/ProgressPage.test.tsx`, `apps/web/src/features/student/academyTracks.ts`.
- Create: `apps/web/src/features/student/SessionRecapPage.tsx`, `apps/web/src/features/student/SessionRecapPage.test.tsx`.
- Modify: `apps/web/src/app/router.tsx` and `apps/web/src/api/client.ts`.

**Interfaces**

Add `/student/sessions/:sessionId/recap` inside the student guard. `SessionRecapPage` fetches `trainingApi.recap(sessionId)` using org/user/session query identity; route state may prefill a cache but is never required. Add optional `StartTrainingContext` to `api.startSession` without breaking existing ordinary starts.

- [ ] Write a failing direct-navigation test that provides no route state, mocks GET recap, and displays the real `correct / attempted` count.
- [ ] Test the partial result **Practice saved — 1 of 8 questions answered** without full-drill reward, and a full result with an already-credited practice day. Verify no artificial confetti/reward for a failed request.
- [ ] Run targeted StudyPage and SessionRecapPage tests.
- [ ] Keep current accepted-answer retry/sessionStorage behavior. After successful completion, invalidate relevant `progress`, `training-today`, `training-honors` and `training-journey` keys and navigate by persisted session ID.

```ts
navigate("/student/sessions/" + encodeURIComponent(summary.sessionId) + "/recap");
```

- [ ] Change resume-of-completed-session navigation to the same recap route. Remove the old route-state-only completion banner from Progress once compatibility tests prove old callers are no longer dependent on it.
- [ ] Render real counts, frozen passage before/after evidence, attributable skill deltas, honor evidence, and the credited date. When aggregate before/after values are null because events may interleave, show the stored answer-level before/after pairs and sum of this session's contributions; do not synthesize a misleading uninterrupted transition. If mission and credit dates differ, name both. Do not render a claimed improvement when the stored recap version is `legacy-counts`.
- [ ] Supply back-to-HQ, current progress, and next useful practice actions with season preserved. Missing session/denied access gets safe recovery; incomplete recap gets Resume session. Do not leak other student names/answers.
- [ ] Run refresh, browser-back, duplicate completion, network retry, keyboard and reduced-motion tests. Review/commit.

## Task 10: Build the Honors collection and assigned passage journey

**Files**

- Create: `apps/web/src/features/student/HonorsPage.tsx`, `apps/web/src/features/student/HonorsPage.test.tsx`, `apps/web/src/features/student/PassageJourney.tsx`, `apps/web/src/features/student/PassageJourney.test.tsx`.
- Modify: `apps/web/src/features/student/ProgressPage.tsx`, `apps/web/src/features/student/ProgressPage.test.tsx`, `apps/web/src/features/student/student.css`, `apps/web/src/app/router.tsx`.
- Modify: `apps/web/src/components/navigation/destinations.ts` and `apps/web/src/components/navigation/destinations.test.ts`; preserve Option C command/pin behavior.
- Extend: `apps/web/src/api/trainingTypes.ts`, `apps/web/src/api/training.ts`; backend journey response in Task 5.

**Interfaces**

```ts
export type PassageJourneyPage = {
  seasonId: string; scopeVersion: string; after: string | null;
  chapters: {
    bookKey: string; chapter: number; scopeLabel: "Assigned scope";
    eligibleCount: number; seenCount: number; strongCount: number;
    passages: {
      knowledgeUnitId: string; title: string; level: string;
      algorithmVersion: string; skills: SkillScores; dueAtUtc: string | null;
    }[];
  }[];
};
```

`trainingApi.journey(seasonId: string, after?: string): Promise<PassageJourneyPage>` and `PassageJourney({ seasonId }: { seasonId: string })` preserve server pagination. Only show an honest aggregate, not a simulated linear lock/unlock path.

- [ ] Write failing collection tests: earned dates/criteria, nearly-there 4/5, no earned badge for missing data, details keyboard dialog, season switching, and no claim that prior earned state equals present mastery.
- [ ] Test the **All**, **Earned**, and **In progress** filters, including a useful empty result for each filter. Filter the fetched catalog by actual `earnedAtUtc` rather than changing award state locally.
- [ ] Write journey tests for a partial chapter assignment, all-unseen content, mixed skill values, legacy scoring, next-page action, and zero eligible passages. Display **Assigned scope** alongside chapter completion.
- [ ] Run targeted Vitest tests.
- [ ] Add `/student/honors` and links from HQ and recap. Keep Progress as the passage journey destination; use real shared chips/meters, explicit dates/criteria, and server order.
- [ ] Expose wording/reference/sequence evidence separately. Do not add targeted mode/knowledge filters the study engine does not support: use the existing review action for due items and normal study for general practice.
- [ ] Preserve Coach's existing read-only Student progress view; its new stored skill fields may display through shared components, but no Coach redesign or student-only goal controls appear there.
- [ ] Verify all new command-center/sidebar destinations resolve, preserve selected season, and restore keyboard focus. Run navigation/student-progress tests and responsive renders; review/commit.

## Task 11: Run the integrated evidence gate and prepare delivery

**Files**

- Create: `apps/web/e2e/training-progression.spec.ts`.
- Modify: `apps/web/playwright.native.config.ts` to include that spec in its explicit `testMatch`.
- Modify: `docs/audits/2026-09-11-training-progression.md` and `PROGRESS.md` during execution only.

**Interfaces**

Run one real HTTP/browser scenario against each supported backend: coach setup creates scope and student; student completes review + drill; returns to HQ; refreshes recap; opens earned/nearly-there honors and journey. Shared contract assertions match across backends.

- [ ] Add real-browser checks for full/partial completion, unique day credit, direct recap refresh after another session, scope invalidation recovery, goal pending date, and deterministic five-activity study.
- [ ] Assert no page-level horizontal overflow at 1440, 390 and 320; interactive targets >=44px for coarse pointers; keyboard-only completion and dialog focus; reduced-motion honors user settings.
- [ ] Capture coach and student shared-component screens together. Check the current button foreground/background behavior through hover, pressed, pending, selected, disabled and focus; do not infer contrast from screenshots alone.
- [ ] Include `/`, `/login`, `/signup`, `/forgot-password` and `/join-coach` in shared-brand/style regression captures. Include available/unavailable account services and actual verification/error states in isolated fixtures. Public-page redesign follows companion Tasks P1–P3; training delivery alone must not publish unreleased Honors claims on the landing page.
- [ ] Run the required commands from repository root:

```powershell
npm run typecheck:web
npm run lint:web
npm run test:web
npm --workspace apps/web run typecheck:native
npm --workspace apps/web run test:native
npm run build:web
npm --workspace apps/web run build:native
dotnet restore apps/api/Erudoza.sln
dotnet format apps/api/Erudoza.sln --verify-no-changes --severity warn
dotnet build apps/api/Erudoza.sln --no-restore
dotnet test apps/api/Erudoza.sln --no-build
node --test scripts/cloudflare-export.test.mjs
npm run test:e2e
```

- [ ] Run native Playwright from `apps/web`:

```powershell
npx playwright test --config playwright.native.config.ts
```

Use isolated owned fixtures; do not touch the existing API on port 5080 or assume workers.dev is staging. Coordinate browser fixture ports/processes before starting. Keep traces/screenshots/databases in ignored output paths.

- [ ] Have a fresh reviewer verify target qualification, day uniqueness, atomicity, auth, scope invalidation, calendar, bounded reads, snapshots and UI copy against the spec. Resolve concrete findings and repeat only affected checks.
- [ ] Record exact executed commands/counts, read/write measurements, browser coverage, skipped gates and limitations. Distinguish local verification, commit, push, and any later deployment.
- [ ] Explicitly stage only this feature's reviewed files; commit and push the authorized task branch after coordination. No merge, production migration or deployment occurs as an implied effect of writing/executing this plan.
- [ ] Prepare a concrete deployment change set with migration order, backward-compatible Worker/UI rollout, data backup, and rollback limitations. Obtain any required deployment approval at that final reviewable gate; pending original artwork or Coach approval does not block the verified student implementation using approved assets.

## Public entry companion phase

These tasks are part of the user's requested design scope. They can be scheduled separately from Tasks 1–11 and reuse the same approved art. Read the [public entry design brief](../../product/2026-09-11-public-entry-design.md) for exact hierarchy, role behavior, asset placement and acceptance states. No new authentication backend or email activation is included.

### Task P1: Preview the landing and complete account-entry family

**Files:** Create `docs/product/mockups/2026-09-11-public-entry.html` at preview execution; use the existing original-assets package. Record the selected composition and approval in `docs/product/2026-09-11-public-entry-design.md`.

**Interface:** A local review artifact covers `/`, `/login`, `/signup`, `/forgot-password` and `/join-coach` with clearly synthetic form values and no real account writes. Existing routes and account states determine the preview controls.

- [ ] Inspect the current public/account pages at 1440/390/320 with the current shared components; use isolated local availability fixtures for signup. Do not create production accounts or send verification emails to render a preview.
- [ ] Build one coherent page family using the approved patch logo, refined landscape and Coach illustration. Show landing entry choices, sign-in, both signup stages, unavailable/retry, invalid code and recovery/invitation examples. Keep the actual security-check space and form behavior recognizable.
- [ ] Render desktop and mobile previews together. Check form reading order, logo/crops, narrow-screen widget space, notice wrapping and no sideways page movement. Show the concrete page compositions for approval; retain the existing artwork approvals.
- [ ] Save the approved composition, artifact link and any requested corrections in the brief and `PROGRESS.md`; review and checkpoint the scoped design files.

### Task P2: Integrate the approved public composition and shared brand

**Files:** Modify `apps/web/src/features/marketing/LandingPage.tsx`, `apps/web/src/features/auth/LoginPage.tsx`, `apps/web/src/features/auth/CoachOnboardingPage.tsx`, `apps/web/src/components/brand/ErudozaWordmark.tsx`, `apps/web/src/styles/training-public.css`, `apps/web/src/styles/training-login.css`, and `apps/web/src/styles/coach-onboarding.css`. Add optimized derivatives in `apps/web/public/brand/` and their provenance to the original asset manifest. Read `apps/web/src/features/auth/useCoachOptions.ts`, `TurnstileChallenge.tsx`, `apps/web/src/api/onboarding.ts`, and `apps/web/src/auth/AuthContext.tsx` as behavior boundaries.

**Interface:** Preserve the existing `ErudozaWordmark({ compact, inverted })` API, route identities, login redirects and `CoachOnboardingPage({ mode })` state machine. Reuse existing `onboardingApi` requests and `useCoachOptions()` availability; a visual change does not make the canonical backend support email onboarding.

- [ ] Produce responsive image derivatives from approved source masters, retain transparency and explicit dimensions, and measure transfer sizes. Use a shared brand source without importing `features/student/trainingAssets.ts` into public routes. Show any newly generated simplified derivative for approval before use.
- [ ] Apply the approved composition using shared Button/Input/LinkButton/Notice/PageHeader primitives. Keep account forms on solid surfaces, restrict patch tilt to honor art, and preserve narrow Turnstile padding and natural scrolling on phones.
- [ ] Preserve email-or-username/password login, password-manager attributes, Show/Hide, Caps Lock notice, pending/error associations and Student `/student` versus coach `/admin` routing. Keep student account guidance and coach signup/recovery paths explicit.
- [ ] Preserve signup/recovery/invitation state transitions: availability/error retry, account loading/error/signed-in notice, security challenge, six-digit verification, expiry/resend cooldown, Change email, field/password constraints and successful-session acceptance. Keep invitation token removal and in-memory handling intact.
- [ ] Keep landing claims tied to released features. Honor samples remain clearly illustrative; a real Honors marketing section goes live only with its working feature. Preserve support access and skip navigation. Run existing login/onboarding tests plus type/lint checks and review the scoped diff before committing.

### Task P3: Verify the full entry journey and checkpoint delivery

**Files:** Extend `apps/web/src/test/landingPage.test.tsx`, `apps/web/src/features/auth/LoginPage.test.tsx`, `apps/web/src/features/auth/CoachOnboardingPage.test.tsx`, `apps/web/e2e/landing-phone.spec.ts`, `apps/web/e2e/login-phone.spec.ts`, and `apps/web/e2e/brand-shell.spec.ts` only for meaningful coverage gaps. Retain behavioral checks in `apps/web/src/api/onboarding.test.ts` and `apps/web/src/auth/AuthContext.test.tsx`. Record browser evidence/limits in a new `docs/audits/2026-09-11-public-entry.md` at execution and `PROGRESS.md`.

**Interface:** Public and auth routes retain their observable behavior; shared wordmark/style changes also render correctly in both workspaces. Native onboarding's isolated local browser scenario remains the verification reference; canonical .NET verifies login and the honest unavailable signup fallback.

- [ ] Run the focused existing behavior suite:

```powershell
npm --workspace apps/web run test -- src/test/landingPage.test.tsx src/features/auth/LoginPage.test.tsx src/features/auth/CoachOnboardingPage.test.tsx src/api/onboarding.test.ts src/auth/AuthContext.test.tsx
npm run typecheck:web
npm run lint:web
npm run build:web
npm --workspace apps/web run build:native
```

- [ ] Run public/account browser checks from `apps/web` with the repository's canonical configuration and owned fixture ports:

```powershell
npx playwright test e2e/landing-phone.spec.ts e2e/login-phone.spec.ts e2e/brand-shell.spec.ts
```

- [ ] Reuse the isolated onboarding setup documented in `docs/operations/coach-onboarding.md` for email/code, invitation, recovery and service-unavailable scenarios. The native Playwright config currently includes only selected gameplay/library specs; do not claim the command above validates native signup or a real email delivery. Coordinate setup before touching fixture processes.
- [ ] Verify all five public/account routes at 1440/390/320 with correct images, readable errors, keyboard focus, password paste/autofill, reduced motion, no page overflow and at least 44px coarse-pointer controls. Include both signup stages, service loading/unavailable, wrong/expired code, resend cooldown, signed-in account, invalid invitation, and recovery success. Confirm Coach/student shells together after the shared logo change.
- [ ] Self-review against the public brief and record exactly executed checks, image sizes, failures/resolutions and remaining limits. Commit/push only scoped reviewed files. Prepare any later deployment for its required final approval; page design does not activate onboarding services or authorize real email sends.

## Coach follow-up boundary

The shared visual language and existing Student progress improvements can support a future Coach HQ, but its information hierarchy and aggregation have not been approved by the student mockup. Create a separate Coach mockup and plan around actionable student support, assignment coverage and team progress. Reuse this feature's bounded day/week/skill evidence through one authorized aggregate query; do not promise readiness predictions, copy student reward controls into management screens, or issue one full Progress query per student.

## Planning verification and handoff

The repository inspection underlying this plan did not change application behavior. The coordinating agent records the reviewed documentation/artwork commit and push in `PROGRESS.md` under the repository checkpoint workflow. That planning checkpoint establishes no application test pass, migration, production write, implementation or deployment. At execution, re-read the current shared progress log, verify the specification's decisions, review the original-assets approval status, and begin Task 1.
