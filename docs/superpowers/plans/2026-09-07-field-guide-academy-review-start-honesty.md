# Field Guide Academy Review Start Honesty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the Reviews CTA and refuse Review starts unless `seasonStatus` is Active and reviews are due, matching the study-session API.

**Architecture:** Tighten `canStartAcademyTrack` for the review track. Pass progress into `academyUnavailableCopy` so Draft+due reviews get an Active-season sentence instead of “none due.” Student home and study page already consult the start gate.

**Tech Stack:** React 19.2, React Router 7, TanStack Query 5, Vitest 4, Testing Library. Official docs: https://react.dev https://vitest.dev/guide/ https://testing-library.com/docs/react-testing-library/intro/

## Global Constraints

- Branch from `origin/main` at `0f9904de56529c757b19b032ca6caf321d231938`. Do not restart abandoned local SHAs.
- Preserve API/auth/study-session/idempotency/tenant contracts.
- Honest UI only: no invented streaks, mastery, or achievements.
- No new general-purpose UI libraries.
- Keep Playwright testids `start-reviews`, `field-guide-academy`, `academy-session-kicker`, `nav-academy-review`, `current-season` when Review is startable.
- Do not deploy, change DNS, mutate live Firebase, upload NKJV, or touch production secrets.

## File map

- Modify: `apps/web/src/features/student/academyTracks.ts`
- Modify: `apps/web/src/features/student/academyTracks.test.ts`
- Modify: `apps/web/src/features/student/StudentHomePage.tsx`
- Modify: `apps/web/src/features/student/StudentHomePage.test.tsx`
- Modify: `apps/web/src/features/student/StudyPage.tsx`
- Modify: `apps/web/src/features/student/StudyPage.test.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

---

### Task 1: Review start gate

**Files:**
- Modify: `apps/web/src/features/student/academyTracks.ts`
- Test: `apps/web/src/features/student/academyTracks.test.ts`

**Interfaces:**
- Consumes: `canStartAcademyTrack`, `academyUnavailableCopy`, progress `seasonStatus` and `reviewDueCount`
- Produces: review start only when Active and due; honest unavailable copy

- [ ] **Step 1: Write the failing tests**

```ts
it("blocks review until the season is Active and reviewDueCount is positive", () => {
  expect(canStartAcademyTrack("review", { seasonStatus: "Active", reviewDueCount: 0 })).toBe(false);
  expect(canStartAcademyTrack("review", { seasonStatus: "Draft", reviewDueCount: 2 })).toBe(false);
  expect(canStartAcademyTrack("review", { seasonStatus: "ContentReady", reviewDueCount: 2 })).toBe(false);
  expect(canStartAcademyTrack("review", { seasonStatus: "None", reviewDueCount: 2 })).toBe(false);
  expect(canStartAcademyTrack("review", { seasonStatus: "Active", reviewDueCount: 2 })).toBe(true);
});

it("explains hidden tracks without inventing scores", () => {
  expect(academyUnavailableCopy("review")).toBe("No passages are due for review.");
  expect(academyUnavailableCopy("review", { seasonStatus: "Draft", reviewDueCount: 2 })).toBe(
    "Reviews open when this season is Active.",
  );
  expect(academyUnavailableCopy("review", { seasonStatus: "Active", reviewDueCount: 0 })).toBe(
    "No passages are due for review.",
  );
});
```

Replace the current “blocks review until reviewDueCount is positive” case that still allows Draft + due.

- [ ] **Step 2: Run** `npm run test:web -- src/features/student/academyTracks.test.ts` and confirm FAIL.
- [ ] **Step 3: Implement** review start as Active **and** `reviewDueCount > 0`. Teach `academyUnavailableCopy` an optional progress argument.
- [ ] **Step 4: Run tests until PASS.**
- [ ] **Step 5: Commit**

---

### Task 2: Hide Reviews CTA on student home

**Files:**
- Modify: `apps/web/src/features/student/StudentHomePage.test.tsx`
- Modify: `apps/web/src/features/student/StudentHomePage.tsx`

- [ ] **Step 1: Write a failing test** — Draft + `reviewDueCount: 3` keeps `academy-track-review`, has no `start-reviews`, and shows `Reviews open when this season is Active.`
- [ ] **Step 2: Run** `npm run test:web -- src/features/student/StudentHomePage.test.tsx` and confirm FAIL.
- [ ] **Step 3: Pass progress into `academyUnavailableCopy(selected, data)`. CTA already uses `canStartAcademyTrack`.
- [ ] **Step 4: Run tests until PASS.**
- [ ] **Step 5: Commit**

---

### Task 3: Study page refuses Review on non-Active seasons

**Files:**
- Modify: `apps/web/src/features/student/StudyPage.test.tsx`
- Modify: `apps/web/src/features/student/StudyPage.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

- [ ] **Step 1: Write a failing test** — Review with `seasonStatus: "Draft"` and `reviewDueCount: 2` does not call `startSession` and shows the Active-season review copy on the cover.
- [ ] **Step 2: Pass progress into `academyUnavailableCopy(track, progress.data)`. StudyPage already consults `canStartAcademyTrack`.
- [ ] **Step 3: Update the brand guide one-liner.
- [ ] **Step 4: Run** `npm run test:web`, `typecheck:web`, `lint:web`.
- [ ] **Step 5: Commit**
