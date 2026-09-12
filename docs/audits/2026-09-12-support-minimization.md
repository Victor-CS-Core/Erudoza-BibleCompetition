# Remembered support minimization — September 12

Implemented in isolated `.worktrees/coffee-minimize`, branch `codex/coffee-minimize`, based on main `cda9e0c`. The user approved browser-local minimization and asked for affected-task coordination. Main and production were not changed by this task.

## Behavior

- Eligible public/Adult coach users can minimize the provider launcher or blocked-script fallback to footer support/restore controls. The browser-wide versioned preference persists without expiry, survives login/logout and reload, synchronizes tabs, and falls back to in-memory state when storage is denied. Student mode and account pages remain excluded.
- Initial storage read and layout-phase adapter ownership avoid a launcher flash. Minimization closes an open popup, restores page interactivity/scroll locking, and directs focus after the footer is committed. Focus targets scroll into view. Native dialogs hide the floating control group; shared 44px touch controls and existing safe-area/148px assignment offsets remain intact.
- No donor verification, payment submission, backend/API/schema change, device synchronization, main merge or deployment. The provider script may still load while minimized.

## Verification

- Baseline support tests: 35 passed. The first new regression failed because Minimize support widget was absent; implementation made it pass. Final full web/native source suite: 627 passed / 1 existing optional skip across 81 passing files. Web/native types, full ESLint, both production builds and whitespace checks passed. Existing bundle-size advisory remains.
- Complete production-preview browser suites: 77 contract-fixture cases and 77 locally inspected official-provider-script cases passed across Chromium, Firefox, WebKit and iPhone 13 emulation (154 total). Payment frames were synthetic. Added cases cover reload/no-ready-flash, account transitions, mobile controls, storage denial, cross-tab updates/clear and open-popup cleanup. Existing popup keyboard/role/installability/stalled-CDN/blocked-frame cases continue to pass.
- Initial focused browser run exposed a cross-tab focus failure in all four projects: effect cleanup ran before the sibling footer existed. Capturing the focus intent during cleanup and applying it during subsequent layout setup fixed the unchanged regression (4/4), followed by both complete passing suites. Independent source review found no other blocking issue and recommended visible footer focus, which was applied.
- Actual native mobile chapter-assignment flow passed once with the real provider enabled (9.4seconds) and once with its script blocked (11.4seconds). Both runs exercised 390/320px save-button clearance including the new minimize control, minimize/restore with selected chapters retained, and the existing saved-assignment/progress assertions. Initial temporary runner config had an ESM loading error; declaring its ignored directory as a module fixed the harness before either successful run.
- Inspected 320px public expanded/minimized, native coach assignment expanded/minimized and student captures. No support controls appear on student screens; footer actions wrap without horizontal overflow. Browser/library dependencies and temporary configs remain ignored.

## Coordination and limits

The active chapter-assignment and training-replayability tasks were notified of shared support/footer/test paths, base commit and no-merge/deploy scope. The chapter task confirmed its release complete and requested preserving mobile save clearance; the added native checks cover it.

Ignored evidence is under `.local/coffee-minimize/` and `apps/web/test-results/coffee-widget/{contract,vendor}/`. No raw browser artifacts, generated credentials, local databases or provider copies belong in Git. No physical-device installation, actual payment completion, new .NET/full-gameplay result, or remote CI pass is claimed. Next: reviewed source checkpoint and private task-branch push, then notify both affected tasks of the exact commit.

## Production release

The user subsequently authorized merge and deployment. Main advanced normally from `cda9e0c` to `f031134`; the unrelated sign-in artwork branch remained untouched. Fresh release verification passed 627 source tests / one optional skip, native build/types and the production dry run. A private D1 export passed integrity verification; no migration was pending or applied. The immediate room-directory projection was empty (asynchronous projection, not direct room inspection).

At 16:17:38 UTC on September 12, source `f031134` deployed as Worker `ebb8dcac-8236-4aab-830f-b3502ef64b39` under deployment `93b53c13-6ede-436d-b8e7-a402e2e02fd1`, serving 100% of traffic. Binding readback matches the prior database, Durable Objects, rate limits, public variables and secret names. Previous compatible Worker: `f7675d55-aa5c-400a-8b9f-96df2a9ecf86`.

Live verification passed 30 edge checks at 16:18:02 UTC and six public browser flows at 16:18:05 UTC. Chromium, Firefox and WebKit each verified normal/blocked-provider minimize, persisted reload and restore at 390px, with visible focus, no overflow or page errors. No account/payment mutation or physical-device installation was performed. Ignored release evidence: `.local/deployment/support-minimize-20260912/`. Source CI remains separately in progress; both affected tasks receive the release readback.

## Quieter hide control follow-up

The user’s live feedback requested a less intrusive hide button. Source `9e05215` changes its shared variant to ghost, preserving the 44px target and existing behavior. Local gates passed 39 support tests, 28 official-provider responsive/minimization browser cases, both builds/types, lint and dry run; independent review found no concern. The later conflict-free merge with main’s separately authorized sign-in artwork passed 627 source tests / one optional skip. The artwork was excluded from this deployment.

The correction deployed at 16:24:29 UTC as Worker `1c29e34e-34c9-4761-b9ae-923971affdca`, deployment `38f2e983-7888-485e-9b40-374e37d7142c`, serving 100%. Thirty live edge checks and six normal/blocked-provider browser flows passed by 16:25:03 UTC, including transparent background/border and 44px geometry. Bindings/schema are unchanged; no account/payment actions. Previous compatible Worker is `ebb8dcac-8236-4aab-830f-b3502ef64b39`. Main retains both source changes; sign-in artwork remains pending deployment.

## Close minus and original cup follow-up

Source `f22952a` places the glyph within5px of the circle and vertically centers it, preserving a separate44px target and shared ghost styling. The live original provider SVG is unchanged; offline tests now use its unmodified artwork instead of an emoji. New geometry assertions reproduced the old gap and shared-style override before the correction. Final gates:39 support tests;28 official-script plus28 contract browser cases across Chromium/Firefox/WebKit/iPhone at desktop/390/320; normal and blocked native mobile chapter flows; both builds/types, lint, dry run and independent review. After integrating main's merge-only login artwork,627 source tests passed/one optional skip. That combined source was not deployed.

Pushed pre-login source `f22952a` deployed at16:33:43UTC as Worker `a2c4ab16-a96d-4a31-809c-e4c683c9fb57`, deployment `1e4eaaea-de77-4ee8-bcde-42b60f369020`,100%traffic. All version resources match previous Worker `1c29e34e-34c9-4761-b9ae-923971affdca`. Thirty anonymous edge checks and six normal/blocked live browser flows passed by16:34:12UTC, including glyph geometry and original artwork URL; WebKit capture inspected. No migration or account/payment action. Ignored reports: `.local/deployment/close-support-20260912/`. Sign-in artwork remains merged but pending deployment.
