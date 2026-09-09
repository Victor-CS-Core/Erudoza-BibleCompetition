# Field Guide Academy Seasons Empty State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the seasons API returns `[]`, the coach seasons folio says `No seasons yet.` without inventing readiness or hiding Create season.

**Architecture:** After a successful empty load (`seasons.data && seasons.data.length === 0`), render the same three-word sentence already used by coverage / questions / progress empty lists. Touch only the three blank seasons `<ul>`s on `/admin` and `/admin/seasons`.

**Tech Stack:** React 19.2, React Router 7, Vitest 4, Testing Library. Official docs: https://react.dev https://vitest.dev/guide/ https://testing-library.com/docs/react-testing-library/intro/

## Global Constraints

- Branch from `origin/main` at `6eb72630d64e011e25ab03ab5d55d808b5e019ae`. Do not restart abandoned local SHAs.
- Preserve API/auth/study-session/idempotency/tenant contracts.
- Honest UI only: no invented readiness, streaks, or mastery.
- No new general-purpose UI libraries.
- Keep Playwright testid `create-season` and API modes Practice / Review / Simulation.
- Do not deploy, change DNS, mutate live Firebase, upload NKJV, or touch production secrets.

## File map

- Modify: `apps/web/src/features/admin/AdminHomePage.test.tsx`
- Modify: `apps/web/src/features/admin/AdminHomePage.tsx`
- Modify: `apps/web/src/features/admin/SimpleAdminPages.test.tsx`
- Modify: `apps/web/src/features/admin/SimpleAdminPages.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

---

### Task 1: Name the empty seasons folio

**Files:**
- Modify: `apps/web/src/features/admin/AdminHomePage.test.tsx`
- Modify: `apps/web/src/features/admin/SimpleAdminPages.test.tsx`
- Modify: `apps/web/src/features/admin/AdminHomePage.tsx`
- Modify: `apps/web/src/features/admin/SimpleAdminPages.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

**Interfaces:**
- Consumes: existing `api.seasons` query (`Season[]`)
- Produces: visible sentence `No seasons yet.` when that query resolves to `[]`

- [x] **Step 1: Write the failing empty-state tests**

```ts
it("explains an empty seasons folio without inventing readiness", async () => {
  vi.mocked(api.seasons).mockResolvedValue([]);

  renderHome();

  const folio = await screen.findByTestId("season-readiness-folio");
  expect(folio).toHaveTextContent("No seasons yet.");
  expect(folio).not.toHaveTextContent("%");
  expect(folio).not.toHaveTextContent("streak");
  expect(screen.getByTestId("create-season")).toHaveAttribute("href", "/admin/seasons/new");
});
```

```ts
it("explains an empty seasons list without inventing readiness", async () => {
  vi.mocked(api.seasons).mockResolvedValue([]);

  renderPage(<SeasonsListPage />);

  expect(await screen.findByText("No seasons yet.")).toBeInTheDocument();
  expect(screen.getByTestId("create-season")).toHaveAttribute("href", "/admin/seasons/new");
  expect(screen.queryByText(/Imported Joshua/)).not.toBeInTheDocument();
});
```

Existing populated-list tests must also assert they do not show `No seasons yet.`

- [x] **Step 2: Run** `npm run test:web -- src/features/admin/AdminHomePage.test.tsx src/features/admin/SimpleAdminPages.test.tsx` and confirm FAIL (empty lists stay blank).
- [x] **Step 3: Render** `No seasons yet.` when `seasons.data && seasons.data.length === 0` on the admin home readiness folio, the admin home paper list, and `SeasonsListPage`. Update the brand-guide sentence.
- [x] **Step 4: Run** the same tests and confirm PASS.
- [x] **Step 5: Commit**
