# PBE chapter projection and action contract

Design for D1/D2 implementation. This contract refines the approved PBE plan; it is not evidence of implemented projections or earned stamps. B4 is reviewed and pushed; D1 integration follows.

## Projection and stamp units

- **Stamp units remain actual Chapter and Introduction parents.** Chapter identity is `chapter:<contentPackId>:<bookKey>:<chapter>`; introduction identity remains exactly `intro:<contentPackId>`. Each parent is projected directly from distinct eligible targets and assigned sources, never by adding child totals.
- **D2 adds PassageGroup children, without separate stamps.** Split each chapter's assigned Scripture sources into contiguous verse runs, breaking at book/pack/chapter boundaries and excluded/unassigned gaps. Split a run of N verses into K=`ceil(N/5)` balanced consecutive groups: base=`floor(N/K)`, with one extra verse in the first N%K groups. Runs of 1–2 stay small; otherwise groups are 3–5 (6→3+3, 11→4+4+3). Never merge across a gap to reach a target size.
- Child key is `group:<parentChapterKey>:<firstSourceId>:<lastSourceId>` under a versioned grouping rule. The same assigned source set produces the same keys; changed boundaries generate new child keys without rewriting old parent stamps. Introductions remain separately labeled opaque-unit groups, without invented verse children.
- Compute both parent and child counters with the complete personally eligible assignment supplied separately from the group's sources. Fully assigned spanning targets/questions contribute in each intersected group; any excluded source disqualifies the whole target/question. Shared targets can appear in several child counters, so child percentages/counts are not additive.
- `ChapterProgress` remains the pure/internal counter contract. Public rows separate generic counters from kind/key/parent metadata. A parent stamp concerns its **assigned scope**; “Chapter retained” is allowed only when `wholeChapterAssigned === true` and current bank readiness is retained. Partial parents say “Assigned passages retained.” Group success says “Group retained”; none guarantees all possible exam questions.

## Exact compact public shapes

```ts
type ChapterCounts = Pick<ChapterProgress,
  'assignedPassages'|'questionCoveredPassages'|'totalTargets'|'practicedTargets'|
  'recalledTargets'|'retainedTargets'|'dueTargets'|'missingVariantTargets'>;
type ProgressAction = { mode:'Practice'|'Review'; label:string;
  progressScope:{ key:string; scopeVersion:string } };
type StampSummary = { stampId:string; chapterKey:string; kind:'Chapter'|'Introduction';
  label:string; scopeLabel:string; scopeVersion:string; ruleVersion:string;
  earnedAtUtc:string; matchesCurrentScope:boolean|null };
type ProgressRow = { key:string; parentChapterKey:string|null;
  kind:'Chapter'|'PassageGroup'|'Introduction'; label:string; scopeLabel:string;
  contentPackId:string; bookKey:string; chapter:number|null;
  wholeChapterAssigned:boolean|null; counts:ChapterCounts;
  currentReadiness:'Retained'|'Incomplete'|'Updating';
  stamp:StampSummary|null; hasHistoricalStamps:boolean; actions:ProgressAction[] };
type ChapterWork = { id:string|null; state:'NotStarted'|'Working'|'Complete'|'Blocked';
  stage:'Indexing'|'Replaying'|'Projecting'|'Cleanup'|null;
  reason:'PbeDisabled'|'SeasonClosed'|'NoAssignment'|'DataGap'|
    'ScopeTooLarge'|'InputTooLarge'|null };
type ChapterPage = { seasonId:string; ruleVersion:string; scopeVersion:string|null;
  snapshotId:string|null; chapterKey:string|null; work:ChapterWork;
  currentAvailable:boolean; historyAvailable:boolean;
  asOfUtc:string|null; dueRefreshAtUtc:string|null; nextCursor:string|null } & (
  {view:'Chapters'|'Groups'; items:ProgressRow[]} |
  {view:'Stamps'; items:StampSummary[]});
type ContinueChaptersRequest = {seasonId:string; workId?:string};
type ContinueChaptersResponse = {seasonId:string; scopeVersion:string|null;
  work:ChapterWork; next:'Continue'|'Reload'|'None'};
```

`counts.assignedPassages` means approved units for an Introduction; UI renders “introduction units,” not verses. Group rows have `stamp:null`, `hasHistoricalStamps:false`, `wholeChapterAssigned:null`. Parent chapter `wholeChapterAssigned` is verified against the canonical chapter inventory, not inferred from covered question count; unknown inventory uses false. No raw sources, answers, peer data, attempt IDs or witness pages appear in these DTOs.

## GET, first POST, pagination and freshness

