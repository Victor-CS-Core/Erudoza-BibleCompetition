# Field Guide Academy Stored Verses Empty State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a selected content pack's source-units API returns `[]`, the stored-verses folio says `No stored verses yet.` without inventing readiness or hiding Import translation / Import pack.

**Architecture:** After a pack is selected and a successful empty load (`selectedPackId && units.data && units.data.length === 0`), render the same four-word sentence pattern already used by content packs / students / seasons empty lists. Touch only the blank stored-verses `<ul>` on `/admin/content`.

**Tech Stack:** React 19.2, React Router 7, Vitest 4, Testing Library. Official docs: https://react.dev https://vitest.dev/guide/ https://testing-library.com/docs/react-testing-library/intro/

## Global Constraints

- Branch from `origin/main` at `8d7f981c7349c3556bcc96cb3ab968abf25a4768`. Do not restart abandoned local SHAs. Do not take open PR #33's assignments change.
- Preserve API/auth/study-session/idempotency/tenant contracts.
- Honest UI only: no invented readiness, streaks, or mastery.
- No new general-purpose UI libraries.
- Keep Playwright testids `content-pack`, `source-unit-list`, `import-catalog-submit`, `load-sample-pack`, and `import-pack-submit`, and API modes Practice / Review / Simulation.
- Do not deploy, change DNS, mutate live Firebase, upload NKJV, or touch production secrets.

## File map

- Modify: `apps/web/src/features/admin/ContentPage.test.tsx`
- Modify: `apps/web/src/features/admin/ContentPage.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

---

### Task 1: Name the empty stored-verses folio

**Files:**
- Modify: `apps/web/src/features/admin/ContentPage.test.tsx`
- Modify: `apps/web/src/features/admin/ContentPage.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

**Interfaces:**
- Consumes: existing `api.sourceUnits` query (`SourceUnit[]`) after a pack is selected
- Produces: visible sentence `No stored verses yet.` when that query resolves to `[]`

- [ ] **Step 1: Write the failing empty-state test**

```ts
it("explains an empty stored verses list without inventing readiness", async () => {
  vi.mocked(api.sourceUnits).mockResolvedValue([]);

  renderPage();

  fireEvent.click(await screen.findByTestId("content-pack"));

  expect(await screen.findByText("No stored verses yet.")).toBeInTheDocument();
  expect(screen.getByTestId("source-unit-list")).toBeInTheDocument();
  expect(screen.getByTestId("import-catalog-submit")).toBeInTheDocument();
  expect(screen.getByTestId("load-sample-pack")).toBeInTheDocument();
  expect(screen.getByTestId("import-pack-submit")).toBeInTheDocument();
  expect(api.sourceUnits).toHaveBeenCalledWith("org-1", "pack-1");
});
```

Existing populated-list test must also select the pack, show a real citation, and assert it does not show `No stored verses yet.` Empty content-packs test must keep asserting the stored-verses folio stays closed.

- [ ] **Step 2: Run** `npm run test:web -- src/features/admin/ContentPage.test.tsx` and confirm FAIL (selected pack with `[]` units stays blank).
- [ ] **Step 3: Render** `No stored verses yet.` when `units.data && units.data.length === 0` on `ContentPage`. Update the brand-guide sentence.
- [ ] **Step 4: Run** the same test and confirm PASS.
- [ ] **Step 5: Commit**
