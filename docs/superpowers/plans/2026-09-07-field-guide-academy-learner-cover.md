# Field Guide Academy Learner Cover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name Field Guide Academy on the student home and landing page, and map existing Practice / Review / Simulation modes onto honest Learner / Reviews / Rehearsal tracks without changing API contracts.

**Architecture:** A pure `visibleAcademyTracks` helper decides which chapter tabs exist from progress payload fields already returned by `/api/v1` progress. A `FieldGuideCover` material component wraps the student home in kraft-bound paper using current tokens. Study mode copy uses `academySessionKicker`. Existing `data-testid` CTAs stay on the default Learner tab.

**Tech Stack:** React 19.2, React Router 7, TanStack Query 5, Tailwind 4, Vitest 4, Testing Library, Playwright 1.55. Official docs: https://react.dev https://vitest.dev/guide/ https://testing-library.com/docs/react-testing-library/intro/

## Global Constraints

- Do not treat local-only `codex/field-guide-academy` Learner 1–4 work as present on this remote.
- Preserve API/auth/study-session/idempotency/tenant contracts on `main`.
- Honest UI only: no invented streaks, mastery, or achievements.
- No new general-purpose UI/animation libraries.
- Keep Playwright testids `start-todays-deck`, `start-simulation`, `start-reviews`, `current-season`, `assignment-packet`, `assignment-range`.
- Do not deploy, change DNS, mutate live Firebase, upload NKJV, or touch production secrets.

### Task 1: Academy track visibility helper

**Files:**
- Create: `apps/web/src/features/student/academyTracks.ts`
- Test: `apps/web/src/features/student/academyTracks.test.ts`

**Interfaces:**
- Consumes: progress fields `seasonStatus` and `reviewDueCount`
- Produces: `visibleAcademyTracks()`, `academySessionKicker()`, `ACADEMY_TRACKS`

- [ ] **Step 1: Write the failing test**

```ts
import { academySessionKicker, visibleAcademyTracks } from "./academyTracks";

describe("visibleAcademyTracks", () => {
  it("always includes learner and hides rehearsal until the season is Active", () => {
    expect(visibleAcademyTracks(undefined)).toEqual(["learner"]);
    expect(visibleAcademyTracks({ seasonStatus: "Draft", reviewDueCount: 0 })).toEqual(["learner"]);
  });

  it("adds reviews only when reviewDueCount is positive", () => {
    expect(visibleAcademyTracks({ seasonStatus: "Active", reviewDueCount: 2 })).toEqual([
      "learner",
      "review",
      "rehearsal",
    ]);
  });

  it("names the study session from the existing mode", () => {
    expect(academySessionKicker("Practice")).toBe("Learner drill");
    expect(academySessionKicker("Review")).toBe("Due review");
    expect(academySessionKicker("Simulation")).toBe("Rehearsal");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:web -- src/features/student/academyTracks.test.ts`
Expected: FAIL because the module does not exist

- [ ] **Step 3: Write minimal implementation**

Export `AcademyTrackId`, `ACADEMY_TRACKS` (label, href, ctaLabel, ctaTestId, description), `visibleAcademyTracks`, and `academySessionKicker`. Learner is always first. Push `review` when `reviewDueCount > 0`. Push `rehearsal` when `seasonStatus === "Active"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:web -- src/features/student/academyTracks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/student/academyTracks.ts apps/web/src/features/student/academyTracks.test.ts
git commit -m "test: add Field Guide Academy track visibility helper"
```

### Task 2: FieldGuideCover material component

**Files:**
- Create: `apps/web/src/components/material/FieldGuideCover.tsx`
- Test: `apps/web/src/components/material/FieldGuideCover.test.tsx`
- Modify: `apps/web/src/styles/materials.css`
- Modify: `docs/brand/erudoza-brand-guide.md`

**Interfaces:**
- Consumes: children plus optional stamp
- Produces: `data-testid="field-guide-academy"` cover titled Field Guide Academy

- [ ] **Step 1: Write the failing test** that renders `FieldGuideCover` and expects “Field Guide Academy” and `field-guide-academy`.
- [ ] **Step 2: Run it** (`npm run test:web -- src/components/material/FieldGuideCover.test.tsx`) and confirm FAIL.
- [ ] **Step 3: Implement** kraft-spine CSS (`.er-field-guide`, `.er-field-guide-inner`) with existing tokens only, plus the component. Update the brand guide required-components list.
- [ ] **Step 4: Run tests** until PASS.
- [ ] **Step 5: Commit**

### Task 3: Learner cover on student home

**Files:**
- Modify: `apps/web/src/features/student/StudentHomePage.tsx`
- Create: `apps/web/src/features/student/StudentHomePage.test.tsx`

**Interfaces:**
- Consumes: `api.progress()`, `visibleAcademyTracks`, `FieldGuideCover`, `ChapterTab`
- Produces: default Learner CTA `start-todays-deck`; rehearsal/reviews CTAs only after the matching tab is shown from real progress

- [ ] **Step 1: Write failing tests** for: cover title; default `start-todays-deck`; no `start-simulation` when season is Draft; after Active progress, clicking `academy-track-rehearsal` reveals `start-simulation`; `start-reviews` absent when `reviewDueCount` is 0; assignment packet still renders the range.
- [ ] **Step 2: Run** `npm run test:web -- src/features/student/StudentHomePage.test.tsx` and confirm FAIL.
- [ ] **Step 3: Implement** student home using local tab state defaulting to `learner`, falling back if the active track is no longer visible.
- [ ] **Step 4: Run tests** until PASS.
- [ ] **Step 5: Commit**

### Task 4: Landing name + study kicker

**Files:**
- Modify: `apps/web/src/features/marketing/LandingPage.tsx`
- Modify: `apps/web/src/test/landingPage.test.tsx`
- Modify: `apps/web/src/features/student/StudyPage.tsx`
- Modify: `apps/web/e2e/admin-to-student-study.spec.ts`

- [ ] **Step 1: Extend landing test** to expect “Field Guide Academy” while keeping the three deck images. Add a study-page assertion via a small unit test or the existing kicker helper (already in Task 1) and an e2e expect on `field-guide-academy` after student login.
- [ ] **Step 2: Run the new unit tests and confirm FAIL** where copy is missing.
- [ ] **Step 3: Set landing eyebrow to Field Guide Academy. On StudyPage, show `academySessionKicker(mode)` with `data-testid="academy-session-kicker"`. Add the Playwright assertion.
- [ ] **Step 4: Run** `npm run test:web` and `npm run lint:web` / `typecheck:web`.
- [ ] **Step 5: Commit**