- GET `/api/v1/progress/me/chapters?seasonId=...&view=Chapters|Groups|Stamps&chapterKey=...&after=...&limit=...`; default view=Chapters and limit=32. Groups requires a current parent chapter key; Stamps optionally filters a chapter/intro key. Chapters lists parents plus introductions; Groups lists that chapter's PassageGroup children; Stamps lists owned dated summaries, including the matching scope where applicable.
- `limit` must be 1–32; also stop before the approved 64-KiB response budget. Use flat rows, never unbounded nested children or stamp arrays. Stable ordering follows source/book/chapter/group order (opaque key tie-break); stamps use a stable indexed identity order. Readiness cursors bind owner/tenant/season/view/parent and snapshot. Changed scope/snapshot returns 409 `PBE_CHAPTER_CURSOR_STALE`; the client reloads page one rather than mixing generations. Stamps cursors bind ownership/view/parent/last immutable stamp identity and do not depend on current PBE admission; new stamps become discoverable on refresh. No target-ID list is transported in a row.
- GET is read-only: it discovers current published rows, historical summaries and the existing owned work item. Without one, return `work={id:null,state:'NotStarted',stage:null,reason:null}`, no current rows and null snapshot/as-of. GET does not create work or award stamps.
- POST `/api/v1/progress/me/chapters/continue` **without workId** atomically creates or finds this student/season's active work, then performs at most one capped step. Repeated initial POSTs converge on the same work ID. With workId, reauthorize and advance that owned generation only; a replaced/stale ID returns 409 `PBE_CHAPTER_WORK_STALE` and the client reloads GET. Requests never carry source/target membership or stamp evidence.
- If prior work is Complete but its counters need refresh or inputs changed, bootstrap POST opens/reuses the next permitted generation instead of repeatedly returning that old completion. Reuse immutable bank membership only after its current-input proof passes. A still-current, fresh completed snapshot can simply return `next:'Reload'`; GET itself never creates the refresh generation.
- POST returns the small continuation response, not an incidental overview page. `next:'Continue'` permits another explicit capped step, `Reload` means GET can discover the completed/current result, and `None` means a surfaced block/no work. Lost responses retry the same work ID or bootstrap POST and recover committed progress. The D2 client may drive these finite continuation calls while its screen is active; no new background-worker promise is part of D1.
- `asOfUtc` is the trusted fixed counter-snapshot time; `dueRefreshAtUtc=min(asOfUtc+5 minutes, earliest scheduled future due time in the snapshot)`. Missing future due uses the five-minute ceiling. Five minutes is the proposed UI refresh cadence, not a retention-rule change.
- When that time passes, D2 labels due counts “as of …” and requests refresh; it cannot call an old number “due now.” Evidence/scope invalidation changes currentReadiness to Updating and clears current claim/action metadata until the relevant current inputs are verified. A timestamp alone does not prove scope or grade consistency.
- A slow rebuild may finish with due freshness already expired; expose that fact and schedule the next refresh without withholding a correctly guarded stamp. Due freshness alone does not invalidate retained proof or an earned date. Start always recomputes actual due/repair eligibility at trusted server time and may return existing `PBE_NOTHING_DUE`.

## Practice actions: D1 lookup now, D2 start integration later

Observed source: native `pbe/sessions.ts:startPbeSession` supports chapter and targetIds, but chapter narrows sources **before** `loadFromResolvedSources`; targetIds without chapter loads the full assignment then filters questions. `src/api/client.ts:api.startSession` currently exposes neither filter. `src/api/training.ts` uses the `/api/v1/progress/me/*` family.

- D1 supplies stable owned key→complete target-ID membership lookup from its guarded manifest, scopeVersion and at most two action descriptors per row. A published bank can support Practice despite incomplete coverage; Review appears only for currently known due/repair work. Its label may be “Comeback practice” when B1 repair is the next action; keep B1's selection/interleaving rules, not an independent remediation algorithm.
- D2 extends the public start client with an optional PBE selection object (existing chapter/targetIds plus new progressScope), serialized into the existing POST `/api/v1/study/sessions`; legacy Memory callers remain compatible. No second session-start endpoint or stored action-token table is required.
- D2's small new server input is `progressScope:{key,scopeVersion}`, mutually exclusive with explicit chapter/targetIds and valid only for Pbe. Resolve the owned manifest key, check current personal authorization/scope, load the **full eligible assignment**, then reuse the existing internal targetIds question predicate. Never pass the chapter narrowing filter for these actions. This preserves assigned cross-chapter/cross-group questions even when practicing one small group or parent.
- The start selector is an intent, never authority: reject stale scope/unknown key, revoked sources or a changed current bank; never trust client labels or target membership. If a selected question also covers another currently assigned group, present that ordinary question honestly. No out-of-assignment material enters selection.
- Include progressScope in the immutable start-payload/idempotency comparison. D2 creates/reuses `training.clientStartId` per deliberate action and preserves season/mode/selector on retry. Do not attach an unrelated daily mission ID or claim this action resumes its saved session.
- D1 need not implement the UI or change session start during its integration gate; native/canonical D2 owners add that selector and client forwarding after D1's stable lookup/DTO contract is accepted. Keeping target IDs inside the manifest satisfies introduction/group targeting without overflowing bounded GET/start payloads.

## Current claims versus dated keepsakes and admission

