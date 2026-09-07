# Field Guide Academy Due Reviews Empty State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Reviews chapter visible when none are due and explain the empty state, without changing the Review start gate.

**Architecture:** `visibleAcademyTracks` always includes `review`. Student home and nav already render that list. Existing `academyUnavailableCopy("review")` and `canStartAcademyTrack("review")` already distinguish empty vs due vs Active-closed.

**Tech Stack:** React 19.2, React Router 7, Vitest 4, Testing Library. Official docs: https://react.dev https://vitest.dev/guide/ https://testing-library.com/docs/react-testing-library/intro/

## Global Constraints

- Branch from `origin/main` at `16f7e87434dcf5c09aa09720d10edb2a6e612aa1`. Do not restart abandoned local SHAs.
- Preserve API/auth/study-session/idempotency/tenant contracts.
- Honest UI only: no invented due counts, streaks, or mastery.
- No new general-purpose UI libraries.
- Keep Playwright testids `start-reviews`, `nav-academy-review`, `academy-track-review`, and API modes Practice / Review / Simulation.
- Do not deploy, change DNS, mutate live Firebase, upload NKJV, or touch production secrets.

## File map

- Modify: `apps/web/src/features/student/academyTracks.test.ts`
- Modify: `apps/web/src/features/student/academyTracks.ts`
- Modify: `apps/web/src/features/student/StudentHomePage.test.tsx`
- Modify: `apps/web/src/layouts/AppShell.test.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

---

### Task 1: Keep Reviews visible when none are due

**Files:**
- Modify: `apps/web/src/features/student/academyTracks.test.ts`
- Modify: `apps/web/src/features/student/academyTracks.ts`
- Modify: `apps/web/src/features/student/StudentHomePage.test.tsx`
- Modify: `apps/web/src/layouts/AppShell.test.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

**Interfaces:**
- Consumes: existing `visibleAcademyTracks`, `canStartAcademyTrack`, `academyUnavailableCopy`
- Produces: `visibleAcademyTracks` always includes `"review"` after `"learner"`

- [ ] **Step 1: Write the failing track assertions**

```ts
it("always includes learner and reviews and hides rehearsal until the season is Active", () => {
  expect(visibleAcademyTracks(undefined)).toEqual(["learner", "review"]);
  expect(visibleAcademyTracks({ seasonStatus: "Draft", reviewDueCount: 0 })).toEqual([
    "learner",
    "review",
  ]);
});

it("keeps reviews when the season is Active even if no reviews are due", () => {
  expect(visibleAcademyTracks({ seasonStatus: "Active", reviewDueCount: 0 })).toEqual([
    "learner",
    "review",
    "rehearsal",
  ]);
});
```

Student home (Draft, count 0): `academy-track-review` is present; clicking it shows `No passages are due for review.` and hides `start-reviews`.

AppShell (Draft or Active, count 0): `nav-academy-review` is present and points at `/student/study?mode=Review`.

- [ ] **Step 2: Run** `npm run test:web -- src/features/student/academyTracks.test.ts src/features/student/StudentHomePage.test.tsx src/layouts/AppShell.test.tsx` and confirm FAIL (Reviews still hidden when count is 0).
- [ ] **Step 3: Always push `review` in `visibleAcademyTracks`. Leave the start gate and unavailable copy unchanged. Update the brand-guide sentence that Reviews stay visible when due so it also covers the empty chapter.
- [ ] **Step 4: Run** the same tests and confirm PASS.
- [ ] **Step 5: Commit**
