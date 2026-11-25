# Team Practice Gamification — agent implementation instructions

You are implementing the Team Practice “Practice HQ” redesign in the Erudoza repository, with separate Student and Coach experiences.

Public references:

- [Gamification brief](./2026-11-25-team-practice-gamification.md)
- [Interactive mockup](./mockups/2026-11-25-team-practice-gamification.html)

## Mission

Turn Team Practice from a long operational panel stack into a player-first game loop:

**Choose a next action → enter a room → practice honestly → receive a verified recap → advance a quest/XP/patch → choose the next action.**

The feature already has rooms, invitations, XP, quests, streaks, weekly goals, recaps, simulation achievements, Team Practice honors, trends, patches, private discussion, roles, appeals, and Coach controls. Connect those existing systems visually and behaviorally. Do not create a second reward ledger. The current product does not provide a learner-created warm-up room flow; do not invent one as part of this redesign.

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

## Repository workflow and ship gates

This package is being tracked as public GitHub Requested cards. Do not start implementation from the mockup alone.

1. Resolve the blocking CTA card first. Until it is decided, keep the CTA presentation-only and do not add learner-created rooms.
2. Before user-facing behavior changes, read the repository board/status guidance and the relevant product wiki/release-gate guidance. Keep the card state and implementation notes synchronized.
3. Move work through the repository’s normal Requested → in-progress → review flow. Do not open a PR as a substitute for the board card or silently bypass review.
4. Before merge or deployment, run the repository’s required CodeQL/security, CI, TypeScript, ESLint, native-build, focused-test, and relevant E2E gates. Record exact results in the handoff.
5. No production deploy, production-data mutation, or reward-ledger migration is authorized by this brief.

If the board/wiki gate or a real API contract is unavailable, stop at the presentation-only implementation and report the blocker instead of inventing a contract.

## Target information architecture

Implement a role-aware composition. Do not force the Coach hub into a Student ordering.

### Student loop

1. **Practice HQ hero** — selected season, short value statement, current XP/level, team streak, and a real next action.
2. **Today’s mission** — existing quest/mission steps, progress, XP values, and one direct continuation action.
3. **Streak rescue** — existing training-summary `nextAction`, weekly goal, and review continuation when no room is ready.
4. **Current room/invitation** — assigned-room status, seats, readiness, role waiting, expiry, and one clear open/join action.
5. **Choose your run** — present supported choices only. The warm-up card is an intent/Study card until a learner-created room is explicitly approved; Arcade head-to-head and PBE/full rehearsal must map to existing flows.
6. **Practice pulse** — finalized accuracy, response time only when supplied by finalized `PracticeTrend.averageResponseMs`, team streak, and patch progress. Mark provisional values clearly.
7. **Team momentum** — room/team-local contribution and patch progress. Do not invent a global roster aggregate in the client.
8. **Patch shelf** — earned, near-term, and locked patches with requirements and correct profile/milestone distinctions.
9. **Recent activity** — completed run, room, quest, XP, provisional/finalized state, and next action.
10. Coach operations remain reachable through their existing anchors but are not part of the Student loop.

### Coach loop

Keep answer reviews and event authoring as prominent operational entry points, then compose the progress/room pulse, recap finality, momentum, patches, and question bank around them. The Coach primary CTA is `Create team event`, routed to the existing event form.

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
| Average response time | `PracticeTrend.averageResponseMs`, only when present and finalized |
| Room XP/quests/awards | `practiceApi.roomRecap()` |
| Seats/readiness/roles | `PracticeRoom.members`, room state, and existing commands |

Use the real training summary DTO and route/action contract for `nextAction`; do not copy the guessed `PracticeProgress` shape from an earlier concept package. If composing the current training summary and practice bootstrap in the browser creates an unacceptable request fan-out, propose a versioned server-composed field only after documenting an exact contract match. The server must still own reward caps, quest completion, date/time-zone credit, appeals, and award eligibility.

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

## CTA and contract rules

- Student primary CTA: `Open assigned room` when an assignment/invitation exists; otherwise `Continue assigned study` through the existing Study/Training HQ route.
- Coach primary CTA: `Create team event` through the existing Coach event form.
- Do not render “Start a 10-question warm-up” as a working room creator. It may appear as a clearly labelled concept/intent card only while the product decision is unresolved.
- A CTA is not complete until its destination, authorization, loading, empty, and error states are covered by a real route or existing command.
- Do not add `PracticeProgress.nextAction` or another guessed DTO to make the composition convenient. Reuse the contract found in the training summary source.

## Test plan

Run focused tests while implementing, then the normal gates. At minimum add or update coverage for:

1. Learner hub with XP/mission/streak/weekly goal data.
2. Student primary CTA with assigned room, no assignment, and loading/error states.
3. Coach primary CTA routes to existing event authoring and keeps answer reviews/question bank reachable.
4. Learner hub with no room, no invitations, no progress, and no active season.
5. Open room promoted with seats/readiness/role requirements.
6. Arcade card never renders PBE speed language.
7. One-team PBE never renders an opponent or winner.
8. Pending appeal keeps recap and trend values provisional.
9. Legacy room with untracked XP does not display invented XP.
10. Room reconnect/refresh preserves current state and commands.
11. 320/390/1440 layouts have no overflow and usable focus order.
12. Existing `apps/web/e2e/practice.spec.ts` role, readiness, discussion, final answer, appeal, judgment, refresh, and complete-match flows still pass.
13. Test execution leaves tracked fixtures unchanged.

Run the project’s normal TypeScript, ESLint, native build, focused tests, and relevant E2E checks. Record exact results; do not replace failing tests with snapshots or loosen assertions simply to make the redesign green.

## Definition of done

- A learner can identify the next practice action in under five seconds.
- Student and Coach primary CTAs each route to a supported flow; no learner-created warm-up is implied.
- A current room or invitation is visible before historical/admin panels.
- Existing XP, quests, streak, weekly goal, recap, award, and patch data are connected to the visual loop without duplicate ledgers.
- Room behavior and authorization remain unchanged.
- Recaps clearly distinguish finalized, provisional, interrupted, and incomplete states.
- Desktop and phone layouts have no overflow and maintain accessible focus/touch behavior.
- Focused and existing practice tests pass, with exact results recorded.
- Mockup/sample values remain outside the production bundle.
- Changes are reviewed against the public brief and mockup before opening a PR.
- The Requested card, board/wiki gate, ship-gate results, and any unresolved contract blockers are recorded in the handoff.

## Handoff format

Report back with:

- files changed;
- API additions, if any;
- tests and commands run with exact counts;
- responsive/accessibility checks;
- known limitations;
- screenshots or public preview links;
- confirmation that no production data or deployment was changed.
