# NKJV built-in library verification

Implemented the user-approved change: one shared NKJV library of 66 books, no manual Scripture import or translation selector, multi-book season selection, and assignments that filter stored verses. Existing private content and historical study/PVP evidence remain intact. UI and server controls reject unavailable chapter/verse coordinates; Ephesians has six chapters and Jude has one.

## Content and storage evidence

- The supplied PDF contains 31,102 numbered verses across 1,189 chapters. Two independent extraction engines agree on every non-whitespace glyph. Nineteen inline annotation digits were removed in 16 specifically audited verses; no other edition supplied missing words. The PDF was not modified or uploaded. See [source validation](../../content/nkjv/validation-report.json).
- The real 66-book manifest was installed twice into ephemeral .NET SQLite databases. Stable pack, document, verse, and knowledge IDs are preserved; knowledge IDs equal their source verse IDs.
- The actual .NET installation was converted to native records, including all 31,102 original source rows in the migration archive. Rerunning the native seed changed neither canonical records nor revisions. The readiness marker is the last migration record. Checks used isolated local databases only.
- Shared library reads require the reserved library owner and built-in flag. Organization-owned assignments, mastery, sessions, answers, and question banks stay private. Public import/catalog routes return 410; built-in deletion and modifications are rejected.
- New multi-book requests select NKJV or retain a previously selected historical pack. The legacy single-pack request shape remains compatible for older clients. No new manual import endpoint or runtime bypass was added for tests.

## Verification

- .NET: 51 unit tests and 182 integration tests passed; one existing opt-in PVP load test skipped. Tests cover real installation, immutability, missing interior coordinates, organization boundaries, multi-book study/reader/coverage/progress/PVP, historical draft edits, SQLite upgrade, and generated SQL Server `bit` migration SQL.
- Web: lint, TypeScript, standard build and native build passed. The full web suite passed with 286 tests and one existing opt-in load-test skip, then 325 tests passed after incorporating read-only copies of the concurrent coffee-support changes. A prior fully concurrent verification run timed out during Miniflare setup in the existing store test; the test passed alone and the full suite then passed without changing its timeout or assertions.
- Native browsers: three scenarios passed, covering the library, multi-book season and assignment persistence, student reading, and all 176 verses of Psalm 119. Coach/student layouts were checked at 1440, 390 and 320 pixels, with keyboard interactions, dependent-selector resets, no horizontal overflow, and unchanged activity answers while reading. Screenshots were inspected.
- .NET-backed browsers: three Chromium scenarios passed against the actual installed library, including a correct deterministic student activity. The Windows fixture teardown was fixed with per-run PID tracking; the final run exited 0, removed its PID files, and released both fixture ports. Offline NuGet auditing and writable local Wrangler log/config paths were process-only test settings; no production settings were changed.
- Migration: six legacy/export regression tests passed, including immutable answer/feedback and credential preservation. Native library provisioning tests execute the complete corpus on ephemeral D1 and reject mismatched files or conflicting installed text.
- A review benchmark with 66 one-verse selections reduced study revision guards from 31,170 rows / 2,337,618 serialized bytes to 68 rows / 4,968 bytes. SQLite query time was 8 ms on the local machine; this is not a deployed-region latency measurement.

## Operational boundary

Installation is a separate maintenance operation before user traffic: [local D1 instructions](../../content/nkjv/README.md), [.NET instructions](../../apps/api/NKJV-LIBRARY.md). A missing installation gives a clear unavailable response. The book JSON and PDF are not public static assets or browser bundle inputs.

No live development database, remote database, deployment, DNS, registrar setting, commit or push was changed during this work. Cloudflare cutover remains paused. Regional CPU, quota and 200-player latency checks remain release work; the local checks do not establish unlimited free usage or current official PBE conformity.
