# Native application API implementation

Implemented Task 3 in `apps/web/worker/native/application.ts` and its `application/` modules. Native entry dispatch is owned by the parent task. The .NET host and frontend UI were not changed.

## API coverage

All existing management endpoints in `ApiEndpoints.cs` and `LifecycleEndpoints.cs` are handled:

| Area | Endpoints and behavior |
| --- | --- |
| Organization | GET organization; tenant boundary checked again inside the handler |
| Students | GET roster; POST student; POST password reset; PUT active state; credential-version rotation immediately invalidates existing sessions |
| Seasons | GET collection/detail; POST create using `PBE_STYLE_V1`; GET/POST scope; POST activate, close and archive |
| Assignments | GET/POST assignments; DELETE assignment; PUT passage correction; PUT student difficulty |
| Coverage | GET coverage with include-minus-exclude eligible sources, mastery, due reviews and actual attempt counts |
| Content | GET packs/source units; POST validated import; DELETE unused packs while retaining source/session history |
| Catalog | GET the existing six-translation/64-book catalog; POST fixed-provider import for 1–8 chapters, validating translation/license/book/chapter/text before persisting |

Student assignment reads return only their own assignments. All management/content reads and every mutation require an adult Owner/Admin. Identifier lookups include the organization; assignment mutations also check the season. Closed seasons are read-only, active scope is locked, archive is irreversible, and assignment removal retains membership and historical training data.

## Storage and integration contract

- `source`: frontend SourceUnit fields plus `contentPackId`, `isActive`, `knowledgeUnitId`; owner is pack ID. New native source and knowledge IDs are identical.
- `pack`: frontend ContentPack fields plus `isActive` and content fingerprint. Stable pack ID prevents concurrent imports duplicating the same organization/key/version.
- `season`: frontend season identity/state/profile/date fields plus `createdAtUtc`; computed counts are response fields.
- `scope`: keyed by season ID; `{ contentPackId, includes, excludes }`; season index populated.
- `assignment`: flattened frontend passage fields plus `seasonId`, `contentPackId`, `studentUserId`, `createdAtUtc`; owner is student ID, season index populated.
- `membership`: keyed by `${seasonId}:${studentId}`; contains `userId`, `studentUserId`, `seasonId`, `difficulty`; owner is student ID. This deterministic internal key is not exposed as a public entity ID.
- `audit`: actor ID, action and creation time. No passwords or submitted credential bodies are stored in audits.
- Exported `effectiveSources(context, seasonId, studentId?)` returns active nonretired sources inside include-minus-exclude scope, intersected with student assignments when requested. Native approved license labels are `development-sample`, `public-domain`, `approved`, `creative-commons`; the first preserves the existing development-content workflow.
- Coverage consumes parent study `mastery` fields `{studentUserId,sourceUnitId,level,reviewDueAt}` and counts nonlegacy `attempt` records by student and season.

Imports are capped at 1 MiB, 66 documents and 2,000 source units; every unit is validated before any write. Pack and all sources are inserted in one D1 batch using one set-based source statement. Mutations emit audit records inside the transaction. Season revision guards make stale multi-record operations roll back rather than partially applying. Pack deletion rechecks all dependencies inside its transaction, including nested immutable session cards.

Season collection counts use a single set-based query. Assignment collection and coverage use bounded bulk reads rather than a query per student. This keeps ordinary coach flows beneath the Free plan per-invocation query budget.

## Verification

`npm exec vitest run worker/native/application.test.ts`: **6 tests passed** against real Miniflare/workerd and D1, covering:

1. Coach setup, exclusion-aware counts, assignments, difficulty, coverage, activation, scope lock, and irreversible close/archive.
2. Whole-import validation, immutable version replay, changed-version rejection, and unused-pack deletion.
3. Database-trigger failure mid-import rolls back the pack and sources.
4. Nested immutable session cards prevent source-pack deletion.
5. Cross-tenant pack rejection, student management denial, password reset/deactivation session revocation, and inactive-student assignment denial.
6. Assignment deletion retains membership and returns the correct setup state.

Own application ESLint checks passed. Native typecheck passed after integration. The parent also reported the integrated 31-test native suite passing. No browser UI parity or live Cloudflare deployment was claimed by this subtask.

## Remaining verification and operational limits

- Catalog provider response handling is implemented, but no live external chapter import was exercised here. Staging must verify provider availability and approved-license metadata.
- Existing shared Store list reads are capped at 5,000 records; bulk imports are deliberately lower. Migration must reject or explicitly paginate larger legacy source packs/season mastery and assignment datasets before claiming complete counts at that scale.
- Only the current `PBE_STYLE_V1` profile is available for new seasons. Migration must preserve legacy stored rule snapshots independently.
- Native password hashing currently requires 10–256 characters, stricter than the .NET reset helper's eight-character minimum. This is the parent authentication contract; existing migrated PBKDF2 hashes remain readable.
- No missing existing management endpoint remains. Solo study/progress and team practice endpoints belong to the parent/other task modules.
