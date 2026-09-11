# Coach workspace recommendations — 11 September 2026

Status: recommendations for review. The user approved the student daily-progress mockup and requested an implementation plan plus an assessment of a similar Coach UI. This document proposes the Coach scope; it does not record approval of a Coach layout or authorize production integration of new artwork.

## Recommended direction

Apply the approved student concept's clear next action, visible progress, compact composition, and rewarding feedback to coach priorities: preparing a season, helping students practice, and recognizing recorded progress. Preserve the academy identity and the existing Option C command navigation. The Coach workspace should help answer three questions quickly: what needs attention, who needs a next step, and what changed through practice.

Keep the navy header, ivory surfaces, teal actions, system sans interface type, shared controls, keyboard search, pins, and accessible mobile tables. Use original artwork as a small welcome or empty-state illustration, with clear space for the primary action. Artwork does not belong behind tables, forms, Scripture, or numerical evidence. Review the new [original illustration and badge proposals](../brand/2026-09-11-original-assets/README.md) and obtain the user's explicit artwork approval before integrating them. Artwork approval is separate from the already approved student interaction direction.

## Current behavior and strongest improvements

| Surface | Current behavior | Recommended improvement |
| --- | --- | --- |
| Coach overview | Selected season, assigned-student/review/assignment counts, and a student coverage table. The active season is the default. | A compact welcome and next-action area, followed by a deterministic attention list and readable student evidence. Give the useful action more prominence than repeated counts. |
| Season preparation | Four steps: details, passages, student plans, review/start. Saved data determines available actions. | Show a preparation checklist with direct links to the existing steps. Label literal states such as "Passages saved" and "At least one student assigned"; preserve activation validation. |
| Student directory and assignments | Search, status, sorting, pagination, account actions, a season selector, and personal plan editing. | Add overview filters for students with due reviews, students with assignments but no recorded attempts, and active students without a plan in the selected season. Each opens the appropriate existing destination. |
| Individual progress | Attempts, mastered verses, due reviews, recent correct percentage, passage scores, and latest attempts. Coach and student views share a page. | Put due passages and the next coach action first. Reuse the student progress presentation where it helps comprehension, retaining coach permissions and private evidence. |
| Weekly progress | No complete weekly coach summary is exposed. | Later add a dated, private recap of participation, qualifying practice, completed reviews, and earned honors, with explicit periods and denominators. |
| Team Practice | Enablement, active seasons, questions, accessible rooms, invitations, individual awards/trends, and room results. | Initially expose a compact next setup action. Later add a coach aggregate for academy practice and unresolved appeals, separate from individual Scripture mastery. |

Do not award XP for adding students, assigning passages, or completing other administrative work. Do not add public student rankings, an inferred risk score, punitive missed-day messages, or an invented competition-readiness percentage. Private honor celebrations can become available once the student backend records the relevant awards and their evidence. A saved checklist step may receive a restrained success acknowledgement without turning account administration into a competition.

## Data contracts and limits

### Coverage means a student's combined assignments

Both [native coverage](../../apps/web/worker/native/application/coverage.ts) and [canonical coverage](../../apps/api/src/Erudoza.Application/Competitions/SeasonCoverageService.cs) return one row per student. Eligible and mastered counts cover the union of that student's eligible assignments. The citation and assignment type fields are copied from the first sorted assignment. The current table can therefore look like a single-passage metric when the counts actually span several passages.

Before extending the presentation, show the complete assigned-passage summary using the existing assignments endpoint, or explicitly label the first citation "Primary assignment" and the metric "Across assigned passages." Do not use the first citation to construct chapter readiness, sum assignment rows as independent evidence, or treat an overlapping assignment twice. A richer passage/season aggregate needs an explicit backend contract and parity tests.

### Active roster and selected season

Coverage contains assigned students, not an active-roster denominator, and does not include active status. Join the existing student roster to determine which accounts are active. Keep inactive students' history accessible while excluding them from current action lists by default. Label denominators explicitly, for example "Active students with an assignment in this season." If a weekly statistic later includes students whose status changed during the period, define whether it uses the current roster or the historical roster; do not mix the two silently.

Every action and filter must retain the selected season. Store the Coach overview season in the URL so refresh, back navigation, direct links, and student detail return paths preserve context. An explicit unavailable season should show a recovery state rather than silently fall back to a different season. Existing assignments URLs already use `seasonId` and `studentId`; reuse those routes.

The preparation checklist can use saved season existence, effective scope count, assignment existence, and lifecycle status. "At least one student assigned" reflects the current activation prerequisite. "Every active student has a plan" is a different descriptive measure, not a new activation rule.

