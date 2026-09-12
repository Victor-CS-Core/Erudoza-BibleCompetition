# PBE cooperative progress contract

Approved D2 design, September12,2026. **Not implemented or verified.** D2 implementation begins after D1 acceptance and consumes its final private interfaces. This refines the [chapter plan](../superpowers/plans/2026-09-12-pbe-chapter-progress.md) and [chapter contract](2026-09-12-pbe-chapter-contract.md). Preserve existing Memory coverage and permanent Honors.

## Product boundary

Provide a bounded season snapshot of independently recorded Solo progress: the union of material assigned to active student season members, the viewer’s own assigned-scope fraction, and the equal-weight mean of individual fractions. Never infer source readiness from target percentages, add overlapping child counters or credit collaborative Team answers as Solo recall. The snapshot grants no award.

Student team summaries expose numeric Scripture/Introduction totals and the viewer’s own contribution. Their chapter map remains their authorized own D1 view. Student identity/count breakdown belongs only on existing coach authorization boundaries. The UI can say “2 confirmed retained; 5 awaiting progress” for an incomplete check rather than presenting a speculative exact total. If displaying a percentage range, retain clear known/unknown labels; do not turn its upper bound into earned progress.

## Source evidence semantics

For active student i, A_i is the distinct, currently eligible personally assigned source set, including separately typed introduction units. Resolve A_i independently of whether D1 has ever built a generation; a missing generation must not erase assignments. Respect every existing season range, exclusion, licensing/provenance, personal assignment and membership rule. A source identity is the normalized tuple (source kind, content pack ID, source unit ID) within this organization/season, never a citation string or verse number alone. Different editions/packs do not collapse. Deduplicate repeated assignment rows before counting.

For s in A_i, T_i(s) contains every distinct declared eligible target whose entire source set lies within A_i and contains s, including targets with no question. Q_i contains valid current published questions wholly within A_i. A spanning question/target remains eligible only if all its sources are assigned; other personally assigned chapters are not filtered out. These are D1’s full-assignment rules.

Derive the following independently, not by rounding target ratios:

- **questionCovered:** at least one Q_i question contains s. Recognition questions may supply coverage.
- **practiced:** at least one t in T_i(s) has D1 Solo practiced evidence. This means “Solo practice reached this passage,” not that every target was practiced. Aided/recognition/pending Solo practice retains D1 participation semantics; Team evidence grants none.
- **recalled** (optional UI detail): T_i(s) is nonempty and every t has final current unaided Solo recalled status without a pending/data-gap barrier.
- **retained:** questionCovered, T_i(s) nonempty, and every t is retention-ready according to the accepted D1 fold and has at least two distinct currently eligible recall-question IDs for its skill. Respect ExactWords applicability and all pending/dirty/data-gap barriers. Current variants are a bank prerequisite; they do not reinterpret original attempt rubrics.
- **due:** any t has unresolved repair, or intervalIndex >= 0 and dueAt <= the aggregate’s trusted check time. An untouched initial target is not due. Export the minimum eligible scheduled due instant plus an unresolved bit from D1 so this can be evaluated at the aggregate check time without replay.

Use three-valued facts where input is unavailable. A known true existential predicate remains true despite another unknown target; a universal predicate is false if any known prerequisite fails, true only with all prerequisites known true, otherwise unknown. A verified untouched target is known false for practice/recall/retention; it is not missing evidence. Missing usable owner generation may conservatively make all that owner’s evidence facts unknown, while preserving A_i. This deliberately avoids partial-target reconstruction outside D1.

For each metric x, team union lower bound is the number of distinct s with at least one assigned student known x=true. Upper bound additionally counts s with no known true but at least one unknown assigned student. Known false for every assignee is false. Hence repeated work and overlapping assignments never inflate a source count. “Team retained coverage” means at least one assigned student independently meets the complete per-source retention rule; it does not mean every assignee is ready. “Passages with maintenance due” is the union where any assignee is due, so it can overlap retained coverage. Separate question coverage, participation and retention labels.

Return Scripture and Introduction metrics separately. Never combine intro counts into a verse percentage. Group the map by actual chapter / intro parent only, counted directly from distinct source facts; no sum of overlapping child counters. Student summaries need only overall typed totals, avoiding disclosure of unassigned peer chapter/source membership. The student’s own chapter map remains D1’s authorized own view; a coach may receive chapter aggregate rows.

For type k and a student with |A_i,k| > 0, personal retained proportion is [knownRetained_i,k / |A_i,k|, possibleRetained_i,k / |A_i,k|]. Own contribution shows this fraction and its counts; it is not a claimed exclusive share of the team union. Equal-weight team fraction is the arithmetic mean of those intervals, with every assigned student weighted once. Missing evidence contributes [0,1], never exclusion. Students with zero assigned units of that type are shown as unassigned and excluded only from that type’s ratio; zero total eligible denominator is null, never 100%. Return the included/unassigned/unknown-student counts. Equivalent intervals can support practiced/due if the UI needs them; retention is sufficient for the first release.

