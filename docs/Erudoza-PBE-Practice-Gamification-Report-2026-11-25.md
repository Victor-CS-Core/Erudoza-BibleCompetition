# Erudoza PBE Practice & Gamification Improvement Report

**Date:** November 25, 2026  
**Audience:** Developer / implementation agent  
**Scope:** Research-backed product and QA handoff for learner-facing PBE Practice. This report intentionally excludes simulated PvP/team-room implementation except where a practice-to-team handoff is relevant. No application code, content, deployment, or production data was changed.

## Executive recommendation

Treat PBE Practice as a **readiness path**, not as a smaller version of a competition room. The current implementation has a sound scoring and evidence foundation, but the learner-facing loop is still “start an untimed session, answer a card, see points, repeat.” The best improvement is a layered path:

1. **Build recall** — short, repeatable solo drills that repair weak targets.
2. **Build team skill** — optional role and decision drills that teach captain/scribe/discussion behavior without pretending to be official standings.
3. **Prove readiness** — 10-question checkpoints and 45/90-question mock rounds with visibly separate rules and finality states.

The gamification should measure progress toward readiness—coverage, recall, precision, composure, and teamwork—rather than only lifetime XP, streaks, or a generic correct-answer count. Keep the official PBE rules authoritative and keep rewards idempotent and honest.

## What was reviewed

### Repository and live behavior

The read-only audit used the public `Victor-CS-Core/Erudoza-BibleCompetition` repository at commit `6d09949401d6fdaf8c497f6915ad94901560fa55`.

Relevant current implementation:

| Area | Current behavior | Source |
| --- | --- | --- |
| PBE question contract | Four persisted kinds: `ShortAnswer`, `List`, `ExactWords`, `TrueFalse`; each question has scored parts, accepted answers, source evidence, and optional order enforcement. | `apps/web/src/api/pbeTypes.ts:1-10`; `apps/web/worker/native/pbe/types.ts:10-30` |
| PBE authoring | Coach declares a learning target, chooses approved source passages, assigns 1–8 accuracy points, selects a kind, adds accepted wordings, previews, then publishes a version. | `apps/web/src/features/practice/PbeQuestionEditor.tsx:23-48` |
| Solo Practice | Server selects an 8-card practice/review set, persists the selection, grades immediately, returns earned/available points, expected answer parts, citation, source evidence, and whether the answer was unaided. | `apps/web/worker/native/pbe/sessions.ts:154-198, 235-250`; `apps/web/src/features/student/PbeStudyPage.tsx:352-370` |
| Assistance | “Read source with assistance” is available in Practice only; the assisted state is recorded and prevents the answer from establishing unaided recall. | `apps/web/worker/native/pbe/sessions.ts:296-308`; `apps/web/src/features/student/PbeStudyPage.tsx:367-369` |
| Review | A due queue is capped at eight questions and is untimed with immediate feedback. The server rejects a review start when nothing is due. | `apps/web/worker/native/pbe/effort.ts:253-263`; `apps/web/src/features/student/PbeStudyPage.tsx:249-346` |
| Timing/scoring | The current rule profile is `nad-pbe-2023-24-v2`; response time is `20 + 5 × points`, or 25–60 seconds for 1–8 points. Practice itself is untimed. | `apps/web/worker/native/pbe/rules.ts:1-8`; `apps/web/worker/native/pbe/grading.ts:105-110` |
| XP | Correct unaided attempt: 10 XP; correct with hint: 6; partial: half of the full value; zero: 2; attempt XP capped at 300/day. Day credit, review completion, quests, and streak milestones are separate events. | `apps/web/worker/native/pbe/effort.ts:37-49, 156-213`; `apps/web/worker/native/training/xp.ts:56-70, 153-186` |
| Progress | PBE has daily mission state, due-review counts, personal bests by mode, streaks, quests, and recap finality/provisional fields. | `apps/web/worker/native/pbe/effort.ts:215-264`; `apps/web/worker/native/pbe/sessions.ts:113-119, 252-294` |
| Availability guard | New learner sessions use published question heads only; when coverage is empty the UI says to ask the coach to publish questions or switch to Memory. | `apps/web/worker/native/pbe/sessions.ts:167-191`; live QA observed the same empty-bank state in production. |

### Verification status

- Focused learner tests: **137 web tests passed**.
- Focused native study/PBE tests: **71 tests passed**.
- Selected Practice/Study lint passed.
- Web and native typechecks passed.
- No confirmed learner Practice defect was found in the prior QA handoff.

