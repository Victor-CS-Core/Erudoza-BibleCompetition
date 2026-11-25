# Team Practice Gamification redesign

**Status:** public implementation brief and UI concept  
**Date:** November 25, 2026  
**Scope:** Team Practice hub, room entry, active-room feedback, recap, rewards, and progress presentation

- [Interactive public mockup](./mockups/2026-11-25-team-practice-gamification.html)
- [Current hub implementation](../../apps/web/src/features/practice/PracticeHub.tsx)
- [Current room implementation](../../apps/web/src/features/practice/PracticePage.tsx)
- [Current practice API types](../../apps/web/src/api/practice.ts)
- [Existing Team Practice redesign brief](./2026-09-11-team-practice-redesign.md)

## Product diagnosis

Team Practice already contains the ingredients for gamification:

- XP and level progression already exist in the shared training system.
- Daily quests, weekly goals, streaks, and session recaps already exist.
- Room recaps return XP earned, completed quests, team awards, contributions, and provisional/finalized status.
- The practice bootstrap returns rooms, invitations, trends, team milestones, simulation achievements, and earned/locked patches.
- The app already distinguishes Arcade accuracy/speed scoring from PBE rubric scoring.
- The app already has private discussion, captain/scribe roles, readiness, appeals, refresh recovery, and Coach-led rooms.

The current `PracticeHub` presents these as a long stack of operational panels: banner, answer reviews, Coach events, current room, invitations, room list, simulation patches, team patches, trends, and question authoring. A player must scroll to discover the game loop. The feature feels like administration with rewards attached, instead of a place to decide what to play next.

### Design goal

Make Team Practice the **Practice HQ**: the place where a learner or Coach can immediately answer:

1. What should I do next?
2. What progress will it advance?
3. Who can I practice with?
4. What did the last run earn?
5. Which verified patch or milestone am I close to?

The redesign must keep the activity honest: no fabricated global rank, online-player count, public matchmaking, official PBE standings, or individual Scripture mastery derived from team evidence.

## What the public mockup demonstrates

The mockup is a self-contained, sample-data concept. It does not call production APIs and does not claim that the demonstration numbers are real.

### 1. Progress-first hero

- Selected season context: `Summer 2027`.
- One primary CTA: **Start a 10-question warm-up**.
- Secondary CTA: browse team rooms.
- Existing shared XP/level is visible as one progression bar.
- Team streak and best streak are visible without implying a public leaderboard.
- The hero copy explains the benefit: practice, XP, and verified patches.

### 2. “Today’s mission” card

A short quest card appears immediately below the hero:

- completed review step;
- current practice-question progress;
- team-room completion step;
- visible XP rewards;
- one direct action to choose the next run.

This turns the existing quest/weekly-goal system into a concrete next action instead of burying it under the room list.

### 3. Keep-the-streak action

A compact card gives the learner a low-friction option when a room is not ready:

- the next review duration;
- current weekly progress;
- a direct continuation action.

The app should use the existing `nextAction`, mission, streak, and weekly-goal data rather than inventing a second streak ledger.

### 4. Live room action

When a room is open, show:

- `3 of 4 seats filled`;
- which role is waiting (captain/scribe if applicable);
- readiness progress;
- exact reason the Start action is disabled;
- invitation expiry and team destination.

Use the existing roster, readiness, owner, captain, scribe, and invitation commands. Do not add public matchmaking or room codes unless a separate product decision explicitly authorizes them.

### 5. Practice pulse

The pulse summarizes effort, not prestige:

- team streak;
- finalized accuracy;
- patch progress;
- average response time.

Use finalized evidence. If appeals are pending, label the metric as provisional and exclude pending answers from finalized accuracy, matching the current trend/recap behavior.

### 6. Three run types

The main choice is organized around the actual supported modes:

- **Warm-up sprint:** a short, low-pressure run. The implementation can route to the existing room/session creation path; it should not silently create an unsupported new format.
- **Head-to-head practice:** existing Arcade scoring with accuracy and the existing speed bonus.
- **Full rehearsal:** existing Coach-led PBE simulation/rehearsal with rubric points, readiness, review, breaks, and interruption safeguards.

The selected card explains exactly what counts and what is different. It should never present a simulated speed bonus in PBE.

### 7. Team momentum

A contribution view rewards participation without ranking children globally:

- team roster;
- team patch progress;
- verified team XP/evidence;
- short privacy note that team evidence is separate from personal Scripture mastery.

