# Team Practice redesign brief — 11 September 2026

Status: approved for implementation on September 11. The user approved the [interactive mockup](mockups/2026-09-11-team-practice.html), its mobile navigation and three core patches, while requesting improvement to Room setup & Invitations. The mockup remains an unchanged visual reference with sample data. Follow the [implementation plan](../superpowers/plans/2026-09-11-team-practice-ui.md) for real-room integration and verification. Erudoza remains a text name.

## Problem and direction

The current [Team Practice page](../../apps/web/src/features/practice/PracticePage.tsx) presents a competitive activity as a long stack of administrative panels. During a match, the score appears after the question, discussion and roster. The small flat illustration disappears on phones, and the team emblems and honors do not use the approved patch family or its shared interaction.

Make the current activity feel like an academy competition through opposing team identities, a visible score, clear match phases, a focused question area and satisfying evidence-based results. Keep the approved navy, ivory, teal and coral palette, readable system-sans interface text, compact geometry, routes and actual rules. New artwork should support the action without sitting behind Scripture, forms or scores. The rest of the approved student composition remains governed by [DESIGN.md](../../DESIGN.md).

## Proposed hierarchy

| Surface | Primary content and action | Secondary content |
| --- | --- | --- |
| Hub | Team Practice patch, invitation or active-room action, then a compact season/team-size/length setup area. Make Create room easy to find. | Room history, earned Team Honors and participant-scoped trends. Coach preparation and the question bank remain clearly separate from playing. |
| Lobby | Two opposing team patches and numbered rosters, occupied/available seats, readiness count, and the current user's Ready action. The owner sees Start match with the actual unmet prerequisite. | Invitations and role badges. Move, swap, remove and ownership actions remain available through roster management; abandon stays secondary and confirmed. |
| Live match | Persistent compact team score, question number, phase and authoritative remaining time; question and response area directly below. Show who submits for the team. | Private team discussion beside the question on desktop and reachable below on phones. Keep roster and connection diagnostics in disclosures. |
| Round review | Revealed answer and accuracy/speed result, with a clear transition to the next question. | Submitted wording, accepted answers and source evidence; appeal or authorized Coach judgment. Previous rounds remain collapsed. |
| Completed | Outcome and paired patches, both score components, actual finality state and a route back to rooms or individual study. | Earned Team Honors when returned by the appropriate endpoint, answer review and recorded evidence. An abandoned room receives an explicit incomplete state rather than a completion celebration. |

Paused recovery, rehearsal break, disconnected, loading, disabled, empty and error states need deliberate compositions using the same hierarchy. A Coach-led phase without a deadline must show that it is awaiting the Coach rather than displaying a fabricated countdown.

## Existing behavior and constraints

The [API types](../../apps/web/src/api/practice.ts), [room state and commands](../../apps/web/worker/native/practice/state.ts) and [award calculation](../../apps/web/worker/native/practice/awards.ts) are the source of truth:

- The activity is **Team Practice**, with **Team 1** and **Team 2**. Supported team sizes are 1v1 through 5v5; lengths are 10, 30 and 90 questions. Formats are Independent and Coach-led. Active seasons and eligible published questions control availability.
- Both teams must be full and ready before starting. Roster changes clear readiness. Invitations are to authenticated members of the same organization; public matchmaking is not available.
- The room owner manages the lobby and starts or abandons the room. The captain transfers team roles. Only the scribe saves the team draft and locks the final answer; teammates contribute suggestions. A Coach-led owner is a nonplaying Coach. UI affordances must follow those current permissions rather than treating every participant as an owner or scribe.
- Phases are Presentation, Scheduled, Response and Review, with Paused and Break where applicable. Independent presentation/review use 15/10 seconds; Coach-led presentation/review await valid Coach actions. The three-second shared schedule requires both scribes to acknowledge it. Response duration comes from the actual question. A 90-question rehearsal has a five-minute break after question 45.
- Final submission uses the HTTP ingress timestamp. A final answer cannot be edited; a saved draft used at the deadline receives no speed bonus. A visual timer is display-only and never a scoring input. Preserve command identifiers, revisions, retries, refresh recovery and question identity.
- Accuracy and speed remain separately visible. The bonus is at most 25% of earned accuracy points, and incorrect answers earn no bonus. Only revealed results contribute visible scores. Coach judgment preserves original timing and applies the existing scoring rules.
- Team discussion is private to teammates and accessible to authorized Coaches for moderation; messages are retained for 30 days. Preserve the existing privacy copy and room boundaries.
- Completed results remain provisional while answers or appeals are unresolved. Team scores and honors do not establish individual Scripture mastery. Head-to-head scoring remains an Erudoza preparation adaptation, not official PBE standings or Pathfinder certification.
- Current data has no ranks, XP, leagues, online-player count, public queue, custom team names, room codes or share links. Do not imply these features or fabricate values in the application. Mockup participants and scores must remain clearly identified as demonstration data.

The [Coach question editor](../../apps/web/src/features/practice/QuestionEditor.tsx) retains season-bound source selection, accepted answer parts, evidence, versioning, preview, import and publication. A visual reorganization must preserve its existing anchors and workflows. Bootstrap awards and trends are participant-scoped; an empty nonplaying Coach history does not mean the whole academy has no progress. See the [Coach recommendations](2026-09-11-coach-workspace-recommendations.md) for that aggregation boundary.

