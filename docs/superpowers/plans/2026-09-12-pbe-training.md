# PBE Training Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Help students retain their assigned season material through varied PBE questions and complete independent practice without waiting for a coach.

**Architecture:** Add a versioned PBE question/rubric layer shared by native solo and team delivery, with equivalent C# contracts and behavior. Persist immutable attempts and per-target review evidence; derive chapter progress from that evidence. Keep historical study sessions, arcade matches and Honors on their original contracts.

**Tech Stack:** Existing React/TypeScript/Vitest/Playwright frontend, Cloudflare Worker/D1/Durable Objects, and .NET/EF Core reference backend. Use existing dependencies; browser speech synthesis is optional presentation support, not a grading service.

**Spec:** [Replayability assessment](../../audits/2026-09-11-training-replayability.md) and [PBE alignment assessment, including accepted independent grading](../../audits/2026-09-11-pbe-training-alignment.md).

## Release scope freeze — user direction

The user requested closure for hands-on testing and explicitly stopped further scope expansion. Finish the implemented A–D2 features, the known D2 review corrections, existing local restore tooling and essential combined release checks; then commit/push, consolidate all branch progress into main, deploy and remove preserved non-main refs. Do not add new gamification, converter architecture, stress matrices or pilot work. D2-containing backup conversion remains explicitly unsupported and fails before target writes; it is future work requiring a new request. Physical-device speech/IME, SQL Server execution, hosted capacity and the coordinated learner study remain disclosed external limits. Features remain disabled for unreviewed season banks.

## Global constraints

- The user authorized implementation as an active goal and subsequently authorized committing, pushing, integrating the latest work from all branches into `main`, deploying the validated combined app, and removing other branches after preservation. Complete training and release checks before consolidation/deployment/cleanup. Planning baseline: `71cc6ac`; its application files matched deployed source `838a066`.
- “Students should be able to start, finish and replay ordinary matches without an adult online.” Automatic grading is the default; coach-led rehearsal is explicitly selected. Disputes do not block play.
- “Preserve the coach's selected season and assignment.” Support multiple books and separately approved commentary introductions. Never fill an insufficient bank with unassigned or invented material. Solo scope is the student’s personal assignment; team rehearsal uses the coach-selected season’s approved material through an authenticated room boundary, following the stated team-scope default in C2. This does not expand generic student bank or reader access.
- NAD baseline: references supplied; short answers, lists, exact quotations/blanks; no multiple choice in rehearsal. Exact words/order for quotations; configured variants and later adjudication for factual answers. No runtime generative-AI grading or blanket fuzzy matching.
- PBE rehearsal earns accuracy points only. Supported question totals are 1–8; response windows are `20 + 5 * points` seconds, following two readings, with a ten-second warning. Full rehearsal is 90 questions and a five-minute break after question 45. These are separate from shortened practice.
- Commentary must be fewer than 10% of a rehearsal set; `maximum = Math.ceil(count * 0.1) - 1`. The existing 10% true/false cap remains a named Erudoza policy, not an official percentage. New rehearsal profiles default to the same cap. These event-mix limits do not restrict focused Practice/Review, which may study assigned commentary directly. Do not require either question kind when none is available; surface missing commentary coverage separately.
- Team rehearsal supports 2–6 students per team and one or two teams. Individual practice may use one student but is labeled solo practice. No claim of official placing from app percent-correct or head-to-head results.
- “Preserve deterministic generation and immutable cards after selection.” New session selection may vary; refresh, retries and resume must not reroll questions or rubrics.
- User addition, September 12: missing-word activities let students type directly into the displayed blanks. Preserve each blank's identity through submission and grading; do not require students to invent comma-separated answer formatting or flatten empty slots into a potentially correct answer. B4 implements this against frozen MissingWords tokens with legacy retry compatibility.
- Preserve historical scores, difficulty evidence ceilings, earned permanent Honors, profile unlocks and existing routes. New chapter stamps are separate dated evidence, not a replacement for permanent Honors.
- Native production and C# reference behavior must pass common fixtures. No parity claim from source inspection alone. The planning-time SDK blocker is resolved with task-local SDK 10.0.303 matching root `global.json`; run and record canonical checks for each implemented gate.
- Read [DESIGN.md](../../../DESIGN.md) and [PROGRESS.md](../../../PROGRESS.md) before implementation. Reuse shared controls/tokens; 44px touch targets, 1440/390/320px checks, keyboard and reduced motion. No new artwork or design system is required.
- Use additive persistence changes. Keep existing feature behavior until the new season setting is enabled. Production bindings, private data and generated fixtures stay outside this documentation checkpoint.

