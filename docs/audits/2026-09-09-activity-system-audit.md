# Erudoza feature and activity audit

Date: 2026-09-09. Scope: local working tree, including the uncommitted training UI. This is an audit and proposed design, not a claim that the defects below have been fixed or that student-specific difficulty is implemented. No production data was changed.

Implementation follow-up: the approved fixes and difficulty flow were subsequently implemented locally. See [implementation and validation](2026-09-09-activity-system-implementation.md). Findings below retain the original pre-fix evidence.

## Outcome

The existing flows have a useful tested foundation, but the activity system is not yet robust enough to trust its mastery totals. Coach-selected difficulty is missing from the assignment contract, persistence, and session configuration. The coach's requested setting belongs to one student in one season, and must apply consistently across that student's assignment ranges.

## Validation performed

| Check | Result | Limit |
|---|---|---|
| Backend unit suite | 24 passed | Existing assertions, not comprehensive behavioral coverage |
| Backend integration suite | 28 passed | Isolated SQLite and test authentication; not production database validation |
| Frontend suite | 105 passed across 20 files | Includes training UI; does not establish every live API journey |
| Additional live API probes | Five defects reproduced below | Loopback API on port 5081, separate feature-audit.db, synthetic seeded content |
| Earlier UI browser checks | Eight layouts and study interactions exercised | Intercepted API fixtures; not live server end-to-end coverage |

The backend suite ran with installed SDK 10.0.303 from an isolated working directory containing its own global.json. The repository pins 10.0.400, which is not installed. The repository pin was not modified. This does not validate the pinned SDK build. The live probes executed the built .NET 10 API DLL and enabled debug answers only on the isolated audit server so known-correct answers could be submitted. The reference-answer leak below concerns the normal citation field, independent of that debug option.

Commands: `dotnet test D:\dev\Erudoza\apps\api\Erudoza.sln --nologo --verbosity minimal` from `apps/web/test-results/audit-runtime`; `npm run test --workspace @erudoza/web`. Raw local probe evidence and script are in the ignored `apps/web/test-results/audit-runtime/probe-results.json` and `probe.mjs`.

## Findings

### P1: A card can award mastery more than once, including after session completion

**Reproduced over HTTP.** Submitting one correct Missing Words answer produced exact-wording score 18. Reusing the same client submission ID correctly returned the same attempt and score 18. Changing only the submission ID created a second attempt and score 36. After completing the session, a third submission was accepted and raised the score to 54. Completing again reported three correct attempts for the same card.

`StudySessionService.cs:84` deduplicates only on session plus client submission ID. There is no answered-card guard or completed-session guard before applying mastery; line 141 sets the session back to Active. `StudyPage.tsx:64` creates a new UUID for every mutation invocation, including retries after an uncertain response.

Required correction: define one scored attempt per card, enforce that invariant in the database, preserve the same submission ID across transport retries, reject new attempts on completed sessions, and make attempt creation plus mastery/review updates atomic. Replays of an already accepted submission should return the saved result without awarding anything. Define behavior for the same key used with a different payload. Test concurrent requests as well as sequential retries.

### P1: Excluded season content can be assigned and studied

**Reproduced over HTTP.** Created a season including Daniel 1:1–8 and excluding 1:5. Assigned only Daniel 1:5 to the student. Activation and session creation succeeded; the first challenge was Daniel 1:5.

`StudentStudyScopeService.cs:35` unions assignment ranges without intersecting the resolved competition scope. Assignment creation also needs validation against the season's authorized, available content.

Required correction: eligible content must be the intersection of organization content, active season scope after exclusions, and the student's assigned ranges. Apply the same scope to practice, review, simulation, question evidence, and progress counts. Reject invalid or wholly excluded assignments with a useful coach-facing explanation.

### P1: Reference Match reveals the correct answer

**Reproduced over HTTP.** A Reference Match card had both normal citation `Daniel 1:3` and answer `Daniel 1:3`. The learner view displays the normal citation above the question. This leak remains when debug answers are disabled.

`DtoMapper.cs:67` exposes the source citation whenever general mode rules permit it, without considering whether the citation is the answer.

