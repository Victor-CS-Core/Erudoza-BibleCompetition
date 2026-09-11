# Daily training and progression design

Date: 2026-09-11. Status: student mockup appearance and interaction approved; Pathfinder patch artwork style approved; feature named **Honors System** by the user. This document defines the proposed implementation rules. Product implementation has not started.

## Design authority and scope

The user selected daily progress and rewarding practice, then approved the interactive Training HQ, final study card, session recap, and Honors collection. Preserve this composition and its clear next action. The illustrative student, Scripture examples, scores, dates, and awards in the mockup are sample data.

The original preview is `erudoza-daily-training.html` in the Codex visualization folder for this task, served locally at `http://127.0.0.1:4317/`. An archived composition reference lives at [daily training mockup](../../product/mockups/2026-09-11-daily-training.html). It is a design artifact, not application code. Use the current shared controls and contrast fix when implementing; do not copy the prototype's CSS controls or sample calculations into the application.

Read [DESIGN.md](../../../DESIGN.md), [PRODUCT.md](../../../PRODUCT.md), and [PROGRESS.md](../../../PROGRESS.md) before execution. The [Coach recommendations](../../product/2026-09-11-coach-workspace-recommendations.md) form an independent proposed phase. Student visual approval does not establish approval for a Coach redesign.

The user also requires the public landing, sign-in and signup designs to be considered. The [public entry design brief](../../product/2026-09-11-public-entry-design.md) covers `/`, `/login`, `/signup`, and the related `/forgot-password` and `/join-coach` routes. Extend the approved patch identity coherently across the visitor journey while preserving the current account and availability behavior. These page compositions need their own preview; the existing logo/art approval remains valid.

## Global constraints

- Preserve the Field Guide Academy brand and Option C command navigation.
- Reuse shared primitives in `apps/web/src/components/ui/index.tsx` and semantic tokens in `apps/web/src/styles/tokens.css`.
- Use system sans for interface text and Georgia only for Scripture and branding.
- Preserve deterministic study selection, evaluation, difficulty ceilings, hints, source-reader rules, authorization, and existing routes.
- Preserve early session completion after at least one accepted attempt; partial completion does not qualify as an eight-card drill.
- Award progress only from server-accepted evidence; never award on a page read or a frontend animation.
- Keep Cloudflare native and canonical .NET contracts and behavior equivalent.
- Use Monday-based weeks, default weekly target 5, and choices 3, 4, or 5 days.
- Count at most one practice day per organization, student, and calendar day across seasons.
- Keep all new historical records additive and preserve earned evidence after scope changes.
- Do not add currency, purchases, locked study content, public student rankings, or punitive streak resets.
- Obtain user approval of the original artwork before integrating it into production screens.
- Verify both roles at 1440px and 390px, plus a 320px stress check, after shared UI changes.

## Student experience

### Training HQ

Keep the command header, pins, keyboard navigation, account permissions, and selected season. Lead with a compact illustrated mission showing assigned scope and one primary action. The sequence is review today's selected passages, then an eight-card Practice drill. After completion, show the completed steps and open the latest stored recap. Other study modes remain accessible.

Show a seven-day weekly strip, completed days out of the selected goal, one near-term honor, and a small passage journey. Do not overload the first mobile screen with artwork. Link the journey to the existing detailed Progress view; show a bounded subset and a clear count when the assigned scope is large. Group passages using actual source/book/chapter metadata. Never infer a whole chapter from the first assignment citation.

Loading and failed requests do not become fabricated zero values. No season, no assignments, no eligible content, closed season, no due reviews, legacy mastery, and invalidated missions have explicit actionable states. A no-review day shows “No reviews due” and the drill action; it does not award the review badge automatically.

### Study and recap

Keep the working study renderer and server feedback. Completing a session navigates to `/student/sessions/:sessionId/recap`. Direct navigation and browser refresh load the same persisted recap. A recap contains mode, attempted/correct counts, full or partial completion, contribution to today's steps, the first practice-day credit if any, actual newly earned awards, and evidence-backed passage changes. It offers a relevant next step and “Back to Training HQ.”

Session accuracy and mastery are distinct. “7/8 correct” describes a result. A passage is newly mastered only when the existing `v2-skill-evidence` algorithm records that transition. Freeze per-attempt before/after skill evidence inside the existing mastery write transaction, then aggregate those events for the recap. Never subtract current mastery from a start snapshot: interleaved sessions could create false gains. Missing historical evidence is omitted, not reconstructed from sample numbers.