If the current API does not have a season roster progress aggregate, show only room-local members and room-local evidence until a server-backed aggregate is added. Do not compute a global value in the browser from partial bootstrap data.

### 8. Patch shelf

Patches are presented as a near-term collection:

- earned patch;
- progress toward the next patch;
- locked patch with a clear requirement;
- no decorative outcome emblem before server evidence exists.

Use the existing `HonorPatchCard`, `MasteryHonorArtwork`, `PatchArtwork`, `simulationAchievements`, and Team Practice honor records. Preserve the distinction between profile-selectable patches and PBE milestones that do not become profile images.

### 9. Recent activity

A short event trail makes the loop legible:

- completed warm-up;
- completed room;
- quest started or completed;
- XP or `Active` state;
- provisional vs finalized wording.

The full history can remain behind the existing trend/history route.

## Feature improvements

### A. Replace the long panel stack with an action hierarchy

Recommended hub order:

1. context + primary next action;
2. current mission and streak rescue;
3. live rooms/invitations;
4. choose a run;
5. practice pulse;
6. team momentum;
7. patches;
8. recent activity;
9. Coach operations and question authoring.

Coach-only answer reviews, event authoring, and question-bank editing remain available, but they should not push the learner’s game loop below the fold. Keep their existing route anchors for deep links and accessibility.

### B. Make room entry a progress step

When a room is open, show exact seats, team readiness, roles, invitation expiry, and the precise reason Start is disabled. Use current commands and permissions; do not add public matchmaking.

### C. Make every match end in a meaningful recap

The existing `RoomRecap` already returns the correct foundations. The recap should visibly group:

- result state: `Finalized`, `Review pending`, or `Incomplete`;
- team accuracy and available points;
- speed bonus only for Arcade;
- personal contribution;
- XP earned (when tracked);
- quests completed;
- awards/patch progress;
- next recommended action.

A pending appeal must not trigger a “win” celebration or finalized patch progress. A disconnected/interrupted room must receive a recovery/incomplete state, not a completion reward.

### D. Use one progression ledger

Do not create a second Team Practice XP system. Compose the hub from the existing training XP/level, quests, streak, weekly goal, and honors data. If one request is required for performance, add a server-composed `practiceProgress` field to the bootstrap response with explicit versioning; do not derive authoritative rewards in React.

Suggested response shape:

```ts
type PracticeProgress = {
  xp: { total: number; level: number; levelName: string; xpIntoLevel: number; xpForNext: number };
  streak: { current: number; best: number; state: "active" | "at-risk" | "broken" };
  weeklyGoal: { target: number; completedDays: number; complete: boolean };
  quests: { key: string; title: string; description: string; progress: number; target: number; completed: boolean }[];
  nextAction: { kind: "Review" | "Warmup" | "Room" | "Recap"; label: string; href: string };
};
```

The server remains the authority for XP caps, quest completion, day credit, time zones, appeals, and award eligibility.

### E. Reward behaviors that fit the app

Use rewards that reinforce practice:

- XP for completed, eligible activity;
- quest progress for the correct activity;
- a verified Team Practice patch or milestone;
- a clear next action.

Avoid global child-vs-child leaderboards, public win/loss rankings, rewards for speed that override correctness, XP for abandoned rooms, team evidence changing individual Scripture mastery, and official PBE placement or certification language.

### F. Make team play social but private

Keep current privacy boundaries: team chat is private to teammates, authorized Coaches can moderate, messages retain the current 30-day policy, and there is no public player directory or online count. A sanitized recap share can remain optional; it must never expose private chat, emails, or student identifiers.

## Implementation sequence

### Phase 1 — presentation-only hub

1. Keep `PracticeHub` query ownership and the existing `practiceApi.bootstrap` contract.
2. Split the page into presentational sections: `PracticeHero`, `PracticeMissionCard`, `PracticePulse`, `PracticeRunPicker`, `PracticeRoomQueue`, `PracticeMomentum`, `PracticePatchShelf`, and `PracticeActivity`.
3. Reuse shared UI primitives, design tokens, patch artwork, and existing IDs/deep links: `invitations`, `rooms`, `simulation-achievements`, `achievements`, `practice-progress`, and `question-bank`.
4. Add the responsive composition from the public HTML concept without copying sample values into production.

### Phase 2 — server-backed progression composition

