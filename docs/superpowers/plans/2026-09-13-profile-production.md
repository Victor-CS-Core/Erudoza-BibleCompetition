# Production character profile implementation plan

> **For agentic workers:** Use the approved review and this contract. Execute independent backend and frontend tasks with bounded ownership, then review their integration. Track completion below.

**Goal:** Make the approved Profile, Character, Honors and Share experience available to authenticated students and coaches in production, with persisted choices and real unlocks.

**Architecture:** Reuse the reviewed 2D character renderer and artwork in the production asset bundle. Extend the existing profile service in native and canonical runtimes with versioned character/preferences storage, preserving legacy Honor/initials clients. Shared identity consumers receive only the selected portrait appearance; account-scoped query caches prevent stale responses crossing sessions.

**Tech stack:** React, shared Erudoza UI primitives/tokens, Canvas 2D, React Query, Cloudflare native Records, canonical EF/PbeTrainingRecords, Vitest, Playwright and .NET integration tests.

**Spec:** User-approved character review in docs/brand/2026-09-13-profile-characters/ and the September 13 instruction to fix its absence from production. No new design approval is needed.

## Constraints and interface

- Sash only, upper left to lower right; exactly three ordered, distinct earned Honors or dotted empty positions.
- Male/female bodies with six separate hairstyles each; four hair colors (red, black, brown, blond), three skin/eye/background choices. Preserve reviewed natural coloring, transparent portraits, attire height and clean edges.
- Master Guide is available to Owner/Admin coaches, including their Student Mode; Student accounts cannot select it. Server enforces this.
- Actual account username on share; no custom name field. Independent username/Erudoza/QR toggles. QR links only to https://erudoza.com/. Only earned patches decorate shares. Touch/keyboard/drag, bounds, history and native share/download behavior remain.
- Keep existing Honor/initials selections and routes. Persist saves with optimistic revision checks; preserve the local draft on rejection/conflict. No fabricated unlocks or demo identity.
- Both profile routes use the new screens. Character portraits propagate through shared ProfileAvatar, with lazy renderer loading and bounded caching. UI controls use shared primitives and tokens; no alternate global header.
- No new schema required: native uses an owned, organization-scoped `profile-character` Record; canonical uses a matching PbeTrainingRecord. Existing Honor selection store remains authoritative for the legacy avatar endpoint.

Shared TypeScript DTO module: `apps/web/shared/profileCharacter.ts` (backend task owns it).
```ts
export type CharacterAppearance = {bodyType:'male'|'female';style:string;hairColor:'red'|'black'|'brown'|'blond';skin:'light'|'medium'|'deep';eyes:'brown'|'hazel'|'blue'};
export type CharacterConfig = CharacterAppearance & {attire:'student'|'coach';background:'sunrise'|'basecamp'|'starlight';slots:[string|null,string|null,string|null]};
export type AvatarKind = 'initials'|'honor'|'character';
export type ShareOptions = {showName:boolean;showBrand:boolean;showQR:boolean};
export type SharePlacement = {key:string;x:number;y:number;size:number;rotation:number};
export type CharacterProfileFields = {character:CharacterConfig;avatarKind:AvatarKind;characterVersion:number;shareOptions:ShareOptions;sharePatches:SharePlacement[];canUseMasterGuide:boolean};
export type SaveCharacterProfile = {version:number;character:CharacterConfig;avatarKind:AvatarKind;avatarHonorKey:string|null;shareOptions:ShareOptions;sharePatches:SharePlacement[]};
```
- GET `/api/v1/profile/me` returns existing profile fields plus CharacterProfileFields.
- PUT `/api/v1/profile/me/character` accepts SaveCharacterProfile and returns full profile. Invalid enum/style/body/slot/coordinates => 400; locked Honors or forbidden attire => 403; stale version => 409. Version 0 creates the record atomically; successful updates increment.
- GET `/api/v1/profile/identities` keeps organization/active-user boundaries and existing fields, adds `avatarKind` and nullable `character:CharacterAppearance`. No share decorations, private preferences, full configuration or other account data exposed.
- Existing PUT `/me/avatar` keeps working, sets Honor/initials mode and preserves saved character/share settings while advancing their revision.
- GET sanitizes no-longer-earned Honors/patches and coach attire if the account role no longer allows it; defaults use no sash Honors, no decorations, all share switches on, male/curls/brown/medium/brown/student/sunrise. Honor/initials defaults reflect the existing profile selection.