## Mobile navigation proposal

A bottom navigation bar is approved for frequent top-level destinations on phones, keeping them within thumb reach and releasing vertical space at the top.

Use a short, role-specific set with icons and visible labels: HQ, Study, Honors and More for students; Overview, Seasons, Students and More for Coaches. These labels are a starting composition for review, using existing routes. Team Practice and other sections remain reachable through More, which stays selected while viewing those sections; tab positions do not change with the current page. Keep search and account actions in the compact top bar, retain selected-season context and saved navigation preferences, and avoid adding a duplicate horizontal shortcut strip above the page.

During an active match, prioritize the phase, question and answer action. A global bottom bar must not cover the final-answer control, discussion input or mobile keyboard. Use safe-area padding, at least 44px targets, a clear current destination and keyboard focus. Desktop navigation stays as currently approved. Before implementation, settle the precise destinations and in-match behavior as part of this same design review.

## Original artwork

Three new original embroidered core patches have been generated for review under [the PVP patch package](../brand/2026-09-11-pvp-patches/manifest.json):

- [Team 1](../brand/2026-09-11-pvp-patches/team-a.webp): teal mountain shield, preserving the current team identity.
- [Team 2](../brand/2026-09-11-pvp-patches/team-b.webp): coral open-Bible shield.
- [Team Practice](../brand/2026-09-11-pvp-patches/team-practice.webp): paired-shield activity emblem.

The package preserves the original masters, prompts and derivative hashes. The approved three core patches now have 256/512px production derivatives and use shared PatchArtwork in the implementation.

Five corresponding original embroidered Team Honor proposals are saved in [their artwork package](../brand/2026-09-11-team-honors/README.md): **First Fellowship**, **Team Steady**, **Shared Scribe**, **Team Precision** and **Rehearsal Complete**. They were shown for separate approval before application. Their keys and finalized-evidence criteria stay unchanged: first completed match; 10 matches over at least three days; manually submitting 10 distinct questions as scribe; at least 90% accuracy across 30 distinct questions; and a completed 90-question Coach-led rehearsal, respectively.

Show new artwork for the requested review before application. A decorative outcome emblem must never imply that a user earned an honor. Native room snapshots currently return no room achievement collection; retrieve confirmed awards through the existing bootstrap path instead of assuming every completed room grants a particular patch.

## Shared implementation and sequence

1. Use the reviewed composition and core patches to establish the match hub and lobby. Keep room creation, invitations, readiness and management wired to their existing API commands.
2. Separate the room presentation into focused hub/lobby/live/review/results components while retaining the existing state, transport and mutation ownership. Avoid a backend or persisted-format redesign for this presentation work.
3. Move the score and phase above the question; make scribe and teammate actions distinct. Add the reviewed mobile navigation through the shared [TrainingAppFrame](../../apps/web/src/layouts/TrainingAppFrame.tsx), preserving [CommandCenter](../../apps/web/src/components/navigation/CommandCenter.tsx) access, routes, pins and focus behavior.
4. Apply approved optimized patch derivatives through [PatchArtwork](../../apps/web/src/components/ui/PatchArtwork.tsx), or [HonorArtwork](../../apps/web/src/components/ui/HonorArtwork.tsx) for earned honors. Use existing pointer lift/dip, directional contour shadow, stationary hit bounds, reduced-motion and coarse-touch behavior. Preserve accessible text labels and explicit image dimensions.
5. Use shared [UI primitives](../../apps/web/src/components/ui/index.tsx), [tokens](../../apps/web/src/styles/tokens.css), [TrainingDialog](../../apps/web/src/components/ui/TrainingDialog.tsx) and existing confirmation patterns. Extend shared patterns only when reused; page CSS should handle composition rather than create another control or typography system.
6. Finish the five Team Honor patch replacements and evidence-based result presentation, then verify the integrated flows below. Keep this review's demonstration data and simulation controls outside application bundles.

## Verification for implementation

Reuse [practice.spec.ts](../../apps/web/e2e/practice.spec.ts) and the isolated [native browser configuration](../../apps/web/playwright.native.config.ts). Its normal-API fixture creates synthetic members, scoped season content and published questions; it supports genuine lobby and match behavior without hosted data changes.

Verify invitation acceptance and team restriction, roster swap/readiness reset, owner/captain/scribe boundaries, private discussion, final HTTP locking, deadline draft, reveal, appeal/judgment and a complete match. Retain refresh/reconnect behavior and the complete ten-player 5v5 regression. Exercise Coach-led advancement and a no-deadline phase as well as Independent play. Results and honor collections must respect unresolved appeals.

Inspect Coach and student hub, lobby, live and completed states at 1440, 390 and 320px, including long names, multiple answer parts, a full 5v5 roster, empty data and failures. Verify no page overflow, clear primary actions, visible text labels, touch targets, keyboard focus and restoration, bottom safe-area/keyboard interaction, selected-season navigation, patch motion, reduced motion and coarse-pointer rest. Run relevant frontend tests, lint, type checks and native/canonical builds. Record actual outcomes and limits; a mockup interaction or source build alone does not establish real multiplayer verification or a deployment.
