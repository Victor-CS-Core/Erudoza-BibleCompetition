# Native study engine report

Implemented the five registered C# solo providers in `apps/web/worker/native/study/engine.ts`. The assessment's six-activity count is incorrect: dependency injection registers MissingWords, VerseBuilder, ReferenceMatch, WhatComesNext and TrueFalse. ShortAnswer exists as a mastery branch and practice question kind, with no solo generator/provider; no sixth activity was invented.

## Pure API

- `generateActivity(type: ActivityType, request: ActivityRequest): GeneratedActivity` creates payload and private answer key; caller supplies stable session/source GUIDs and sequence. It does not assign card IDs/timestamps or persist anything. Request carries sourceUnit, knowledgeUnitId, sessionId, sequence, difficulty, mode, ruleProfile, optional nextSourceUnit/nextKnowledgeUnitId/alternateSourceUnit/distractorCitations/usedActivityTypes/targetCardCount. Use eligibility first: the low-level generator intentionally permits generator fixtures such as advanced TrueFalse, while provider eligibility excludes it.
- `eligibleActivities(request): ActivityType[]` preserves DI order and restrictions; `chooseActivity(eligible, usedTypes, sequence): ActivityType | null` preserves first MissingWords and least-used/non-repeating rotation.
- `stableSeed(sourceGuid, sessionGuid, sequence): number` matches .NET GUID byte ordering and unchecked FNV arithmetic. `DotNetRandom(seed).next()` ports seeded System.Random's subtractive compatibility algorithm, including signed overflow. Stable OrderBy keys preserve tie order.
- `evaluateAnswer(submitted, canonical)` returns isCorrect, evaluationCode, normalizedSubmitted, normalizedCanonical, evaluatorVersion. Uses configured punctuation removal, invariant simple casing, .NET whitespace and exact ordered text equality. `EVALUATOR_VERSION = exact-text-v1`.
- `evaluateOrderedTokens(card, indices)` validates complete unique displayed token identities before joining/evaluating. Existing API remains joined-text grading: equal repeated words are interchangeable in that contract. Generated display indices remain unique even for repeated text.
- `applyMastery(current, isCorrect, hintsUsed, activityType, answerMode = ExactText, difficulty = 3): MasteryScores` preserves skill-only evidence, difficulty ceilings, hints, penalties and levels. `nextReview(nowIso, isCorrect)` returns two days later for success, now for failure. `MASTERY_VERSION = v2-skill-evidence`.
- `normalizeDifficulty(value)` maps Foundation/Standard/Advanced or 1/3/5 and rejects invalid values.
- `toCardDto(card, {id,sessionId,sequence,total}, source, showCitation=true, exposeDebug=false)` mirrors web DTO redaction and next-verse prompt assembly. Never expose the GeneratedActivity private answer key to the client.

## Verification

Tests were authored before implementation; first run failed because engine module was absent. Initial 9 tests passed after implementation. Then generated 15 fixtures (five generators x three difficulties) using the actual existing net10.0 Erudoza.Domain assembly from a temporary console project outside the repository. Committed-as-working-file fixture data is engine-csharp-fixtures.json. No .NET source or project was modified. Fixture comparison exposed signed-overflow mismatch in negative seeded Random; fixed with int32 arithmetic and all 15 payload/choice/answer comparisons pass. Tests also cover repeated-token identity, reversed/incomplete/duplicated answers, next-verse grading target, advanced exclusions, simulation cap, reference redaction, mastery ceilings, configured punctuation and .NET whitespace/casing.

`npm --workspace apps/web run test -- worker/native/study/engine.test.ts`: 11 tests pass. Standalone strict TypeScript check of engine passed before final whitespace refinement; parent native typecheck also passed the initial engine. No live Cloudflare execution or browser verification was performed by this bounded subtask. Persisted legacy cards must be used verbatim by session service; no regeneration/migration is performed here.

## Integration boundaries

Session service remains responsible for approved active assigned scope, exposure/due/specialist source selection, immutable card persistence, session lifecycle, one accepted attempt, idempotency/CAS and authorization. `knowledgeUnitId` in WhatComesNext targets the answer verse; `sourceUnitId` remains the prompt verse and `answerSourceUnitId` holds the next verse. RuleProfile snapshot loading belongs to caller. No AI or network dependencies exist in the engine.