### Honors collection

Add `/student/honors?seasonId=...` with All, Earned, and In progress filters; clear criterion text; real earned dates; and an accessible detail dialog. Keep unearned artwork distinct without lowering text contrast or suggesting study content is inaccessible. Labels and criteria are HTML text outside the image. A badge is recognition of a recorded event, not an assertion that skill can never decay.

## Calendar, qualification, and mission rules

1. Persist validated IANA timezone and weekly target per organization/student. Initialize from the browser timezone on the first authorized session-start or preference-save write. A Today GET can return a suggestion but never creates preferences, awards, or missions. An unsupported timezone returns a validation error rather than silently selecting a different day.
2. Freeze timezone, goal, local week key, and exact UTC boundaries for each week. Later timezone/goal edits take effect at the next Monday boundary interpreted using the current timezone, with the precise UTC instant stored. Display the effective date. Do not recalculate completed weeks when preferences change.
3. Snapshot a season mission on the first mission-linked session start: active eligibility/scope fingerprint, ordered review knowledge-unit IDs (at most 8), revision, and drill target 8. Before that write, show the suggested counts returned by the server. A full due queue larger than 8 is described as “today's selected reviews,” with the remaining queue still available.
4. Mission Review selects frozen IDs minus distinct IDs already attempted for that mission, intersected with authoritative current eligibility. Another session clearing a due timestamp does not remove a frozen item. New due items do not expand the denominator mid-mission. Ordinary Review retains its existing selection behavior.
5. Every distinct accepted nonlegacy review attempt advances effort regardless of correctness. Wrong answers remain due under the existing engine. Rename the prototype's “Review Cleared” award to **Review Complete** so it does not falsely imply all review debt disappeared.
6. Removing assignments, retiring content, losing access, or closing a season invalidates unfinished mission work explicitly. Never shrink a frozen target and award completion. Previously credited effort and earned awards remain historical facts; a replacement mission records its new scope and revision.
7. Completing the fixed eight accepted cards in one Practice session qualifies the drill. A full Simulation also qualifies a practice day without satisfying the Practice drill step. A completed nonempty frozen review set can span resumed/partial mission-linked Review sessions and qualifies a day when its last required ID is accepted. Full ordinary Review sessions qualify effort days using their original nonzero target. Opening a page, viewing Scripture, or completing only 1/8 does not qualify.
8. Qualification occurs when the last necessary attempt is accepted, not when the recap animation runs. Completion persists the recap. The one-time day-credit event is shared across all sessions and seasons. Four reviews followed by a drill on the same day keeps the weekly strip at the same count, as in the approved prototype.
9. Use the authoritative instant of the qualifying event to choose its practice day. A mission started before midnight can finish afterward: it advances its original mission and credits the event's current calendar day. Display that distinction in the recap; do not silently move the mission date.
10. Accepted card identity and knowledge-unit identity serve different purposes: session full-target checks count distinct accepted cards; review/coverage criteria count distinct evaluated knowledge units. Duplicate submission IDs, replacement submission IDs for an already accepted card, retries, and concurrent sessions cannot duplicate credit or an award.

## Initial award catalog

These are proposed version-1 rules for implementation, not inferred facts about a student. Skill awards require current algorithm evidence and eligible assigned scope. Save criterion version, evidence, scope snapshot, and server timestamp when earned; never revoke history when the active scope changes.

| Key / label | Criterion | Scope |
|---|---|---|
| `exact-recall` / Exact Recall | Five distinct eligible passages with exact wording score at least 80 under `v2-skill-evidence`. | Student and season |
| `reference-ready` / Reference Ready | Ten distinct eligible passages with reference score at least 70 under `v2-skill-evidence`. | Student and season |
| `chapter-strong` / Chapter Strong | Every eligible assigned verse in one book/chapter is Strong or Mastered. Show “assigned verses in [chapter]” and the exact denominator. | Student and season; captured chapter/scope |
| `review-complete` / Review Complete | At least one nonempty frozen mission review set has an accepted attempt for every selected knowledge unit. | Student and season |
| `steady-study` / Steady Study | Meet the saved weekly goal in four recorded weeks; they need not be consecutive. | Student across seasons in the academy |
| `full-coverage` / Full Coverage | At least one accepted attempt for every eligible knowledge unit in a nonempty season scope snapshot. | Student and season |

