# Coach UI refinement

The approved generated Training HQ / Focused Practice / Coach Workspace concept guides this change. Coach navigation now uses its horizontal navy masthead and cream tabs; the login uses the same logo, navy, teal, cream, and mountain artwork.

Season setup is a four-step flow: details, passages, student plans, review/start. It reads persisted inclusions and exclusions through the new authorized scope GET endpoint. Assignment fields no longer edit season scope. Each student's saved assignments and difficulty appear together. Named Bible books replace code-only entry, retaining custom codes and a fallback if the catalog is unavailable.

Saving freezes the relevant controls, preserves the submitted scope snapshot, and refreshes saved counts. Duplicate passage/role assignments are disabled. Active scope and closed-season controls are read-only in the UI. These UI restrictions do not introduce new server-side lifecycle rules.

The assignments page has an explicit season selector and links to that season's student plans. Student account forms have visible labels and blank masked passwords. Mobile progress renders readable student rows; student navigation retains the selected season.

## Validation

- 124 frontend tests pass, including 14 season workflow tests.
- 81 backend tests pass: 29 unit and 52 integration. Scope GET tests cover saved ranges and organization/role isolation.
- Lint, TypeScript, and production web build pass.
- Browser fixture regression: 10 desktop/mobile views, practice submission, reload recovery, next-card flow, and difficulty changes.
- Real isolated SQLite/API browser flow: create season, save scope, assign Foundation, reload, save Advanced, reload, review/start, confirm active scope is read-only, student login, start Advanced practice. Test seasons were created only in the isolated test database.
- Live app login and nine desktop/mobile screenshots checked for overflow, missing images, and runtime exceptions. Screenshots retained under ignored `apps/web/test-results/redesign`.

No deployment. No AI runtime capabilities were added. The user's local app remains on localhost:5173 with its API on localhost:5080.