### Weekly evidence requires new aggregation

`Progress.recentAttempts` is capped at the latest 20 attempts in [native progress](../../apps/web/worker/native/study/routes.ts) and [canonical progress](../../apps/api/src/Erudoza.Application/Progress/ProgressQueryService.cs). Use it only for recent activity. It cannot establish complete practice-day counts, weekly reviews completed, or week-over-week improvement. Current mastery is a snapshot; it cannot establish which passages became mastered during a past week without historical transitions or suitable snapshots.

A later authorized coach aggregate should define the season, week boundary, timezone, qualifying attempts, current or historical roster, deduplication, and mastery algorithm version. It must use persisted evidence, return explicit period metadata, and avoid one progress request per student. Decide query indexes/read bounds before adding summary refreshes on the Cloudflare Free deployment. Insufficient evidence and query failures must remain distinguishable from a genuine zero.

### Practice reporting is currently participant scoped

[Native practice bootstrap](../../apps/web/worker/native/practice/routes.ts) returns awards owned by the current user and [trends](../../apps/web/worker/native/practice/awards.ts) from matches in which that user participated. A non-playing coach may have no trends despite completed student matches. Do not present that empty state as "Your academy has no progress."

Existing bootstrap data can support enablement, active-season availability, published question counts, and accessible room links. Academy-wide match summaries, honor totals, or a complete appeal queue require a coach-specific aggregate with organization/role authorization. Room results remain provisional while appeals are unresolved. Team scores and speed bonuses do not establish an individual's Scripture mastery.

## Phased delivery

### C1 — Existing-data Coach overview

This phase can ship independently of student rewards. Prepare a compact Coach overview concept for user approval, then implement the next-action area, attention categories, saved preparation checklist, accurate assignment summaries, selected-season URL context, and responsive student coverage. Reuse existing mutations and routes. Keep individual actions direct; do not introduce bulk student messaging or new reminder behavior.

Acceptance: the categories derive only from the selected season and saved data; active/inactive accounts have explicit treatment; each student appears once in counts; overlap does not inflate metrics; loading/errors do not fabricate zero progress; no new rule changes activation or assignment editing.

### C2 — Student detail and private honors

Reuse the approved student progress components for coach-readable evidence while preserving coach navigation and authorization. After the student backend can prove earned badges, add a private Honors section with criterion, earned date, and supporting context. Unavailable or unearned badges must not appear as earned. Keep student-only practice controls out of the Coach view.

Acceptance: the Coach sees the same recorded mastery and awards as the student for the same season; legacy scoring remains identified; current and past seasons remain distinct; the return action retains the student and season.

### C3 — Weekly coach aggregate

Design and implement bounded, authorized weekly summary endpoints for both deployed native and canonical backends. Add period definitions, persisted qualifying-event semantics, deduplication, and roster handling before displaying new metrics. Introduce historical mastery evidence if a new-mastery count is in scope. Present a private weekly recap with contextual actions, not a leaderboard.

Acceptance: results remain correct across time boundaries, retries, overlapping assignments, removed assignments, inactive students, empty periods, legacy duplicates, and different organizations; the latest-20 list is never the aggregate source; query/read cost is measured.

### C4 — Practice preparation and team recap

Use a compact practice setup area after C1, and add a true coach practice summary only after its aggregate contract exists. Preserve reviewed-question requirements, room readiness, match timing, scoring, invitation permissions, and appeal finality. Room-level progress stays in the Team Practice route.

Acceptance: participant trends are not relabeled as academy totals; provisional and finalized results remain distinct; disabled practice and missing bank/season states offer the correct next action; shared styling does not regress live questions or review controls.

## Implementation references

Paths below are relative to the repository root; links point to existing sources inspected for this assessment.

