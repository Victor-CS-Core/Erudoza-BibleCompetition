# Field Guide Academy Landing Cover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Field Guide Academy cover on `/` without replacing the hero, supplied deck artwork, or landing CTAs.

**Architecture:** Place the existing `FieldGuideCover` above the landing hero. Cover has no chapter line because landing has no signed-in organization or season. Remove the hero eyebrow that only repeated the academy name.

**Tech Stack:** React 19.2, React Router 7, Vitest 4, Testing Library. Official docs: https://react.dev https://vitest.dev/guide/ https://testing-library.com/docs/react-testing-library/intro/

## Global Constraints

- Branch from `origin/main` at `e78fa7ec4f165fd9fc3911ae3e2b69ba6df79152`. Do not restart abandoned local SHAs.
- Preserve API/auth/study-session/idempotency/tenant contracts.
- Honest UI only: no invented streaks, mastery, or achievements.
- No new general-purpose UI libraries.
- Keep Playwright testids `start-studying` and `build-a-season`, and the three supplied deck image sources.
- Do not deploy, change DNS, mutate live Firebase, upload NKJV, or touch production secrets.

## File map

- Modify: `apps/web/src/test/landingPage.test.tsx`
- Modify: `apps/web/src/features/marketing/LandingPage.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

---

### Task 1: Landing page uses Field Guide cover

**Files:**
- Modify: `apps/web/src/test/landingPage.test.tsx`
- Modify: `apps/web/src/features/marketing/LandingPage.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

**Interfaces:**
- Consumes: existing `FieldGuideCover` and landing `Link`s to `/login`
- Produces: `data-testid="field-guide-academy"` cover titled Field Guide Academy above the unchanged hero and decks

- [x] **Step 1: Write the failing tests**

```tsx
it("opens on the Field Guide Academy cover and keeps the training decks", () => {
  renderLanding();

  const cover = screen.getByTestId("field-guide-academy");
  expect(screen.getByRole("heading", { name: "Field Guide Academy" })).toBeInTheDocument();
  expect(screen.queryByTestId("academy-chapter-line")).not.toBeInTheDocument();
  expect(cover).not.toHaveTextContent("%");
  expect(cover).not.toHaveTextContent("streak");
  expect(screen.getByRole("heading", { name: "Know the passage. Own the moment." })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Choose today’s training deck" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "New deck" })).toHaveAttribute("src", "/brand/deck-new.webp");
  expect(screen.getByRole("img", { name: "Review deck" })).toHaveAttribute("src", "/brand/deck-review.webp");
  expect(screen.getByRole("img", { name: "Simulation deck" })).toHaveAttribute(
    "src",
    "/brand/deck-simulation.webp",
  );
  expect(screen.getByTestId("start-studying")).toBeInTheDocument();
  expect(screen.getByTestId("build-a-season")).toBeInTheDocument();
});
```

- [x] **Step 2: Run** `npm run test:web -- src/test/landingPage.test.tsx` and confirm FAIL (missing `field-guide-academy`).
- [x] **Step 3: Place `FieldGuideCover` above the existing hero. Remove the hero eyebrow. Keep deck images and CTAs.
- [x] **Step 4: Update the brand guide one-liner.
- [x] **Step 5: Run** `npm run test:web`, `typecheck:web`, `lint:web`.
- [x] **Step 6: Commit**
