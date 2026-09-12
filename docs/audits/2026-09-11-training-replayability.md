# Training replayability and chapter memorization

Date: September 11, 2026. Reviewed source: `6be36f0`, whose application files match deployed release source `838a066`. Scope: assessment and recommendations; no application change or deployment.

Implementation planning: [four-phase PBE training plan](../superpowers/plans/2026-09-12-pbe-training.md), including the accepted independent-grading decision. Plan tasks have not been executed.

## Assessment

Training has a useful repeatable foundation: assigned Scripture, five exercises, saved sessions, daily review and practice, weekly goals, passage progress, permanent Honors and profile rewards. Students can continue after completing the daily mission. The important next step is to make repeated practice cover the assigned material through PBE-style questions and then verify recall after a delay.

**PBE standards follow-up:** the current application is not yet a faithful competition rehearsal. The [official-rule crosswalk and revised priorities](2026-09-11-pbe-training-alignment.md) supersede any implication that reference guessing, verse construction, or speed rewards establish PBE readiness. They remain possible study aids. Short factual answers with references supplied, rubric points, and competition timing must drive rehearsal. This follow-up changes recommendations, not deployed behavior.

The current selector can repeatedly give a verse the same exercise. The scheduler can postpone a failed wording review after a correct recognition answer. Advanced exercise design also introduces avoidable repetition and excessive input work. These are material limitations for the goal of memorizing complete assigned chapters.

Daily reviews do improve the mix. A simulated four-week course reached both wording and reference evidence for every verse in Daniel 1. The findings do not mean all students inevitably get stuck, nor do synthetic correct answers demonstrate actual learning.

## Verification and limits

- Existing focused suite: **152 tests passed across 20 files**, covering native study, training, mastery Honors and student components. Command: `npm --workspace apps/web run test -- worker/native/study worker/native/training worker/native/mastery src/features/student --maxWorkers=2`.
- Additional audit probes use the native application and isolated Miniflare databases, synthetic users, representative NKJV Daniel assignments and stored canonical answers. Repeated-drill probes traverse HTTP authentication, session generation, submission and completion. The daily-course probe calls the real study handlers and database with a controlled clock and synthetic actor; it does not test browser or authentication behavior over 28 real days.
- Final audit probes: **6 passed**, including **98 completed sessions and 759 correct accepted answers**, plus a three-answer failed-recall/recognition sequence (**762 accepted answers total**). Command: `npm --workspace apps/web run test -- worker/native/study/replay-audit.test.ts --maxWorkers=1`; final run took 41.56 seconds. The temporary harness and reports are retained under ignored `.local/training-replayability/`; generated artifacts and Scripture excerpts are excluded from this checkpoint.
- A first extension of the probe mixed a future simulated training clock with a later wall-clock scenario for the same synthetic student. The saved monotonic training timestamp caused a harness assertion failure. Each scenario now receives its own runtime/database, and generated fixture identifiers are deterministic. A subsequent assertion also distinguished JavaScript negative zero from zero after rounding subsecond elapsed time; the measurement now normalizes an already-due delay to zero. These were harness corrections; the final six-probe run passed without an application patch.
- The live public homepage loaded through the in-app browser. Direct anonymous command-line homepage/health requests returned 403 from this environment. Authenticated production training, deployed asset hashes and real student usability were not reverified here.
- The .NET implementation was inspected for matching selection/generation/scoring rules. No .NET SDK is installed on this host, so no fresh .NET execution is claimed. Native tests include comparison with saved C# generator fixtures, which is not a fresh C# run.

## Measured replay outcomes

Every completed session below used correct canonical answers without hints. Counts describe software-generated evidence, not measured human memory. “Wording/reference evidence” means a positive score in that skill, not mastery.

| Scenario | Completed sessions | Correct answers | Verses with wording evidence | Verses with reference evidence |
|---|---:|---:|---:|---:|
| 8 verses, Standard, consecutive Practice | 16 | 128 | 2/8 | 0/8 |
| 8 verses, Advanced, consecutive Practice | 16 | 128 | 3/8 | 2/8 |
| 24 verses, Advanced, consecutive Practice | 12 | 96 | 7/24 | 6/24 |
| Daniel 1, Advanced, 28 daily missions | 54 | 407 | 21/21 | 21/21 |