| Concern | Existing files |
| --- | --- |
| Overview and evidence tests | [AdminHomePage.tsx](../../apps/web/src/features/admin/AdminHomePage.tsx), [AdminHomePage.test.tsx](../../apps/web/src/features/admin/AdminHomePage.test.tsx) |
| Directory, season lists, assignment routes | [SimpleAdminPages.tsx](../../apps/web/src/features/admin/SimpleAdminPages.tsx), [SimpleAdminPages.test.tsx](../../apps/web/src/features/admin/SimpleAdminPages.test.tsx), [StudentTable.tsx](../../apps/web/src/features/admin/StudentTable.tsx), [StudentTable.test.tsx](../../apps/web/src/features/admin/StudentTable.test.tsx) |
| Setup and plan editing | [SeasonWizardPage.tsx](../../apps/web/src/features/admin/SeasonWizardPage.tsx), [SeasonWizardPage.test.tsx](../../apps/web/src/features/admin/SeasonWizardPage.test.tsx), [season-setup.css](../../apps/web/src/styles/season-setup.css) |
| Shared progress detail | [ProgressPage.tsx](../../apps/web/src/features/student/ProgressPage.tsx), [ProgressPage.test.tsx](../../apps/web/src/features/student/ProgressPage.test.tsx) |
| Practice presentation | [PracticePage.tsx](../../apps/web/src/features/practice/PracticePage.tsx), [PracticePage.test.tsx](../../apps/web/src/features/practice/PracticePage.test.tsx), [QuestionEditor.tsx](../../apps/web/src/features/practice/QuestionEditor.tsx) |
| API contracts | [types.ts](../../apps/web/src/api/types.ts), [client.ts](../../apps/web/src/api/client.ts), [practice.ts](../../apps/web/src/api/practice.ts), [ApiContracts.cs](../../apps/api/src/Erudoza.Application/Contracts/ApiContracts.cs) |
| Shared navigation and primitives | [TrainingAppFrame.tsx](../../apps/web/src/layouts/TrainingAppFrame.tsx), [destinations.ts](../../apps/web/src/components/navigation/destinations.ts), [ui/index.tsx](../../apps/web/src/components/ui/index.tsx), [ConfirmationDialog.tsx](../../apps/web/src/components/ui/ConfirmationDialog.tsx), [tokens.css](../../apps/web/src/styles/tokens.css), [design-system.css](../../apps/web/src/styles/design-system.css) |
| Native coverage and regression tests | [coverage.ts](../../apps/web/worker/native/application/coverage.ts), [application.test.ts](../../apps/web/worker/native/application.test.ts) |
| Canonical coverage/progress regression tests | [ActivitySelectionIntegrationTests.cs](../../apps/api/tests/Erudoza.IntegrationTests/ActivitySelectionIntegrationTests.cs), [InstalledLibraryTests.cs](../../apps/api/tests/Erudoza.IntegrationTests/InstalledLibraryTests.cs), [SeasonStudyAndContentTests.cs](../../apps/api/tests/Erudoza.IntegrationTests/SeasonStudyAndContentTests.cs) |

## Planned validation

For implementation, run relevant behavior tests for the changed components and contracts, followed by repository-required checks at the checkpoint. From the repository root:

```powershell
npm run test:web
npm run typecheck:web
npm --workspace apps/web run typecheck:native
npm run lint:web
npm run build:web
npm --workspace apps/web run build:native
```

For changed native aggregates, also run `npm --workspace apps/web run test:native`. For canonical endpoint changes, run the affected integration tests and the repository's required .NET validation against `apps/api/Erudoza.sln`. Verify the pinned SDK and current validation workflow before execution.

From `apps/web`, these existing real isolated browser cases cover relevant workflows:

```powershell
node ../../node_modules/@playwright/test/cli.js test coach-shell.spec.ts command-center.spec.ts admin-to-student-study.spec.ts student-password-reset.spec.ts built-in-library.spec.ts
```

The native Playwright configuration currently matches only practice, native study, and built-in library specs. Add an explicit native Coach route/aggregate case before claiming native Coach browser coverage. For populated route captures, use the documented opt-in `ERUDOZA_UI_AUDIT=1` run of `ui-audit.spec.ts`, restoring the environment variable afterward. Coordinate before starting fixtures as required by `PROGRESS.md`.

Review Coach and student screens together at 1440px, 390px, and 320px after shared styling changes. Include empty academy, populated/overlapping/multi-book assignments, inactive accounts, unavailable season, legacy evidence, loading/error, pending/disabled controls, keyboard and focus restoration, reduced motion, and no page overflow. Preserve the [September 11 contrast fix](../audits/2026-09-11-contrast.md); do not reintroduce simultaneous foreground/background color transitions on selected buttons.

## Evidence reviewed and verification limits

Read the current repository source, `PROGRESS.md`, `DESIGN.md`, relevant existing tests, the [mobile coverage audit](../audits/2026-09-10-mobile-page-coverage.md), and the [contrast audit](../audits/2026-09-11-contrast.md). Visually inspected these existing local screenshots:

- `D:/dev/Erudoza/.local/contrast-audit/after/coach-home-1440.png`
- `D:/dev/Erudoza/.local/contrast-audit/after/coach-home-390.png`

These are earlier synthetic fixture captures, inspected during this assessment. They support the layout recommendations and show an existing compatible visual system. They are not fresh live checks. No new application tests, builds, fixtures, hosted queries, gameplay, or deployment were performed for this recommendations document. No production behavior was changed. The current load gate remains outside this design assessment.