---

## Delivery order and boundaries

The assessment spans four subsystems. Execute these linked plans serially at first; each produces an independently testable gate. Team rehearsal can be developed after Phase A without waiting for Phase B, but shared contract changes need one owner.

| Phase | Plan | Working deliverable | Prerequisite |
|---|---|---|---|
| A | [Questions and grading](2026-09-12-pbe-questions.md) | Versioned rubrics, reusable scoped question bank, coach publishing/coverage tools | Existing application |
| B | [Solo learning and replay](2026-09-12-pbe-solo-replay.md) | Factual daily practice, skill-specific review, reproducible session variation, usable memory exercises | A |
| C | [Independent team rehearsal](2026-09-12-pbe-team-rehearsal.md) | Accuracy-only matches, six-student teams, independent presentation, deferred disputes | A; B's target-history contract |
| D | [Chapter progress and release](2026-09-12-pbe-chapter-progress.md) | Evidence-based chapter stamps/season map and integrated release validation | B and C |

The first useful pilot is A+B: students can practice assigned PBE questions without an adult online. C adds event-style team practice. D adds progression once the underlying evidence is trustworthy. Do not release all four as one unreviewable change.

## Shared file and ownership map

All paths below are relative to the repository root. `Create` paths in the child plans are proposed files, not existing APIs.

| Boundary | Native/frontend | C# equivalent |
|---|---|---|
| Private rules and rubrics | Create `apps/web/worker/native/pbe/{types,rules,grading,bank}.ts` | Create `Erudoza.Domain/Practice/PbeRules.cs`, `PbeRubric.cs`; application bank abstraction/service |
| Public DTOs | Create `apps/web/src/api/pbeTypes.ts`; adapt existing study/practice clients | Create `Erudoza.Application/Contracts/PbeContracts.cs` |
| Target evidence and selection | Create `worker/native/pbe/{selection,review,progress}.ts`; integrate study/training stores | Create domain review/selection rules and application persistence adapters |
| Team runtime | Existing `worker/native/practice/{state,room,routes,reports,awards}.ts` | Existing `Erudoza.Api/Practice/` services/engine/commands |
| Shared presentation | Create `src/features/study/PbePresentation.tsx`, `pbeSpeech.ts` | Server presentation contract; browser UI is shared |
| Readiness and rewards | Existing training/mastery services plus separate PBE projections | New PBE projection records, existing training query services |

Do not move the existing five generators or rewrite the monolithic room engine wholesale. Add focused modules and branch at the version boundary. Frontend DTO modules must never import server answer-key objects.

## Persistence and compatibility decisions

Native storage reuses the `Records` infrastructure with new kinds `pbe-question`, `pbe-question-head`, `pbe-target`, `pbe-introduction`, `pbe-introduction-assignment`, `pbe-progress`, `pbe-session-summary`, `pbe-chapter-stamp` and `pbe-dispute`. Use deterministic identities scoped by organization/season/student and immutable question IDs/versions in attempts. Create `apps/web/migrations/0005_pbe_training.sql` in Phase A, after checking no other branch has claimed that number. It adds only the indexes actually used by scoped queries; no historical data rewrite.

C# adds `PbeTrainingRecord` (organization, kind, string ID, season, optional owner, JSON, revision) and an indexed EF mapping for these projections. Existing `PracticeQuestionRecord.DefinitionJson` and room snapshots retain their legacy purpose; v2 PBE questions and targets live in `PbeTrainingRecord` so legacy bank consumers cannot silently ingest them. Add a generated migration named `PbeTrainingRecords`; let EF produce its timestamped filenames and model snapshot rather than hand-authoring designer files.

Use A2's implemented `Season.PbeEnabled` / native season `pbeEnabled`, default false when absent. New session `format` is `Memory | Pbe`; new room `format` is `Arcade | Pbe`. New clients default to Pbe for enabled seasons with eligible published content; unavailable banks show an actionable empty state and an explicit Memory option. Never silently substitute Memory for a requested Pbe session. Missing format on persisted records means legacy behavior. Every new record snapshots its rule, scoring and selection versions.

