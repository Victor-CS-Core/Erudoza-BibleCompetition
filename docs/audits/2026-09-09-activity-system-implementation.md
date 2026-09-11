# Student-season training implementation

Implemented locally following approval of the September 9 activity audit. Existing training UI changes were preserved. No production deployment or production database change was performed.

Subsequent simplification: AI and generated-question capabilities were removed at the user's request. The approved Short Answer generation described below is historical; new sessions now use only the five deterministic activities. See [AI removal](2026-09-09-ai-removal.md).

## Coach and learner behavior

- The season assignment form offers Foundation, Standard and Advanced for each student. The roster shows the setting, and the coach can change it for future sessions.
- Difficulty belongs to the student-season membership, not the user globally or an individual assignment range. Additional ranges share that setting; omitted difficulty preserves an existing setting and defaults a new student-season membership to Standard.
- Sessions snapshot difficulty and competition rules. A subsequent coach change does not modify cards in that session.
- Students can choose among their assigned active seasons. The session URL identifies the saved session so refresh restores the current card, accepted feedback, or completed summary. Uncertain submissions retain the same ID and payload for retries.
- The final card offers Finish rather than an invalid Next request. Next-card failures retain accepted feedback and can be retried.

## Activity policy v1

| Format | Foundation | Standard | Advanced |
|---|---|---|---|
| Missing Words | One missing word | Several words, approximately a quarter of the verse | Most eligible key words hidden |
| Verse Builder | Four-word chunks | Two-word chunks | Individual words |
| Reference Match | Up to two valid choices | Up to four valid choices | Typed reference |
| What Comes Next | First four words outside simulation | Full next verse, first-word support outside simulation | Full next verse unaided |
| True/False | Short excerpt recognition | Full-passage recognition | Excluded |
| Approved Short Answer | Approved question matching level 1 | Matching level 3 | Matching level 5 |

Content length can limit available gaps or distractors. Reference Match falls back to typed input if a meaningful choice set is unavailable. What Comes Next is excluded from Review so each due target is scored directly. All formats obey simulation restrictions regardless of difficulty. Approved questions must match the season and difficulty, and every evidence passage must be within the student's eligible content. Previews in the coach form are illustrative examples, not a promise that every format is available for every assignment.

## Integrity and scoring

- One scored attempt per card is enforced with a filtered unique database index. Same-key payload collisions are rejected; retries or new keys for an answered card return its persisted result without awarding points again.
- Serializable transactions and bounded retries cover card generation, submission, completion and resume. Concurrent requests cannot reopen completed sessions or lose mastery updates across sessions.
- Scope is intersected with season exclusions, active content packs, non-retired source content and student assignments. Scope is checked again before drawing, resuming an unanswered card or accepting a new answer.
- Reference Match hides answer-bearing citations. What Comes Next retains separate prompt and answer sources and credits the next verse's sequence evidence.
- Passage selection exhausts the current cycle and balances persisted exposure across sessions instead of repeatedly selecting the first verse.
- Scoring version `v2-skill-evidence` distinguishes recognition, wording, reference, sequence and factual recall. Choice recognition does not earn exact-wording points. Hints do not earn exact credit. Foundation wording evidence is capped at 40, Standard at 70 and Advanced at 100; correct easier responses never lower an already higher score. Full mastery therefore requires advanced unaided recall evidence.
- Coach and student mastery totals count only current-algorithm Mastered states, not Strong or legacy scaffold totals. Review counts use eligible content. Historical duplicate attempts are excluded from aggregate counts.
- Legacy score rows are labeled. On their next attempt, mastery is rebuilt from preserved historical evidence under the new rules. Historical next-verse records without answer-source evidence are skipped rather than credited to the wrong passage. Historic attempts that lacked saved result snapshots cannot reconstruct their original response score; the first replay freezes the reconstructed response.

## Database upgrade

`DatabaseSchemaUpgrade.ApplyAsync` replaces startup EnsureCreated-only behavior. New databases record current migration history. An existing database without history is baselined only after checking all initial tables and columns, then migrations are applied.

The migration adds difficulty and session snapshots, answer-source IDs, persisted attempt results and the historical-duplicate marker. It preserves all attempts, flags later duplicates and adds the one-scored-attempt index. Existing difficulty defaults to Standard. Legacy sessions without original rule snapshots capture the rules available at upgrade time and are marked `v1-legacy-upgrade`; their original unrecorded policy cannot be recovered.

Back up an existing deployment before applying the upgrade. Duplicate student-season membership rows or schema drift require reconciliation; the upgrade must not silently delete those records. The upgrade has been tested with SQLite, including a database without migration history and repeated startup. SQL Server deployment/migration behavior has not been validated in this change.

## Validation evidence

Final automated results: **87 backend tests** (34 unit, 53 integration) and **116 frontend tests**, all passing: **203 total**.

Backend tests cover per-student/per-season independence, unchanged session snapshots, invalid/unauthorized difficulty changes, preserved settings across additional ranges, duplicate/concurrent scoring, concurrent next-card requests, session recovery/ownership, content scope, activity variety, question evidence, skill-specific scoring, coach coverage and SQLite upgrades.

Frontend component tests cover assignment settings, previews, per-season navigation, final-card completion, retry recovery, refresh recovery and legacy labeling. Type checking, lint and production build were run. Ten fixture-backed desktop/mobile browser views were checked, including difficulty changes and refresh.

A separate browser journey used the real local API with debug answers disabled and a dedicated synthetic database. It created and activated a Foundation season through the coach UI, saved learner attempts, refreshed accepted feedback, advanced and completed the session, restored the saved summary, changed the coach setting to Advanced, and confirmed that the old session remained Foundation while a new session used Advanced. No browser runtime errors were recorded.

Backend validation uses installed SDK 10.0.303 from an isolated working directory because the repository pins unavailable SDK 10.0.400. The repository SDK pin was not changed. Live model-generated question quality, production infrastructure, SQL Server and multi-host load testing were not exercised.

Local evidence: `apps/web/test-results/audit-runtime/backend-final.log`, `live-browser-results.json`, and `live-browser.mjs`; screenshots under `apps/web/test-results/training-ui`. These generated files are ignored by Git.