1. Reuse the training summary source for XP, quests, streak, mission, weekly goal, and next action.
2. Add a versioned composed `practiceProgress` response only if the existing query fan-out is too expensive.
3. Keep participant-scoped and season-scoped boundaries explicit.
4. Add tests for empty progress, pending appeal, legacy room with untracked XP, disabled Team Practice, no active season, Coach/student bootstrap, and one-team PBE with no fabricated opponent.

### Phase 3 — room and recap polish

1. Promote the current room/invitation to the action area.
2. Add role/readiness summary before opening a room.
3. Reorganize live room chrome so phase, question number, score, timer, submitter, and connection state remain visible.
4. Reorganize recap around finality, contribution, XP/quests, awards, and the next action.
5. Preserve command revisions, timestamps, retries, SignalR reconnect, refresh recovery, private discussion, appeal, judgment, and interruption semantics.

### Phase 4 — accessible visual feedback

1. Use `aria-live` for mission progress, room status, and reward updates.
2. Keep all controls at least 44px on touch layouts.
3. Respect `prefers-reduced-motion`; patch celebration must not be required to understand the result.
4. Keep keyboard focus on newly revealed mission/reward content.
5. Verify 1440px, 390px, and 320px widths with long names and 5v5 rosters.
6. Preserve the existing mobile navigation and keep active-room controls above safe-area/keyboard.

## Acceptance criteria

### Hub

- A learner can identify the next action in under five seconds.
- The primary CTA routes to a real supported flow, not a demo-only mode.
- A current room or invitation appears before historical panels.
- XP, quest, streak, weekly goal, and patch progress are sourced from server data.
- Empty, disabled, loading, and error states remain understandable.
- Coach-only authoring and answer-review controls remain reachable without dominating the learner hub.

### Room

- Lobby shows exact seats, readiness, role ownership, and the reason Start is unavailable.
- Independent and Coach-led permissions remain enforced.
- Live question, phase, authoritative timer, score, scribe controls, discussion, reconnect, and recovery remain usable.
- Team 1/team 2 and one-team PBE layouts do not fabricate an opponent or winner.

### Recap

- Finality is explicit: finalized, review pending, interrupted, or incomplete.
- Arcade speed bonus is not shown for PBE.
- XP and quests match the server ledger.
- Pending appeals do not award finalized celebration or patch progress.
- The learner receives one sensible next action.

### Quality

- No horizontal overflow at 320, 390, or 1440 CSS pixels.
- TypeScript, lint, focused unit tests, native build, and existing practice E2E flows are rerun.
- Test fixtures are not silently rewritten by routine tests.
- Mockup data remains outside production bundles.
- No public ranks, fabricated counts, official PBE claims, or private student details are introduced.

## Source-grounded notes

The previous Team Practice redesign in this repository already approved a hub/lobby/live/review/results hierarchy, patch artwork, mobile navigation, and room-state constraints. This brief extends that work by moving gamification to the top of the player experience and explicitly connecting existing XP, quests, streaks, recaps, milestones, and patches into one loop. It does not replace the existing room authority or scoring contracts.

## Live verification — November 25, 2026

After authentication, the Coach Team Practice hub and an existing lobby were inspected at `erudoza.com` without creating or modifying data.

- The hub loaded the active Summer 2027 season, one existing 2v2 lobby, the PBE answer-review link, event creation, rooms, invitations, simulation patches, Team Achievement patches, team progress, and the question bank.
- At a 936px desktop viewport, the full practice hub measured approximately **4,894px** of content. The event-creation panel measured approximately **1,169px** by itself. This confirms that gamification is currently separated from the primary play action by a long operational page.
- The live page puts the banner, PBE answer reviews, and event authoring before the current room. The first achievement/progress surfaces begin around the middle of the document rather than next to the next action.
- The existing lobby correctly showed a 2v2 independent room, one occupied seat, three more players needed, zero of four ready, and a disabled Start match action. Team rosters, role labels, invitation destination choices, and roster-management controls were present.
- The event form correctly exposed the supported activity choices, Arcade/PBE mode distinction, 1v1–5v5 sizes, 10/30/90 question lengths, Independent/Coach-led format, passage scope, who-can-start, open-now/scheduled timing, and roster assignment. The season roster appeared after a short loading state.
- No event, invitation, roster, score, question, or published content was changed during this review.

The public mockup is intentionally marked as sample data and is not evidence that the proposed progression fields already exist in the current bootstrap response. The implementation agent should preserve the measured operational controls while moving the game loop above them.
