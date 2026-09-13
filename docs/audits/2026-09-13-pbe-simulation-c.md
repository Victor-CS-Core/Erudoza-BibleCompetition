# Option C simulation implementation

## Scope

Implemented the approved one-team student PBE simulation on the existing room authority in both native Cloudflare and canonical .NET runtimes. The room creator configures assigned material, Full Event/Short Practice/Custom presets, team size, timing multiplier, halftime, discussion mode and designated reader. Server-owned timing retains two readings, scribe readiness, a shared response schedule, a three-second answer lock, review and safe interruption/recovery. In-person practice uses a designated reading device and the team's scribe; remote practice retains team chat.

The shared UI now has compact simulation/PVP entry cards, matching light lobbies, a four-tab simulation editor, role-aware live views and answer filters. PVP retains two teams, existing scoring, routes and original Honor artwork. Five separate simulation achievements have transparent patches and server-validated profile selection. New evidence never grants solo mastery. Existing room records without versioned simulation settings keep their previous behavior.

## Rules and evidence

The existing [PBE implementation baseline](2026-09-12-pbe-implementation.md) records the official NAD guide and source review. This feature reuses that baseline: 90 questions, two readings, response time based on question points, ten-second warning and a five-minute break after question45. Short/custom practice is explicitly an app adaptation. Scores do not imply official placing.

Actual team material is the union of current members' assignments. AllAssigned and SelectedChapters are explicit; contradictory or unavailable selected chapters are rejected. Pre-room estimates are advisory so complementary teams can form; start checks actual material, quotas and a distinct recovery reserve. A saved editor uses its opening revision and cannot overwrite a different device's setup. Practice again exposes unavailable retained chapters for explicit removal or reselection.

Simulation awards require a completed versioned session and actual question-service membership. Trusted Scribe counts explicit distinct submissions. Team Precision deduplicates by server response-lock time (completion fallback and room-ID tie break), requires at least30 finalized questions and90% aggregate accuracy, and blocks on pending review. Immutable original unlock evidence is separate from current eligibility; corrections can revoke profile use and later requalify without rewriting the original award.

## Local verification

- Combined frontend and native practice/mastery run:625 passed,2 existing optional cases skipped. This includes legacy PVP storage/HTTP/privacy and large-rubric publication regressions.
- Canonical implementation run:54 scoped integration tests and192 unit tests passed. Later timestamp changes received7 focused checks; final scope-validation correction received18 room/simulation integration checks and scoped formatting validation.
- Independent UI review identified and resolved pre-room availability, roster material metadata, stale-editor revision, Arcade filter, old creation deep-link, PBE two-team entry and rematch reconciliation issues. Independent backend review found and verified the canonical AllAssigned/chapter conflict correction.
- Final94 focused UI tests, native production build, frontend/native TypeScript, ESLint and whitespace checks passed after the profile refresh and coach-entry fixes. Vite's existing large-chunk advisory remains.
- The connected Chromium acceptance passed19 screens at1440/390/320 (57 screen/viewport checks), with no page errors, failed images or horizontal overflow. It exercised all editor tabs, two student devices and in-person presenter/scribe readiness, response/locked/review states, all10 questions through completion, Practice again, automatic First Rehearsal eligibility and saved profile selection, PBE two-team creation/lobby/response and Coach creation deep links. Full-page image checks explicitly load lazy artwork; dialogs are captured at viewport size.
- An actual completion/profile race was reproduced: verified award publication occurs a few seconds after room completion. Profile now makes bounded visible-page refreshes and offers manual Refresh patches; regression verifies eventual unlock and no indefinite polling. Coach mode hides student-only simulation creation.
- Browser acceptance uses an isolated native test runtime, real HTTP/WebSockets and real timers. Synthetic local TLS is required by host-prefixed secure cookies. Test fixtures, keys, logs and screenshots stay ignored under `.local`; no production authentication bypass is added.
- Artwork source hashes, complete alpha bounds, transparent corners and opaque interiors verified; all five patches visually inspected on ivory/navy. See the [artwork package](../brand/2026-09-13-simulation-patches/README.md).

## Reproduction and limits

Run `NODE_OPTIONS=--no-experimental-webstorage npm --workspace apps/web test -- --run src worker/native/practice worker/native/mastery --maxWorkers=2`, `npm --workspace apps/web run build:native` and `npm --workspace apps/web run lint`.

For the opt-in connected browser check, create ignored `.local/browser-key.pem` and `.local/browser-cert.pem` with a local self-signed certificate, then run `SIMULATION_BROWSER=1 NODE_OPTIONS=--no-experimental-webstorage npm --workspace apps/web test -- --run scripts/simulation-browser.test.ts --maxWorkers=1`. It uses `/usr/bin/chromium`, port5214 and synthetic fixture accounts. The default suite skips it. The source fixture seeds artificial Alpha/Beta questions, not copyrighted or private student material.

Local tests do not establish production deployment, physical-device speech behavior, conference-specific rules or live-user migration. No main merge or deployment is part of this task. The current branch checkpoint and remote verification are recorded separately in PROGRESS.md.