This is therefore a product-depth recommendation, not a claim that the current PBE flow is broken.

## What official PBE is trying to teach

The NAD describes PBE as in-depth Bible study, memorization, Scripture understanding, and relationship with Christ—not memorization as an end in itself. It explicitly connects competition with application, reflection, and outreach. genui{"citation":{"ref":"turn334898462view1"}}

The competition has four advancement levels—Area, Conference, Union, and Division—and is played by teams. Winning teams commonly use study coaches, sample tests, and friendly competition. genui{"citation":{"ref":"turn334898462view1"}}

The current NAD resources page lists the assigned 2026–27 books (Mark; 1 Peter; 2 Peter; 1/2/3 John), translations, Bible Commentary resources, the How-to Guide, and official answer/score sheets. genui{"citation":{"ref":"turn334898462view2"}}

The official How-to Guide describes the competition pattern as:

- 90 questions in a full event.
- Questions worth 1–8 points.
- Questions read twice, followed by a point-dependent response window.
- A ten-second warning before time expires.
- A five-minute intermission after question 45.
- Captain/team discussion and a scribe writing the final answer.
- A “Challenge” path for appeals.
- Scripture references on questions and exact handling for direct quotes/fill-ins.
- No extra time after the answer call.

These are not merely visual details; they create distinct skills: recall, listening, speed calibration, group decision-making, writing accuracy, and composure. genui{"citation":{"ref":"turn334898462view0"}}

The most recent official finals coverage still describes 90 questions, 1–8 point values, 30–60-second limits, the ten-second warning, and the question-45 halfway moment. It also explains that rankings are relative to the top score, which is why a practice product should not invent “winners” or present a private practice score as an official placement. genui{"citation":{"ref":"turn856270791search4"}}

Official practice guidance emphasizes standalone questions, mostly single-word or short-phrase answers, limited true/false, a Scripture reference on every question, and full-book reading/memorization rather than dividing a book so that each member only knows a piece. genui{"citation":{"ref":"turn856270791search8"}}

The Pathfinder training requirements reinforce the same learning loop: use multiple memorization techniques, build a study schedule, review and self-test as a group, run a mock competition, discuss teamwork/strategy/sportsmanship, and reflect afterward on what to improve. genui{"citation":{"ref":"turn334898462view3"}}

## Gap diagnosis

### 1. The data model has four kinds, but the learner sees one generic card

`ShortAnswer`, `List`, `ExactWords`, and `TrueFalse` already exist, yet the Practice surface presents a common prompt/input/feedback shell. This is reliable for correctness, but it hides the strategic difference between “name one fact,” “supply an ordered list,” “quote exact words,” and “make a binary judgment.”

**Recommendation:** keep the four persisted kinds and add a presentation/skill label to the card. Do not create a parallel, client-invented question contract. Add new patterns as metadata-backed variants or new server-validated kinds only when the grading rule genuinely differs.

### 2. Practice does not visibly progress toward an event

The current path has `Practice`, `Review`, and `Simulation`, but no learner-facing bridge such as “you are strong at recall, weak at reference retrieval, and not yet ready for a 45-question round.” The daily mission is useful, but it is not a PBE readiness curriculum.

**Recommendation:** add a presentation-only “Readiness Path” composed from existing PBE progress, due targets, session results, and personal bests. A new server-composed field is not required for Phase 1; derive the first version from existing data and make any future API addition additive and contract-tested.

### 3. Generic XP is not enough to explain improvement

The current XP ledger is careful and anti-grind capped, but a learner cannot tell whether XP came from coverage, exact wording, weak-area repair, speed, or teamwork. PBE-specific personal bests are accuracy/correct-count based; they do not yet create a set of named skills that a learner can pursue.

**Recommendation:** retain the shared XP ledger and add PBE readiness dimensions alongside it. XP should be the reward currency; readiness dimensions should be the explanation.

### 4. Team behaviors are learned only when a room exists

Official PBE depends on a captain, scribe, discussion, and challenges. Solo Practice currently teaches recall and grading, but does not rehearse those behaviors. Team-room simulation is intentionally outside this report; the missing piece is a lightweight practice layer that can be completed before a room is scheduled.

**Recommendation:** add optional team-skill drills that are local practice artifacts, not official competition results and not public standings.

### 5. Coverage readiness is hard to trust when the bank is empty

The app correctly refuses to fabricate a session when there are no published questions. That is a product integrity win, but the learner-facing experience ends at “ask your coach.” A developer needs a deterministic fixture/publish path so that the readiness loop can be tested end-to-end in CI and staging.

