# Shared mastery Honor profiles — implementation plan

User request: earned achievement patches can be selected as profile images; Honors must be challenging and reward mastery rather than attendance/repetition; the same profile must represent the person everywhere, including PVP messages.

## Product and compatibility
- Add versioned, immutable mastery unlock evidence. Existing solo and PVP awards remain historical practice milestones, never silently promoted into avatar eligibility.
- Show the new mastery collection as Honors. Put existing participation/coverage awards in clearly labeled milestone/history disclosure. Daily goals and effort credit continue separately.
- Shared account Profile entry allows selecting an unlocked patch or resetting to initials. Use existing approved artwork; five new Team Honor designs remain pending separate approval/alpha preparation.
- Identity is looked up by user ID, not copied into chat history. Preserve Erudoza text brand, the approved PVP composition and stable mobile navigation.
- No hosted changes/deployment. Do not alter login/Me contracts.

## Paired API contract
- GET /api/v1/profile/me -> { userId, displayName, avatarHonorKey: string|null, honors: MasteryHonorOption[] }.
- MasteryHonorOption: { key, title, requirement, category: "Scripture"|"Team Practice", ruleVersion: "mastery-v1", earnedAtUtc: string|null }. Keys use solo: or team: prefix followed by existing artwork key.
- PUT /api/v1/profile/me/avatar with { honorKey: string|null }; returns the same self profile. Null restores initials. Reject unknown keys, legacy-only evidence, foreign-user awards; determine unlock identity on server.
- GET /api/v1/profile/identities?userId=GUID&userId=GUID... returns [{userId,avatarHonorKey:string|null}] only for authenticated same-organization identities. Cap 50 unique IDs; validate length/format; GETs stay read-only and reveal no new personal fields.
- Persist selected unlock ID/key/version internally, not arbitrary URLs. Immutable valid unlock survives later ordinary skill decline.
- Frontend per-identity React Query caching with batched requests; clear with existing auth cache boundary.

## Mastery criteria (same algorithms and strings on both backends)
Solo uses explicit skill scores, not weak existing Strong classification:
1. solo:exact-recall: Exact wording >=90 on 12 distinct assigned passages (advanced unaided recall).
2. solo:reference-ready: Reference >=90 on 20 distinct assigned passages.
3. solo:chapter-strong: at least10 assigned passages in one chapter; every assigned passage in that chapter has exact>=90/reference>=80/recognition>=80.
4. solo:full-coverage: at least30 assigned passages and every assigned passage meets that same mastery standard.
5. solo:steady-study:20 distinct passages meet mastery standard, then pass an unaided typed retest >=48h after first reaching the standard while retaining it. Use bounded per-passage proof; do not scan all attempts on avatar reads.
6. solo:review-complete:8 distinct due passages answered correctly on their first accepted attempt in a review without hints and meeting the mastery standard. Track certified passage IDs across review sessions; repetitions do not increase distinct count.

Team uses Completed resolved matches, accuracy excludes speed, manual scribe submissions only for personal proof; no chat/idle contribution unlocks:
1. team:first-fellowship:>=90% personal accuracy across10 distinct manually submitted questions.
2. team:team-steady:three matches each >=90% team accuracy, plus >=90% personal accuracy across30 distinct questions.
3. team:shared-scribe:>=95% personal accuracy across30 distinct questions/10 distinct passages.
4. team:team-precision:>=95% team accuracy across50 distinct questions/15 passages, plus >=90% personal accuracy across10 distinct questions.
5. team:rehearsal-complete:resolved coached90-question rehearsal with >=90% team accuracy, plus >=90% personal accuracy across10 distinct manual questions.
Deduplicate deterministically by latest completed match timestamp then room ID; never count repeats as additional questions. Snapshot qualifying question/source IDs, scores, submitter/manual status and match revisions.

## Ownership
- Native worker: new mastery ledger/proof/rules + profile routes, accepted-attempt/finalized-room hooks, focused boundary/authorization/read-budget tests.
- Canonical: matching entity/migration/services/endpoints/hooks/tests. Preserve existing legacy awards.
- Root: shared frontend profile API/cache/avatar/picker, account routes and identity placement, mastery-first Honors and legacy milestone labels, export/release compatibility, integration verification.
- PVP recovery worker: finish existing local responsive/motion verification, no profile edits.

## Verification
- Boundary/sample-size/dedup/hints/deadline/appeal tests; immutable legacy + mastery history; unauthorized selection and organization isolation; null reset and bounded batch queries.
- Paired profile API lifecycle + header/roster/chat consistency; selected artwork remains after reload; never expose locked choice by direct HTTP.
- Full appropriate frontend/native/.NET checks, both builds; actual local student/Coach responsive flow at1440/390/320 with safe-area/focus/reduced-motion; record exact limitations.
- Finish current PVP checkpoint evidence, then explicitly stage/commit/push verified task branch. No merge/deployment.
