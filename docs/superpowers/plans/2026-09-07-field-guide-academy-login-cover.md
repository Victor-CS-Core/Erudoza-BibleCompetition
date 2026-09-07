# Field Guide Academy Login Cover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Field Guide Academy cover on `/login` without changing the sign-in form or auth routing contract.

**Architecture:** Wrap the existing login `PaperSurface` with the same `FieldGuideCover` already used on learner and coach pages. Cover sits above the sheet. No chapter line because login has no signed-in organization or season.

**Tech Stack:** React 19.2, React Router 7, Vitest 4, Testing Library. Official docs: https://react.dev https://vitest.dev/guide/ https://testing-library.com/docs/react-testing-library/intro/

## Global Constraints

- Branch from `origin/main` at `a8419729cf64e123aed069a9db13c1fa92079158`. Do not restart abandoned local SHAs.
- Preserve API/auth/study-session/idempotency/tenant contracts.
- Honest UI only: no invented streaks, mastery, or achievements.
- No new general-purpose UI libraries.
- Keep Playwright testids `login-identifier`, `login-password`, `login-submit`.
- Do not deploy, change DNS, mutate live Firebase, upload NKJV, or touch production secrets.

## File map

- Create: `apps/web/src/features/auth/LoginPage.test.tsx`
- Modify: `apps/web/src/features/auth/LoginPage.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

---

### Task 1: Login page names Field Guide Academy

**Files:**
- Create: `apps/web/src/features/auth/LoginPage.test.tsx`
- Modify: `apps/web/src/features/auth/LoginPage.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

**Interfaces:**
- Consumes: existing `useAuth().login(identifier, password)` returning `Me`
- Produces: `data-testid="field-guide-academy"` cover titled Field Guide Academy above the unchanged sign-in sheet

- [ ] **Step 1: Write the failing tests**

```tsx
it("opens on the Field Guide Academy cover and keeps the sign-in form", () => {
  renderLogin();

  expect(screen.getByTestId("field-guide-academy")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Field Guide Academy" })).toBeInTheDocument();
  expect(screen.queryByTestId("academy-chapter-line")).not.toBeInTheDocument();
  expect(screen.getByTestId("login-identifier")).toBeInTheDocument();
  expect(screen.getByTestId("login-password")).toBeInTheDocument();
  expect(screen.getByTestId("login-submit")).toBeInTheDocument();
  expect(screen.getByTestId("field-guide-academy")).not.toHaveTextContent("%");
  expect(screen.getByTestId("field-guide-academy")).not.toHaveTextContent("streak");
});

it("sends a student to /student after login", async () => { /* mock login Student; submit; expect pathname /student */ });
it("sends an adult to /admin after login", async () => { /* mock login Adult; submit; expect pathname /admin */ });
it("stays on /login when sign-in fails", async () => { /* reject login; expect error copy; pathname /login */ });
```

- [ ] **Step 2: Run** `npm run test:web -- src/features/auth/LoginPage.test.tsx` and confirm FAIL (missing `field-guide-academy`).
- [ ] **Step 3: Wrap login with `FieldGuideCover` above the existing `PaperSurface`. Keep testids and `login()` routing.
- [ ] **Step 4: Update the brand guide one-liner.
- [ ] **Step 5: Run** `npm run test:web`, `typecheck:web`, `lint:web`.
- [ ] **Step 6: Commit**