## Task 1: Backend persistence and eligibility

**Files:** shared/profileCharacter.ts; worker/native/mastery/profile.ts and new character helper/tests; canonical ProfileEndpoints, Honor service/new character helper and integration tests. No frontend ownership.

- [ ] Write native and canonical failing regressions for default/migration, full save/reload, portrait identities, stale writes, malformed config, duplicate/locked slots and patches, Student Master Guide rejection, coach allowance, cross-organization reads, and legacy avatar interoperability.
- [ ] Implement the exact DTO/endpoints above using existing authority and storage. Validate finite placement coordinates within 1200×1600, size 144..336, rotation -180..180; at most one decoration per catalog Honor and only earned keys.
- [ ] Run focused native tests/types and canonical tests/formatting. Report exact commands/results and limitations to root; no independent Git staging or commits.

## Task 2: Production artwork, editor and shared avatars

**Files:** src/features/profile/character/*, ProfilePage.tsx, ProfileAvatar.tsx, profile.ts/profile.css, AppShell avatar sizing where necessary, public/brand/characters/v1/*, profile tests.

- [ ] Write a failing production Profile test that requires the four pages and authenticated character save, no sample identity, locked Honors and error-retained drafts.
- [ ] Copy only rendering dependencies and runtime artwork from the approved review; replace relative docs URLs with versioned public URLs and supply all real catalog Honor images. No review fixture imports in production. Keep full-size PNG for export, optimized WebP for preview.
- [ ] Wire four tabs to the real profile query and explicit Save changes. Save the chosen avatar kind/Honor independently of the sash; use actual earned collection in the sash and Share editor. Retain draft navigation, body-specific hairstyle memory and server conflict reload action.
- [ ] Add lazy, cached transparent portrait rendering to ProfileAvatar for roster/chat/header consumers; retain existing fallback and account isolation. Increase the header avatar to an accessible visible size without breaking the compact phone header.
- [ ] Verify component save/rejection/unlock behavior, compiled assets, scoped types/lint and existing profile regressions.

## Task 3: Acceptance and release

**Files:** e2e/native-profile-character.spec.ts, playwright.profile-character.config.ts, audit and progress log; deployment artifacts remain ignored.

- [ ] Real native e2e: sign up local coach/create Student, verify both routes; no-unlock dots/disabled catalog; save appearance/share switches/reload; select headshot and verify header; decorate only real test unlocks; native share API boundary and exported PNG parity; Master Guide authority; phone 390/320 and desktop layouts. No production account writes for tests.
- [ ] Independently review source and representative desktop/mobile captures; fix actionable issues, rerun affected gates. Run native/canonical builds, typechecks/lint, backend/profile tests and appropriate broader regressions.
- [ ] Checkpoint/push task branch with PROGRESS and audit evidence. Reconcile current main, merge/push under the user's authorization, then production dry-run, private D1 backup and native deployment. Verify live asset hashes, routes, anonymous authorization and loaded character assets. Report physical-phone native chooser limitation separately.

## Execution record

- Baseline: 13 existing profile frontend/native tests pass. Worktree `.worktrees/profile-production`, branch `codex/profile-production`, base `7e3e0e0`.
- Approval: User explicitly instructed "proceed to fix it" after the diagnosis listed integration, testing and deployment; this executes that approved outcome.
