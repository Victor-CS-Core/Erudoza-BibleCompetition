# Field Guide Academy Landing Deck Art Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overlay Learner / Reviews / Rehearsal stamps on the landing training-deck cards so visible labels match `DeckStack`, without replacing supplied artwork or changing API modes.

**Architecture:** Keep the three supplied webps. Reuse `Stamp` as the overlay chrome already used on `FieldGuideCover`. A parchment band covers the baked-in NEW / REVIEW / SIMULATION titles. Tests assert the stamps and keep image sources / CTA testids.

**Tech Stack:** React 19.2, React Router 7, Vitest 4, Testing Library. Official docs: https://react.dev https://vitest.dev/guide/ https://testing-library.com/docs/react-testing-library/intro/

## Global Constraints

- Branch from `origin/main` at `7778af4cd98f3106d372e6a63abc263c7ccdea1b`. Do not restart abandoned local SHAs.
- Preserve API/auth/study-session/idempotency/tenant contracts.
- Honest UI only: no invented activity types, streaks, or mastery.
- No new general-purpose UI libraries. Do not invent new deck art.
- Keep Playwright testids `start-studying` and `build-a-season`, the three supplied deck image sources, and API modes Practice / Review / Simulation.
- Do not deploy, change DNS, mutate live Firebase, upload NKJV, or touch production secrets.

## File map

- Modify: `apps/web/src/test/landingPage.test.tsx`
- Modify: `apps/web/src/features/marketing/LandingPage.tsx`
- Modify: `apps/web/src/styles/materials.css`
- Modify: `docs/brand/erudoza-brand-guide.md`

---

### Task 1: Stamp academy names on landing decks

**Files:**
- Modify: `apps/web/src/test/landingPage.test.tsx`
- Modify: `apps/web/src/features/marketing/LandingPage.tsx`
- Modify: `apps/web/src/styles/materials.css`
- Modify: `docs/brand/erudoza-brand-guide.md`

**Interfaces:**
- Consumes: existing supplied deck image sources and `Stamp`
- Produces: visible Learner / Reviews / Rehearsal stamps on `/` deck cards

- [x] **Step 1: Write the failing assertions**

```ts
const learner = screen.getByRole("link", { name: "Open the learner deck" });
const reviews = screen.getByRole("link", { name: "Open the reviews deck" });
const rehearsal = screen.getByRole("link", { name: "Open the rehearsal deck" });
expect(within(learner).getByTestId("landing-deck-learner")).toHaveTextContent("Learner");
expect(within(reviews).getByTestId("landing-deck-reviews")).toHaveTextContent("Reviews");
expect(within(rehearsal).getByTestId("landing-deck-rehearsal")).toHaveTextContent("Rehearsal");
expect(screen.queryByTestId("landing-deck-new")).not.toBeInTheDocument();
expect(screen.queryByTestId("landing-deck-simulation")).not.toBeInTheDocument();
```

- [x] **Step 2: Run** `npm run test:web -- src/test/landingPage.test.tsx` and confirm FAIL (stamps missing).
- [x] **Step 3: Overlay `Stamp` on each deck link. Cover the baked-in title with `.er-deck-label`. Keep image sources, `er-deck-*` classes, and `start-studying` / `build-a-season`. Update the brand guide one-liner.
- [x] **Step 4: Run** `npm run test:web`, `typecheck:web`, `lint:web`.
- [x] **Step 5: Commit**
