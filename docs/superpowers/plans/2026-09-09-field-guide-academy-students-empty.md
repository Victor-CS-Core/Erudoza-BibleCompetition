# Field Guide Academy Students Empty State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the students API returns `[]`, the coach students folio says `No students yet.` without inventing readiness or hiding Add student.

**Architecture:** After a successful empty load (`students.data && students.data.length === 0`), render the same three-word sentence pattern already used by seasons / coverage / questions / progress empty lists. Touch only the blank students `<ul>` on `/admin/students`.

**Tech Stack:** React 19.2, React Router 7, Vitest 4, Testing Library. Official docs: https://react.dev https://vitest.dev/guide/ https://testing-library.com/docs/react-testing-library/intro/

## Global Constraints

- Branch from `origin/main` at `ea112195fd7c59cd84cb82930543b2be4f9603d0`. Do not restart abandoned local SHAs.
- Preserve API/auth/study-session/idempotency/tenant contracts.
- Honest UI only: no invented readiness, streaks, or mastery.
- No new general-purpose UI libraries.
- Keep Playwright testids `student-list` and `add-student`, and API modes Practice / Review / Simulation.
- Do not deploy, change DNS, mutate live Firebase, upload NKJV, or touch production secrets.

## File map

- Modify: `apps/web/src/features/admin/SimpleAdminPages.test.tsx`
- Modify: `apps/web/src/features/admin/SimpleAdminPages.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

---

### Task 1: Name the empty students folio

**Files:**
- Modify: `apps/web/src/features/admin/SimpleAdminPages.test.tsx`
- Modify: `apps/web/src/features/admin/SimpleAdminPages.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

**Interfaces:**
- Consumes: existing `api.students` query (`Student[]`)
- Produces: visible sentence `No students yet.` when that query resolves to `[]`

- [ ] **Step 1: Write the failing empty-state test**

```ts
it("explains an empty students list without inventing readiness", async () => {
  vi.mocked(api.students).mockResolvedValue([]);

  renderPage(<StudentsPage />);

  expect(await screen.findByText("No students yet.")).toBeInTheDocument();
  expect(screen.getByTestId("add-student")).toBeInTheDocument();
  expect(screen.queryByText("daniel.student")).not.toBeInTheDocument();
});
```

Existing populated-list test must also assert it does not show `No students yet.`

- [ ] **Step 2: Run** `npm run test:web -- src/features/admin/SimpleAdminPages.test.tsx` and confirm FAIL (empty list stays blank).
- [ ] **Step 3: Render** `No students yet.` when `students.data && students.data.length === 0` on `StudentsPage`. Update the brand-guide sentence.
- [ ] **Step 4: Run** the same test and confirm PASS.
- [ ] **Step 5: Commit**
