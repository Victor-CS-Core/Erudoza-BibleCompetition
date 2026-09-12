# PBE training alignment review

Reviewed September 11, 2026 (US/Eastern); local verification completed September 12 UTC. Application source matches `838a066`; task checkpoint at review start: `0b206bc`. Assessment and proposed acceptance criteria only. No application change, rules migration, or deployment.

Implementation planning: [four-phase PBE training plan](../superpowers/plans/2026-09-12-pbe-training.md). Plan tasks have not been executed.

## Conclusion and authority

Erudoza's existing study activities support memorization, but its solo Simulation and Team Practice modes do not yet reproduce PBE testing faithfully. The next replayability work must prioritize competition-relevant questions and grading. More varied word puzzles alone will not close that gap.

The baseline is the **NAD PBE How-to Guide 2023–24**, still linked by the [official resources page](https://nadpbe.org/pbe-resources/) on the review date. It is not a newly issued 2026–27 guide. A club using another division or a conference variation needs an explicitly identified rules profile. This assessment is not PBE certification.

The official page lists **Mark, 1 Peter, 2 Peter, 1 John, 2 John and 3 John** for 2026–27 and says that year's resources are forthcoming. Preserve the coach's selected season and assignment; the audit's Daniel fixtures do not identify the user's active season. A season may cover several books. [Official season resources](https://nadpbe.org/pbe-resources/).

## Official baseline

- English source: NKJV and the selected books' SDA Bible Commentary introductions; commentary supplies fewer than 10% of questions.
- Questions stand alone and supply references. Most expect a word or short phrase. Multiple choice is excluded; true/false is limited, with no numeric cap stated here.
- Direct quotations and blanks require exact words in order. Recognizable spelling is accepted. Only the requested number of answers counts; unwanted answers must be crossed out. Graders and an appeal panel adjudicate.
- Teams contain 2–6 students, with captain, scribe and non-playing coach. Training includes full-scope reading as well as specialist sections and scribe practice.
- Questions are read twice. Response time then runs 25–60 seconds for 1–8 points, increasing five seconds per point, with a ten-second warning.
- Events use 90 questions and a five-minute halfway break. Scores reward correct answers. Standings compare against the event's highest score: at least 90% first, at least 80% second, otherwise third. Exact team scores are not publicly announced.

Source: [NAD guide](https://nadpbe.org/wp-content/uploads/2023/11/How-to-Bible-Experience-2023-24.pdf), printed pages 6–9, 12–17. Accuracy-only rehearsal follows that scoring description; the existing Erudoza speed bonus is an application adaptation.

## Verified application gaps

| Area | Observed behavior and implication |
|---|---|
| Solo question format | Only five generators are registered. `ShortAnswer` has a mastery branch but no generator. Simulation still admits Verse Builder and Reference Match; the latter hides the reference. The existing mode cannot provide the principal factual-question practice. [Engine](../../apps/web/worker/native/study/engine.ts) |
| Solo scoring and timing | Simulation is ten cards, with normalized whole-answer correctness and a client-reported elapsed time. There is no enforced per-question response window or answer-part rubric. It does reject hints and disables multiple choice by default. A shorter practice set is useful, but its current behavior is insufficient for faithful rehearsal. [Routes](../../apps/web/worker/native/study/routes.ts), [student controls](../../apps/web/src/features/student/StudyPage.tsx) |
| Team scoring and judging | Published questions already support ShortAnswer, List, ExactWords, TrueFalse and partial credit. A correct one-point answer at five seconds earns 1.00 accuracy plus 0.20 speed. Matching accepts configured variants, not every recognizable spelling; a coach can adjudicate and record a reason. This provides reusable groundwork, but speed must not influence rehearsal results. [Scoring](../../apps/web/worker/native/practice/scoring.ts), [room state](../../apps/web/worker/native/practice/state.ts) |
| Coach dependency | Uncoached matches already grade and advance automatically, including when an answer is appealed. Coached matches require both answers to be resolved before advancing from review. Use the existing independent path as the default experience and reserve mandatory live review for explicitly selected coach-led rehearsal. [Room state](../../apps/web/worker/native/practice/state.ts) |
| Team response bounds | The room command rejects more answer fields than scoring parts, preventing extra submitted entries from earning credit. Keep that guard, and ensure authored rubrics accurately represent the number requested. |
| Team delivery | Room sizes stop at five. Uncoached presentation advances after a fixed 15 seconds without a twice-read completion gate. Coached presentation is manually advanced. Point-based timing and the 90-question halfway break already exist. Validation also allows point totals beyond the guide's published timing table; a faithful profile needs explicit handling rather than silently extrapolating. [Room state](../../apps/web/worker/native/practice/state.ts), [question validation](../../apps/web/worker/native/practice/scoring.ts) |
| Team replay selection | Published, in-scope latest question versions are sorted by ID; each new room takes the first requested count. An unchanged bank therefore repeats the same set and order, leaving later entries unused. The numeric 10% true/false cap is an Erudoza policy, not a verified official percentage. [Bank selection](../../apps/web/worker/native/practice/questions.ts), [room start](../../apps/web/worker/native/practice/state.ts) |
| Season coverage and readiness | Solo generation depends on exact verse text, so it cannot establish commentary preparation. Existing wording/reference Honors and passage mastery also do not establish factual-question coverage or event readiness. The [replayability audit](2026-09-11-training-replayability.md) measures these narrower forms of evidence. |

The existing [Team Practice operations guide](../operations/pvp.md) already describes head-to-head play and speed as adaptations. A PBE-oriented version label alone does not remove these differences.

## Recommended implementation order

1. **Deliver PBE questions in daily practice and review.** Reuse the coach-reviewed, source-backed question bank for solo as well as team training. Extend it with explicit knowledge targets, source kind, rubric and rules version. Focus on the student's assigned chapter ranges. Keep verse construction, reference games and optional recitation as learning aids; successful puzzle completion must not substitute for factual-answer evidence. A question bank must cover facts within a passage, not merely have one item per verse. Uncovered material needs a visible coach action.
2. **Make replay select knowledge that needs practice.** Choose weak and due targets, unseen questions and alternate formulations before recently mastered repeats. Save a seed and immutable question/rubric versions so resume is identical while a new session can differ. Different wording that asks the same fact is the same knowledge target. A recognition answer must not defer an unresolved recall failure. Use fresh questions in delayed checkpoints to measure transfer beyond memorizing a fixed answer list.
3. **Introduce an independent rehearsal profile.** Use rubric points without the arcade speed component. Preserve a versioned distinction from historical matches. Default to automatic grading and progression, with optional later coach review for disputes as described below. Start the server deadline after the automated twice-read presentation completes; coach-led presentation remains an explicit alternative. Retain short practice sets, with a separate full-length team rehearsal. Permit six students and rotate the scribe during training. Allow one team to rehearse without needing an opponent.
4. **Connect rewards to retained knowledge.** Chapter stamps should reflect fresh unaided PBE-format answers after a delay. Comeback quests should revisit missed facts and omitted answer parts. A cooperative season map can show specialist coverage and maintenance needs. Track solo evidence separately from team results, preserve earned Honors, and display the scope/date of readiness evidence. Neither personal percent-correct nor beating another app team predicts an official placing.

For full-season preparation, let coaches deliberately assign secondary/generalist coverage and approved commentary introductions alongside specialist chapters. Do not silently expand a student's assignment, replace selected content, or import unreleased event questions. Use independently authored practice questions and verified source editions.

## Accepted recommendation: independent play with optional review

The user approved adding this recommendation after identifying mandatory coach review as a dependency. Students should be able to start, finish and replay ordinary matches without an adult online. Coach-led rehearsal remains an optional mode for practicing the full event process. This is a practice-product decision; it does not replace official event graders.

- **Grade immediately using the prepared rubric.** Use source-verified accepted answers and answer-part points. Question-bank review happens before play, rather than requiring a coach to judge every response during a match. Preserve exact-word and order requirements for quotations and blanks. Accept configured factual-answer variants; ambiguous spelling must not silently equate different people, places or facts.
- **Give useful feedback at the reveal.** Show the submitted answer, expected answer, supporting passage and points by part. In PVP, reveal only after both teams have locked their answers or the response window closes, so one team's feedback cannot disclose the answer to the other.
- **Let students flag and continue.** A disputed answer enters a later-review queue without pausing the match, blocking completion or preventing another session. A coach can resolve it asynchronously with a reason. Keep the automatic result visible and mark disputed totals provisional until resolution; absence of a coach must not prevent further practice.
- **Preserve trustworthy progress.** Apply a later correction consistently to the match recap and any dependent evidence or awards. Keep unaffected training progress available. Scoring-dependent rewards may await resolution of the relevant dispute, without freezing unrelated rewards or the student's next activity.

## Acceptance gates

- A published sample bank spans short facts, multi-part lists and exact wording. Both solo and team delivery show the correct reference, hide keys until the appropriate reveal and apply identical versioned rubrics. Check omissions, duplicates, order, accepted variants, extra answers and coach-resolved spelling cases. Never infer that all near-spellings mean the same answer.
- Replaying with the same assignment and a sufficiently large bank reaches later questions and different knowledge targets. Resume returns the original card and rubric. Sparse banks expose coverage limits; altered prompts alone cannot manufacture mastery. Verify excluded ranges, season changes and multiple books.
- An early and a late correct answer inside the window earn equal rehearsal points; submissions beyond the deadline cannot gain points. Verify the documented timing table, presentation completion, warning, reconnects and concurrent submissions. Unsupported point values require a documented override or rejection in this profile.
- Complete and replay a full independent match with no coach connected. Flag a disputed answer mid-match and verify progression, completion, answer secrecy and clearly provisional disputed scores. Resolve it later and verify consistent recap/evidence updates without duplicate rewards or blocked unrelated practice.
- Also run the optional coached team rehearsal with six students, captain/scribe roles, rubric correction and the halfway break. Verify that historical arcade results retain their original scoring version and that short practice is clearly distinguished from a full event.
- Confirm delayed factual and exact-word recovery independently of recognition and reference games. Chapter coverage displays the actual assigned denominator and missing question coverage. Test coach/student desktop and phone flows, followed by a small coached student pilot; software tests cannot establish learning effectiveness.

## Verification evidence and limits

- Fresh focused tests: **24 passed in three files**, 312 ms. Command: `npm --workspace apps/web run test -- worker/native/study/engine.test.ts worker/native/practice/scoring.test.ts worker/native/practice/state.test.ts --maxWorkers=2`.
- Nine additional read-only behavioral probes passed against the actual native functions: generator eligibility, hidden Reference Match citation, timing-table parity, speed bonus, nine-point validation, six-student rejection, repeat bank selection, partial credit/spelling matching, and extra-answer rejection at the command boundary. Synthetic labels only; no student records or production writes. Harness/report remain ignored under `.local/pbe-standards/`.
- The initial probe used non-GUID command IDs and correctly failed validation. Fixture IDs were corrected before the final nine-check run; application code was unchanged.
- Official PDF text was downloaded and inspected locally after intermittent web extraction failures. No fresh authenticated live rehearsal or .NET execution occurred. This gate establishes findings and requirements, not an implemented fix or compliant deployment.
