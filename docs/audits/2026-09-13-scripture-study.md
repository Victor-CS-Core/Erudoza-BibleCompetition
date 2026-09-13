# Scripture study release evidence — September 13, 2026

## Scope

Account-private, server-persisted phrase/verse highlights (Promises, People, Review), notes, chapter bookmarks and a filtered cross-book notebook. Includes searchable book browsing, chapter controls, repeatable Go to verse, hide/reveal, text sizes and Focus. Shared Scripture remains immutable and annotation writes do not award training progress. Coach/student routes, season context and assignment markers remain intact.

Native Cloudflare and canonical ASP.NET APIs validate source anchors, derive quotations, enforce authenticated organization/owner privacy, limit notebook capacity and use atomic version checks. Failed saves retain drafts; stale tabs require explicit reload/retry. Existing record storage requires no migration. Canonical export preserves notebook records separately from PBE activity.

## Local validation

- Full web/native suite: 140 files passed, 2 skipped; 1,160 tests passed, 3 skipped. Command: `NODE_OPTIONS=--no-experimental-webstorage npm --workspace apps/web test -- --maxWorkers=2 --testTimeout=30000 --hookTimeout=60000`.
- Full canonical solution: 192 unit tests and 364 integration tests passed, 2 existing integration load tests skipped. Used repository-pinned .NET SDK 10.0.303 installed only in ignored task-local storage; project settings unchanged.
- Canonical export mapper: 70 tests passed (`node --test scripts/cloudflare-pbe-mapping.test.mjs`).
- Native production build, canonical web build, both TypeScript checks, full ESLint, full .NET formatting verification and whitespace validation passed. Existing large-bundle advisory remains. Six existing C# files received only import-order corrections required by the formatting gate.
- Two comprehensive local native Playwright scenarios passed against real Miniflare persistence and the actual installed NKJV catalog: `npm --workspace apps/web run test:e2e -- --config playwright.scripture-study.config.ts` after `build:native`.
- Browser acceptance covers real mouse phrase selection, cross-verse rejection, keyboard/touch verse selection, category updates, recall, note editing/deletion, failed network save/retry, stale-tab conflict/reload with preserved draft, bookmarks, reload persistence, filters, cross-book navigation, repeated verse jumps, Focus/text size and coach/student account isolation. Coach and student layouts passed at 1440/390/320px with no overflow or page errors. Desktop and phone screenshots were inspected; generated evidence remains ignored.

## Review and fixes

Independent frontend and final backend/spec source reviews approved the result after fixes. Browser testing exposed premature mouse-drag capture; capture now waits for pointer release and safely handles subsequent selection changes. Review fixes make repeated verse jumps work, prevent deleting the note currently being edited, restore focus after closing its editor and reject forged numeric/composite canonical highlight colors. All four canonical notebook tests passed again after final formatting.

## Limits

Local browser coverage is Chromium, including synthetic touch; it does not establish physical-device/Safari or assistive-technology behavior. Canonical tests use the repository test database setup, not a production SQL Server concurrency trial. Authenticated production notebooks will not be modified for release smoke checks. Remote CI and live deployment are distinct from the local checks recorded here.

## Release preparation

Authorized target is the existing `erudoza-native` Worker at https://erudoza.com. Configuration, bindings, secrets and Durable Object migrations are unchanged. Previous Worker version: `15c73340-74a2-4934-bfea-5c53de319a06`. No D1 migrations pending; Wrangler dry run passed. A restricted, ignored 24,843,185-byte D1 export restored in memory with integrity_check=ok and 13 tables (SHA256 `fe4707418bf562b7bc189426c44ab349cc11cdd686df9b56404e873581018bee`). This backup covers D1, not Durable Object authority; this release changes neither schema nor that authority. The prior Worker remains compatible with new notebook rows.

Implementation checkpoint `d6ff5b0` was normally pushed to `origin/codex/scripture-study`. Main `0248157` adds character-review artifacts only; integration preserves both progress-log additions. Live deployment remains pending.