Required correction: redact answer-bearing metadata from the pre-answer DTO for this activity. Reveal the reference after submission. Add a production-shaped DTO test with debug answers off.

### P1: Coach-selected difficulty does not exist end to end

**Confirmed by source inspection.** `StudyEngine.cs:135` passes level 1 for most cards and level 3 for the last card. CreateSeasonRequest, CreateAssignmentRequest, and StartSessionRequest have no coach difficulty setting. Most activity generators do not consume the request difficulty; Missing Words does.

Required correction: persist a student-season training profile and snapshot it at session creation. Each eligible provider must implement a defined difficulty contract or be excluded with a clear reason. Changing only a label or the number of cards is insufficient.

### P2: What Comes Next uses the wrong feedback source and mastery target

**Reproduced over HTTP; mastery target confirmed in source.** The activity prompted from Daniel 1:1, accepted the text of Daniel 1:2, then returned Daniel 1:1 as its feedback source. The provider retains the current verse's knowledge-unit ID, so submission also credits the current verse rather than distinguishing the sequence relationship and recalled next verse.

Required correction: model prompt evidence separately from answer evidence and scoring targets. Feedback should show the answer passage. Record sequence evidence deliberately; do not automatically grant exact recall mastery to the prompt passage.

### P2: Recognition tasks can manufacture exact-wording mastery

**Confirmed by source inspection.** `ScaffoldMasteryRules.cs:26` awards eight exact-wording points for every correct non-Missing-Words activity, including True/False and reference choices. Ten such correct answers can satisfy the Mastered threshold without exact verse recall. Reference, Sequence, and FactualRecall scores are not updated by these rules. `ProgressQueryService` also includes Strong in its MasteredCount, while the dashboard says “Verses mastered.”

Required correction: score demonstrated skills, distinguish choice recognition from unaided recall, account for hints, and report Strong separately from Mastered. Version the scoring algorithm; decide how historic scaffold scores are displayed or recalculated before changing production semantics.

### P2: Final-card navigation can strand the learner

**Confirmed by code path; not reproduced in a live browser during this audit.** The UI permits Next card after the last answer. It resets submission success before requesting another card; the engine rejects the request at the session target (`StudyEngine.cs:52`). Finish session also requires submission success, so that path can leave it disabled.

Required correction: replace Next with Finish on the final card; retain successful submission state if loading the next card fails; provide an explicit retry. Test the complete final-card journey and a network failure after an accepted answer.

### P2: Activity variety deteriorates once assigned passages have been used

**Observed in the live eight-card probe.** The first four cards covered Daniel 1:1–4. The remaining four all used Daniel 1:1. `StudyEngine.cs:95` falls back to the first knowledge unit once all have been used. The provider mix varies, but passage selection does not cycle fairly. New sessions also prioritize low ordinals rather than recent exposure across sessions.

Required correction: use a persisted, reproducible selection policy balancing review due dates, assignment priority, recent exposure, and least-used passages. Exhaust an eligible cycle before repeating a passage where possible; handle one-verse assignments honestly without promising uniqueness.

### P2: Season selection and review counts need assignment-aware filtering

**Confirmed by source inspection; scenario not exercised live.** Default student progress selects the latest active organization season rather than the latest season assigned to that student. Review session length counts all due records for the student and season rather than intersecting eligible assigned knowledge. Assignment changes can therefore yield an empty or misleading study entry point.

Required correction: list the student's assigned active seasons, let them select when needed, and derive due counts and session targets from the same eligible set the engine uses.

## Feature coverage and remaining verification

| Area | Evidence and outcome |
|---|---|
| Authentication and organization boundaries | Existing integration tests pass. Broad security review and production cookie configuration were not performed. |
| Student administration, content import, season setup | Existing integration tests pass; assignment/season scope intersection fails the additional probe. |
| Practice | Mixed activity generation works on synthetic content; answer leak, repetition, scoring and replay defects remain. |
| Review | Existing tests pass; assignment changes and due-queue exhaustion need new coverage. |
| Simulation | Existing rule/profile tests pass; full timed competition journey and difficulty interactions need coverage. |
| Progress and coach coverage | Endpoints are tested, but totals inherit duplicate-attempt and mastery semantics defects. |
| Generated questions and coach approval | Existing generation validation tests pass. Real model quality, availability and costs were not exercised. Engine selection needs a dedicated check that all question evidence belongs to the student's season and assignment. |
| Responsive training UI | Component tests and earlier fixture-based browser checks pass. Final-card completion and transport recovery remain gaps. |

