# Field Guide Academy Coach List Cover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Field Guide Academy cover on the remaining coach list pages and show only real organization or season chapter lines.

**Architecture:** Add `academyCoachChapterLine` next to the coach pages. Wrap seasons, students, content, assignments, and questions with the existing `FieldGuideCover` above the current `PaperSurface` sheets. Keep list/form queries and gauntlet testids unchanged.

**Tech Stack:** React 19.2, React Router 7, TanStack Query 5, Vitest 4, Testing Library. Official docs: https://react.dev https://vitest.dev/guide/ https://testing-library.com/docs/react-testing-library/intro/

## Global Constraints

- Branch from `origin/main` at `78915f701d43b0a70de3c296542978f0fe122014`. Do not restart abandoned local SHAs.
- Preserve API/auth/study-session/idempotency/tenant contracts.
- Honest UI only: no invented streaks, mastery, or achievements.
- No new general-purpose UI libraries.
- Keep Playwright testids `create-season`, `student-list`, `add-student`, `coverage-table`, `load-sample-pack`, `import-pack-submit`, `content-pack`, `source-unit-list`, `run-generation`, `question-review-list`.
- Do not deploy, change DNS, mutate live Firebase, upload NKJV, or touch production secrets.

## File map

- Create: `apps/web/src/features/admin/academyCover.ts`
- Create: `apps/web/src/features/admin/academyCover.test.ts`
- Create: `apps/web/src/features/admin/SimpleAdminPages.test.tsx`
- Create: `apps/web/src/features/admin/ContentPage.test.tsx`
- Modify: `apps/web/src/features/admin/SimpleAdminPages.tsx`
- Modify: `apps/web/src/features/admin/ContentPage.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

---

### Task 1: Honest coach chapter line

**Files:**
- Create: `apps/web/src/features/admin/academyCover.ts`
- Test: `apps/web/src/features/admin/academyCover.test.ts`

**Interfaces:**
- Consumes: optional `organizationName`, `seasonName`, `seasonStatus`
- Produces: `{name} · {status}` when both season fields exist; otherwise organization name; otherwise empty

- [x] **Step 1: Write the failing tests**

```ts
it("names a season chapter from real name and status", () => {
  expect(academyCoachChapterLine({ seasonName: "Imported Joshua", seasonStatus: "Draft" })).toBe(
    "Imported Joshua · Draft",
  );
});

it("falls back to the organization name when no season is selected", () => {
  expect(academyCoachChapterLine({ organizationName: "Development Academy" })).toBe("Development Academy");
  expect(academyCoachChapterLine({ organizationName: "Development Academy", seasonName: "Imported Joshua" })).toBe(
    "Development Academy",
  );
});

it("stays empty instead of inventing readiness", () => {
  expect(academyCoachChapterLine({})).toBe("");
});
```

- [x] **Step 2: Run** `npm run test:web -- src/features/admin/academyCover.test.ts` and confirm FAIL.
- [x] **Step 3: Implement** `academyCoachChapterLine`.
- [x] **Step 4: Run tests until PASS.**
- [x] **Step 5: Commit**

---

### Task 2: Coach list pages use Field Guide cover

**Files:**
- Create: `apps/web/src/features/admin/SimpleAdminPages.test.tsx`
- Create: `apps/web/src/features/admin/ContentPage.test.tsx`
- Modify: `apps/web/src/features/admin/SimpleAdminPages.tsx`
- Modify: `apps/web/src/features/admin/ContentPage.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

- [x] **Step 1: Write failing tests** — each remaining coach list page shows `field-guide-academy` and an honest chapter line; seasons/students/content keep their list/form testids; assignments/questions show `{season.name} · {season.status}` from real API fields; no `%` or `streak`.
- [x] **Step 2: Run** `npm run test:web -- src/features/admin/SimpleAdminPages.test.tsx src/features/admin/ContentPage.test.tsx` and confirm FAIL.
- [x] **Step 3: Wrap each page with `FieldGuideCover` above the existing sheets and render `academyCoachChapterLine`.
- [x] **Step 4: Update the brand guide one-liner.
- [x] **Step 5: Run** `npm run test:web`, `typecheck:web`, `lint:web`.
- [x] **Step 6: Commit**
