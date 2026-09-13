# Assignments layout refinement

The user approved a bounded refinement of the live coach assignments page: one aligned content width, a main passage editor, and a narrower sidebar containing saved passages followed by training difficulty. Below 900px the panels stack; the existing phone assignment action remains sticky within the editor. Both the standalone assignments route and season setup use the same composition.

The implementation reuses shared Panel, Badge, Button, Select and Input primitives and semantic spacing tokens. Named regions expose the editor, saved passages and difficulty settings. The standalone page no longer repeats the student name inside the editor; season setup retains the selected student's name. Saved passages have an explicit empty state and stored row count. The relocated difficulty fieldset retains its own closed/pending lock. Assignment handlers, payloads, exclusions, correction/removal dialogs and difficulty persistence are unchanged.

## Local verification

- Baseline: 57 existing assignment, chapter and season tests passed.
- After layout changes, six existing checks stopped at the intentionally replaced student-name heading. Updated those selectors while preserving their selected-student payload, difficulty, duplicate and read-only assertions. All 57 passed.
- Full frontend suite: 535 tests passed across 62 files. Native production build, web/native TypeScript, full ESLint and Git whitespace passed. The existing bundle-size advisory remains.
- Independent read-only source review found no blocking findings. It identified student MyAssignments as another consumer of the context-row alignment, which was included in browser verification.
- Chrome local production-build preview: standalone assignments at 1440/390/320; season setup precise-verse controls at 1440/320; student-mode My assignments at 1440/390/320. Checked panel alignment, stacked layouts, selected and empty states, stored Scripture choices, and sticky assignment action while scrolling. Measured document scroll width equaled client width (1425 or 1440 desktop; 375 at 390; 305 at 320). No horizontal overflow in these checks.
- Local synthetic browser flow selected and saved a chapter, observed its saved row and disabled already-assigned chapter, changed difficulty, and exercised student switching. Existing component tests cover server-error/partial-retry, correction/removal confirmation, duplicate and closed-season behavior.

## Limits and handoff

Browser data comes from a loopback-only in-memory fixture using stored NKJV coordinates. It is a visual/application interaction check, not authenticated production or actual-provider persistence evidence. No production assignments were changed. Full backend suites, remote CI, physical phones, main integration and deployment are not claimed.

The ignored fixture serves the built app at http://127.0.0.1:5243/admin/assignments?seasonId=demo&studentId=daniel via the temporary user service `erudoza-assignments-preview`. It is not enabled at login. Preview mutations affect only synthetic in-memory data. Source worktree: `.worktrees/assignments-layout`; branch: `codex/assignments-layout`.