The four-week course included 28 practice drills and 26 review sessions. It reached all 21 verses in both skills, with 16 marked `Mastered` by the current passage rule. This demonstrates the value of the daily review path while leaving room for a selector that responds directly to missing skills.

The targeted failure sequence was: wrong Missing Words on Daniel 1:1 → correct Verse Builder on Daniel 1:2 → correct multiple-choice Reference Match on Daniel 1:1. The final answer moved verse 1's review from immediately due to 48 hours later, while its wording score remained zero.

## Findings

### 1. High priority: repeated drills can leave skills unpracticed indefinitely

The selector balances **prompt-source exposure**, then chooses an activity using only the current session's activity counts. Every session starts with Missing Words, and ties use a fixed provider order. With an assignment containing eight verses, the eight-card drill returns to the same verse-to-activity mapping on each replay. Different session seeds shuffle content inside some exercises but do not solve this allocation problem.

In 16 consecutive all-correct Standard drills over Daniel 1:1–8, all 128 cards followed the same mapping: verses 1 and 6 received Missing Words; 2 and 7 received Verse Builder; 3 and 8 received Reference Match; 4 prompted What Comes Next; 5 received True/False. Only two verses gained wording evidence, and none gained reference evidence because these reference answers were choices.

The same Advanced experiment produced wording evidence on only three of eight verses and reference evidence on two. No verse gained both. Daniel 1:4 remained without its own accepted recall evidence: using it as the prompt for verse 5 correctly credits the answer verse, but the selector keeps counting verse 4 as exposed. A 24-verse Advanced assignment repeated three eight-card templates across 12 drills and showed the same allocation weakness.

**Recommendation:** select the passage and the tested knowledge together. Track accepted evidence and recent questions per passage; prioritize factual recall and question-specific wording across sessions. Rotate reference and sequence exercises as supporting study activities. Give weak or overdue knowledge explicit priority, while retaining coverage of new assigned content. Preserve deterministic generation and immutable cards after selection. Do not fabricate recall credit for recognition or for merely displaying a prompt.

Sources: [native selector](../../apps/web/worker/native/study/routes.ts), particularly lines 112–140; [activity chooser](../../apps/web/worker/native/study/engine.ts), line 29; [canonical StudyEngine](../../apps/api/src/Erudoza.Application/Study/StudyEngine.cs).

### 2. High priority: the review schedule does not distinguish failed recall from successful recognition

Every correct answer schedules its knowledge unit 48 hours later; every wrong answer makes it due immediately. The rule does not inspect which skill was tested, hints, past success, lapses, or how long the passage must be retained. A correct multiple-choice reference answer can therefore postpone a wording failure without the student recalling the missing words correctly.

Ordinary Practice sorts exposure count ahead of due status and has no explicit missed-answer repair queue. Daily mission completion records participation; an incorrect review counts toward completing the frozen review set while correctly remaining due. That effort/memory distinction is intentional and should remain visible.

**Recommendation:** keep scheduling evidence per skill, or at least preserve an unresolved recall failure until a comparable recall task succeeds. Add a brief repair attempt after intervening cards, followed by delayed retrieval on a later day. Expand intervals after successful unaided retrieval and shorten them after lapses. A proposed starting ladder such as 1, 3, 7 and 14 days needs validation with students and the season's competition date; these exact intervals are not established by this audit.

Sources: [native mastery and review functions](../../apps/web/worker/native/study/engine.ts), lines 48–49; [attempt persistence](../../apps/web/worker/native/study/routes.ts); [canonical mastery rules](../../apps/api/src/Erudoza.Domain/Study/ScaffoldMasteryRules.cs); [mission evidence](../../apps/web/worker/native/training/store.ts).

### 3. High priority for usability: Advanced Verse Builder can require hundreds of actions

Advanced divides a verse into individual words. The student can move each word only one position at a time with Up/Down. Daniel 1:2 has 47 whitespace-delimited words; 20 deterministic shuffles required 281–449 adjacent moves (median 375) even when the correct order was already known. Duplicate words were treated as interchangeable when calculating the minimum moves. This measures interface work, not observed student completion time.

**Recommendation:** retain phrase-sized chunks for long verses and offer tap-to-append or accessible direct-position movement. Keep full-verse typing available as an optional memorization exercise; advanced PBE rehearsal should use the answer length and rubric required by the question. Support keyboard and touch. Choose a maximum reasonable interaction count and test representative long verses on a phone before shipping.

