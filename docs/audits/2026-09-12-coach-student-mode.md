# Coach Student Mode implementation evidence

## Behavior

One active adult Owner/Admin identity now uses Coach and Student workspaces. Student mode reuses existing learner activities, training, Scripture reader, recap, Honors and profile selection. Personal season assignments are self-owned and excluded from student rosters, coverage, assignment counts and setup status changes. Standard difficulty and existing season scope/lifecycle rules apply. Coach profiles use the same earned-only avatar checks in either workspace.

Team Practice includes eligible coaches as players. Membership prevents judging and opponent-chat access; changing routes or supplying a pretend mode header cannot change that. The room's non-playing judge cannot receive a player invitation. Navigation preserves the selected season, including switching from a coach season detail route.

## Source verification

- Final combined Vitest: 597 passed, one existing optional workload skip. This includes frontend and native Worker tests. Host Node uses `--no-experimental-webstorage`; the final run used four workers and disk-backed temporary files after a resource-related failed run.
- .NET: 71 unit + 199 integration passed, one existing optional workload skip. Both frontend production builds, web/native TypeScript, full ESLint, .NET formatting and whitespace checks passed. The existing large-bundle advisory remains.
- Regressions cover personal ownership, injected assignee rejection, student administration/report isolation, active-account guards, season lifecycle, saved recap after removing the final assignment, Scripture access, route/season context and player/judge isolation.
- Cross-review of the implementations closed the reporting, difficulty, navigation and invitation findings. No database migration or role conversion is required.

## Browser verification

Final native Chromium: three scenarios passed in 5.2 minutes using fresh loopback-only fixtures. Coach self-assignment, mode switching from a season detail, eight correctly answered study cards, Scripture access, assignment removal with retained recap, and unchanged student coverage passed. Existing student eight-card study/resume/progress also passed. A real ten-question 1v1 match with a coach as invited player completed, checked all twenty accuracy results and team totals, rejected self-judging after switching to Coach mode, earned mastery First Fellowship and saved/reloaded its avatar in both workspaces. Locked avatar selection remained HTTP 403.

Both workspaces were captured at 1440, 390 and 320 pixels; representative final screenshots were visually inspected. The personal-assignment form received layout-only spacing and action-width corrections. The final canonical coach scenarios also passed: personal assignment/study and the complete match/profile flow. The regular student training regression required the selector correction below; it passed in the targeted rerun (10.9 seconds; 25.2 seconds including fixture setup). All six final browser scenarios passed across the two runtimes.

## Validation limits and runner incidents

- Earlier canonical gameplay reached completed results but the test timed out closing the second player's browser context. The harness now navigates that player to a blank page before closing its context. Keep this distinct from a successful complete browser run.
- A parallel rerun encountered SQLite IOERR writes in unrelated full-canon fixtures and Chromium SIGTRAP renderer crashes. `/tmp` was heavily used; memory pressure was observed, but the precise crash cause was not established. Moving temporary files to disk and reducing unit-test concurrency produced the passing final application suite and native browser run without application changes.
- Subsequent canonical fixture builds reported MSB4166 child-node exits. A fresh single-node build with shared build servers disabled passed. The fixture launcher now uses those flags so compiler servers do not escape fixture ownership. The underlying MSBuild crash cause was not established.
- SignalR navigation/negotiation diagnostics and one native fixture broken-pipe diagnostic were observed. Passing gameplay is not a claim of console-error-free runs.
- The existing student training browser test still selected the pre-mastery Honors labels (`details` and `In progress`). Source comparison with the task baseline confirmed the current `requirements` and `Locked` labels predated this task. The weekly-goal button also retained the old `Change` label rather than the existing `Edit` label. The test now selects the mastery profile collection and current controls; application behavior was not altered to satisfy the stale test.
- An extra legacy exporter suite could not run because its required local `erudoza.dev.db` fixture is absent in this isolated checkout. Exporter code and migrations are unchanged; no exporter gate is claimed.
- As in existing learner behavior, removing the final assignment clears the current-season progress selection. Attempts/mastery, earned Honors and completed-session recaps remain stored. Closed-season progress can be retrieved while assignments remain.
- No production data, email, migration, deployment or default-branch merge was performed. Generated fixture databases, credentials, traces and screenshots remain ignored and are not part of the source checkpoint.
