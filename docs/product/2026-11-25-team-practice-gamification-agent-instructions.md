# Team Practice Gamification — agent implementation instructions

You are implementing the Team Practice “Practice HQ” redesign in the Erudoza repository.

Public references:

- [Gamification brief](./2026-11-25-team-practice-gamification.md)
- [Interactive mockup](./mockups/2026-11-25-team-practice-gamification.html)

## Mission

Turn Team Practice from a long operational panel stack into a player-first game loop:

**Choose a next action → enter a room → practice honestly → receive a verified recap → advance a quest/XP/patch → choose the next action.**

The feature already has rooms, invitations, XP, quests, streaks, weekly goals, recaps, simulation achievements, Team Practice honors, trends, patches, private discussion, roles, appeals, and Coach controls. Connect those existing systems visually and behaviorally. Do not create a second reward ledger.

## Read before editing

Read these files on the target branch first:

1. `apps/web/src/features/practice/PracticeHub.tsx`
2. `apps/web/src/features/practice/PracticePage.tsx`
3. `apps/web/src/features/practice/RoomRecapPage.tsx`
4. `apps/web/src/features/practice/CoachEvents.tsx`
5. `apps/web/src/api/practice.ts`
6. `apps/web/src/features/practice/practice.css`
7. `apps/web/src/features/practice/practice-hub.css`
8. `apps/web/e2e/practice.spec.ts`
9. `docs/product/2026-09-11-team-practice-redesign.md`
10. `docs/superpowers/plans/2026-09-11-team-practice-ui.md`

Also inspect the existing training summary types and routes that own XP, quests, streaks, weekly goals, and next actions. Those values must remain server-authoritative.

## Non-negotiable constraints

- Preserve the existing practice API, room command revisions, timestamps, SignalR reconnect, refresh recovery, retries, appeals, judgment, and interruption safety.
- Preserve the distinction between Arcade scoring and PBE rubric scoring. Never show an Arcade speed bonus on PBE.
- Preserve room roles: owner, Coach, captain, scribe, teammate, and read-only moderation.
- Preserve private team discussion and the current retention/privacy rules.
- Preserve one-team PBE behavior. Never fabricate an opponent, winner, online-player count, global rank, public matchmaking queue, or official PBE standing.
- Team evidence must not alter individual Scripture mastery.
- Do not award XP, quests, honors, or patches for abandoned, interrupted, provisional, or unresolved activity unless the existing server rules explicitly say it is eligible.
- Do not put sample numbers, sample names, or mockup state into production code.
- Do not add a new runtime dependency for the redesign.
- Do not deploy or modify production data as part of this implementation task.

## Target information architecture

Implement the hub in this order:

1. **Practice HQ hero** — selected season, short value statement, current XP/level, team streak, primary next action.
2. **Today’s mission** — existing quest/mission steps, progress, XP values, and one direct continuation action.
3. **Streak rescue** — existing `nextAction`, weekly goal, and a short review continuation when no room is ready.
4. **Current room/invitation** — live status, seats, readiness, role waiting, expiry, and one clear open/join action.
5. **Choose your run** — supported warm-up/short practice, Arcade head-to-head, or PBE/full rehearsal. Map each card to a real existing route/flow.
6. **Practice pulse** — finalized accuracy, response time, team streak, and patch progress. Mark provisional values clearly.
7. **Team momentum** — room/team-local contribution and patch progress. Do not invent a global roster aggregate in the client.
8. **Patch shelf** — earned, near-term, and locked patches with requirements and correct profile/milestone distinctions.
9. **Recent activity** — completed run, room, quest, XP, provisional/finalized state, and next action.
10. **Coach operations** — answer reviews, event authoring, question bank, and administrative details remain reachable but should not dominate the learner’s game loop.

Keep these existing anchors and deep links intact: `invitations`, `rooms`, `simulation-achievements`, `achievements`, `practice-progress`, and `question-bank`.

## Suggested component split

Keep query ownership in `PracticeHub.tsx`, then extract presentational sections. Suggested components:

- `PracticeHero`
- `PracticeMissionCard`
- `PracticeStreakCard`
- `PracticeRoomQueue`
- `PracticeRunPicker`
- `PracticePulse`
- `PracticeMomentum`
- `PracticePatchShelf`
- `PracticeActivity`

Use the existing shared UI primitives and design tokens. Reuse `HonorPatchCard`, `MasteryHonorArtwork`, `PatchArtwork`, `ThemedImage`, `Panel`, `Badge`, `Button`, `LinkButton`, and existing confirmation/dialog patterns.