**Recommendation:** provide a small published PBE fixture for automated tests and a coach-facing coverage checklist. Keep unpublished drafts unavailable to learners.

### 6. Spiritual context and reflection are absent from the scoring loop

The app shows source evidence and citations after an answer, which is good. It does not yet offer a small, optional reflection/application card that reinforces the official purpose of PBE without altering official scoring.

**Recommendation:** add non-scored “Understand it” or “Apply it” prompts after selected drills. Store a completion signal, not a text leaderboard; avoid shipping copyrighted commentary text without the required license.

## Proposed learner model

### Three practice lanes

| Lane | Learner promise | Suggested runs | Result shown |
| --- | --- | --- | --- |
| **Build recall** | “Repair the material you are weakest on.” | 3-question rescue, 8-question adaptive drill, chapter/target drill | Accuracy by target, unaided recall, next weak target |
| **Build team skill** | “Practice the behaviors that make a team reliable.” | Captain call, scribe handoff, discussion sprint, challenge check | Role completion, decision quality, composure; no official rank |
| **Prove readiness** | “See whether you can sustain PBE conditions.” | 10-question checkpoint, 45-question half mock, 90-question full mock | Point-band accuracy, readiness dimensions, finalized/provisional state |

The current untimed PBE Practice should remain the default first lane. A timed 10-question run should be labeled a checkpoint, not a competition. The 45/90 runs should be labeled mock rounds and should show the official timing/intermission rules only when the product has enough published content to support them.

### Exercise catalogue

| Exercise | Phase | PBE fidelity | Implementation note |
| --- | --- | --- | --- |
| Short-answer recall | Existing | High | Keep typed answer and multi-part scoring. Add a visible “Factual recall” skill tag. |
| List / ordered response | Existing | High | Explain whether order matters before the learner starts. Teach “no extra answers” in feedback. |
| Exact-word quote | Existing | High | Keep strict word/order grading. Display exact-word expectations before the run. |
| True/false | Existing | Limited | Keep as a minority pattern; never let it dominate a bank or readiness score. |
| Reference → answer | Phase 1 | High | Existing source/reference fields can drive the prompt; expose the direction explicitly. |
| Answer → reference | Phase 1 | High | Useful for retrieval; return the source citation after grading. |
| Who / what / where / when | Phase 1 | High | A presentation template over `ShortAnswer` or `List`, not a new grading rule. |
| Verse continuation / sequence | Phase 1 | High | Map to `ExactWords` or an ordered list; show “continue from…” framing. |
| Book-introduction/context recall | Phase 1 | High | Use approved Commentary sources and the existing `sourceKind`/licensing controls. |
| Spot the extra or wrong answer | Phase 2 | Medium | Practice-only pattern that teaches the official “do not add extra answers” rule. |
| Read-twice response | Phase 2 | High | Presentation wrapper around an existing question; practice may offer replay, mock mode follows event rules. |
| Application/reflection card | Phase 2 | Purpose-aligned | Non-scored devotional reflection; never mix it into official point totals. |

Third-party PBE Quiz Engine patterns are useful inspiration for filters, sequential/random order, quiz size, blanking difficulty, language selection, and touch/keyboard shortcuts. They are not official NAD requirements and should not be copied as a source of truth. genui{"citation":{"ref":"turn334898462view4"}}

### Official-format guardrails

- Do not use multiple choice in an official-format mock. If a multiple-choice aid is ever added for learning, label it **Study aid — not PBE format**.
- Keep point values 1–8 and use the server’s rule profile for timing.
- Keep exact-word/fill-in questions strict about wording and order; normal answer spelling remains recognizable under the existing grading policy.
- Show a reference and source evidence after every answer.
- Keep assisted answers distinct from unaided recall.
- Never show a private practice score as an official placement or winner.
- Keep `Practice`, `Mock`, and `Official` visibly distinct in copy and analytics.

## Gamification proposal: PBE Readiness Path

### Readiness dimensions

Use seven explainable dimensions, calculated from real stored events only:

1. **Coverage** — assigned targets practiced at least once.
2. **Recall** — unaided points earned on assigned targets.
3. **Precision** — exact-word/list accuracy and avoidable extra answers.
4. **Reference** — ability to connect an answer to its source.
5. **Composure** — completion and accuracy across timed checkpoints; never award this for an abandoned run.
6. **Team** — role-drill completion and room-local contribution, never a fabricated team XP aggregate.
7. **Reflection** — optional application/context completion, not a competitive score.