- A row's `stamp` is only an actually persisted stamp matching current scope/rule; it stays dated even if a later wrong answer/correction makes `currentReadiness:'Incomplete'`. It never establishes present readiness by itself. Stamps view retains older scopes/rules; `matchesCurrentScope` is null when no current authorized scope is available.
- If only new PBE admission is disabled, GET Stamps remains available to the active owning student under organization/ownership authorization. Current-view GET reports `currentAvailable:false`, Blocked/PbeDisabled and no new-claim/action rows; it can still advertise `historyAvailable`. Closed seasons behave similarly. POST continuation cannot start/resume award work on disabled/closed scope.
- Historical access exposes only owned stamp summaries and prior scope labels, never source text, question/rubric data, peer witnesses or a practice selector that reopens revoked material. Missing current competition assignment does not fabricate current scope; account/organization authorization failures remain 403. Existing already-created session continuation follows its separate accepted B2/C3 policy.
- Native/canonical tests should cover true parent vs nonadditive child counts, 1/2/6/11-verse runs and gaps, partial-chapter labels, intro units, bootstrap races, stale page/work cursors, expired due snapshots, matching-but-no-longer-ready stamps, disabled-admission history, and D2's full-assignment scoped-start/idempotent selector behavior.

The D1 implementation supplies projection/replay persistence and compact lookup/DTO contracts. D2 implements the UI and progressScope session/client integration. Existing global PBE rules, source eligibility, original timing, permanent Honors and immutable historical evidence remain binding.


## Atomic input validation and operating bounds

Reuse existing per-target C3 dirty generations/revisions. Build immutable input manifests in bounded pages and validate exact current source, personal assignment, bank candidate and target-projection sets inside final publication, including new/deleted rows and expected absences. Native uses the existing atomic/set-guard pattern with server-created manifest pages; final SQL joins those pages instead of binding an unbounded guard array. Canonical typed content/assignment entities have no Revision field; compare their actual semantic sets within the existing serializable transaction. A hash checked outside that transaction is insufficient. No new global owner/curriculum epoch or authoring-writer hooks are required by this design.

One normalized C3 evidence page must advance both scheduling and resumable retention state. Retention keeps deterministic qualifying attempt witnesses and respects original acceptance order, response-lock time, wrong-recall reset and Pending barriers. Do not create a second chronology scan or derive retention from a schedule interval. Direct append and correction completion must preserve both projections' validity atomically. A verified untouched target can be empty; missing required provenance remains incomplete.

D1-only limits are 5,000 Scripture and 10,000 combined eligible source units; 10,000 raw targets and current heads each; 10,000 assignment inputs per family. Metadata processing is at most 128 rows and 64KiB UTF-8 per manifest page, 16MiB total staged input per work generation, with at most one active and one abandoned unstamped generation. Stop explicitly before exceeding a limit; never truncate into an earned claim. These are new readiness limits, not reductions in existing question/answer admission. Bounded cleanup may remove only unreferenced unstamped staging; historical stamps/proofs remain immutable.

Final exact-set validation may read the whole capped relevant metadata set in one transaction. It is not a constant-cost 128-row operation. Measure its complete authenticated statement count (at most 50), rows, bytes and runtime; a single statement does not prove low cost. No room/source history scan, duplicate full bank/source-text archive, or broad garbage collector belongs in this work. Available-provider race checks and SQL Server script/source checks must be reported separately from actual SQL Server execution.


## Out-of-order delivery and qualifying witnesses

Replay resets and Pending barriers remain in original accepted-sequence order. Within the successes after the last wrong-recall reset, two different question IDs qualify when their original trusted response times differ by at least 172,800,000ms, regardless of which outbox delivery was accepted first. For example, a correct response locked at day2 and accepted first, then a different correct response locked at day0 and accepted second, establish the same real two-day separation; delivery time itself grants no credit. A one-millisecond-short gap still fails.

The bounded fold therefore retains the earliest two and latest two success witnesses with distinct question IDs in each extreme set (at most four candidates), rather than only earliest witnesses. Compare original times, choose deterministic ties by accepted sequence/normalized identity, and preserve the first qualifying pair encountered until a later wrong recall clears it. The public array helpers wrap this same fold. Test both delivery orders and page splits in native and canonical code.

## Bounded witness staging

Stage qualifying attempt witness pages before the final stamp transaction, under immutable generation-qualified identities and the same128-row/64KiB page bounds. A final atomic stamp record seals and references the verified generation/family/page count/aggregate hash while checking exact current membership and saved retention witnesses. Never create an unbounded number of proof rows in the final transaction. Concurrent generations cannot overwrite a shared future stamp proof key. Cleanup must preserve every page referenced by an earned stamp, even if its originating work generation is later abandoned. Unreferenced unstamped staging remains subject to the existing bounded cleanup policy.

The generation's 16-MiB staging total includes the serialized UTF-8 payload of every new input/manifest and witness page. Charge each page atomically with its insertion and cursor advance; retries cannot charge it twice. Keep that charge after a page becomes stamp-owned, without refunds within the generation. Exceeding the total returns `InputTooLarge` before writing the new page and preserves all previously sealed proof pages. Per-page bounds do not replace this total budget.
