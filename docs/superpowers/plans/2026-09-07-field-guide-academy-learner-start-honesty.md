# Field Guide Academy Learner Start Honesty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the Learner CTA and refuse Practice starts unless `seasonStatus` is Active, matching the study-session API.

**Architecture:** Tighten `canStartAcademyTrack` for the learner track. Student home swaps the CTA for existing unavailable copy. Study page already skips `startSession` when the gate fails.

**Tech Stack:** React 19.2, React Router 7, TanStack Query 5, Vitest 4, Testing Library. Official docs: https://react.dev https://vitest.dev/guide/ https://testing-library.com/docs/react-testing-library/intro/

## Global Constraints

- Branch from `origin/main` at `45a7c8f8cd33793a2dcaae0cd567651d12792494`. Do not restart abandoned local SHAs.
- Preserve API/auth/study-session/idempotency/tenant contracts.
- Honest UI only: no invented streaks, mastery, or achievements.
- No new general-purpose UI libraries.
- Keep Playwright testids `start-todays-deck`, `field-guide-academy`, `academy-session-kicker`, `nav-academy-learner`, `current-season` when the season is Active.
- Do not deploy, change DNS, mutate live Firebase, upload NKJV, or touch production secrets.

## File map

- Modify: `apps/web/src/features/student/academyTracks.ts`
- Modify: `apps/web/src/features/student/academyTracks.test.ts`
- Modify: `apps/web/src/features/student/StudentHomePage.tsx`
- Modify: `apps/web/src/features/student/StudentHomePage.test.tsx`
- Modify: `apps/web/src/features/student/StudyPage.test.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

---

### Task 1: Learner start gate

**Files:**
- Modify: `apps/web/src/features/student/academyTracks.ts`
- Test: `apps/web/src/features/student/academyTracks.test.ts`

**Interfaces:**
- Consumes: `canStartAcademyTrack`, `academyUnavailableCopy`, progress `seasonStatus`
- Produces: learner start only when Active; honest unavailable copy

- [x] **Step 1: Write the failing tests**

```ts
it("blocks learner until the season is Active", () => {
  expect(canStartAcademyTrack("learner", { seasonStatus: "Draft", reviewDueCount: 0 })).toBe(false);
  expect(canStartAcademyTrack("learner", { seasonStatus: "ContentReady", reviewDueCount: 0 })).toBe(false);
  expect(canStartAcademyTrack("learner", { seasonStatus: "None", reviewDueCount: 0 })).toBe(false);
  expect(canStartAcademyTrack("learner", { seasonStatus: "Active", reviewDueCount: 0 })).toBe(true);
});

it("explains hidden tracks without inventing scores", () => {
  expect(academyUnavailableCopy("learner")).toBe("Learner drill opens when this season is Active.");
});
```

Replace the current “lets learner start even when later tracks are hidden” case.

- [x] **Step 2: Run** `npm run test:web -- src/features/student/academyTracks.test.ts` and confirm FAIL.
- [x] **Step 3: Implement** learner start as `seasonStatus === "Active"`. Set learner unavailable copy to `Learner drill opens when this season is Active.`
- [x] **Step 4: Run tests until PASS.**
- [x] **Step 5: Commit**

---

### Task 2: Hide Learner CTA on student home

**Files:**
- Modify: `apps/web/src/features/student/StudentHomePage.test.tsx`
- Modify: `apps/web/src/features/student/StudentHomePage.tsx`

- [x] **Step 1: Write failing tests** — Draft cover has no `start-todays-deck` and shows `academy-track-unavailable`; Active still has the CTA.
- [x] **Step 2: Run** `npm run test:web -- src/features/student/StudentHomePage.test.tsx` and confirm FAIL.
- [x] **Step 3: Render the Learner CTA only when `canStartAcademyTrack(selected, data)`. Otherwise show the existing unavailable sentence.
- [x] **Step 4: Run tests until PASS.**
- [x] **Step 5: Commit**

---

### Task 3: Study page refuses Practice on non-Active seasons

**Files:**
- Modify: `apps/web/src/features/student/StudyPage.test.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

- [x] **Step 1: Write a failing test** — Practice with `seasonStatus: "Draft"` does not call `startSession` and shows the learner unavailable copy on the cover.
- [x] **Step 2: StudyPage already consults `canStartAcademyTrack`; after Task 1 the new test passed without a page change.
- [x] **Step 3: No StudyPage behavior change. Update the brand guide one-liner.
- [x] **Step 4: Run** `npm run test:web`, `typecheck:web`, `lint:web`.
- [ ] **Step 5: Commit**
