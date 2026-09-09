# Field Guide Academy Content Packs Empty State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the content-packs API returns `[]`, the coach content folio says `No content packs yet.` without inventing readiness or hiding Import translation / Import pack.

**Architecture:** After a successful empty load (`packs.data && packs.data.length === 0`), render the same three-word sentence pattern already used by seasons / students / coverage / questions / progress empty lists. Touch only the blank content-packs `<ul>` on `/admin/content`.

**Tech Stack:** React 19.2, React Router 7, Vitest 4, Testing Library. Official docs: https://react.dev https://vitest.dev/guide/ https://testing-library.com/docs/react-testing-library/intro/

## Global Constraints

- Branch from `origin/main` at `7434a8f6ed793410f03938aff96915e86ce6a473`. Do not restart abandoned local SHAs.
- Preserve API/auth/study-session/idempotency/tenant contracts.
- Honest UI only: no invented readiness, streaks, or mastery.
- No new general-purpose UI libraries.
- Keep Playwright testids `content-pack`, `import-catalog-submit`, `load-sample-pack`, and `import-pack-submit`, and API modes Practice / Review / Simulation.
- Do not deploy, change DNS, mutate live Firebase, upload NKJV, or touch production secrets.

## File map

- Modify: `apps/web/src/features/admin/ContentPage.test.tsx`
- Modify: `apps/web/src/features/admin/ContentPage.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

---

### Task 1: Name the empty content folio

**Files:**
- Modify: `apps/web/src/features/admin/ContentPage.test.tsx`
- Modify: `apps/web/src/features/admin/ContentPage.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

**Interfaces:**
- Consumes: existing `api.contentPacks` query (`ContentPack[]`)
- Produces: visible sentence `No content packs yet.` when that query resolves to `[]`

- [ ] **Step 1: Write the failing empty-state test**

```ts
it("explains an empty content packs list without inventing readiness", async () => {
  vi.mocked(api.contentPacks).mockResolvedValue([]);

  renderPage();

  expect(await screen.findByText("No content packs yet.")).toBeInTheDocument();
  expect(screen.getByTestId("import-catalog-submit")).toBeInTheDocument();
  expect(screen.getByTestId("load-sample-pack")).toBeInTheDocument();
  expect(screen.getByTestId("import-pack-submit")).toBeInTheDocument();
  expect(screen.queryByTestId("content-pack")).not.toBeInTheDocument();
});
```

Existing populated-list test must also assert it does not show `No content packs yet.`

- [ ] **Step 2: Run** `npm run test:web -- src/features/admin/ContentPage.test.tsx` and confirm FAIL (empty list stays blank).
- [ ] **Step 3: Render** `No content packs yet.` when `packs.data && packs.data.length === 0` on `ContentPage`. Update the brand-guide sentence.
- [ ] **Step 4: Run** the same test and confirm PASS.
- [ ] **Step 5: Commit**
