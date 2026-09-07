# Field Guide Academy Leftover Verbs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace leftover visible “practice” / “simulation” copy on landing and academy track chrome with Field Guide labels, without changing API modes.

**Architecture:** Keep `ACADEMY_TRACKS` as the single track-copy table. Landing strings stay local to `LandingPage`. Tests assert visible academy verbs and keep hrefs / testids / image sources.

**Tech Stack:** React 19.2, React Router 7, Vitest 4, Testing Library. Official docs: https://react.dev https://vitest.dev/guide/ https://testing-library.com/docs/react-testing-library/intro/

## Global Constraints

- Branch from `origin/main` at `7aa0cd825786a7a88f798f578522f8ab9a569e41`. Do not restart abandoned local SHAs.
- Preserve API/auth/study-session/idempotency/tenant contracts.
- Honest UI only: no invented activity types, streaks, or mastery.
- No new general-purpose UI libraries.
- Keep Playwright testids `start-studying`, `build-a-season`, `start-simulation`, and API modes Practice / Review / Simulation.
- Do not deploy, change DNS, mutate live Firebase, upload NKJV, or touch production secrets.

## File map

- Modify: `apps/web/src/features/student/academyTracks.ts`
- Modify: `apps/web/src/features/student/academyTracks.test.ts`
- Modify: `apps/web/src/features/student/StudentHomePage.test.tsx`
- Modify: `apps/web/src/features/marketing/LandingPage.tsx`
- Modify: `apps/web/src/test/landingPage.test.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

---

### Task 1: Name leftover academy track verbs

**Files:**
- Modify: `apps/web/src/features/student/academyTracks.test.ts`
- Modify: `apps/web/src/features/student/academyTracks.ts`
- Modify: `apps/web/src/features/student/StudentHomePage.test.tsx`

**Interfaces:**
- Consumes: existing `ACADEMY_TRACKS` records
- Produces: Learner description “Drill the assigned passage with memorization games.”; Rehearsal description “Run a PBE-style rehearsal from the assigned Scripture.”; Rehearsal CTA “Start rehearsal”

- [ ] **Step 1: Write the failing tests**

```ts
describe("ACADEMY_TRACKS leftover verbs", () => {
  it("names learner and rehearsal copy without practice or simulation", () => {
    expect(ACADEMY_TRACKS.learner.description).toBe(
      "Drill the assigned passage with memorization games.",
    );
    expect(ACADEMY_TRACKS.rehearsal.description).toBe(
      "Run a PBE-style rehearsal from the assigned Scripture.",
    );
    expect(ACADEMY_TRACKS.rehearsal.ctaLabel).toBe("Start rehearsal");
    expect(ACADEMY_TRACKS.rehearsal.ctaTestId).toBe("start-simulation");
    expect(ACADEMY_TRACKS.rehearsal.href).toBe("/student/study?mode=Simulation");
  });
});
```

Add on the Active-season student-home test after the rehearsal tab click:

```ts
expect(screen.getByTestId("start-simulation")).toHaveTextContent("Start rehearsal");
expect(screen.getByText("Run a PBE-style rehearsal from the assigned Scripture.")).toBeInTheDocument();
expect(screen.queryByText(/practice/i)).not.toBeInTheDocument();
expect(screen.queryByText(/simulation/i)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run** `npm run test:web -- src/features/student/academyTracks.test.ts src/features/student/StudentHomePage.test.tsx` and confirm FAIL (old Practice / simulation copy still present).
- [ ] **Step 3: Update `ACADEMY_TRACKS` learner description, rehearsal description, and rehearsal CTA label only.**
- [ ] **Step 4: Run** the same files and confirm PASS.

---

### Task 2: Name leftover landing verbs

**Files:**
- Modify: `apps/web/src/test/landingPage.test.tsx`
- Modify: `apps/web/src/features/marketing/LandingPage.tsx`
- Modify: `docs/brand/erudoza-brand-guide.md`

**Interfaces:**
- Consumes: existing landing hero, proof cards, and supplied deck images
- Produces: visible landing copy that uses drill / rehearsal / deals the deck

- [ ] **Step 1: Write the failing assertions**

```ts
expect(screen.getByText(/due reviews, and realistic rehearsal/)).toBeInTheDocument();
expect(screen.getByText("Your team chooses the passage. Erudoza deals the deck.")).toBeInTheDocument();
expect(screen.getByRole("heading", { name: "Drill only the assigned Scripture." })).toBeInTheDocument();
expect(
  screen.getByText("Timed rehearsal turns growing recall into confident Bible Bowl performance."),
).toBeInTheDocument();
expect(screen.queryByText(/practice/i)).not.toBeInTheDocument();
expect(screen.queryByText(/simulation/i)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run** `npm run test:web -- src/test/landingPage.test.tsx` and confirm FAIL (old practice / simulation copy still visible).
- [ ] **Step 3: Replace the four landing strings. Keep image sources, `er-deck-*` classes, and `start-studying` / `build-a-season`. Update the brand guide one-liner.**
- [ ] **Step 4: Run** `npm run test:web`, `typecheck:web`, `lint:web`.
- [ ] **Step 5: Commit**
