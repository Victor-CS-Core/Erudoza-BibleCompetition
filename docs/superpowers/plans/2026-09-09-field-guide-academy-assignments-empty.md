# Field Guide Academy Assignments Empty State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show `No assigned students yet.` on `/admin/assignments` only after a successful empty coverage load, and do not claim that sentence when there is no season.

**Architecture:** After a successful empty load (`coverage.data && coverage.data.students.length === 0`), keep the existing four-word sentence. When `coverage.data` is undefined, render neither the table nor that sentence. Touch only the coverage empty branch on `AssignmentsPage`.

**Tech Stack:** React 19.2, React Router 7, Vitest 4, Testing Library. Official docs: https://react.dev https://vitest.dev/guide/ https://testing-library.com/docs/react-testing-library/intro/

## Global Constraints

- Branch from `origin/main` at `8d7f981c7349c3556bcc96cb3ab968abf25a4768`. Do not restart abandoned local SHAs.
- Preserve API/auth/study-session/idempotency/tenant contracts.
- Honest UI only: no invented readiness, streaks, or mastery.
- No new general-purpose UI libraries.
- Keep Playwright testid `coverage-table` and API modes Practice / Review / Simulation.
- Do not deploy, change DNS, mutate live Firebase, upload NKJV, or touch production secrets.

## File map

- Modify: `apps/web/src/features/admin/SimpleAdminPages.test.tsx`
- Modify: `apps/web/src/features/admin/SimpleAdminPages.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

---

### Task 1: Gate the empty coverage sentence

**Files:**
- Modify: `apps/web/src/features/admin/SimpleAdminPages.test.tsx`
- Modify: `apps/web/src/features/admin/SimpleAdminPages.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

**Interfaces:**
- Consumes: existing `api.coverage` query (`SeasonCoverage`)
- Produces: visible sentence `No assigned students yet.` only when that query resolves with `students: []`

- [ ] **Step 1: Write the failing empty-state tests**

```ts
it("explains an empty coverage list without inventing readiness", async () => {
  vi.mocked(api.coverage).mockResolvedValue(coverage({ students: [] }));

  renderPage(<AssignmentsPage />);

  expect(await screen.findByText("No assigned students yet.")).toBeInTheDocument();
  expect(screen.queryByTestId("coverage-table")).not.toBeInTheDocument();
  expect(screen.getByText("Daniel Gauntlet · Active")).toBeInTheDocument();
});
```

Existing no-season coverage test must also assert it does not show `No assigned students yet.`
Existing populated coverage test must also assert it does not show `No assigned students yet.`

- [ ] **Step 2: Run** `npm run test:web -- src/features/admin/SimpleAdminPages.test.tsx` and confirm FAIL (no-season folio still says `No assigned students yet.`).
- [ ] **Step 3: Render** `No assigned students yet.` when `coverage.data && coverage.data.students.length === 0` on `AssignmentsPage`. Update the brand-guide sentence.
- [ ] **Step 4: Run** the same test and confirm PASS.
- [ ] **Step 5: Commit**
