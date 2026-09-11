# Built-in NKJV library implementation

User-approved scope: use the supplied NKJV PDF as the sole built-in 66-book library; remove manual imports and other catalog translations from the product; preserve prior content/history; select season and student passages by filtering stored text. Book, chapter and verse selectors must use actual validated library structure. Deployment/DNS stay paused.

## Architecture and contracts

- One immutable library shared by organizations. Reserved library organization ID: `00000000-0000-4000-8000-000000000066`. Existing private packs remain organization-scoped and historically readable. Only built-in pack/source reads may reach the reserved library owner; writes through organization APIs cannot alter it.
- There are 66 physical built-in book packs. Preserve current pack/source IDs for legacy records. Add `IsBuiltIn` to .NET ContentPack; native pack JSON uses `isBuiltIn: true` plus book metadata. New season selection uses built-in books. Existing seasons keep their original content until explicitly changed while editable.
- Stable IDs: SHA-256 of UTF-8 `erudoza:nkjv:v1:` followed by `book:GEN`, `document:GEN`, or `verse:GEN:1:1`; use first 16 bytes, set UUID version nibble to 5 and variant to RFC 4122, format hex groups directly. .NET must use the formatted string, not Guid byte-array endianness. All runtimes get identical IDs.
- `content/nkjv/library-manifest.json`: `{schemaVersion:1,translationId:"nkjv",translationName:"New King James Version",version:1,sourcePdfSha256,books:[{contentPackId,bookKey,name,file,verseCount,chapters:[{number,verses:number[]}],sha256}]}`. Files are server-side data, never public static assets. PDF extraction produces full provenance and validation; installer marks provided material `approved`, never public-domain.
- Authenticated coach `GET /api/v1/organizations/{orgId}/library` returns `{translationId,translationName,version,books:[{contentPackId,bookKey,name,verseCount,chapters:[{number,verses:number[]}]}]}`. Actual chapter/verse values come from installed data. Missing installation returns a clear unavailable error, not invented entries.
- Source preview retains `GET /content-packs/{packId}/source-units` for authorized built-in or same-organization historical packs. Retire manual/catalog import endpoints. Keep reusable internal import logic only for tests/migration where needed.
- Season scope supports `packs:[{contentPackId,includes:Range[],excludes:Range[]}]`. Keep legacy top-level `contentPackId/includes/excludes` readable and accept legacy-shaped requests for existing clients/tests. New multi-book requests set legacy `contentPackId:null,includes:[],excludes:[]`. Responses include `packs` plus the legacy fields when one pack is selected.
- Student assignment shape stays `{contentPackId,range,...}`. A student can have assignments across several selected book packs. Validate every referenced coordinate and the complete intended range against real content; no chapter 7 on a six-chapter book, no missing/reversed bounds, no cross-book ranges. Reset invalid dependent UI choices.
- Scope resolution and coverage use bounded set-based queries across selected packs, including the immutable library, without one query per book. Never duplicate verse rows for seasons/students. Existing study and PVP snapshots remain immutable.
- Install the library once through local/deployment provisioning, outside user requests. .NET startup/provisioning and native D1 seed tooling must be idempotent and detect conflicting content/version data. No PDF or extracted text is uploaded during this task.

## Tasks and ownership

1. Extract PDF in isolated scratch; validate 66 books, numbered verses, exact locator sequence, geometry/font parsing and representative rendered pages. Preserve unresolved discrepancies explicitly; never invent words.
2. Refresh isolated checkout from completed UX/KJV work, preserving reviewed room-auth optimization. Done: 106 incoming files copied, five native auth/room files preserved; baseline recorded for selective integration.
3. Implement .NET immutable library installation/read access, multi-book scopes, bounds, API retirement and tests (delegate).
4. Simplify coach library, multi-book season and student selectors; update shared contracts/navigation/tests (delegate).
5. Implement native immutable library reads, multi-book scoped queries/guards, API retirement, idempotent provisioning and migration compatibility (root).
6. Validate extracted source and prepare deterministic manifest/seed data; review backend/frontend changes independently.
7. Run web lint/type checks/tests/build, .NET checks, and targeted browser scenarios at 1440/390/320. Verify multi-book assignments, all chapter/verse bounds, data reuse, source isolation and PVP eligibility.
8. Integrate only reviewed changed files when original hashes still match the captured baseline. Preserve unrelated work. Document remaining regional/deployment checks without publishing.
