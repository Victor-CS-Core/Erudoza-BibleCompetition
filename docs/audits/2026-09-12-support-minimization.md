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
