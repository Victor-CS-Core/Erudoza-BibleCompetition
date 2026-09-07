# Field Guide Academy Track Honesty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Review and Rehearsal from starting (or appearing in nav) unless the same progress rules that hide those tracks on the learner cover would show them.

**Architecture:** Extend `academyTracks` with mode mapping, a start gate that reuses `visibleAcademyTracks`, and unavailable copy. `StudyPage` skips `startSession` when the gate fails. Student `AppShell` renders Learner / Reviews / Rehearsal from the cached progress query. Cover `DUE` stamp uses `reviewDueCount`.

**Tech Stack:** React 19.2, React Router 7, TanStack Query 5, Vitest 4, Testing Library. Official docs: https://react.dev https://vitest.dev/guide/ https://testing-library.com/docs/react-testing-library/intro/

## Global Constraints

- Branch from `origin/main` at `101e5cd`. Do not treat abandoned local SHAs as done.
- Preserve API/auth/study-session/idempotency/tenant contracts.
- Honest UI only: no invented streaks, mastery, or achievements.
- No new general-purpose UI libraries.
- Keep Playwright testids `start-todays-deck`, `start-simulation`, `start-reviews`, `academy-session-kicker`, `field-guide-academy`, `assignment-range`.
- Do not deploy, change DNS, mutate live Firebase, upload NKJV, or touch production secrets.

## File map

- Modify: `apps/web/src/features/student/academyTracks.ts`
- Modify: `apps/web/src/features/student/academyTracks.test.ts`
- Modify: `apps/web/src/features/student/StudyPage.tsx`
- Create: `apps/web/src/features/student/StudyPage.test.tsx`
- Modify: `apps/web/src/layouts/AppShell.tsx`
- Create: `apps/web/src/layouts/AppShell.test.tsx`
- Modify: `apps/web/src/features/student/StudentHomePage.tsx`
- Modify: `apps/web/src/features/student/StudentHomePage.test.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

---

### Task 1: Track start gate helper

**Files:**
- Modify: `apps/web/src/features/student/academyTracks.ts`
- Test: `apps/web/src/features/student/academyTracks.test.ts`

**Interfaces:**
- Consumes: `visibleAcademyTracks`, study `mode`
- Produces: `academyTrackForMode()`, `canStartAcademyTrack()`, `academyUnavailableCopy()`

- [ ] **Step 1: Write the failing tests** for mode mapping, start gate, and copy.
- [ ] **Step 2: Run** `npm run test:web -- src/features/student/academyTracks.test.ts` and confirm FAIL.
- [ ] **Step 3: Implement** the three functions. Learner is always startable from the helper; Review and Rehearsal use `visibleAcademyTracks`.
- [ ] **Step 4: Run tests until PASS.**
- [ ] **Step 5: Commit**

### Task 2: Study page refuses hidden tracks

**Files:**
- Create: `apps/web/src/features/student/StudyPage.test.tsx`
- Modify: `apps/web/src/features/student/StudyPage.tsx`

- [ ] **Step 1: Write failing tests** — Review with `reviewDueCount: 0` does not call `startSession` and shows unavailable copy; Simulation on Draft does the same; Review with due count and Simulation on Active still call `startSession`.
- [ ] **Step 2: Run** `npm run test:web -- src/features/student/StudyPage.test.tsx` and confirm FAIL.
- [ ] **Step 3: Gate the existing start effect on `canStartAcademyTrack`. Render kicker + `data-testid="academy-track-unavailable"` when blocked.
- [ ] **Step 4: Run tests until PASS.**
- [ ] **Step 5: Commit**

### Task 3: Honest student nav + due stamp

**Files:**
- Create: `apps/web/src/layouts/AppShell.test.tsx`
- Modify: `apps/web/src/layouts/AppShell.tsx`
- Modify: `apps/web/src/features/student/StudentHomePage.tsx`
- Modify: `apps/web/src/features/student/StudentHomePage.test.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

- [ ] **Step 1: Write failing shell tests** — Draft progress has Learner, not Rehearsal/Reviews; Active adds Rehearsal; `reviewDueCount > 0` adds Reviews. Adjust home test so `DUE` is absent on Active with zero reviews and present when reviews are due.
- [ ] **Step 2: Run the new tests and confirm FAIL.**
- [ ] **Step 3: Student `AppShell` queries `api.progress()` (same query key as home) and maps `visibleAcademyTracks` to nav links. Stamp `DUE` only when `reviewDueCount > 0`.
- [ ] **Step 4: Run** `npm run test:web`, `typecheck:web`, `lint:web`.
- [ ] **Step 5: Commit**