No load test, parallel submission stress test, production database migration, deployment, live model generation, or exhaustive accessibility audit was performed.

## Proposed student-season difficulty design

This section describes recommended behavior, not existing functionality.

1. Coach creates the season, selects its rule profile and defines included/excluded content.
2. While assigning each student, coach selects that student's training difficulty alongside their passage ranges. One setting applies across that student's ranges within that season; another student or another season may have a different setting.
3. Coach previews representative eligible activities and any unavailable formats before activating the season. Insufficient content must be explained, never silently replaced with excluded passages.
4. Student opens an assigned season and chooses Practice, Review, or Simulation.
5. Server resolves allowed content and the student-season profile, then snapshots the difficulty policy/version and competition rules into the session. The student cannot override coach difficulty through the request body.
6. Engine selects an eligible passage and activity, persists the card, and returns only safe presentation fields.
7. A single accepted answer produces skill-specific evidence, feedback and a review due date. Retried requests return the existing result. Completion freezes the session.
8. Coach reviews results and can adjust the student's difficulty for future sessions. Existing sessions and previous results retain the policy under which they were created.

Suggested storage: extend an appropriate student-season membership/profile with a unique `(OrganizationId, SeasonId, StudentUserId)` key and an explicit enum plus policy version. Do not place difficulty on the user globally or independently on every assignment range. Add session snapshot fields. Introduce a reviewed migration/backfill; this project uses EnsureCreated locally, which does not upgrade existing schemas.

Suggested levels, pending product tuning:

| Activity | Foundation | Standard | Advanced |
|---|---|---|---|
| Missing Words | One word or short gap, optional clue | Several gaps, fewer clues | Longer phrase or multiple gaps, unaided |
| Verse Builder | Larger phrase chunks | Short phrase chunks | Individual words, where passage length is usable |
| Reference Match | Small valid choice set | Larger valid choice set | Typed book, chapter and verse |
| What Comes Next | Brief answer target with support | Full next verse with permitted support | Full next verse unaided |
| True/False | Recognition practice only | Recognition practice only | Limited warm-up or omitted; never evidence of exact recall |
| Approved Short Answer | Explicitly supported simple recall | More detailed recall | More demanding approved recall; evidence remains within assigned scope |

Competition simulation must honor the season's actual rule profile at every difficulty. A lower training difficulty must not enable choices, hints, references, or timing that the simulation profile prohibits. If a provider cannot satisfy both settings, use another eligible format or explain that no compatible activity is available.

## Implementation and release acceptance

Recommended sequence: fix scoring integrity and content boundaries first; add student-season configuration and migration; make providers difficulty-aware; complete learner recovery paths; then validate complete coach-to-student journeys.

- Two students in the same season receive different configured activity difficulty.
- One student in two seasons retains independent difficulty settings.
- Multiple assignment ranges for one student resolve to one season difficulty.
- Invalid difficulty values and student-side attempts to change difficulty are rejected server-side.
- Coach changes apply to new sessions; resume/retry uses the existing session snapshot.
- Every supported provider has deterministic examples at each level; repeated sessions show meaningful content variation.
- Excluded, unassigned, retired, and wrong-organization evidence cannot enter a card.
- Same-key retries, new-key resubmissions, parallel submissions, refresh and offline recovery cannot award points twice.
- New attempts cannot reopen completed sessions; final-card navigation reaches a saved summary.
- Choice recognition does not count as exact wording recall; reference and sequence activities update their intended skills.
- Simulation restrictions hold for every difficulty profile.
- Existing databases upgrade without deleting data; old sessions and scores remain interpretable.

The new difficulty system and these corrections remain implementation work after this audit.
