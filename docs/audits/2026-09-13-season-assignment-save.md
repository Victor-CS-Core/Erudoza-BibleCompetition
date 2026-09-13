# Season assignment save recovery — September 13, 2026

## Report and cause

A coach reported the season planner remaining at “Saving…” when assigning all chapters on a phone, with Specialist study and Advanced difficulty. The pending assignment mutation disables the planner's draft/start actions.

The old helper sent one POST per chapter. Reproduction using actual library chapter/verse metadata produced 40 writes for Exodus (1,213 verses) and 150 for Psalms (2,461 verses). Every native assignment POST reloads the effective season sources for validation. Network requests had no deadline, and the mutation continued waiting for broad background query invalidation after confirmed writes. Source and isolated reproduction establish these failure paths; no production trace or timing was collected from the user's device.

## Change

- Compact exact contiguous selected, eligible, unassigned coordinates into existing multi-chapter assignment ranges. Retain gaps for exclusions, unavailable verses, previous coverage and unselected chapters. The chapter-choice UI and granular `chapterRanges` contract remain intact.
- Validate confirmation over the entire attempted range. On a lost response, reread assignments before proceeding; never automatically replay an unconfirmed failed write within the same attempt. Preserve confirmed earlier writes if a later readback fails. User retries start with a fresh read.
- Bound each save-related read, write and difficulty update to 30 seconds and pass cancellation to fetch. Failed-write reconciliation has its own 30-second deadline: a stalled write and stalled readback together can take approximately 60 seconds. Aborting a client request does not establish server rollback.
- Show confirmed chapter progress, including on the Save button at the end of a long chapter list. Publish confirmed assignment coverage and per-person difficulty before releasing the editor, and let background refresh finish separately. Retain loaded editor data and selections when those refreshes fail.

No backend endpoint, storage schema, training eligibility, administrative budget, season scope limit or existing progress record is changed. Both native and canonical APIs already accept these multi-chapter ranges.

## Verification

Baseline: 37 existing planner, chapter and personal-assignment tests passed. New compaction, whole-range confirmation, progress, timeout and stalled-refresh regressions were observed failing before their corresponding fixes. Three existing recovery fixtures now use nonadjacent chapters so they continue exercising multiple writes with compaction enabled.

Final focused check (from repository root):

```sh
NODE_OPTIONS=--no-experimental-webstorage npm test --workspace @erudoza/web -- --run src/features/admin src/features/student/MyAssignmentsPage.test.tsx src/api worker/native/application/library.test.ts worker/native/coach-learning.test.ts worker/native/admin-limits.test.ts --maxWorkers=2
```

Passed 142 tests across 18 files. Coverage includes exclusions, partial and omitted readbacks, no automatic duplicate retry, whole-range confirmation, initial/write/readback deadlines, progress, stalled and failed background refreshes, selected-student preservation, and confirmed student/coach difficulty during a stalled refresh.

Passed both application builds, web/native TypeScript, full ESLint and whitespace checks:

```sh
npm run build:native --workspace @erudoza/web
npm run build --workspace @erudoza/web
npm run lint --workspace @erudoza/web
git diff --check
```

The existing bundle-size advisory remains. Hosted CI exposed a pre-existing one-line lambda-brace formatting violation in `MasteryHonorService.cs`. That whitespace-only correction passes the full `dotnet format apps/api/Erudoza.sln --verify-no-changes --severity warn` command. Canonical API behavior is unchanged; local .NET runtime and production-device end-to-end tests were not run for this frontend fix.

Real native browser acceptance uses the isolated full-library fixture, with no production account writes:

```sh
cd apps/web
NODE_OPTIONS=--no-experimental-webstorage npx playwright test --config playwright.season-save.config.ts
```

The three scenarios cover creating a season through the real UI with Exodus/Psalms, selecting all 190 chapters and saving Advanced assignments in exactly two POSTs, reloading 190 assigned chapters for student and coach, unlocked draft/start actions, an actual 30-second stalled transport followed by a single successful retry, and a response lost after real persistence recovered with no second write. Desktop, 390px and 320px overflow checks and mobile saving/saved/retry captures are included. Browser-generated data and captures remain ignored. This verifies Chromium mobile layouts, not physical iPhone networking or Safari.

An independent read-only reviewer verified range API compatibility and retry/cancellation semantics. Its stale-difficulty finding was fixed for both students and coaches, with two observed failing-then-passing regressions and a clean re-review.

## Delivery state

Work is isolated on `codex/season-assignment-save` from main `fa27bea`. See `PROGRESS.md` for exact Git checkpoint and remote review status. This audit does not establish a main merge or production deployment. The user's earlier profile merge/release is separate from this new season bugfix.
