# One-team simulation and consistent PVP implementation

Approved: C and six walkthrough boards, plus matching PVP reconstruction and five new unlockable simulation patches. User authorized implementation, scoped commits/push, not merge/deploy. Root owns this plan, PROGRESS and Git. Worktree codex/pbe-simulation-c, based on main a5a341f. Existing other-worktree changes are unrelated.

## Binding UI and behavior
Reuse DESIGN.md primitives, tokens, actual emblem and existing Honor bitmaps. Reconstruct shared hub, lobby, question stage, scoreboard, discussion, review and results for simulation AND PVP. PVP retains two teams and all scoring/awards. Student navigation/season/permissions persist. Phones 390/320, desktop 1440. Active room hides dock. New simulation explicit entry within existing /student/practice, room links unchanged. Dialog Simulation menu: Material, Timers, Team, Review; one tab at a time; full screen on mobile. Creator edits only in Lobby. All six boards are design reference, generated prose is not authoritative.

## Shared wire contract (native + C# + frontend)
Add optional `simulation` to create input, room snapshot/state/summary, history: `{version:1,scope?:'AllAssigned'|'SelectedChapters',preset:'FullEvent'|'ShortPractice'|'Custom',bookKeys:string[],chapters:{bookKey:string,chapter:number}[],includeScripture:boolean,includeIntroductions:boolean,timeMultiplier:1|1.5|2,halfTime:boolean,discussion:'InPerson'|'Chat',audioPresenterId?:string}`. Accepted only for format Pbe, teamCount 1. Missing simulation preserves legacy behavior. Season remains immutable. New rooms default FullEvent/90/6, whole permitted scope, both sources, 1x, halftime true, InPerson, creator audio presenter. ShortPractice count10/30,1x,no break. Custom count10/30/90, multiplier1/1.5/2, break optional only90. Two readings, warning10sec, accuracy rubric and per-question reveal are invariant. No toggles disabling integrity behavior. Include at least one source kind; selected chapters require explicit known books and canonical available chapter choices. No empty/stale chapter selection silently becoming whole scope.

`PracticeCommand` gains optional `simulation`, `teamSize`, `questionCount`; `action:'configure'` owner-only Lobby, revision/idempotency checked, validates all input before mutation, resets ready if changed. Cannot shrink below roster size. Role transfer remains existing captain command. Audio presenter must be current member; do not make the creator a coach/judge.

Authenticated student-safe `GET {practiceBase}/simulation/material?seasonId=...&roomId=...` returns `{seasonId,translation,books:[{key,label,chapters:number[]}],introductionsAvailable:boolean}`. Resolve the creator's authorized assigned material before creation, or the authorized actual roster union when roomId is provided, without answer data. AllAssigned resolves complementary assignments after joining; SelectedChapters stays explicit and rejects stale or contradictory choices. FullEvent pre-room availability is advisory so complementary teams can form. A fresh Practice again setup retains unavailable choices visibly, requiring explicit removal/reselection or AllAssigned; it never silently discards or broadens them.
`POST {practiceBase}/simulation/availability` body `{seasonId,questionCount,teamSize,simulation,roomId?}` returns `{eligibleQuestions:number,requestedQuestions:number,canStart:boolean,reason:string|null}` using same filters, quotas and distinct reserve as start. For roomId use actual roster/cohort, authorize requester membership/owner. Pre-room estimates are labeled and start always revalidates. No question/answer/evidence DTOs exposed.

Snapshots gain `audioReadingComplete?:boolean`. InPerson designated presenter alone sends existing `present` Audio/TextFallback after actual two readings. Scribe sends `present-ready` separately. Only schedule after both, current question/revision; scribe+presenter same person can satisfy completion/readiness in one action. Chat keeps existing scribe presentation, no remote voice-call feature. Changing presenter only Lobby, with between-question recovery allowing creator to choose another current member during Presentation if device absent; reset presentation/readiness. Command `presenter` with targetUserId. No audio-side timing authority.

Native+C# server authority: actual response length standard points formula times configured multiplier; deadline validation and results share same value. For new simulations insert `AnswerLocked` phase 3sec before Review, no key/evidence until Review. Reuse existing10sec Review and5min Break, custom break respected. Broadcast authoritative progression; don't reset halftime on refresh/reconnect/hibernation. Active leave is navigate away, not membership leave command. Rejoin through room link. Existing server interruption safety preserved, clear Interrupted UI.

## Simulation achievements / patches
Keep every existing earned award and original bitmap. Separate category `Simulation`, profile-selectable patch keys `simulation:first-rehearsal`, `simulation:event-ready`, `simulation:steady-team`, `simulation:trusted-scribe`, `simulation:team-precision`, rule version `simulation-v1`. Never pass collaborative evidence into solo mastery. Only new versioned one-team simulation Completed rooms count; actual served member IDs required, no lobby/abandoned/interrupted rewards. No PVP evidence.
- First Rehearsal: one completed simulation. Art Bible/sunrise.
- Event Ready: one completed90 FullEvent at1x with break/two readings. Art Bible/stopwatch.
- Steady Team: five completed simulations across3 UTC dates. Art connected trail markers.
- Trusted Scribe: explicit (not deadline draft) submissions to30 distinct question IDs across completed simulations, for that scribe. Art quill/answer sheet.
- Team Precision: most recent result per distinct question ID (server responseLockedAtMs, fallback completion time, plus room ID stable tie-break), at least30, aggregate earned/available>=90%; all considered results resolved; pending means no new award. Art compass/Bible.
Achievements scoped by organization/student/season with idempotent evidence, profile unlock follows existing mastery infrastructure. Pending review cannot grant accuracy award, resolved result replay must reconcile correctly without double awards. Use existing revocation/evidence semantics for score corrections rather than sticky fabricated eligibility.
Current eligibility is reconciled separately from immutable original unlock evidence, including revocation and requalification after corrections. First/event timestamps use earliest qualifying completion; existing valid unlock dates are retained. Public optional `simulationAchievements` on bootstrap: `{key,title,requirement,current,target,earnedAtUtc:string|null}[]` for selected/all accessible season; include seasonId in each item. Current is room count, valid full event count, qualifying room count (requirement mentions distinct days), explicit unique submissions, or finalized unique question count respectively; accuracy/three-day requirements must be explicit and display as secondary evidence if needed. Profile honor catalog adds Simulation and new ruleVersion while preserving old values. Root creates assets at /brand/simulation/{name}-256.webp and -512.webp with transparent alpha; shared PatchArtwork renders them.

## Work ownership
Native implementer: apps/web/worker/native/** simulation contract/config/material/availability/state/audio/achievements + tests.
Canonical implementer: apps/api/** equivalent full parity + tests.
UI implementer: apps/web/src/** and frontend tests all screens/contracts/profile new category, shared PVP redesign; consumes above fields. Root owns artwork, docs, integration test coordination, screenshots, final review and Git.

## Gates
[x] baseline practice suites
[x] native backend feature/parity checks
[x] canonical backend feature/parity checks
[x] shared UI and achievement integration
[x] transparent patch originals/derivatives
[x] whole-tree tests/build/lint
[x] browser multi-client1440/390/320 + role/timing/review/legacy regression
[x] independent review fixes
[ ] scoped commit/push and preview handoff

Use meaningful failing behavioral tests before changes. Preserve existing source proofs, quotas, reserve, pending ingress, event idempotency, storage restore and privacy fences. No new task/thread creation or deployments. Root may revise contracts with messages to both implementers; do not silently invent divergent APIs.
