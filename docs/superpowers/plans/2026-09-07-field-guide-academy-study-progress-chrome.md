# Field Guide Academy Study / Progress Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Field Guide Academy cover on `/student/study` and `/student/progress` (including the coach student folio) and name finished sessions with academy track copy instead of raw API mode.

**Architecture:** Add `academySessionSummaryCopy` next to the existing kicker helper. Wrap study/progress presentation in the existing `FieldGuideCover`. Keep session start/complete and progress queries unchanged.

**Tech Stack:** React 19.2, React Router 7, TanStack Query 5, Vitest 4, Testing Library. Official docs: https://react.dev https://vitest.dev/guide/ https://testing-library.com/docs/react-testing-library/intro/

## Global Constraints

- Branch from `origin/main` at `f610b512e01ed6a23ec40aee251598526b46688a`. Do not restart abandoned local SHAs.
- Preserve API/auth/study-session/idempotency/tenant contracts.
- Honest UI only: no invented streaks, mastery, or achievements.
- No new general-purpose UI libraries.
- Keep Playwright testids `field-guide-academy`, `academy-session-kicker`, `challenge-card`, `complete-session`, `progress-mastery`, `progress-attempts`, `recent-attempts`, `session-summary`, `current-season`.
- Do not deploy, change DNS, mutate live Firebase, upload NKJV, or touch production secrets.

## File map

- Modify: `apps/web/src/features/student/academyTracks.ts`
- Modify: `apps/web/src/features/student/academyTracks.test.ts`
- Modify: `apps/web/src/features/student/StudyPage.tsx`
- Modify: `apps/web/src/features/student/StudyPage.test.tsx`
- Create: `apps/web/src/features/student/ProgressPage.test.tsx`
- Modify: `apps/web/src/features/student/ProgressPage.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

---

### Task 1: Honest session-summary copy

**Files:**
- Modify: `apps/web/src/features/student/academyTracks.ts`
- Test: `apps/web/src/features/student/academyTracks.test.ts`

**Interfaces:**
- Consumes: `academySessionKicker`, API session `mode` string
- Produces: `academySessionSummaryCopy({ mode, correct, attempted })`

- [x] **Step 1: Write the failing tests**

```ts
describe("academySessionSummaryCopy", () => {
  it("names finished sessions from academy tracks, not raw API mode", () => {
    expect(academySessionSummaryCopy({ mode: "Practice", correct: 1, attempted: 1 })).toBe(
      "Last Learner drill session: 1 / 1 exact",
    );
    expect(academySessionSummaryCopy({ mode: "review", correct: 2, attempted: 3 })).toBe(
      "Last Due review session: 2 / 3 exact",
    );
    expect(academySessionSummaryCopy({ mode: "SIMULATION", correct: 0, attempted: 2 })).toBe(
      "Last Rehearsal session: 0 / 2 exact",
    );
  });

  it("omits a track name when the API mode is unknown", () => {
    expect(academySessionSummaryCopy({ mode: "Unknown", correct: 1, attempted: 4 })).toBe(
      "Last session: 1 / 4 exact",
    );
  });
});
```

- [ ] **Step 2: Run** `npm run test:web -- src/features/student/academyTracks.test.ts` and confirm FAIL.
- [ ] **Step 3: Implement** `academySessionSummaryCopy` by case-insensitive mapping onto Practice / Review / Simulation, then `academySessionKicker`. Unknown mode uses `Last session: {correct} / {attempted} exact`.
- [ ] **Step 4: Run tests until PASS.**
- [ ] **Step 5: Commit**

---

### Task 2: Study page Field Guide cover

**Files:**
- Modify: `apps/web/src/features/student/StudyPage.test.tsx`
- Modify: `apps/web/src/features/student/StudyPage.tsx`

- [ ] **Step 1: Write failing tests** — learner study shows `field-guide-academy`, `current-season`, and the session kicker; `DUE` appears only when `reviewDueCount > 0`; unavailable Review still skips `startSession` and still lives on the cover.
- [ ] **Step 2: Run** `npm run test:web -- src/features/student/StudyPage.test.tsx` and confirm FAIL.
- [ ] **Step 3: Wrap study chrome in `FieldGuideCover`. Put season line + kicker (and unavailable copy) on the cover. Keep `StudyCard` below for allowed starts. Stamp `DUE` when reviews are due.
- [ ] **Step 4: Run tests until PASS.**
- [ ] **Step 5: Commit**

---

### Task 3: Progress folio Field Guide cover

**Files:**
- Create: `apps/web/src/features/student/ProgressPage.test.tsx`
- Modify: `apps/web/src/features/student/ProgressPage.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

- [ ] **Step 1: Write failing tests** — student progress shows the cover, season line, and `Last Learner drill session` from location state; coach path `/admin/seasons/:seasonId/students/:studentId/progress` uses `studentProgress` and the same cover; existing `progress-mastery` / `progress-attempts` stay.
- [ ] **Step 2: Run** `npm run test:web -- src/features/student/ProgressPage.test.tsx` and confirm FAIL.
- [ ] **Step 3: Wrap ProgressPage in `FieldGuideCover`. Replace the extra `h1` with a chapter heading. Use `academySessionSummaryCopy`. Stamp `DUE` when reviews are due. Update the brand guide one-liner.
- [ ] **Step 4: Run** `npm run test:web`, `typecheck:web`, `lint:web`.
- [ ] **Step 5: Commit**
