# Field Guide Academy Deck Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name landing decks and the learner `DeckStack` with Learner / Reviews / Rehearsal using only real progress fields.

**Architecture:** Relabel the existing landing artwork and `DeckStack` columns. Learner and Reviews keep numeric counts from assignments and `reviewDueCount`. Rehearsal shows `seasonStatus` or `—` because no rehearsal count exists.

**Tech Stack:** React 19.2, React Router 7, Vitest 4, Testing Library. Official docs: https://react.dev https://vitest.dev/guide/ https://testing-library.com/docs/react-testing-library/intro/

## Global Constraints

- Branch from `origin/main` at `9058dfb80b49a2c6edfbba39ec264c72f1323130`. Do not restart abandoned local SHAs.
- Preserve API/auth/study-session/idempotency/tenant contracts.
- Honest UI only: no invented streaks, mastery, or rehearsal counts.
- No new general-purpose UI libraries.
- Keep Playwright testids `start-studying` and `build-a-season`, and the three supplied deck image sources.
- Do not deploy, change DNS, mutate live Firebase, upload NKJV, or touch production secrets.

## File map

- Create: `apps/web/src/components/material/DeckStack.test.tsx`
- Modify: `apps/web/src/components/material/DeckStack.tsx`
- Modify: `apps/web/src/features/student/StudentHomePage.tsx`
- Modify: `apps/web/src/features/student/StudentHomePage.test.tsx`
- Modify: `apps/web/src/test/landingPage.test.tsx`
- Modify: `apps/web/src/features/marketing/LandingPage.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

---

### Task 1: DeckStack uses academy track labels

**Files:**
- Create: `apps/web/src/components/material/DeckStack.test.tsx`
- Modify: `apps/web/src/components/material/DeckStack.tsx`
- Modify: `apps/web/src/features/student/StudentHomePage.tsx`
- Modify: `apps/web/src/features/student/StudentHomePage.test.tsx`

**Interfaces:**
- Consumes: `learner: number`, `reviews: number`, `seasonStatus?: string | null`
- Produces: `deck-stack` with `deck-learner`, `deck-reviews`, `deck-rehearsal`

- [ ] **Step 1: Write the failing tests**

```tsx
it("labels today's deck with academy tracks and honest fields", () => {
  render(<DeckStack learner={2} reviews={3} seasonStatus="Active" />);

  expect(screen.getByTestId("deck-stack")).toHaveTextContent("Learner");
  expect(screen.getByTestId("deck-stack")).toHaveTextContent("Reviews");
  expect(screen.getByTestId("deck-stack")).toHaveTextContent("Rehearsal");
  expect(screen.getByTestId("deck-learner")).toHaveTextContent("2");
  expect(screen.getByTestId("deck-reviews")).toHaveTextContent("3");
  expect(screen.getByTestId("deck-rehearsal")).toHaveTextContent("Active");
  expect(screen.getByTestId("deck-stack")).not.toHaveTextContent("Due");
  expect(screen.getByTestId("deck-stack")).not.toHaveTextContent("New");
  expect(screen.queryByTestId("deck-due")).not.toBeInTheDocument();
});

it("shows an em dash when rehearsal has no season status", () => {
  render(<DeckStack learner={0} reviews={0} />);
  expect(screen.getByTestId("deck-rehearsal")).toHaveTextContent("—");
});
```

- [ ] **Step 2: Run** `npm run test:web -- src/components/material/DeckStack.test.tsx` and confirm FAIL (missing labels / testids).
- [ ] **Step 3: Relabel `DeckStack` and wire StudentHomePage to `assignments.length`, `reviewDueCount`, and `seasonStatus`.
- [ ] **Step 4: Assert the home page deck uses those honest fields.
- [ ] **Step 5: Run** the DeckStack and StudentHomePage tests and confirm PASS.

---

### Task 2: Landing decks use academy track names

**Files:**
- Modify: `apps/web/src/test/landingPage.test.tsx`
- Modify: `apps/web/src/features/marketing/LandingPage.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

**Interfaces:**
- Consumes: existing supplied deck image sources
- Produces: Learner / Reviews / Rehearsal deck names on `/`

- [ ] **Step 1: Write the failing landing assertions** for Learner deck / Reviews deck / Rehearsal deck alts, same image sources, and no New / Review / Simulation deck names.
- [ ] **Step 2: Run** `npm run test:web -- src/test/landingPage.test.tsx` and confirm FAIL (old alts).
- [ ] **Step 3: Rename the three landing deck labels only.
- [ ] **Step 4: Update the brand guide one-liner.
- [ ] **Step 5: Run** `npm run test:web`, `typecheck:web`, `lint:web`.
- [ ] **Step 6: Commit**