## Proposed product defaults

These values are implementation choices for the pilot, not official PBE requirements or proven optimal learning intervals:

- Daily eight-question practice prefers three due targets, three least-practiced targets, one eligible repair and one alternate-form transfer question. Unavailable categories fall back to least-practiced eligible targets. Review mode uses due targets only.
- Review intervals after fully correct, unaided retrieval: 1, 3, 7 and 14 days. Early successful replays preserve the future due date/interval; a due retrieval advances it. A failed/partial answer resets the target's interval and remains due; a hinted success cannot clear it. Repair waits for two distinct intervening answer targets when the assignment permits. If a small or overlapping failed-target bank cannot start a spaced set, permit a next-session retry without claiming spaced repair. Repair slots are selected with the complete fixed set; newly missed targets remain due for the next session, without appending or rerolling cards.
- Chapter stamp: all coach-declared targets in the assigned range have two fully correct unaided attempts at least 48 hours apart using different question IDs. A stamp stores coverage and date; current readiness can become due again. Missing targets or only one question variant prevent a retained claim rather than enlarging the assignment.
- Use current honor artwork and ordinary text/progress indicators. No new currency, public ranking, paid service or push-notification system.

## Coverage checklist

| Assessment requirement | Implementation task |
|---|---|
| Real factual/list/exact questions and source coverage | A1–A3 (including A2b introductions), B2 |
| Automatic partial credit, conservative spelling and answer secrecy | A1, B2, C3 |
| No repeated first-bank slice or fixed verse/activity mapping | B1, C2 |
| Recognition cannot erase failed recall | B1 |
| Advanced Builder actions and repeated masks | B3 |
| Direct typing in MissingWords blanks and positional verification | B4 |
| Official timing, no speed points, 90 questions, six students | C1–C2 |
| Complete/replay without coach; later disputes | C2–C3 |
| Short assignments, transparent difficulty and missing coverage | A3, D1–D2 |
| Delayed checkpoints, comeback quests, season cooperation | B1–B2, D1–D2 |
| Historical awards and runtime parity | A1–A2, C3, D1, D3 |
| Mobile usability, pilot and rollout evidence | Each phase gate and D3 |

## Execution and release discipline

- [x] Before coding, read this index, the target child plan, both assessments and current progress; create an isolated implementation worktree with the repository branch prefix. The initial implementation branch was created from the planning checkpoint.
- [ ] For every task: add the behavioral regression first, observe failure for the expected reason, implement the smallest change, run its focused tests, review the diff, explicitly stage and commit. Update progress and push at the child plan's verified gate. Do not stage unrelated files or generated private artifacts.
- [ ] Run the full release checks in D3 only after the integrated behavior exists. Tests listed in these plans are future execution steps; the earlier audit's passing tests do not satisfy them.
- [ ] Prepare rollout with new features disabled, a reviewed additive migration, backup/rollback procedure, and a selected coach's source-reviewed question bank. A question bank is prepared ahead of play; live coach presence is never an availability dependency.
- [ ] Record local verification, pushed source, approved pilot and live deployment separately. The subsequent user instruction authorizes the final main integration, production deployment and branch cleanup; it does not authorize real-world pilot contacts or silently enabling an unreviewed season bank.
- [ ] Before cleanup, inventory every local/remote branch and worktree, preserve uncommitted work and unique branch history in main, resolve superseded changes against the validated current app, and verify final remote reachability. Deploy and read back the combined build before deleting other branch refs. Do not discard ignored private tooling, backups or active previews through worktree removal.

## Plan review result

All assessment findings map to tasks above. A verified question bank for the actual selected season remains a pilot prerequisite; the canonical .NET test environment is now available. Isolated synthetic fixtures support implementation. Browser speech availability and proper-name pronunciation are explicit Phase C tests with a labeled text fallback; no automatic-audio success is assumed.

## Execution status

A–D2 features are implemented and reviewed through task checkpoint `e8dec16`, now integrated into local main with every branch's progress. The user froze further scope expansion. D3's implemented local restore subset is verified; unsupported D2 conversion, hosted capacity and real learner studies remain explicit follow-ups. Final combined checks, production deployment and preserved-ref cleanup are complete. The user is taking over live signed-in testing; no further work is scheduled. See [PROGRESS.md](../../../PROGRESS.md) for executed evidence and its limits.

