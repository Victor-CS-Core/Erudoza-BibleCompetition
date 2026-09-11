# Mobile page audit coverage

This audit uses an isolated API and synthetic test data. It does not change the running development database. Phone checks target 320, 390 and 430 CSS pixels; phone screenshots use 390 pixels. Desktop confirmation uses 1440 pixels.

## Evidence method

`apps/web/e2e/ui-audit.spec.ts` is an opt-in route audit (`ERUDOZA_UI_AUDIT=1`). Its fixture creates an active season, stored Scripture sample, student assignment, published practice questions and an accepted study attempt. Every screenshot is labeled with its actual state in the attached `route-coverage` JSON. Read-only external Bible-provider book/chapter metadata is stubbed explicitly; authentication and all application mutations use the real isolated API.

The normal browser suite separately exercises content import, season activation, answering an actual generated activity, password reset, account switching, command search, pin persistence and live multiplayer interactions. A route screenshot is not a claim that every behavior on that page was tested.

## Route and state matrix

| Surface | Route/state | Evidence target |
| --- | --- | --- |
| Public landing | `/` signed out | Full phone and desktop page |
| Sign in | `/login` signed out | Fields, primary action and layout |
| Unknown route | `/audit-page-does-not-exist` | Recovery screen |
| Coach overview | `/admin` active assigned season | Populated student coverage |
| Season list | `/admin/seasons` | Existing active season |
| New season | `/admin/seasons/new` | Unsaved creation form |
| Season details | `?step=details` | Existing active season |
| Season passages | `?step=passages` | Stored pack and selected scope |
| Draft passage editor | Draft `?step=passages` | Bounded stored-book/chapter/verse selectors |
| Season students | `?step=students` | Assigned student |
| Season review | `?step=review` | Active season status and summary |
| Student directory | `/admin/students` | Student row and management actions |
| Assignment coverage | `/admin/assignments?seasonId=…` | Existing assignment |
| Individual assignment | `?seasonId=…&studentId=…` | Editable personal plan |
| Scripture library | `/admin/content` | Stored packs; bounded chapter controls tested separately |
| Selected library pack | `/admin/content` after choosing a pack | Actual stored verse preview |
| Coach progress | `/admin/seasons/…/students/…/progress` | Assigned student before attempts |
| Design reference | `/admin/design-system` | Shared UI primitives |
| Coach practice | `/admin/practice` | Enabled practice and published question bank |
| Student feedback | `/student/study?sessionId=…` | Accepted incorrect answer with source feedback |
| Student home | `/student?seasonId=…` | Active assignment and recorded attempt |
| Student progress | `/student/progress?seasonId=…` | Real attempt count and progress |
| Study | `/student/study?mode=Practice` | Real generated activity |
| Review | `/student/study?mode=Review` | Due-review readiness after an incorrect attempt; unavailable state is labeled if no review is due |
| Simulation | `/student/study?mode=Simulation` | Real generated rehearsal activity |
| Student practice | `/student/practice` | Enabled practice and active season |
| Practice lobby | `/student/practice/…` | Real room with one player, no match started |
| Live question | Quick multiplayer browser journey | Two authenticated players and server timing assertions |
| Question review / appeal | Quick multiplayer browser journey | Accepted answers, source evidence and resolved coach review |
| Completed 5v5 | Prior full multiplayer run; source review for this UI pass | Ten scored questions, refresh recovery and achievements previously passed; no fresh completion screenshot claimed |

## Verification status

The first complete mobile pass identified assignment coverage overflowing at 320, 390 and 430 pixels. DOM diagnosis showed that the table itself was correctly contained: an absolutely positioned accessible action label escaped the scroll region. Positioning shared table scroll regions relatively resolved the page overflow. Visual review also found that the mobile study form hid its disabled Check answer button before an answer was entered; that action now remains visible.

Final evidence: 32 distinct functional browser checks passed across fresh desktop/mobile full and targeted runs. These include actual generated study submission/resume, stored-pack import and assignment, book/chapter reset bounds, account switching, command navigation, password reset, and quick live multiplayer scoring/appeal review. All 27 route/state captures passed on desktop. All 27 mobile states were captured and checked at 320, 390 and 430 pixels; the final focused assignment rerun passed after the accessible-label containment fix. The full suite was not repeated after targeted test updates and the last CSS correction.

The earlier ten-player, ten-question 5v5 journeys passed on desktop and mobile before this UI pass; they were not rerun here. Native-only study tests belong to `playwright.native.config.ts` and are excluded from the .NET browser configuration. Initial captures interrupted by in-progress edits or showing a loading state are not counted as final route coverage. No performance, production deployment or release-readiness conclusion is made by this document.

Additional verification passed: 191 frontend/native catalog tests, 9 .NET catalog HTTP tests, and 29 .NET provider-adapter tests. Frontend and native type checks, ESLint, and the production build passed. Wrangler could not write its optional log outside the workspace sandbox; the build still exited successfully and generated its bundles.

## Final screenshot locations

- Desktop, all 27 files: `D:/dev/Erudoza/apps/web/test-results/e2e-f735338a-3f90-4484-9354-3e5e1aef7e45/ui-audit-populated-coach-and-student-route-audit-chromium/`
- Mobile, all 27 files except the superseded assignment screenshot: `D:/dev/Erudoza/apps/web/test-results/e2e-7e3bc6d0-f664-4594-9ad1-f1182c78dcf0/ui-audit-populated-coach-and-student-route-audit-mobile-chrome/`
- Corrected mobile assignment screenshot: `D:/dev/Erudoza/apps/web/test-results/e2e-7e8df231-c91c-46e6-a90b-7db676fcefcc/ui-audit-populated-coach-and-student-route-audit-mobile-chrome/coach-assignments.png`
- Fresh live question/review at 320, 390 and 1440 pixels: `D:/dev/Erudoza/apps/web/test-results/e2e-25d4ec6f-4dd1-4635-9175-43e9ba7f7824/practice-real-browsers-inv-48203-erver-measured-speed-points-mobile-chrome/match-320.png`, `match-390.png`, `match-1440.png`.

The 27 route filenames are: `landing.png`, `login.png`, `not-found.png`, `coach-overview.png`, `coach-seasons.png`, `coach-new-season.png`, `coach-season-details.png`, `coach-season-passages.png`, `coach-season-students.png`, `coach-season-review.png`, `coach-season-draft-passages.png`, `coach-students.png`, `coach-assignments.png`, `coach-assignment-editor.png`, `coach-library.png`, `coach-library-preview.png`, `coach-student-progress.png`, `coach-design-reference.png`, `coach-practice.png`, `student-study-feedback.png`, `student-home.png`, `student-progress.png`, `student-study-practice.png`, `student-study-review.png`, `student-study-simulation.png`, `student-practice.png`, and `student-practice-lobby.png`.

## Implemented content selection safeguards

The library supports content browsing/search and selected stored-verse previews. Translation, book and chapter controls use provider metadata, with a maximum of eight consecutive chapters per import. Season scopes and personal assignments derive their chapter/verse choices from actual stored coordinates, resetting dependent selections when a parent changes. Both .NET and native backends reject invalid book/chapter requests.

Automated browser tests stub read-only provider metadata explicitly. Separately, the root agent verified Daniel chapters 1–12 and Jude chapter 1 through the actual [Bible API](https://bible-api.com/) using the local API, without importing content or mutating user data. The development database was backed up online before the local API restart.
