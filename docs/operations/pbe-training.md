# PBE training release operations

Status: preparation in progress, not a ready-to-run release procedure. Source through C3 is reviewed and pushed at `88b14d78cc98377a1aba932f827d87cbe8895787`; B4 inline missing-word answers, chapter progress and final integration remain open. No PBE deployment, production migration, import or real-user pilot has run for this goal. The [implementation evidence](../audits/2026-09-12-pbe-implementation.md) and [progress log](../../PROGRESS.md) distinguish local checks from pushed source and live releases.

Use this document with the [Cloudflare native operations](cloudflare-native.md) and [Team Practice operations](pvp.md). The latter's speed-bonus and restart descriptions belong to historical Arcade behavior. New PBE rehearsals use the saved PBE profile described below; never reinterpret an existing match through a current default.

## Cohort and content record

Before enabling a real cohort, record its organization and season, coach-selected books, each student's assignment, source edition, any approved commentary introductions, question-bank version/coverage, and applicable division or conference rules. Preserve the existing selections. Do not infer the active season from synthetic Daniel fixtures or replace it with the books listed for a different year.

The [official NAD resource page](https://nadpbe.org/pbe-resources/) linked the [2023–24 guide](https://nadpbe.org/wp-content/uploads/2023/11/How-to-Bible-Experience-2023-24.pdf) when checked September 12, 2026. Recheck it and conference variations before cohort rollout. The app follows that identified baseline; it does not claim official certification or predict official placing from an app score.

Validate the actual published bank through the coach tools. Solo practice stays within each student's assignment. Team rehearsal uses approved season material through private room access. Full rehearsal needs 90 distinct eligible questions and a compatible unused reserve, with the configured question-mix caps; a short bank must show its actual capacity. Separately approved introduction sources must retain their real source IDs and review status. Synthetic fixtures and unreleased official event questions are not a production bank.

## Release manifest and local gate

Complete the following manifest from the final reviewed checkpoint before preparing a deployment command:

| Required field | Current state |
|---|---|
| Exact reviewed release commit and pushed remote readback | C3 source reviewed through `88b14d7`; B4/D integration and final review remain pending |
| Ordered native migration names and hashes | `0005_pbe_training.sql` exists; C3 adds `0006_practice_room_components.sql`, reviewed at C3; final hashes/inventory pending |
| Worker artifact hash, compatible configuration and DO migrations | Additive `v3-pbe-solo` exists in source; final build/config verification pending |
| Canonical EF migration and populated conversion mapping | `20260912021321_PbeTrainingRecords`; B4 slot-answer migration and final C3/D record mapping pending |
| Populated local restore, native resume and original retry proof | Pending D3 |
| Full native/canonical tests, types, lint, formatting, builds and browser results | Pending final integrated gate; earlier task results remain in the audit |
| Six/twelve-student full rehearsal and local load measurements | Native and canonical 90-question tests pass locally; C3 source review passed. Native chat p95 across 10 rooms with 60/120 actors missed the 500ms target (3.57/9.08s); live cohort capacity remains unverified |
| Selected cohort bank and applicable rules approval | Requires real-world cohort coordination |

Run the exact final check sequence in [Task D3](../superpowers/plans/2026-09-12-pbe-chapter-progress.md). A skipped optional load case, pure state-engine test or frontend build does not establish hosted capacity, an HTTP flow or native type safety. Preserve test environment adjustments and their limits in the result record. Keep fixture databases, screenshots, credentials and raw test logs outside Git and public assets.

Before enabling a cohort, assess its actual bank, expected answer sizes and retained room history against the available storage. The C3 stress fixture retained/uploaded about 16.35 times its current authority payload because historical metadata components are retained; it does not establish typical usage or season capacity. A separate ordinary short-answer one-team full90 fixture retained17,086,239localDOcomponent payload bytes; this overhead is not limited to maximum-length answers. The measured local latency target is also unmet. These limits remain part of rollout assessment.

## Backup and authority drain

Record the current deployed Worker version, bindings, migration state and compatible rollback artifact before any authorized change. Take a private verified backup using the established procedure. Do not infer a complete backup from D1 alone: accepted timed answers may still reside in a room or solo Durable Object with pending projection. Native room state/outbox and solo timing authority, plus canonical full state and pending delivery records, are separate from read projections.

For a controlled drain, stop new PBE admission for the chosen season while permitting compatible active sessions to finish. The organization-wide Team Practice switch is a broader control and can block room operations; it is not interchangeable with a new-session admission switch. Observe active sessions, rooms and pending outboxes through the final supported inventory procedure. That procedure and the final storage manifest checks still require D3 implementation and verification. Do not substitute direct JSON edits, restart an armed clock to force completion, or call a D1 export a successful authority drain.

If an active timed authority is lost, the supported recovery settles trustworthy saved responses or retains an interrupted result with restart. It must not reopen an expired answer window. Preserve original response-lock time, attempt/command identities and acceptance sequence during drain, backup and restore. Later projection or coach review is not a new retrieval.

## Populated conversion and restore

The existing SQL exporter retains a 100KB statement guard. Parameter binding is required for larger supported rows, but D1 still has a [2MB row/string/BLOB limit](https://developers.cloudflare.com/d1/platform/limits/). C3's bounded native room format and connection-probe fix are locally verified and source-reviewed, and D3's importer is pending; there is no approved command here for importing the new populated PBE release yet.

The final procedure must validate an entire private export bundle before writing to an isolated, fully migrated, offline destination. Pin its manifest digest, source/mapping version, ordered migration hashes and destination identity. Resume only that exact bundle with byte-for-byte readback. A lost acknowledgement requires readback before retry; a conflicting existing identity must stop rather than overwrite history. A partial destination is not ready to serve users.

Preserve `PbeTrainingRecords` composite source identities, revisions, season flags, immutable question/rubric and session snapshots, dictionary keys, original attempts and response locks, review chronology, adjustments, projections and dated stamps. B4 also requires original indexed MissingWords answers and saved per-blank results in canonical `Attempt.AnswerPayloadJson` and native `answerPayload`; keep historical string-only answers and exact pending retries unchanged. Preserve every source archive row separately from its native operational projection. A source row exceeding one D1 row needs an explicitly versioned, lossless archive manifest and bounded chunks, or an explicit unsupported-conversion result with the complete backup retained. Do not silently omit data or weaken the SQL guard.

The accepted importer must prove native authenticated history, resume, retry, pending correction and projection recovery from actual populated fixtures. Archived rows and matching counts alone cannot establish those behaviors. This is one-way conversion; switching back to a legacy host without reconciling newer native attempts is not a safe rollback.

## Authorized rollout and rollback

After the local gate and separate deployment authorization, use the reviewed deployment-specific configuration and private backup. Retain feature defaults off until the chosen cohort is ready. Apply only reviewed additive migrations and the exact verified build, then read back the active version and bindings. Run separate public and authorized authenticated smoke checks for start, answer, finish, replay, original-result preservation and privacy. Record which actions actually ran; no real invitations or messages are implied.

For a functional rollback, disable new PBE starts while retaining a compatible build that can finish existing v2 sessions and read the final room storage format. Keep additive schema, original evidence, earned Honors and dated stamps. Do not roll back to code unable to read saved versions or discard post-release attempts. A security or correctness incident may require a broader stop, but document its effect on active rooms and preserve their evidence.

## Student availability and pilot evidence

Ordinary practice and independent teams must start, finish and replay without a coach online. Automatic grading uses the frozen rubric; flags leave the original result visible and provisional, with later authorized per-part review. Pending disputes cannot block ordinary progression. Explicit coached rehearsal remains a separate selected mode. Participation and individual recall are separate evidence; collaborative team answers cannot prove an individual's retention.

Confirm readable text fallback, keyboard access and responsive coach/student screens at 1440/390/320 pixels. Actual speech support and biblical-name pronunciation require real supported devices; stubbed browser events cover only control flow. A coordinated learner pilot must measure first-attempt unaided recall after 48 hours and seven days and record its sample and limitations. Synthetic delayed answers prove bookkeeping, not learning effectiveness. Scheduling or contacting students/coaches requires separate real-world coordination.


Accepted C3 recovery mapping: `pbe-dispute-correction` stores durable unfinished Solo correction work under organization/kind/dispute ID, separate from immutable grade adjustments. The review queue must keep it discoverable after a lost resolve response or navigation, and guarded replay completion removes only its own finished work. D3 conversion must preserve these records and their revisions; restoring only resolved disputes or visible recap scores can strand scheduling updates. This note does not authorize a live import or cleanup.