## Snapshot, stale and missing behavior

Capture exact roster and A_i before readiness. Roster is active organization users whose kind and role are Student, with valid season membership; exclude Adult personal practice. Include roster members with no assignment in an explicit unassigned count. Reconcile these predicates against current main at D3; do not copy Memory coverage’s historical assignment-driven loop.

A work generation fixes a bounded roster/assignment/source manifest. For each member, consume a completed accepted D1 generation only through the internal capability below. Snapshot readiness evidence must pass exact current D1 bank/source/assignment/target-projection guards at final aggregate publication. A timestamp or generation ID alone is insufficient. Missing, unfinished, blocked or invalid D1 generations become explicit unknown evidence for that member; capture the exact pointer/absence and current assignment inputs so later generation availability invalidates that aggregate rather than silently changing its interpretation. No automatic peer D1 replay or stamp creation is part of this map.

Final publication atomically checks all captured semantic sets (including inserted/deleted rows and expected absences), computes due against trusted publication check time, and publishes one immutable aggregate revision. Native uses a set guard over paged metadata; canonical uses its existing serializable transaction and typed semantic sets. Copy only required compact D1 guards and derived source facts into capped aggregate staging; do not pin unlimited abandoned D1 generations or archive source text, questions, answers or witnesses. If any owner input changed, that work cannot publish: return stale/reload and recapture; do not downgrade a just-failed guard to known false. A deliberately captured unavailable owner remains unknown.

GET is read-only and verifies the published aggregate’s exact current input guard before serving its numbers. A semantic change in roster, assignment, source provenance, bank, relevant evidence, correction state or captured generation availability makes the entire aggregate Updating, with no current counts/actions; page-one refresh starts a replacement. Do not blend generations or show removed-member contributions as current. Prior aggregates need not be publicly browseable. Historical D1 stamps remain separate.

At or beyond dueRefreshAtUtc = min(checkedAtUtc + 5 minutes, earliest future eligible due instant), unchanged evidence counts may remain visible with “Checked …; maintenance as of …”; due numbers cannot be called “due now.” UI requests continuation refresh. Retained proof does not expire just because time passed. Return Snapshot status for complete known facts and Provisional for any unknown portion; even Snapshot means checked evidence, not a guarantee about future exam performance. Intervals support exact known/possible coverage at that check only. A Provisional snapshot cannot support “everyone ready,” an exact team retained total, or a new award. Roster/assignment source capture failure cannot yield an unknown denominator: block aggregate construction explicitly instead.

## Exact compact API

```ts
type CountRange = { known: number; possible: number };
type MaterialSummary = { assigned: number; questionCovered: CountRange;
  practiced: CountRange; retained: CountRange; due: CountRange;
  equalRetained: { lower: number; upper: number; students: number;
    unknownStudents: number; unassignedStudents: number } | null };
type OwnMaterialSummary = { assigned:number; practiced:CountRange;
  retained:CountRange; due:CountRange };
type OwnSummary = { scripture:OwnMaterialSummary;
  introduction:OwnMaterialSummary; state:'Known'|'Unknown'|'Unassigned' };
type CooperationSnapshot = { seasonId:string; ruleVersion:string;
  scopeVersion:string|null; snapshotId:string|null;
  state:'NotStarted'|'Updating'|'Snapshot'|'Provisional'|'Blocked';
  reason:'PbeDisabled'|'SeasonClosed'|'ScopeTooLarge'|'InputTooLarge'|'DataGap'|null;
  checkedAtUtc:string|null; dueRefreshAtUtc:string|null;
  rosterStudents:number; unknownStudents:number;
  scripture:MaterialSummary|null; introduction:MaterialSummary|null;
  own:OwnSummary|null; work:{id:string|null;next:'Continue'|'Reload'|'None'} };
```

No target IDs, member IDs/names, source IDs, attempt IDs or answers appear in the student DTO. Ratios are 0–1 and nullable, with integer range numerators retained for accessible labels.

- GET `/api/v1/progress/me/pbe-cooperation?seasonId=...`: authorized student summary + own contribution. Verified season membership is mandatory. No studentId parameter.
- POST same path `/continue` with `{seasonId,workId?}`: reauthorize caller, atomically create/find shared tenant/season work or advance one capped step; initial retries converge. A student may advance aggregate-only work, not impersonate peers or mint their stamps. Lost response retries recover committed cursor state.
- GET `/api/v1/organizations/{orgId}/seasons/{seasonId}/pbe-cooperation`: same aggregate without a fabricated own student. Coach chapter rows can be a later paged view if needed.
- GET same coach-authorized path `/students?after=...&limit=...`: verified active same-organization Owner/Admin only; page of student identity, availability/reason and personal typed counts/fractions. Limit 1–32, response <=64 KiB; cursors bind caller authorization class, tenant/season and immutable snapshot. No raw evidence is needed even here. Coach continuation uses the same internal service under real caller identity via an coach-authorized `/continue` route.

