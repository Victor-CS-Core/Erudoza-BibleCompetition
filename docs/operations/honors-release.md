# Honors release change set

Status: released to production on September11at22:08UTC from pushed commit838a066. Worker `257f14ee-6d2d-4896-9319-de0f4fc283f2` receives100%traffic; native migration0004is applied and public health/assets smoke passed. See PROGRESS.md and the approved Team Honor release audit for verification limits.

## Scope

Release the approved patch brand/public entry composition and student Honors System together with the native Worker that provides its Today/preferences/Honors/journey/recap endpoints. Preserve `AUTH_EMAIL_FROM`, Turnstile, origin/host checks, rate-limit bindings, three Durable Objects and the existing apex domain configuration. The independent email activation source through `b291af4` is included in the implementation branch.

Native storage adds the partial unique `Records_training_start` index in migration `0004_training_progression.sql`. Day, week, mission and evidence records use existing scoped Records identities. There is no backfill that invents historical day credit or Honors. The canonical backend separately adds nullable session/mastery provenance fields and six tables through EF migration `20260911164255_TrainingProgression`.

## Before an approved native release

1. Confirm the reviewed branch/checkpoint and fresh verification results in [the implementation audit](../audits/2026-09-11-honors-implementation.md). Check concurrent production changes and current Worker version immediately before release; recheck live state immediately before rollout even when the preceding preflight passed.
2. Take a private D1 backup/export and record the current Worker version. Keep any export with account/student data under ignored private storage. Review migration status and ensure exactly the additive 0004 migration remains pending. Never reset, reseed or replace the production database.
3. Build the native frontend and prepare a Worker dry run with `wrangler.production.jsonc`. Review the artifact/configuration diff and preserve the verified email activation. Do not attach a live log tail during an active Team Practice match.
4. The September 11 instruction explicitly authorizes this production rollout after verification, commit and push. Review the concrete artifact, backup and migration status, then proceed without repeating approval. A different deployment scope or destructive data repair is not covered.

## Approved rollout order

From `apps/web`, apply the reviewed pending D1 migration using the production configuration, then deploy the paired native Worker and `dist-native` assets. The relevant established CLI operations are `wrangler d1 migrations list`, `wrangler d1 migrations apply` and `wrangler deploy`, each explicitly targeting `wrangler.production.jsonc`; use remote D1 only after release approval. Never substitute the local template’s placeholder database ID.

Migration 0004 is additive and can precede the new code. Deploy the Worker/API and frontend asset bundle together. Existing start requests without training metadata, SessionSummary fields, deterministic activity behavior, persisted PVP identifiers and historical sessions remain supported. An old open client can continue ordinary study; refresh is required to expose the new Honors interface.

After deploy, check healthy API/D1, exact published asset hashes, landing/login/signup availability, both role shells, authorized existing-session resume, and bounded Today reads. Any test needing a hosted account, content changes, a full match or email delivery must use the approved operational scope. Local synthetic fixtures do not authorize creating production fixtures.

For canonical hosting, take the same private backup precaution, apply its EF migration before starting the new API, then serve the matching web build. The EF migration is not applied to D1.

## Rollback

Retain additive schema/indexes and restore a reviewed compatible Worker/UI pair; do not drop new training records or replay attempts to reconstruct awards. Export new evidence before any data repair. Downgrading code does not undo accepted attempts, sent emails, day credits or earned Honors. A destructive database restore could discard post-backup student work and requires a separate reconciliation decision.

The existing regional 20-room/200-player load gate stays open. Local browser passes and bounded query tests do not establish production capacity or remaining Cloudflare account quota.

## Mastery profiles and cross-backend export

The shared mastery profile extension adds canonical migration `20260911205416_MasteryHonorProfiles` and uses existing native Records storage. Its versioned mastery unlocks are separate from historical practice milestones. The [mastery profile export procedure](mastery-profile-export.md) describes preserved unlocks, selected patches, bounded passage proof and validated migration limits. A release containing this extension must include the matching profile API and frontend together; the earlier Honors-only verification above does not establish that newer release gate.
