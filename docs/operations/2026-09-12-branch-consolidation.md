# September 12 branch consolidation and release

The user authorized finishing training, committing/pushing and integrating the latest work from every branch into main, deploying the validated combined app, and then removing the other branches. **Inventory/preparation only: no consolidation, production mutation or branch deletion has occurred in this task.** The remaining training gates are in the [plan](../superpowers/plans/2026-09-12-pbe-training.md).

## Verified inventory

A read-only worktree inventory and `git fetch --all --prune` verified main `faf35d5e1828a03f275e30975949f44b2833b5ea`. The eight registered worktrees are clean except the active `codex/pbe-training` implementation. A detached chapter-assignment worktree and ignored tooling/private artifacts remain in place. Refresh this inventory before integration and deletion; this is not a lock against later work.

The coach/student-mode, coffee/PWA, support-control, centered-header, login and landing branch tips are already reachable from this main. Training and its planning/audit ancestor are not yet in main. Main includes the latest landing/header history; this inventory does not establish the deployed Worker version.

Older branch tips can be absent from main's ancestry even when their complete source trees were squash-merged. Exact Git tree equality, stronger than a title match, establishes the following historical source integration:

| Remote branch suffix | Branch tip | Identical-tree main commit |
|---|---|---|
| `cursor/content-pack-import-7a00` | `db6bbcbe57fe` | `a9d8484fdd76` |
| `cursor/erudoza-scaffold-7a00` | `2d895a376648` | `fbb1b7d4469b` |
| `cursor/firebase-host-7a00` | `242f3bbbf9cf` | `63f7e39bd8d0` |
| `cursor/question-review-pipeline-7a00` | `2bdf3dd5cbc2` | `e1f5d8b8fb3f` |
| `cursor/recent-attempts-7a00` | `c8a064ef3dec` | `30baf2ee5f15` |
| `cursor/review-and-coach-progress-7a00` | `1d14dba49c1a` | `2a1db46bfe77` |
| `cursor/scope-chapters-7a00` | `5780a9462d96` | `9050c8f3a942` |
| `cursor/season-roster-7a00` | `a930ef85390f` | `45f561a0278f` |
| `cursor/student-password-reset-7a00` | `b38be17f0caa` | `9d96387c9cee` |
| `cursor/study-activities-openai-7a00` | `5dfcf06bcbed` | `973a5cc853f9` |
| `cursor/true-false-simulation-7a00` | `f0deda50d8f1` | `0ab6b30ff098` |

The landing deck label branch `0db6367450f9dea891ee13478ae3fc0b009e079d` has a patch-equivalent commit already in main (`git cherry` reports `-`; matching main subject at `6ec0afb51bd72cc90cd773ea2551273943984488`). Its whole tree is not claimed equal to a main tree. Preserve these original branch tips in main's ancestry before ref deletion; do not reroll current application files to the older tree.

## Unique old material requiring reconciliation

- `cursor/azure-host-7a00` at `11cde3938e64cf43fafb03eafd8aebd904a7e67d` has an unmerged historical Azure proposal: deployment documentation/script, Bicep and .NET static hosting/cookie changes. Main's current Cloudflare deployment and later security/hosting behavior supersede that operational direction. Its exact history must remain reachable; do not deploy Azure or restore old cookie/seed defaults merely to clean a branch. Root has inspected the changed code/script and file inventory; final reconciliation remains pending.
- `docs/nkjv-private-storage-content-pack-runbook` at `70a4dba408ecc7f5ff84625ce805b2613a1f6264` adds one historical September9 planning document. Root read it fully. Its stated live architecture, import routes, one-pack assumption and authorization context predate the current library/Cloudflare release. Preserve its history and label it historical if retained as a present-day file; it cannot override later user instructions or reopen retired import/storage workflows.

## Remaining execution gates

The independent two-branch source audit is complete. Preserve `.azure/*` and `infra/bicep/*.local.json` as additive ignore rules. Azure's production cookie, automatic seeding/schema, privileged database identity, broad firewall and obsolete deployment choices conflict with later behavior; preserve its exact commit through a documented `ours` strategy history merge with no tree rollback. Merge the unique NKJV document normally and add a clear historical notice immediately after its title, linking current README/PROGRESS and library/Cloudflare guidance. Preserve its original body as dated evidence. These decisions are approved preparation; the merges and ignore-rule edits have not run.

For the eleven exact-tree matches and the patch-equivalent landing fix, retain current source and preserve the original tips as merge ancestors. Record exact parents and unchanged tree evidence for any history-only merge. None of these decisions permits discarding a newly advanced branch tip without inspecting it.

1. Finish reviewed D1/D2/D3 training work, including actual local restore and release checks. Record any real pilot, provider or capacity limits without inventing passes.
2. Refresh every local/remote tip and worktree status; preserve any newly uncommitted work. Build a combined candidate with the latest main and every unique branch history, documenting conflict/supersession decisions. Apply current protection/CI policy through normal non-force operations.
3. Verify the combined code, additive migration/backup and active-room compatibility, then push main and read back its exact SHA. Deployment must use the verified combined build and existing production target/bindings.
4. Deploy and read back the active Worker and migration state; verify public and authorized authenticated behavior separately. Preserve current season choices and existing content; deployment does not automatically enable an unreviewed PBE bank.
5. Only afterward, refresh branch tips again and prove each is reachable from remote main. Remove non-main remote/local branch refs. Detach clean worktrees as needed while retaining their files, ignored private backups/tooling and unrelated active previews. Do not force-delete dirty worktrees or terminate unrelated processes.

A final table must record the integrated SHA, deployed version, verification limits and deleted refs. This document currently contains no completion claim.