Sources: [native Verse Builder generation](../../apps/web/worker/native/study/engine.ts), line 35; [student answer controls](../../apps/web/src/features/student/StudyPage.tsx), `ChallengeInput`; [canonical generator](../../apps/api/src/Erudoza.Domain/Study/VerseBuilderGenerator.cs).

### 4. Advanced Missing Words usually repeats the same cue pattern

Across 20 generated sessions for each of Daniel 1's 21 verses, 20 verses retained exactly the same hidden-word pattern. Advanced requests almost every token but only tokens longer than two characters are normally eligible. For many verses it therefore hides the entire eligible set on every replay, leaving the same short-word cues visible.

This is useful cued recall, but it is not an independent full-verse recall check. Current passage `Mastered` means exact wording at least 80 and recognition at least 70; it does not itself require delayed recall or reference mastery. Some newer Honors have stricter reference and delayed-retest criteria, which is a valuable existing distinction.

**Recommendation:** add a transparent progression from supported reading to varied gaps and unaided answers. Use full-verse recall when practicing a quotation or when the student chooses that memorization goal. Require delayed unaided PBE-format evidence for a separate rehearsal-readiness state. Preserve existing earned Honors and version any changed scoring criteria.

Sources: [native generation/scoring](../../apps/web/worker/native/study/engine.ts), lines 34 and 48; [canonical Missing Words](../../apps/api/src/Erudoza.Domain/Study/MissingWordsGenerator.cs); [mastery Honor evidence](../../apps/web/worker/native/mastery/solo-rules.ts).

### 5. Progression and rewards need a more attainable next action

Coach-set Foundation and Standard have exact-wording ceilings of 40 and 70. From zero, neither can reach the current `Mastered` threshold or the wording requirements of mastery Honors. There is no automatic progression to Advanced. This is a deliberate evidence safeguard, but students need an understandable route forward under coach control.

Several permanent Honors also have minimum assignment sizes: Exact Recall needs 12 passages, Reference Ready and Steady Study need 20, Chapter Strong needs at least 10 in one chapter, and Full Coverage needs 30. An otherwise complete shorter chapter cannot meet all these goals. These are fixed mastery criteria, not reasons to enlarge a student's assignment artificially.

Training HQ highlights old practice milestones, whereas profile-unlocking mastery Honors show requirements and earned/locked status without a live per-criterion progress counter. The passage journey lists chapters and scores but offers generic Practice/Review links rather than a practice action for a selected chapter or verse. Permanent Honor identity is per student/academy/key/version, so earning it again in another season does not create another unlock.

**Recommendation:** keep permanent Honors meaningful and add attainable chapter/season progress underneath them. Explain difficulty and assignment-size prerequisites, show what evidence is missing, and offer a relevant practice action. Let coaches approve advanced challenges or promotions. Do not silently relax existing award criteria.

Sources: [Honor catalog](../../apps/web/worker/native/mastery/catalog.ts); [Honor rules](../../apps/web/worker/native/mastery/solo-rules.ts); [HQ](../../apps/web/src/features/student/StudentHomePage.tsx); [Honors](../../apps/web/src/features/student/HonorsPage.tsx); [passage journey](../../apps/web/src/features/student/PassageJourney.tsx).

## Recommended game loop

Extend the existing Pathfinder journey and patch system with these mechanics, in order:

1. **Chapter expeditions.** Turn each assigned chapter into selectable groups of roughly three to five verses. Each group visibly progresses through practiced, recalled and retained. Use the exact assigned denominator when only part of a chapter is assigned; every assigned passage remains accessible.
2. **PBE chapter checkpoints.** Answer fresh, source-backed factual, list and exact-word questions from the assigned chapter, with references supplied. Give a dated chapter stamp after an unaided delayed retest, with a later maintenance challenge. Verse chains can support memorization, but do not replace this checkpoint. Never cross excluded or unassigned content.
3. **Comeback quests.** Offer a small “repair these two passages” activity after mistakes, highlight exactly what needs work, and reward later successful recall. Retrying should feel productive; errors should not erase the day's effort or existing patches.
4. **Focused daily choices.** Offer “review missed questions,” “practice exact words,” or “continue this chapter,” selected from actual missing evidence. Keep the daily workload bounded. Timed rehearsal should use the question's point-based response window and reward correct answer parts, with no early-answer bonus. Reference games remain optional study aids.
5. **Shared team expeditions and seasonal keepsakes.** Let each student contribute a bounded amount by retaining their own assigned passages. Award a team/season pennant alongside permanent mastery patches. Use personal improvement and cooperative goals so assignment size, typing speed and access to the app do not determine who matters most.