Foundation and Standard exact wording ceilings remain 40 and 70; selected choices do not award exact wording or reference skill evidence. UI criterion text must explain when a criterion requires Advanced practice. A small assignment may not yet contain five or ten eligible passages: show the denominator honestly and explain that the criterion exceeds the current assignment, without offering student editing permissions.

Persist one award per student/key/rule version/award scope. Evaluate rules only after relevant actual writes. No historical earned dates are fabricated at rollout. Existing compatible mastery may contribute to future skill qualification, but the first evaluation on a subsequent evidence write gets its actual timestamp and stored provenance. Effort days, coverage attempts, weekly goals, and recap deltas begin with the new projection version unless a separately audited migration proves earlier evidence.

## Storage and API boundaries

Use compact preferences, day/week, mission, and badge projections alongside immutable accepted-attempt evidence and completed recap snapshots. Native writes use the existing D1 atomic batch/revision-guard pattern; .NET uses the serializable write coordinator plus database uniqueness. A session-only concurrency lock cannot protect two sessions writing the same first day or badge.

Add read-only Today, honor, and recap endpoints under existing progress/study routing; add a preferences write and optional mission/timezone fields to session start. Preserve old clients through additive optional fields. Repeated completion returns the same stored recap; legacy sessions return their existing factual counts with missing newer evidence represented explicitly.

Expose persisted reference/sequence skill scores and actual source metadata through Progress for the journey. Keep cohort aggregations separate. Do not implement a Coach dashboard by requesting every student's lifetime Progress or treating the latest 20 attempts as a complete week. Bound Today reads to current day/week/season projections and a small journey preview; use cursor-based collection reads when needed. Measure actual D1 rows read/written and test with the full library.

Include EF schema additions and native access-path migrations where measured query plans require them. Update the .NET-to-native export allowlist and explicit session/attempt mappings in `scripts/cloudflare-export.mjs`, with parity fixtures, so new fields are not dropped and new tables do not make future exports fail.

## Original asset work

The user requested original high-quality artwork for the site and achievements and asked to review it before use. The [asset package](../../brand/2026-09-11-original-assets/README.md) contains generated source masters, exact prompts, an approval gallery, and a manifest. The package covers a website/Training HQ landscape, a Coach field-guide illustration, a completion illustration, and the six award symbols above.

The user approved the embroidered patch style for artwork and logos. A new embroidered derivative of the existing flame-and-Bible Erudoza mark retains its recognizable silhouette, with fine thread texture and a gold edge. Keep the existing navigation icon system. Validate the logo at 24/32/48 pixels before selecting it for compact navigation; use a simplified derivative where stitching loses clarity. Integration produces optimized responsive derivatives, real transparency, width/height attributes to prevent layout shift, decorative empty alt text when the adjacent caption supplies meaning, and appropriate lazy loading. Source masters do not enter the initial application bundle. Verify rendered honors at 48, 96, and 160 pixels, and illustrations within actual mobile crops before shipping.

### Honors motion

The user requested a smooth tilt toward the pointer. On fine-pointer hover, rotate only the honor artwork around its center, bounded to 7 degrees on each axis, with frame-rate-independent easing and perspective. The text, focus target, and card layout stay stable. Ease back to zero on pointer exit/cancellation; stop animation when settled, hidden, unmounted, or disabled. Disable tilt for reduced-motion preferences and touch/coarse input. Motion is decorative and carries no exclusive information. Use one reusable presentation component for HQ, collection, recap, and any future Coach honors; no animation library is necessary.

## Acceptance and delivery

Public entry is an explicit companion workstream, with page-preview, implementation and verification checkpoints in the plan. It uses the shared logo and optimized original art but does not depend on new student reward projections for sign-in/signup. Public Honors claims wait for the actual feature release. Shared logo/style changes must be checked across landing, account entry, Coach and student screens at desktop and mobile sizes, including signup service-unavailable and verification states.

The implementation plan defines incremental backend, UI, and release checkpoints. Required cases include replay/idempotency, concurrent first awards/days, partial sessions, wrong reviews staying due, refresh-stable recap, midnight/DST/Monday boundaries, assignment changes, old algorithm data, cross-user/org denial, large scopes, error states, keyboard/focus, and reduced motion. Preserve the September 11 foreground/background contrast fix in every shared control state.

Run relevant checks at each implementation gate and the full changed-runtime regression at the integrated gate. Use isolated local fixtures and coordinate ownership through PROGRESS. The current plan and artwork review are documentation/design work; they do not establish a new application test pass, native production deployment, or live gameplay proof.