Display a small “next action” card such as “Two reference targets are weak — run a 3-question repair,” rather than a generic “earn more XP” message. The next action must be derived from existing progress and have an empty-state explanation when data is unavailable.

### Progression names

These labels are intentionally separate from the global XP levels (`Seedling`, `Seeker`, `Reader`, `Keeper`, `Scribe`, `Scholar`, `Guide`, `Torchbearer`):

`Learner → Reader → Responder → Captain → Team Ready → Event Ready`

Do not overwrite the global level curve. The PBE path is a readiness badge/path, not another lifetime XP curve.

### Missions and patches

Daily mission sequence:

1. Read or review one assigned unit.
2. Complete five unaided recall answers.
3. Repair three weak targets.
4. Complete one role/team-skill sprint or one reflection card.

Suggested patches:

| Patch | Verified condition |
| --- | --- |
| **Coverage Complete** | All assigned targets have at least one eligible published practice question. |
| **First 45** | Complete a finalized 45-question mock with no interruption. |
| **Full 90** | Complete a finalized 90-question mock with the Q45 break. |
| **Zero Extra Answers** | Complete a practice set with no extra-answer grading misses. |
| **Scribe Ready** | Complete a verified scribe-handoff drill and one room-local contribution. |
| **Captain’s Call** | Complete a verified final-decision drill. |
| **Appeal Scholar** | Correctly identify which answer needs a challenge and why. |
| **Steady Under Time** | Meet the chosen readiness threshold across two completed checkpoints. |
| **Commentary Context** | Complete a source-context drill using an approved licensed source. |
| **Team Ready** | Finish the role rotation set; no public ranking implied. |

### Reward rules

- Keep current attempt XP values and the 300/day attempt cap unless product testing shows they are too low/high.
- Add small PBE patch/quest rewards through the existing single XP ledger; never create a second XP balance.
- Reward completion and improvement, not only perfect answers.
- Do not reward abandoned mock sessions as completed patches.
- Make every patch and XP write idempotent by a stable evidence key.
- For retries, reward a meaningful weak-area repair once per target/window rather than unlimited grind.
- Keep team momentum room-local and derived from finalized events.
- Keep exact scores private when mirroring the official convention that public competition emphasizes standings rather than publishing every team’s exact score. genui{"citation":{"ref":"turn334898462view0"}}

## Proposed UI behavior

The companion HTML mockup is a concrete, standalone visualization of this layout. It is not a production implementation.

1. **Hero:** “PBE Readiness” with global level/XP kept separate from a readiness bar.
2. **Today’s mission:** one deterministic next action, e.g. “Repair 2 reference targets.”
3. **Three run cards:** Build recall, Team skill lab, Prove readiness.
4. **Readiness bars:** Coverage, Recall, Precision, Composure, Team.
5. **Patch shelf:** earned and next-to-earn patches with exact conditions.
6. **Recent activity:** finalized/provisional labels, no invented winners.
7. **Mobile behavior:** one column, sticky primary action, no horizontal overflow at 320/390px.
8. **Dark mode:** use the existing design tokens; do not introduce a light-only visual language.

The primary button should never promise an unavailable learner-created competition room. In Student mode it should route to the assigned PBE drill or an existing saved session. If no published questions are available, the call-to-action should explain that the coach must publish coverage and offer Memory as the fallback.

## Implementation roadmap

### P0 — product contract and test data

- Define `Practice`, `Review`, `Checkpoint`, `MockHalf`, and `MockFull` as presentation modes over the existing PBE session contract. Keep `Simulation` separate.
- Define finality: `Practice` feedback is immediate; mock recap is provisional until any disputes are resolved; no official result is implied.
- Add a published PBE fixture with enough questions for 10/45/90 tests. Keep drafts excluded.
- Write the PBE readiness rules and patch conditions in the project wiki before implementation, per repository workflow.

### P1 — high-value solo experience

- Replace the single PBE entry panel with the three-lane Practice HQ composition shown in the mockup.
- Add the readiness hero and deterministic next-action card using existing progress/review/bests data.
- Add visible card skill labels and mode framing for the four existing question kinds.
- Add run presets: 3-question rescue, 8-question adaptive practice, 10-question checkpoint.
- Keep all new UI responsive and accessible; do not change the scoring authority.

### P1 — authoring and exercise depth