GET state-changing input invalidation and continuation conflicts return explicit stale code (`PBE_COOPERATION_CURSOR_STALE` / `PBE_COOPERATION_WORK_STALE`, 409 where applicable). Closed/disabled scope gives no current aggregate work or detail. Cross-tenant access, inactive actors and unauthorized peer detail fail authorization. Internal readers accept a verified operation scope with actual caller plus subject ID; never rewrite RequestContext.actor or ICurrentUser.


Use the existing organization route and `CanManageSeason`/same-organization authorization conventions for coach endpoints; there is no new `/api/v1/admin` product route family. Both student and coach continuation may advance the same aggregate-only work under the actual caller’s authorization. They cannot impersonate peers, trigger their chronology replay or mint their personal stamps. Adult personal learning does not enter the student cohort union or mean.

## Bounded implementation

Build source facts once from accepted D1 eligible membership, variant and normalized target-retention inputs. Traverse eligible target-source edges once; do not run the whole chapter projector for every source, call each student’s public GET with a fake actor, or scan another retention chronology. Add the small internal source-fact and guard capability in D2 if D1 does not already expose it. It accepts a verified real operation scope plus explicit subject and returns compact typed identities/facts, minimum due time/repair bit, known/unavailable reason, and a bound snapshot/version cursor. No raw answers/witnesses or source text belongs in these aggregate facts.

Resolve roster and exact current assigned sources independently of published D1 generations, so missing generation does not remove a student or shrink a denominator. Reuse actual season membership records and shared active Student predicates, reconciling latest main at D3. Count introduction units separately. Source/roster capture failure blocks the aggregate; unknown evidence cannot stand in for an unknown assignment denominator.

Initial cooperative-feature caps are32active roster students,10,000distinct union source units,50,000distinct student/source pairs,10,000aggregate assignment rows per family,16MiBcopied exact guard metadata and32MiBtotal staging including facts/guards/outputs. Use early bounded count/byte probes before allocation. All caps apply together; overflow is ScopeTooLarge/InputTooLarge without partial roster projection. These are new map limits, not reductions in study or personal D1 admission, and do not promise all combinations of maximal personal scopes.

Each POST advances one page of at most128metadata/fact rows and64KiBserialized UTF-8. Reduce stable(kind,source,student) ordering with deduplicated pair identities and persisted cursor state, so retries cannot double-count. Compute final due facts against one trusted publication timestamp from saved minimum-due/repair facts. Allow one published, one active and one abandoned aggregate generation with bounded cleanup. These aggregate snapshots have no historical award obligation; never delete D1 proof pages.

Export or copy only required capped exact guard metadata and source facts, not unlimited old D1 generations. A single bulk native exact-set predicate must validate all captured tenant/subject inputs, insertions/deletions/absences and generation availability; canonical uses serializable semantic comparison. The final check can read the whole capped guard set and is not a128-row operation. Target at most40complete native statements to leave headroom within the required50, including auth, work, publication/audit and response reads. Measure actual statement/row/byte/runtime costs for successful and stale/error paths; provider gaps remain explicit. Do not drop a guard to pass a budget.

GET remains read-only, with exact current input validation as specified above. The screen drives finite continuation only while open; stop on navigation, identity/season changes, blocks or errors and provide explicit retry. No new background scheduler is promised. Selected chapter actions use D1’s guarded progressScope in the existing start endpoint and remain separate from aggregate continuation.

## Required D2 acceptance

Verify overlapping assignments once per source, multiple editions, cross-chapter targets wholly assigned and excluded-source rejection, recognition/aided/Team distinctions, zero/nonzero denominators, unknown members retained in denominators, independent own contribution and equal student weighting, due/retained overlap, introduction-only scope, scope/roster/grade/generation invalidation, bootstrap and publication races, lost-response restart, cursor ownership, all caps and complete native request budgets. Verify student summary never returns peers’ identities/evidence/source membership, coach detail uses current organization authorization and disabled/closed scope cannot publish new current claims.

Use existing Panel/Badge/Button/ProgressMeter primitives, clear text and existing art. Verify own chapters, cooperation summary, coach breakdown, dated stamps, exact legacy Honor prerequisites and guided Practice/Review at1440/390/320, keyboard/focus/announcements and reduced motion. Required current/pending/partial/empty/overdue cases must use real fixtures; passing component mocks alone does not complete D2.
