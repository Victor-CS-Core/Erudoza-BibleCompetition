# Erudoza QA handoff

**November 24, 2026 · Production app, native Cloudflare runtime, web client, and repository CI**

**Release assessment.** The coach, learner and master-admin workspaces were usable in production. A coach question and support ticket survived reloads. In an isolated native environment, a second user completed an eight-card study session and the coach saw the correct attempt count. The retry smoke test below confirms the live production workspace is reachable after the deployment window, but the repository release gates remain red. Two defects deserve early attention: a coach can save an outdated question after editing the previewed text, and an open support ticket can become unreachable through the queue.

| Evidence | Revision or environment |
|---|---|
| Live walkthrough and saved changes | Authenticated desktop Chrome at `erudoza.com`. Production reported service version `2026.11.1`. This identifies the service version only. |
| Original local audit | [fc5a7d7, Control Center contract fix](https://github.com/Victor-CS-Core/Erudoza-BibleCompetition/commit/fc5a7d7026303325c1416c59454ce03d3f4d279b). Clean checkout, lockfile install, Node 24.22.3. |
| Follow-up on newer main | [3aa384e, Control Center audit fixes](https://github.com/Victor-CS-Core/Erudoza-BibleCompetition/commit/3aa384eb182fb02e9a167d36abc86df2375d2240). The update adds lazy-page recovery, panel isolation, contract tests, copy and touch-target changes. The question editor, native support query and assignment coverage calculation are unchanged between the audited revisions. |
| Local data | Disposable Miniflare, D1 and fixture accounts. Local browser testing used a headless Chromium substitute because the pinned Playwright browser download returned HTTP 403. Hosted CI provides independent browser evidence. |

**Deployment checkpoint.** After the production walkthrough, main advanced to [a570f31](https://github.com/Victor-CS-Core/Erudoza-BibleCompetition/commit/a570f31cf524eee1575933ae9f791044cf427e64). Its staging deployment succeeded. CI and the visual workflow reported failures on that revision. It includes the onboarding test-double correction described below. Treat that item as addressed in source. Validate it on the release candidate before reopening it. The retry smoke test on November 25 confirmed that production is reachable and authenticated after the deployment window; the service still reports version `2026.11.1`. All counts below identify the earlier revisions actually exercised.

## Retry post-deployment smoke test — November 25, 2026

Authenticated desktop Chrome reconnected to `https://erudoza.com` after the deployment pause and reached the coach workspace without a login failure. The following production checks passed:

- Coach Overview loaded with the active Summer 2027 season, two assigned students and four assignments.
- Master admin Control Center Overview loaded; the 14-day practice chart rendered and the 7-day range control was present.
- Control Center System reported **Operational**, **0 server errors** in the last 24 hours and last 7 days, live version **2026.11.1**, and the expected credential-presence checks.
- Control Center Content loaded directly and showed 17 material drafts awaiting review, one live material, the NKJV library, and no open answer disputes. The prior Content error boundary did not recur.

This verifies post-deployment availability and the previously fragile Control Center routes. It does not turn the failing GitHub CI/visual workflows green, prove the exact deployed Worker revision is `a570f31`, or close the seven code-level findings below.

## Production data left by QA

| Item | Verified outcome |
|---|---|
| Team Practice coach question | Saved **QA 2026-11-24 — Which wilderness is named in Numbers 1:1?** with a Scripture reference, evidence and two accepted wordings. It remained under **Drafts** after reload and was absent under **Published**. Left unpublished in the tested season so a developer can inspect it. |
| Support ticket | Created **#S-101**, subject **QA 2026-11-24 · ticket lifecycle**. Changed status to Waiting, reloaded, changed to Resolved and reloaded again. Left **Resolved**, with no requester email. |
| Coach's personal weekly goal | Started at five days, saved four and verified the editor showed the pending change for November 30. The current week correctly stayed at five. Restored five and verified it after a fresh reload with no pending change displayed. |

The review created no production student accounts, sent no invitations, and changed no existing student's grades or assignments. All published-question and scored-session checks described below used synthetic local data. No repository edits were pushed and no deployment was performed by this audit.

## Defects to fix

### 1. High — Saving a preview can silently discard a coach's correction

**How to reproduce.** Open Team Practice → Coach question bank → Create a question. Fill in a valid source, prompt, reference, evidence and scoring part. Preview it. Change the prompt, then click **Save validated drafts** without previewing again.

**Observed.** A local React test exercised the real editor and captured its import request. The visible field contained `QA corrected prompt`, but the submitted question contained `QA old prompt`. The source stores a separate preview object and submits it. Editing the prompt leaves that object valid. A coach correcting an accepted answer or scoring rubric faces the same stale-preview design.

**Fix and acceptance.** Invalidate the preview whenever any contributing field changes, or bind saving to a validated revision of the current form. Test a prompt change, source change and scoring change. In each case, Save must require a fresh preview or submit the corrected content. Verify the stored draft after reload. Keep the batch JSON-import flow covered separately. [QuestionEditor.tsx, preview and save](https://github.com/Victor-CS-Core/Erudoza-BibleCompetition/blob/fc5a7d7026303325c1416c59454ce03d3f4d279b/apps/web/src/features/practice/QuestionEditor.tsx#L43-L64)

### 2. High — An open support ticket can disappear from the queue

**How to reproduce locally.** Seed one old Open ticket and 30 newer Resolved tickets. Open Control Center → Support & tickets. Compare the Open tickets metric with the available rows.

**Observed.** Running the checked-in ticket query over the repository's SQLite schema returned 30 resolved rows and zero open rows. The aggregate query correctly returned one open ticket. The client renders only returned rows, with no pagination or older-ticket lookup. The inbox has an analogous newest-20 limit. The production ticket population was too small to expose this during the walkthrough.

**Fix and acceptance.** Provide a paginated or filterable queue. An overview alert for stale tickets should open the corresponding filtered queue. With 31 tickets, a coach with the required admin access must be able to find and update the oldest open ticket. Test the corresponding case with more than 20 inbox messages. [Worker queries](https://github.com/Victor-CS-Core/Erudoza-BibleCompetition/blob/fc5a7d7026303325c1416c59454ce03d3f4d279b/apps/web/worker/native/control-center.ts#L231-L247) · [Queue rendering](https://github.com/Victor-CS-Core/Erudoza-BibleCompetition/blob/3aa384eb182fb02e9a167d36abc86df2375d2240/apps/web/src/features/admin/ControlCenterPage.tsx#L665-L699)

### 3. Medium — Assignment summaries combine one passage label with the total for all passages

**How to reproduce.** Give a learner two disjoint ranges in the same season. Compare Coach Overview → Student progress, Assignments → Assigned passage coverage, and the learner's assignment editor.

**Observed.** In production, `NUM 1:20–30` appeared beside **106 verses**. The editor showed additional ranges. In an isolated fixture with Daniel 1:1–3 and 1:6–7, the coverage response displayed 1:6–7 beside a count of **5**. The worker takes coordinates from one assignment and counts the union of sources across all assignments. Both screens render that pair.

**Fix and acceptance.** Preserve the deduplicated total. Return the other ranges or their count and label their scope in the UI, for example “Daniel 1:1–3 and 1 more range · 5 verses total.” Cover single, disjoint, overlapping and multi-book assignments. The summary and editor must agree. [Worker calculation](https://github.com/Victor-CS-Core/Erudoza-BibleCompetition/blob/fc5a7d7026303325c1416c59454ce03d3f4d279b/apps/web/worker/native/application/coverage.ts#L23-L30)

### 4. Medium — Support promises incoming mail while intake is disabled

**How to reproduce.** With support intake unconfigured and the inbox empty, compare Control Center → System with Support & tickets.

**Observed.** System showed **Disabled**. Support said messages sent to the support address would appear there. This can make an empty application queue look like an empty mailbox. The newer main still renders that promise unconditionally. No external email was sent as part of this test.

**Fix and acceptance.** Give the support view the configured state. When disabled, direct staff to the mailbox or manual ticket creation. When enabled, explain ingestion. Keep existing imported messages readable in both states. [Empty-state copy](https://github.com/Victor-CS-Core/Erudoza-BibleCompetition/blob/3aa384eb182fb02e9a167d36abc86df2375d2240/apps/web/src/features/admin/ControlCenterPage.tsx#L692-L699)

### 5. Medium — Student Team Practice header overflows the desktop viewport

**How to reproduce.** Run the native PBE bank scenario with its seeded student. Open `/student/practice` at 1440 CSS pixels wide. Compare the document's scroll width and client width.

**Observed.** The original browser assertion measured **1485 px** of content in a **1440 px** viewport. A second run reproduced the same 45 px overhang. Measurements identified the account control, account name and trailing icon in the header. In that same diagnostic the student page fit 390 and 320 px, and the coach practice page fit all three widths.

**Fix and acceptance.** Inspect the masthead grid and account-control shrink rules with longer display names. At 1440, 390 and 320 px, the account control must remain visible and keyboard-accessible, with document scroll width at most one pixel above client width. Preserve the original overflow assertion. [Styles](https://github.com/Victor-CS-Core/Erudoza-BibleCompetition/blob/fc5a7d7026303325c1416c59454ce03d3f4d279b/apps/web/src/styles/command-center.css) · [Browser scenario](https://github.com/Victor-CS-Core/Erudoza-BibleCompetition/blob/fc5a7d7026303325c1416c59454ce03d3f4d279b/apps/web/e2e/pbe-bank.spec.ts#L49-L52)

### 6. Low — Single-item counts use plural labels

Production displayed “1 players” in the lobby and room list, “1 members” and “1 materials” on Content, and “1 sessions” on the activity chart. The coach question preview also displayed “1 points.” Apply singular/plural formatting to both visible text and accessible labels. Check values 0, 1 and 2 across Team Practice and Control Center.

### 7. Low — Successful publication shows draft-only instructions

In a local component test, clicking **Publish reviewed question** called the publish API successfully, then showed “Saved. Drafts require publication before matches can use them.” The editor uses the same success message for draft import and publication. Give each action its own confirmation and test that the publication message reflects the saved state. The separate native integration journey verified that the published flag itself persisted. [Shared success handler](https://github.com/Victor-CS-Core/Erudoza-BibleCompetition/blob/3aa384eb182fb02e9a167d36abc86df2375d2240/apps/web/src/features/practice/QuestionEditor.tsx#L42)

## Verified user journeys

| Area | Checks and results |
|---|---|
| Coach dashboard and directory | A due-review shortcut opened the listed season and its one matching student. The Engagement view retained the season and showed both assigned students. Assignment details showed the additional saved ranges missing from the summary. |
| Control Center | Opened Overview, Users & clubs, Content, Support & tickets and System. Opened Content directly and through the draft-review shortcut. No error boundary appeared. Switching the activity chart from 14D to 7D showed the expected seven dates. Health and ticket status controls rendered. |
| Coach and learner workspaces | Switched to Training HQ and back. Learner assignment and verse progress rendered. Selecting and clearing an unsaved chapter toggled the Save button correctly. Weekly preference persistence and restoration were verified separately. |
| Native local coach → student → coach | Signed in with distinct synthetic accounts. Created a season, scoped passages, assigned two ranges and activated the season. Imported and published a local question and read back the published state. |
| Native local study and progress | Resumed the first card, submitted eight attempts over five activity types, resent the first submission with the same client submission ID, and received its existing attempt ID. The completed recap, student progress and coach progress each counted eight attempts. This was an HTTP integration journey. |
| Coach chapter assignment in a phone-width browser | On newer main at 390 × 844, the coach selected Numbers chapter 2 using the current chapter button and saved. After reload the chapter showed **already saved** and the coverage API reported **88 verses** across chapters 1 and 2. |
| Student Memory session in a phone-width browser | On newer main, a separate fixture student resumed a seeded native practice session at 390 × 844 CSS pixels. The test entered all eight answers through the UI, reloaded after the first accepted answer and recovered its feedback. The completion response reported **8 attempted, 8 correct**, and the browser reached the recap. Session creation used the API. |
| Responsive views | Checked the coach authoring and student practice routes at 320, 390 and 1440 CSS pixels with seeded data. The 1440 px student overflow is recorded above. A Chromium viewport check does not establish iPhone Safari or installed-PWA behavior. |

## Release and test-suite findings

### Restore the API dependency gate

On the original commit the normal .NET restore failed locally and in GitHub Actions. SDK 10.0.303 resolved this transitive chain in Erudoza.Infrastructure:

`Microsoft.EntityFrameworkCore.SqlServer 10.0.11 → Microsoft.Data.SqlClient 6.1.6 → System.Security.Cryptography.Pkcs 9.0.11`.

NuGet reported NU1903 and NU1902. Both advisories list **9.0.21** as the patched version on the 9.x line. Choose a compatible dependency update and verify the resolved graph across the solution. The acceptance gate is an ordinary restore, build and test with the repository's normal audit policy. The live service reviewed here runs on Cloudflare Workers. These results establish a .NET repository dependency issue. They do not establish exposure of the production Worker. [High advisory](https://github.com/advisories/GHSA-846f-f764-76mx) · [Moderate advisory](https://github.com/advisories/GHSA-2fmv-rv2c-59x7)

### Recover trustworthy automated coverage

| Original revision check | Result | Developer action |
|---|---|---|
| Native production build | Passed web and native TypeScript checks and the Vite native bundle. | Keep the native build as an independent gate. |
| ESLint | **28 errors**. 25 explicit `any` annotations in the native Control Center tests, one unused `clientIp` import and two unused test parameters. | Type the response fixtures, clean up unused declarations and rerun lint. |
| Full serial Vitest | **1,878 passed, 52 failed, 3 skipped** across 214 files. | Re-run with `npm --workspace apps/web run test -- --maxWorkers=1`. Keep the original failing test names and group by cause before changing expectations. |
| Focused Control Center, question editor, goal and wiki tests | **52 passed, 1 failed**. The failing joined-date assertion used a midnight-UTC fixture. It passed when rerun with `TZ=UTC`. | Specify whether the feature presents local dates or UTC dates. Make the expected value explicit in both timezones. |
| .NET unit-test diagnostic | **192 unit tests passed** in a separate diagnostic that downgraded only the two NuGet warnings to permit execution. | Keep this separate from the failed normal restore. The original integration-test completion count was not captured. |
| Native browser and rotation suites | The built-in-library browsing test passed. Multiple flows stopped at outdated chapter-checkbox, season-status or room-setup selectors. All four dedicated season-layout variants failed looking for `.planner-chapter-choice`. | Update selectors to match visible roles and accessible names. Live chapter selection uses pressed buttons. Preserve selection, persistence, keyboard behavior and rotation assertions. |
| Hosted CI on the original commit | Web lint, API restore and browser-support jobs failed. Dependent E2E skipped. Browser-support reported **26 failures** and the separate visual workflow reported **6**. Infrastructure passed. | Rerun the jobs after fixing their first actionable failures. A successful staging workflow ran independently. [CI](https://github.com/Victor-CS-Core/Erudoza-BibleCompetition/actions/runs/45438172262) · [Visual workflow](https://github.com/Victor-CS-Core/Erudoza-BibleCompetition/actions/runs/45438172341) |

The 52 Vitest failures included **21 onboarding tests** and **6 landing-page tests**. The first onboarding failure returned 503 where 202 was expected. The landing tests rendered without the AuthProvider required by the component. Other failures included PBE rooms, disputes, restore, a Scripture collection boundary, mastery query cost, and training progression. The duplicate-review test stopped at “No reviews due” before its credit assertion. These failures leave those behaviors unverified. They do not demonstrate 52 separate production defects.

### Follow-up on the newer revision

GitHub shows staging succeeded, CI failed and visual screenshots failed on `3aa384e`. In CI, web failed at lint, API failed at restore, browser-support failed in the Playwright coffee-widget suite, and dependent E2E skipped. The infrastructure job passed. [CI](https://github.com/Victor-CS-Core/Erudoza-BibleCompetition/actions/runs/45472336589) · [Visual workflow](https://github.com/Victor-CS-Core/Erudoza-BibleCompetition/actions/runs/45472336424) · [Staging](https://github.com/Victor-CS-Core/Erudoza-BibleCompetition/actions/runs/45472336347)

**Local follow-up.** The newer native build passed. ESLint reported **39 errors**. The eight-suite check covering lazy-page recovery, Control Center rendering and contracts, shortcuts and wiki returned **68 passed, 1 failed**. The sole failure was the joined-date assertion. Hosted browser-support returned **51 passed, 26 failed**. One assertion observed notification and practice-bootstrap requests outside its expected request list. The visual workflow returned **3 passed, 6 failed**, with a representative case timing out on the missing character canvas.

**Isolated cause of the onboarding failures.** The provider implementation posts URL-encoded Turnstile verification data. The onboarding test double parses it as JSON and fails before the test reaches its intended signup or invitation assertions. Changing only the test double to parse URL-encoded data, in a temporary copy, produced **31/31 passing onboarding tests**. Apply that fixture fix first. Verify provider-backed email delivery separately on a designated test account. [Worker request](https://github.com/Victor-CS-Core/Erudoza-BibleCompetition/blob/3aa384eb182fb02e9a167d36abc86df2375d2240/apps/web/worker/native/onboarding/providers.ts#L22-L32) · [Test double](https://github.com/Victor-CS-Core/Erudoza-BibleCompetition/blob/3aa384eb182fb02e9a167d36abc86df2375d2240/apps/web/worker/native/onboarding/routes.test.ts#L18-L27)

### Completed follow-up runs at 3aa384e

| Check | Final result |
|---|---|
| Full serial Vitest | **1,906 passed, 52 failed, 3 skipped** across 220 files. The seven product findings above are individually supported by their own evidence. |
| Native browser suite | Across the original run and targeted reruns of its remaining scenarios, **3 of 20 passed and 17 failed**. The first run hit an eight-minute suite limit. The reruns used shorter action waits. Several cases stopped at obsolete selectors such as “Set up PVP” before exercising the match itself. |
| Reader, study tools and season-save browser cases | The 320 px touch verse-selection and book-search test passed. Two reader/study cases timed out, including one waiting for the next-card response. The three season-save cases were run separately and failed looking for obsolete select-all checkboxes. The independent 390 px coach-save and student-recap workflows in the table above both passed. |
| .NET after diagnostic restore | **192 unit tests passed. 372 integration tests passed, 2 load tests skipped.** This diagnostic run treated only NU1902 and NU1903 as warnings. The repository’s normal restore still failed its audit gate on the reviewed revision. |
| Tracked fixtures | Running the normal suite rewrote two tracked JSON snapshots. The capture tests call `writeFileSync` on the checked-in fixtures. Make regeneration an explicit command and have routine tests compare against stable fixtures. Acceptance is an ordinary test run that leaves `git diff` empty. |

## Acceptance order for the developer agent

1. Add the stale-preview regression and paginated-ticket regression described above. Fix each case and demonstrate corrected saved data or a reachable older ticket.
2. Correct the .NET dependency graph and restore green lint. Run the normal CI commands with the repository's warning policy.
3. Correct the assignment summary, support-intake text, desktop overflow and plural labels. Exercise both roles and use seeded data for screenshots.
4. Repair stale selectors and fixture setup. Record the actual result of separate-student study, multi-client room completion, and rotation. Retain independent assertions for application behavior when replacing selectors.
5. Rerun automated gates and repeat a short authenticated smoke test on staging. Record the tested commit, deployed version and CI run IDs together. Check the wiki release gate for each user-facing change.

**Coverage limits.** The live pass used an owner/master-admin account and that account's learner mode. Separate student credentials and scored sessions were exercised locally. Real email delivery, a live multi-person production match, and physical iOS installation/offline behavior remain unverified. No real student names, credentials, screenshots or private account identifiers are included.
