# Project instructions

## Read first: shared progress and checkpoints

Before starting repository work, every agent must read [`PROGRESS.md`](PROGRESS.md). Use its current state, active work, completed gates, blockers, and next steps to avoid duplicating or conflicting with other work. Then read the instructions and evidence relevant to the files being changed. Verify facts that may have changed since the log entry.

Update `PROGRESS.md` whenever a gate is reached, a material blocker changes, or work is handed off. Record the outcome, concrete validation and its limits, relevant paths, and the next action. Distinguish local verification, a Git checkpoint, a pushed branch, and a live deployment; one does not establish the others. Keep credentials, tokens, private data, and generated test artifacts out of the log.

At coherent, verified gates, review and commit the in-scope changes and push the current task branch to keep the remote current. Use explicit staging, preserve unrelated changes, and record the checkpoint in the log. Do not force-push or merge to the default branch without authorization. If a check, push, or deployment is blocked, record the exact blocker and what remains; do not label the gate complete. Coordinate with active agents before staging shared files.

# graphify
- When the user types `/graphify`, invoke the graphify skill before other work.

<!-- bm-design-system:start -->
## Design system

Read `DESIGN.md` before changing UI. The live reference is `/admin/design-system`.
Reuse primitives in `apps/web/src/components/ui/index.tsx` and semantic tokens in `apps/web/src/styles/tokens.css`.
Buttons, fields, panels, page headers, badges and notices must use these primitives. Page-specific CSS is for layout, not alternate color, typography or control systems.
Preserve the Erudoza brand, existing workflow semantics, routes, accessibility, and deterministic activity behavior. Use the system sans for interface text and serif only for Scripture and branding.
New UI patterns should extend the shared system when reused. Verify coach and student screens together on desktop and mobile after shared styling changes.
<!-- bm-design-system:end -->

## Learner parity (standing rule, 2026-09-18)

Never gate student features away from coaches. Coaches have a student mode and
sometimes compete themselves, so an Adult Owner/Admin in learner mode must be
able to reach everything a Student can. Strict `student()` checks on
learner-facing paths have caused real 403/404 bugs (PBE chapter progress,
season cooperation). Use `requireLearner()` / `learner()` (Student/Student OR
Adult Owner/Admin), never a Student-only check, on any learner-facing route,
query, or capability.

## Wiki release gate

Before merging any user-facing feature, behavior, or visual change to `main`, review the authenticated wiki at `/wiki`:

- Update the relevant article, search keywords, route links, control explanations, and screenshot when the workflow or UI changes.
- If no wiki update is needed, record the reason in the task handoff and `PROGRESS.md`.
- Keep screenshots sanitized and sourced from seeded local/demo data only; never capture production accounts, credentials, or private student data.
- Run the focused wiki coverage check: `npm --workspace apps/web run test:wiki`.
- Include wiki search, article links, responsive layout, and screenshot review in release/deployment acceptance.

The authoring workflow and article field guide live in [`docs/wiki/README.md`](docs/wiki/README.md).
