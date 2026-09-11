# Team Practice and shared mastery profiles — local implementation audit

Date: September 11, 2026. Worktree: `D:\dev\Erudoza\.worktrees\honors-public`. Branch: `codex/honors-public`.

## Implemented behavior

The approved Team Practice composition now drives the real hub, room setup, invitations, opposing team rosters, scoreboard, live question/discussion area and results. Room setup separates immutable match choices from invitation and roster actions. Real open-seat limits, eligible destinations, invitation feedback, private chat, scribe drafts/submissions, judgment guards, appeals, refresh recovery and explicit active-match return confirmation are retained. Appeal text survives question/review transitions; completed-room rosters remain available.

The approved three core patch designs use shared `PatchArtwork` lift, pointer-facing dip and contour shadows. Reduced motion and coarse-touch input rest immediately. The text Erudoza wordmark remains. Mobile navigation has four stable destinations with safe-area space and 44px targets, and hides during active matches. Create-room fields stack below 360px to keep their complete values readable.

Users can wear an earned mastery Honor from `/student/profile` or `/admin/profile`, reached through Account or the command center. Initials remain the default/reset. A shared `ProfileAvatar` appears in the header, student/Coach directories, coverage and assignment rows, command search, PVP rosters and private/moderated messages. Identity comes from the current user profile; message records do not copy an avatar. Requests batch visible identities up to 50 and use the existing authenticated query-cache boundary.

The 11 mastery-v1 requirements are identical on native and .NET backends. Solo unlocks require substantial distinct-passage scores, complete assigned-scope standards, delayed unaided retests or first-attempt due-review mastery. Team unlocks require completed resolved scoring evidence, explicit accuracy floors, distinct questions/passages and manual scribe participation. Speed, attendance, chat, repeated question counts and legacy practice awards do not unlock avatars. Requirements are displayed in the collection and picker.

Earned unlocks preserve immutable qualifying evidence. Original solo and PVP award records remain under Practice milestones, including frozen recap evidence. A later ordinary decline in current skill does not erase a valid unlock. Profile selection accepts only a server-validated own-user/current-version unlock; no arbitrary image URLs or client-supplied evidence are accepted.

## Persistence and compatibility

Canonical adds `20260911205416_MasteryHonorProfiles`; native stores additive `mastery-honor`, `mastery-proof` and `user-profile` Records without a new native schema migration. Auth/Me and room/message DTOs remain unchanged. Pure profile and identity GETs are read-only and not cacheable.

The [export compatibility procedure](../operations/mastery-profile-export.md) maps canonical unlock identities to native deterministic keys, validates ownership/version and proof, retains selected avatars and archives raw canonical evidence. Export is validated before output; its files are emitted sequentially and a complete verified manifest is required. This is not evidence of an atomic remote import or deployment.

## Review findings closed

- Preserve appeal drafts across question/review remounts and terminal room rosters.
- Replace stale accessible-name tests after decorative initials became hidden from assistive technology.
- Correct a same-account reauthentication race: an old avatar save must match the original Query instance and returned user before changing the current cache.
- Refresh profile collections on mount so a just-earned unlock cannot remain locked behind a fresh previous cache.
- Issue canonical mastery unlocks when the existing gameplay polling path finalizes a match; terminal rereads do not mint again.
- Validate selected rule versions and required mutation payloads; set canonical profile/identity responses to no-store.
- Preserve the frozen due-review set consistently on both backends, ignore legacy duplicate attempts for proof initialization, and include all personal answers supporting Team Steady in its immutable evidence.
- Permit the bounded 50-GUID identity URL through the native perimeter without relaxing other routes.

## Verification evidence

Completed source gates:
- Final .NET: **267 passed**, one existing opt-in 20-room/200-player load test skipped; formatting verification and EF model/migration parity passed.
- Exporter: **13 passed**, including populated all-migration Miniflare readback, selection, denial/reset and evidence preservation.
- Final web/native type checks, full ESLint and both production builds passed. Existing bundle-size and dependency advisories remain.
- Final combined Vitest: **579 passed**, one optional native workload test skipped, across 77 passing files (176 seconds). Includes frontend, native, and repository script tests selected by the existing configuration. The later 320px text-wrapping-only adjustment is verified in the final browser pass.
- Six approved production patch derivatives matched their recorded source/output hashes; three core PNG masters have actual alpha. All ten proposed Team Honor master/review hashes matched, with the three RGB checkerboard proposals still explicitly pending.
- Final native complete-match browser suite: **2 passed** (6.6 minutes), including real invitation/synchronization/scoring, a ten-player ten-question 5v5, manual-scribes-only mastery unlocks, actual avatar selection/reload and rejected selection by an ineligible player. The Windows runtime logged a socket-abort message during context teardown; the assertions and suite passed. Canonical full browser suite: **4 passed** without retries (13.6 minutes), including desktop and Pixel 7 projects, both full ten-player matches, mastery/avatar selection/reload and locked-player denial. It produced 36 responsive captures at 1440/390/320; added player contexts use ordinary browser contexts, while the named mobile project applies Pixel 7 to its primary page. The 5083/5183 fixture listeners were confirmed stopped. Intentional route/refresh transitions logged SignalR negotiation-stop messages; this is not a console-error-free result.

Before the profile additions, fresh local PVP recovery passed **24 room views / five real flows**, plus **12 shell views / two navigation flows / six motion checks** at 1440/390/320. Reports: ignored `.local/pvp-room-check/report.json` and `.local/pvp-shell-recovery/report.json`. The earlier paused-room failure was a fixture state recovered through the real Resume match control. Prior native/canonical complete matches were individually verified; current profile-aware runs supersede them where noted below.

Final profile browser gate at **21:21:53 UTC**: **27 views, three identity/reset flows and three motion checks** passed with no page overflow or JavaScript page errors. A measured long-name overflow (351px page width at 320px viewport) was corrected with one shared summary wrapping rule and both builds/the entire profile browser pass were rerun. Inspected desktop student profile, 320px Coach profile and 390px moderated-chat screenshots. The moderated-chat screenshot shows Reconnecting; this profile pass verifies HTTP-backed identity/message readback and layout, while the independent complete-match suites establish the recorded gameplay/transport flows.

Profile browser evidence is at ignored `.local/honor-profile-check/report.json`. The fixture uses a clearly synthetic pre-earned solo Honor to test presentation and persistence; actual earning is independently exercised through accepted-study and finalized-match integration tests and the complete-match browser suite. No real participant's record is fabricated or modified.

## Artwork approval and release boundaries

The approved core Team Practice patches are installed. Five newly generated Team Honor designs remain **proposal-only** under `docs/brand/2026-09-11-team-honors`. Three generator outputs contain a baked checkerboard and need separately authorized cleanup. Neither design approval nor alternate-method cleanup approval has been received for this five-design set; existing approved artwork remains in use.

All actions described here are local implementation, synthetic verification and repository checkpoint work. No production migration, hosted user/data change, email/invitation to a real person, merge or deployment occurred. The regional load gate remains open. Codex computer-use reconnection failed twice with a trusted Node process exit; in-app interaction was not reverified in this final turn. Automated Chromium flows and local screenshot inspection are the browser evidence. The finished screenshot was queued through the Codex panel tool. The main checkout and its services are separate.