A concrete session could answer three due PBE-style questions, practice three new or weak knowledge targets, repair one earlier error, and finish with a fresh question testing transfer. This is a proposed short practice composition, not a full competition simulation or a rigid replacement for the existing eight-card rule. Measure effort and adjust for student ability.

The first implementation priority should be PBE question delivery and accurate rehearsal scoring, coupled with question coverage and review scheduling. Improve Verse Builder as a supporting study tool. Chapter expeditions and checkpoints then give those improvements a clear student-facing purpose. Additional currencies or more static badge art would add less value at this stage.

**Independent play is the default recommendation.** Automatically grade prepared answer rubrics and let students finish and replay without a coach online. Reveal answers and source evidence after responses are locked; disputed answers can be flagged for later review without stopping play. Coach-led rehearsal remains optional. See the [accepted grading and review recommendation](2026-09-11-pbe-training-alignment.md#accepted-recommendation-independent-play-with-optional-review) for feedback, spelling, provisional-score and correction requirements.

## Learning rationale and success measures

Repeated retrieval improved delayed recall in Karpicke and Roediger's vocabulary experiment; that supports keeping retrieval after initial success. It does not establish Erudoza's effectiveness for Bible memorization. [Original research](https://learninglab.psych.purdue.edu/downloads/2008/2008_Karpicke_Roediger_Science.pdf).

Cepeda and colleagues found that useful practice spacing depends on the intended retention interval. This supports revisiting the fixed two-day schedule, while leaving exact season-specific timing as a product hypothesis to test. [Original research](https://escholarship.org/content/qt0kp5q19x/qt0kp5q19x_noSplash_aedacd613d87c6d68878ac7ba09fdf0b.pdf).

Sailer and colleagues found that different game elements affected different motivational needs; their experiment supports connecting feedback, meaningful progress and team identity to a purpose. It does not show that adding badges alone guarantees learning. [Original research](https://doi.org/10.1016/j.chb.2016.12.033).

Evaluate changes using coverage of published knowledge targets across assigned passages, first-attempt unaided PBE question accuracy after 48 hours and seven days, rubric points earned, recovery of missed knowledge, session completion/return rates, and median actions/time per exercise. Track reference and sequence skill separately as study outcomes. Compare cohorts or a small coached pilot using the same passage scope and difficulty; record hints separately. Exercise count, a completed mission and a permanent Honor are useful evidence of different things and should not be treated as interchangeable measures of current chapter readiness.

## Next verification gates

- First satisfy the [PBE alignment acceptance gates](2026-09-11-pbe-training-alignment.md#acceptance-gates). Demonstrate relevant factual and exact-word question coverage across repeated sessions with assignment sizes 1, 2, 8, 16, 21, 24 and 100+, including uneven/excluded ranges. Test both prompt exposure and answer-target coverage; identify passages missing authored questions instead of overstating readiness.
- Demonstrate that recognition or hinted success cannot clear an unresolved unaided recall failure; test correct, wrong and partially completed review sessions across days.
- Exercise coach difficulty changes, short assignments, long verses, deterministic replay, immutable results and retained historical Honors in both runtimes.
- Check actual student/coach flows on desktop and phone, then run a small student pilot measuring delayed recall. Synthetic canonical answers only validate software behavior.

## User addition — September 12: answer in each blank

The user supplied a mobile Missing Words example in which the verse contains separate blanks but the answer is entered as comma-separated phrases in one textarea. Add inline fields at the frozen blank positions so students can see exactly where each answer belongs. Preserve that position through authoritative grading, including empty, adjacent and repeated-word slots; joining fields alone loses information and can mark a misplaced answer correct.

[Task B4](../superpowers/plans/2026-09-12-pbe-solo-replay.md#task-b4-type-directly-into-missing-word-blanks) covers accessible mobile/keyboard entry, post-submission per-blank feedback, native/canonical positional verification, immutable structured retries and unchanged historical string-only attempts. This is an added requirement and source-grounded plan, not an implemented or deployed fix.
