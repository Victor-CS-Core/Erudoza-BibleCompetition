# Field Guide Academy Activity Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name existing study activities on the study card and progress folio with Field Guide labels, without changing API activity types.

**Architecture:** Add `academyActivityName` next to the existing track helpers. Study chrome and recent attempts call it. Unknown API types stay raw.

**Tech Stack:** React 19.2, React Router 7, Vitest 4, Testing Library. Official docs: https://react.dev https://vitest.dev/guide/ https://testing-library.com/docs/react-testing-library/intro/

## Global Constraints

- Branch from `origin/main` at `9db3926f028aac5ae0a4944e0318fb01bd4c0d0b`. Do not restart abandoned local SHAs.
- Preserve API/auth/study-session/idempotency/tenant contracts.
- Honest UI only: no invented activity types, streaks, or mastery.
- No new general-purpose UI libraries.
- Keep Playwright testids `challenge-card`, `challenge-prompt`, `missing-words-answer`, `recent-attempts`, and API modes Practice / Review / Simulation.
- Do not deploy, change DNS, mutate live Firebase, upload NKJV, or touch production secrets.

## File map

- Modify: `apps/web/src/features/student/academyTracks.ts`
- Modify: `apps/web/src/features/student/academyTracks.test.ts`
- Modify: `apps/web/src/features/student/StudyPage.tsx`
- Modify: `apps/web/src/features/student/StudyPage.test.tsx`
- Modify: `apps/web/src/features/student/ProgressPage.tsx`
- Modify: `apps/web/src/features/student/ProgressPage.test.tsx`
- Modify: `apps/web/e2e/admin-to-student-study.spec.ts`
- Modify: `docs/brand/erudoza-brand-guide.md`

---

### Task 1: Map existing activity types to academy names

**Files:**
- Modify: `apps/web/src/features/student/academyTracks.test.ts`
- Modify: `apps/web/src/features/student/academyTracks.ts`

**Interfaces:**
- Consumes: API `activityType` strings (`MissingWords`, `VerseBuilder`, `ReferenceMatch`, `WhatComesNext`, `TrueFalse`, `ShortAnswer`, or unknown)
- Produces: `academyActivityName(activityType: string): string`

- [x] **Step 1: Write the failing tests**

```ts
describe("academyActivityName", () => {
  it("names existing study activities from the games spec", () => {
    expect(academyActivityName("MissingWords")).toBe("Missing Words");
    expect(academyActivityName("VerseBuilder")).toBe("Verse Builder");
    expect(academyActivityName("ReferenceMatch")).toBe("Reference Match");
    expect(academyActivityName("WhatComesNext")).toBe("What Comes Next");
    expect(academyActivityName("TrueFalse")).toBe("True/False");
    expect(academyActivityName("ShortAnswer")).toBe("Short answer");
  });

  it("keeps an unknown API activity type raw", () => {
    expect(academyActivityName("SelectedChoice")).toBe("SelectedChoice");
  });
});
```

- [x] **Step 2: Run** `npm run test:web -- src/features/student/academyTracks.test.ts` and confirm FAIL (helper missing).
- [x] **Step 3: Add `academyActivityName` with the six known mappings and a raw default.**
- [x] **Step 4: Run** the same file and confirm PASS.

---

### Task 2: Show academy activity names on study and progress

**Files:**
- Modify: `apps/web/src/features/student/StudyPage.test.tsx`
- Modify: `apps/web/src/features/student/StudyPage.tsx`
- Modify: `apps/web/src/features/student/ProgressPage.test.tsx`
- Modify: `apps/web/src/features/student/ProgressPage.tsx`
- Modify: `apps/web/e2e/admin-to-student-study.spec.ts`
- Modify: `docs/brand/erudoza-brand-guide.md`

**Interfaces:**
- Consumes: `academyActivityName`
- Produces: study chrome and `recent-attempts` labeled Missing Words (or the matching games-spec name)

- [x] **Step 1: Write the failing assertions** — study cover shows `academy-activity-name` = Missing Words after the card loads; recent attempts show Missing Words and not MissingWords.
- [x] **Step 2: Run** `npm run test:web -- src/features/student/StudyPage.test.tsx src/features/student/ProgressPage.test.tsx` and confirm FAIL (raw MissingWords still visible).
- [x] **Step 3: Call `academyActivityName` on the study card label and recent-attempt line. Add `data-testid="academy-activity-name"` on the study label.**
- [x] **Step 4: Update the Playwright recent-attempts assertion to Missing Words. Update the brand guide one-liner.**
- [x] **Step 5: Run** `npm run test:web`, `typecheck:web`, `lint:web`.
- [x] **Step 6: Commit**