| Phase | Status |
|---|---|
| A — Questions and grading | Complete, reviewed and integrated |
| B — Solo learning/replay and inline missing words | Complete, reviewed and integrated |
| C — Independent rehearsal and deferred review | Complete, reviewed and integrated |
| D — Chapter progress and release | Complete within user-frozen scope; deployed and cleaned up |

### A2 storage refinement

The implementation uses dedicated native `pbe-question`/`pbe-target` kinds and canonical `PbeTrainingRecord` rows for the new bank. This preserves the existing question table and legacy selectors without interpreting v2 data as arcade questions. A2 exposes explicit season-scoped PBE endpoints under `/practice/pbe/seasons/{seasonId}`; coach preparation works before the season is enabled and does not depend on the organization's Team Practice flag. Student bank responses contain coverage counts only. D3 must preserve these rows, versions, revisions and the enable flag in the existing cross-backend exporter.

### Introduction source refinement

Task A2b was added after source inspection showed that the current range-only assignment model cannot represent commentary introductions without fabricated coordinates. It uses explicit season-owned introduction packs and student assignments in A2's record storage, with source review before question publication. This added one implementation task within the approved PBE source-coverage requirement; the later user-requested B4 brings the current total to 14. A3 adds its coach controls, B2 consumes the shared resolver, and D2 displays separate introduction groups.

A2 also keeps a `pbe-question-head` projection for the newest published version of each question. Its source anchor enables indexed assignment reads without falling back to an older version when a new version moves outside the student's scope. Publication updates the head and source index atomically; old versions remain immutable for authoring/history. D3 exports this projection alongside raw versions.


### B1 evidence storage and caller boundary

The replay implementation separates six record kinds: `pbe-recall-sequence`, `pbe-recall-event`, `pbe-target-review`, `pbe-service-event`, `pbe-question-service` and `pbe-target-service`. Their identities are scoped to organization, season and student. A served prompt records exposure; it does not create accepted recall evidence. Accepted events preserve the original server time and a transaction-ordered sequence, including when timestamps tie. Target state persists across unrelated scope additions. Later corrections replay the original chronology rather than treating the resolution date as a new retrieval.

The bounded encounter projection keeps the latest sequence for three distinct target IDs. Two other IDs strictly after the failed sequence establish repair spacing; simultaneous parts of the failed attempt do not. Selection distinguishes a failed-target candidate from proven spacing, preserves the complete fixed set, and permits a next-session retry when spacing cannot be achieved. Accepted-answer question kind is stored separately from last-viewed kind so alternate-form selection uses actual answers. Recognition can update that metadata without changing factual recall scheduling.

These are internal composable adapters. B2 must authenticate and freshly authorize the saved student's material, grade frozen rubrics, preserve server-recorded assistance, and commit the attempt, session/card state, evidence and daily effort together. A semantic student eligibility signature is distinct from fresh resolver revision guards. Exact retries reuse original server times and card/attempt identities. D3 must export all six kinds and their scopes/revisions without rewriting immutable evidence. The adapter tests do not establish complete HTTP request cost, saved-session behavior or a live deployment.


### B2 saved daily study and evidence boundary

The implementation adds `pbe-session`, `pbe-attempt`, `pbe-session-start`, `pbe-daily-mission` and `pbe-daily-mission-head` records. Separate PBE services share existing calendar/preference/day/week storage and commit effort with the accepted attempt and target evidence, avoiding fabricated legacy source/knowledge rows or Honor updates. Sessions freeze question/target/rubric versions and actual selected counts; semantic personal eligibility is separate from fresh revision guards. D3 must preserve these five kinds alongside B1 evidence and existing native scope audit records.

Saved format controls resume. A compatible frozen mission stays available after new question publication or disabling only new admission; real source, assignment, membership or season revocation still blocks continuation. Source assistance persists before text is revealed. Completed historical recaps remain stable; unfinished recaps cannot reveal unanswered rubrics. Ordinary PBE Practice/Review is operational locally; C1 must supply presentation, authoritative timing and delayed Simulation feedback before enabling the timed entry. Query-count measurements and synthetic browser journeys do not establish live capacity or human retention.


### B3 saved Memory evidence boundary