Do not move room transport or mutation ownership into decorative components. Keep `PracticePage.tsx` responsible for live room state and commands.

## Data mapping

Use the current server-backed sources wherever possible:

| UI element | Source of truth |
| --- | --- |
| XP and level | Existing training XP/level summary |
| Quests and mission steps | Existing training mission/quest summary |
| Streak and weekly goal | Existing training summary/preferences |
| Current room | `practiceApi.bootstrap().rooms` |
| Invitations | `practiceApi.bootstrap().invitations` |
| Team milestones | `practiceApi.bootstrap().achievements` |
| Simulation patches | `practiceApi.bootstrap().simulationAchievements` |
| Finalized trends | `practiceApi.bootstrap().trends` |
| Room XP/quests/awards | `practiceApi.roomRecap()` |
| Seats/readiness/roles | `PracticeRoom.members`, room state, and existing commands |

If composing the current training summary and practice bootstrap in the browser creates an unacceptable request fan-out, add a versioned server-composed `practiceProgress` field. The server must still own reward caps, quest completion, date/time-zone credit, appeals, and award eligibility.

## Room and recap improvements

### Lobby

- Promote an open room or invitation above historical sections.
- Show exact seats, readiness, current roles, and the reason Start is disabled.
- Make invitation destination and expiry obvious.
- Keep roster changes, ownership transfer, captain/scribe assignment, and readiness reset semantics unchanged.

### Live room

- Keep phase, question number, authoritative timer, score, submitter, connection state, discussion, and recovery visible.
- Keep the question/answer action above secondary diagnostics.
- Keep team-private messaging and Coach moderation boundaries intact.
- Preserve refresh/reconnect and no-early-advance behavior.

### Recap

Present these groups in order:

1. `Finalized`, `Review pending`, `Interrupted`, or `Incomplete` state.
2. Team accuracy and available points.
3. Arcade speed bonus only when `format === "Arcade"`.
4. Personal contribution.
5. XP earned, when tracked.
6. Quests completed.
7. Team awards and patch progress.
8. One next recommended action.

Do not celebrate a provisional or unresolved result as a final win. Do not award a patch based on decorative UI state.

## Accessibility and responsive requirements

- 44px minimum touch targets.
- Keyboard focus moves to newly revealed mission/reward content.
- `aria-live` for room status, mission progress, and reward updates.
- All essential meaning remains available with reduced motion.
- `prefers-reduced-motion` disables patch celebration movement.
- Verify 1440px, 390px, and 320px widths.
- Test long display names, 5v5 rosters, multiple answer parts, empty data, disabled Team Practice, loading, errors, pending appeals, and one-team PBE.
- No horizontal overflow. Keep the active-room controls clear of mobile safe-area and keyboard overlays.

## Test plan

Run focused tests while implementing, then the normal gates. At minimum add or update coverage for:

1. Learner hub with XP/mission/streak/weekly goal data.
2. Learner hub with no room, no invitations, no progress, and no active season.
3. Open room promoted with seats/readiness/role requirements.
4. Coach hub with answer reviews, events, question bank, and administrative controls still reachable.
5. Arcade card never renders PBE speed language.
6. One-team PBE never renders an opponent or winner.
7. Pending appeal keeps recap and trend values provisional.
8. Legacy room with untracked XP does not display invented XP.
9. Room reconnect/refresh preserves current state and commands.
10. 320/390/1440 layouts have no overflow and usable focus order.
11. Existing `apps/web/e2e/practice.spec.ts` role, readiness, discussion, final answer, appeal, judgment, refresh, and complete-match flows still pass.
12. Test execution leaves tracked fixtures unchanged.

Run the project’s normal TypeScript, ESLint, native build, focused tests, and relevant E2E checks. Record exact results; do not replace failing tests with snapshots or loosen assertions simply to make the redesign green.

## Definition of done

- A learner can identify the next practice action in under five seconds.
- A current room or invitation is visible before historical/admin panels.
- Existing XP, quests, streak, weekly goal, recap, award, and patch data are connected to the visual loop without duplicate ledgers.
- Room behavior and authorization remain unchanged.
- Recaps clearly distinguish finalized, provisional, interrupted, and incomplete states.
- Desktop and phone layouts have no overflow and maintain accessible focus/touch behavior.
- Focused and existing practice tests pass, with exact results recorded.
- Mockup/sample values remain outside the production bundle.
- Changes are reviewed against the public brief and mockup before opening a PR.

## Handoff format

Report back with:

- files changed;
- API additions, if any;
- tests and commands run with exact counts;
- responsive/accessibility checks;
- known limitations;
- screenshots or public preview links;
- confirmation that no production data or deployment was changed.