- Add presentation templates for reference retrieval, continuation, context, and list/ordered responses.
- Preserve the existing `PbeQuestion` schema unless a new grading rule requires a versioned schema change.
- Add authoring preview examples so coaches see how a learner will experience each kind.
- Add coverage warnings for targets with zero or only one published variant.

### P2 — team-skill practice

- Add solo role drills: captain final call, scribe handoff, discussion sprint, challenge identification.
- Add team-local progress and patch evidence only after a room/event is finalized.
- Do not add public winners, cross-team XP aggregates, or PvP balancing to this phase.

### P2 — readiness gamification

- Add patch shelf, readiness dimensions, weak-target repair quests, and “First 45 / Full 90” completion evidence.
- Route rewards through the existing XP ledger and idempotency guards.
- Add recap cards that explain improvement by skill, not only total XP.

### P3 — polish

- Read-twice audio/text presentation with accessibility controls.
- English/Spanish/French presentation where the licensed content and answer rules support it; the official resources list all three language tracks. genui{"citation":{"ref":"turn334898462view2"}}
- Optional reflection/application cards and coach-authored context notes.
- Keyboard/touch shortcuts and reduced-motion support.

## Acceptance criteria for the developer agent

### Product

- A student can identify the difference between solo Practice, Review, Checkpoint, Mock Half, and Mock Full before starting.
- The Practice HQ shows a deterministic next action or an honest empty-state explanation.
- At least five visibly distinct exercise patterns are available in the learner flow, while the server still validates the existing PBE kinds/rubrics.
- A learner can see progress in at least Coverage, Recall, Precision, and Composure without confusing those with global XP.
- A 45-question mock pauses at question 45; a 90-question mock supports the same official-format break.
- Official-format mocks do not use multiple choice and use the point-dependent response window.
- Assisted answers are visibly separate from unaided readiness.
- Reflection/application is non-scored and cannot change official point totals.

### Integrity and data

- Published heads only are eligible for learner sessions; unpublished drafts remain unavailable.
- Every reward is idempotent, ledger-backed, and tied to a stable evidence key.
- Abandoned sessions do not earn completion patches or full-run rewards.
- Team momentum is room-local and only uses finalized events.
- No winner, rank, or average is fabricated when the underlying data is missing or provisional.
- Dispute/review state is shown as `Provisional` vs `Finalized`.

### Engineering and QA

- Add focused web tests for lane entry, mode framing, card labels, empty bank, and mobile action behavior.
- Add native tests for each new selection/presentation rule, reward idempotency, 45/90 break handling, and fixture coverage.
- Run the existing focused PBE suite plus typechecks and lint.
- Test viewport widths 320, 390, and 1440px in dark and light themes.
- Update the project wiki before marking the work ready.

## Open product decisions

1. Is Phase 1 strictly solo Practice HQ, or should the first release include the lightweight team-skill lane?
2. Should the 10-question checkpoint use exact official timing, or a shorter coached timer before the learner unlocks full timing?
3. Should PBE readiness patches be personal only, or should selected team patches appear room-locally?
4. Which licensed source/context material may be displayed in reflection cards?
5. Are Spanish/French presentation and audio in the first release or a later phase?

## Public implementation handoff

- Repository audited: `https://github.com/Victor-CS-Core/Erudoza-BibleCompetition`
- Existing QA baseline: `Erudoza-Practice-Mode-QA-Handoff-2026-11-25.md`
- Companion mockup: see the separately published `Erudoza-PBE-Practice-HQ-Mockup-2026-11-25.html`.

## Research sources

- NAD About PBE: purpose, levels, study/coaching context. genui{"citation":{"ref":"turn334898462view1"}}
- NAD PBE Resources: current books, translations, commentary, guide, answer sheets. genui{"citation":{"ref":"turn334898462view2"}}
- NAD How-to Guide: 90-question format, point/timing rules, roles, intermission, challenges, grading. genui{"citation":{"ref":"turn334898462view0"}}
- NAD 2026 finals coverage: current 90-question/1–8-point/30–60-second event details and relative ranking context. genui{"citation":{"ref":"turn856270791search4"}}
- Official practice guidance: standalone short-answer questions, limited true/false, references, whole-book study. genui{"citation":{"ref":"turn856270791search8"}}
- Pathfinder Wiki requirements: memorization techniques, group review, mock competition, teamwork, sportsmanship, reflection. genui{"citation":{"ref":"turn334898462view3"}}
- Third-party PBE Quiz Engine: filters, blanking, order, language, and shortcut patterns used only as inspiration. genui{"citation":{"ref":"turn334898462view4"}}