New enabled-season Memory sessions save their Warmup or coach-permitted Advanced purpose, generator version and evidence profile. Actual acceptance validates the card against the saved session before new evidence writes. Missing historical metadata retains legacy behavior; malformed new metadata cannot silently select a legacy or Advanced evaluator. D3 must preserve the existing canonical session/card JSON snapshots and native purpose, generator, profile and original request discriminator. Pending Memory/PBE responses survive same-owner reload only after fresh authentication matches the sessionStorage owner marker. See PROGRESS.md for review and verification chronology; this does not establish a deployed change.


### C1 timed rehearsal and recovery boundary

Shortened solo Simulation freezes the actual eligible set, uses two readings or explicitly confirmed text fallback, and defers scoring feedback until completion. Native per-session PbeSoloRound and canonical IPbeSoloTimingAuthority capture trusted ingress, enforce inclusive accuracy-only deadlines and persist verified drafts/finals for idempotent delivery. Canonical pbe-solo-outbox is an indexed pending marker; complete timing/retry data lives in pbe-session. Original response lock time is separate from transaction acceptance chronology for later retention proof.

Clock loss cannot reopen an armed window. Trusted saved answers settle; unrecoverable sessions retain earlier effort and sanitized partial scores with independent recap/restart. Question-scoped receipts and cancelled-ticket cleanup were independently reviewed after focused fixes. C2 must integrate the shared presentation/timing contracts into real one/two-team rooms. Native v3-pbe-solo source configuration is additive and unapplied; D3 must handle pending authority state during export and rollback. Local test evidence does not establish deployed eviction, hosted ticker cadence, physical speech or SQL Server execution.


### C2 room authority and exposure boundary

PBE rooms freeze the requested 10/30/90 questions plus one compatible reserve, select from approved season material using participant maximum question-service history, and keep personal-study scope separate. One/two teams, student-captain independent control, explicit coached readings/readiness, accuracy points and a hidden-question halfway break are saved-version behavior. Team service is exposure only, with idempotent bulk projections and durable outboxes; it does not create individual retention evidence.

Active material revocation yields a sanitized management view with existing cleanup authority. Cleanup preserves earlier answers and authorized revealed history; terminal admission rejects new play before recovery/mutation while preserving original-actor accepted command retries. Native full authority stays in DO state/outbox; canonical full room and pbe-room-service-outbox are persisted separately from read projections. D3 must retain coach-reading metadata, source proofs, question/rubric wrappers, reserve/replacement identities, schedules and response lock times. The final C2 task review closes all blocking findings; C3 owns the tracked one-team invitation minor, deferred disputes and full Phase C/load checks.


### B4 inline answer addition

The user's supplied Missing Words screen requires direct entry in each displayed blank. [Task B4](2026-09-12-pbe-solo-replay.md#task-b4-type-directly-into-missing-word-blanks) preserves public frozen token indices and verifies original indexed answers on both servers. A UI-only join is insufficient: entries `['in the', '']` must not pass for `['in', 'the']`. The task adds versioned structured attempt storage while retaining old string-only pending retries and historical scores. It follows C3 without interrupting that checkpoint; D3 must include its additive payload/migration in populated restore tests. Current free-form PBE parts do not expose blank positions and must not be guessed from underscores.


### B4 inline-answer boundary

MissingWords now uses shared inline inputs keyed to saved hidden-token indices. Binary grading compares each original slot independently; empty or misplaced words cannot become a correct joined phrase. The immutable versioned payload preserves raw entries and server-generated feedback in native attempts and nullable canonical `Attempt.AnswerPayloadJson`. Accepted reloads restore the submitted values, including wrong/empty slots. Historical string-only answers and pending retries remain unchanged. New structured requests enforce the 1,048,576-byte received-body/100,000-character answer limits and 409 conflicting-retry contract; canonical legacy-only admission/status behavior is preserved.

B4 is reviewed/pushed through `0fa0ea2`; populated Memory export/restore and generated EF migration checks pass locally. D3 still owns full PBE/C3/D archive and operational recovery coverage. Chapter integration follows the [chapter projection contract](../../product/2026-09-12-pbe-chapter-contract.md), with evidence-based parent stamps and small selectable groups; both adapters are independently reviewed through `7214cf4`. D2 supplies cooperative progress and atomic selected-session starts; D3 supplies full restore and release validation.
