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

Hosted follow-up: PR run `34767900740` passed the 47 assignment-related tests and 1,126 tests overall, but reported 64 failures. The normalized failing test-name set matches main run `34764431742` exactly (zero newly failing cases). Native test report writers assume an ignored `.local` directory exists on a fresh checkout; four unrelated timeout cases also fail. The later whitespace-only checkpoint `bdae7fe` passes hosted API formatting/build, browser-support and infra, with API/web tests still running at the recorded readback. Broad hosted CI is not green and release readiness is not claimed. No test was skipped, weakened or hidden to obtain the local gate.

## Book-list scroll handoff follow-up

The user also reported that phone scrolling appeared broken when a finger remained over the book selector at its boundary. The shared `.bible-book-groups` rule explicitly used `overscroll-behavior: contain`. A native Chromium touch sequence reproduced the trap: the inner list moved normally, then a swipe at its bottom left the page at the same scroll offset. The [CSS Working Group specification](https://www.w3.org/TR/css-overscroll-1/#overscroll-behavior-properties) describes `contain` as preventing ancestor scroll chaining and `auto` as retaining the browser's normal behavior.

The production change is confined to that shared CSS rule: use `auto`, with an explanatory comment. The browser owns the boundary handoff, including after search filters shrink or expand the list; no mutation observer, touch cancellation, scroll-position state or custom gesture handler is added. This covers season book selection and both Scripture book browsers. The chapter grid already permits normal handoff and requires no additional production change.

The focused browser command is `NODE_OPTIONS=--no-experimental-webstorage npx playwright test --config playwright.book-scroll.config.ts` from `apps/web`. It uses actual local native accounts/library data, Chromium touch events at 390/320, and successive desktop wheel ticks at 1440. Assertions check inner scrolling while content remains, actual page movement at both boundaries, a non-overflowing one-book search result, expanded search results retaining selection, coach/student book browsers, and 150-chapter selection preserving the chosen checkbox. Programmatic positioning only prepares boundaries; touch/wheel input must produce the measured handoff. Desktop setup reserves room for the page to move and waits for compositor frames.

An attempted WebKit run could not retain the fixture's Secure session cookie on its plain-HTTP local server and returned to sign-in before rendering a book list. That is an uncompleted browser test, not production Safari acceptance. No production authentication was changed to accommodate it. The committed focused matrix covers Chromium; physical iPhone/Safari remains unverified. See `PROGRESS.md` for the final test and pushed checkpoint outcomes.


## Phone landscape follow-up

The supplied landscape screenshot showed a wide empty roster column beside the assignment editor. The planner only switched to the compact selector at widths of 760px or less, so rotating a phone restored the desktop columns even when very little vertical space remained. The new real native rotation regression first failed when the season summary remained beside the books at 844×390.

The planner now also uses its existing compact composition on landscape screens with a coarse primary pointer and at most 500px of height. This keeps the student/coach selector above the editor, removes the left separator/roster column, stacks plan settings and season actions, and places the season summary below book selection. On those short screens the book and chapter scrollports are capped at half the small viewport height. Desktop mouse windows and taller tablets retain their existing layout. Selection and save logic are unchanged.

Visual inspection also identified support controls overlapping the right edge of Save. A second regression failed with the save edge at x=783 and the support controls starting at x=718. A narrow reserved area beside the season form now keeps both the loaded provider launcher and the blocked-provider fallback clear of fields/buttons. It includes right safe-area space and returns to the form when support is minimized. Existing support eligibility, links and minimization preferences remain intact.

From `apps/web`:

```sh
VITE_BUY_ME_A_COFFEE_URL=https://buymeacoffee.com/erudoza npm run build:native
npx playwright test --config playwright.season-layout.config.ts
npm run lint
```

Native build, web/native TypeScript and full lint pass. The four browser projects pass: phone with the existing local support contract fixture, phone with blocked provider/fallback, desktop and tablet. Each uses real isolated authentication/library/season APIs. Phone checks cover 390×844 → 844×390 → 932×430 → 667×375 → portrait, preserved 40-chapter selection/person/role/Advanced difficulty, reachable save controls, support clearance/minimization, and student/coach saves surviving reload. Desktop 1440×900 and short 932×430 mouse windows, plus touch tablets at 768×1024 and 1024×768, retain their roster. Landscape and restored portrait screenshots were inspected. No physical iPhone, Safari, notch geometry or OS rotation acceptance is claimed.

A rerun of the existing scroll matrix exposed an intermittent synthetic-touch timing issue (one failure, five passes; then one failure and two passes on repeated phone runs). Its helper returned immediately after touch release and repositioned the next boundary before momentum settled. It now waits for six stable animation frames of both inner and page scroll offsets, bounded at three seconds, before continuing. All page-movement and selection assertions remain unchanged; no production gesture handler was added. Three repeated phone book-scroll runs then passed. The final full-matrix outcome and Git checkpoint are recorded in `PROGRESS.md`.


## Authorized release and CI preparation

The user requested deployment of these fixes on September13. Fresh main remained `fa27bea`; PR #43 was marked ready for review. The last completed pre-release CI run (`34770100493`) had the previously identified64 web failures and nine canonical report-directory failures. Native fixture startup and three canonical report writers now create the ignored report directory in clean checkouts. The canonical old binary reproduced9/11 rehearsal failures in an isolated root; after the three one-line directory additions, Room14/14, Dispute8/8 and opt-in Load1/1 pass without skips, and all11 generated reports parse. A fresh native metered-cooperation fixture likewise creates its report successfully.

CI now runs Vitest with one worker. Controlled two-CPU tests reproduce pagination/session timeouts with three workers and pass all four heavy cases with one, without changing test deadlines, workloads or assertions. The large projection retains726 requests and its existing60-second cap. The selection and chapter failures did not reproduce in the bounded contention diagnostic, so full hosted Node22 validation remains necessary. Local diagnostic Node is26.8.1. This addresses setup/runtime contention rather than concealing failures; full hosted and live outcomes are recorded separately in PROGRESS.md.


The first repair head `d34cf38` passed hosted API, browser-support and infrastructure checks. The web suite reduced its baseline failures from64 to three exhaustive-fixture timeouts:5,101-record pagination,199-variant coverage across100 passages and the10,000-target chapter projection. Scoped harness deadlines are being corrected based on those results; production deadlines, workload sizes, query/row/payload budgets and behavioral assertions remain intact. This is not yet a passing full hosted gate.

Canonical browser maintenance adapts stale controls to the existing two-step whole-book planner, bounded chapter checkboxes, Scripture notebook, practice setup dialogs and explicit profile saves. Existing narrow/excluded passage fixtures are seeded through the real API and checked after current-UI save/readback. Activity source answers, exact assignment coverage, privacy, scoring, persistence and overflow checks remain. A real selected-person heading overflow was reproduced at1440 and390px with long names; the existing heading now allows flex shrinking and word wrapping. Fresh production build/both TypeScript checks and the4-project native rotation matrix pass after that one-line CSS fix.

The browser history fixture incorrectly allowed only one synthetic stamp per entire run, so its second browser project received409 for a different season. A regression first failed on that second season, then passed with the one-shot guard keyed by organization and season; wrong-run403 and duplicate-season409 remain asserted. The progress test's navigation boundary now waits for the profile response on Honors before closing its expected-cancellation window, because the identity response can arrive before React's profile query is mounted and replaced. This does not ignore arbitrary transport failures.


Local follow-up verification passes the exact-scope/library/activation cases 6/6, coach/workspace/navigation/training cases14/14, chapter-assignment cases4/4 and chapter-progress cases2/2. The latter confirms both synthetic-history project isolation and the narrowed profile-navigation cancellation handling. The long-name regression now measures the visible chapter controls first and scrolls the normal-flow Save button into view for separate viewport/dock/support geometry assertions. All original long names, exact ranges and progress checks remain. Node22.23.2 passes the three large native cases and all27 selector cases with the scoped harness limits; recorded projection resource costs are unchanged. Practice/profile and populated-route browser acceptance and a fresh full hosted gate remain pending at this checkpoint.
