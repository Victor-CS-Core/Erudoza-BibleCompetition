# SQLite to native D1 migration adapter

`scripts/cloudflare-export.mjs` opens the EF SQLite source with Node's `DatabaseSync(..., { readOnly: true })`, performs integrity/foreign-key checks inside a read transaction, validates the conversion, and exports native SQL plus a count/hash manifest and original source table definitions. It never writes the source database, imports remotely, deploys resources or migrates authentication cookies.

Run with Node 24:

```powershell
node scripts/cloudflare-export.mjs
node --test scripts/cloudflare-export.test.mjs
```

The default source is `apps/api/src/Erudoza.Api/erudoza.dev.db`. Output goes to a new timestamped directory under ignored `apps/web/test-results/migration/`. `--source <path>` and `--output <directory>` override those locations. Files contain password hashes, private answer keys and student records: keep them out of Git and external destinations until the cutover's authorized import. Existing output files are never overwritten.

## Preserved representations

- Organizations and users keep GUID identity, names, roles, active state, security stamps and byte-identical PBKDF2 password hashes. A fresh credential version is assigned only when the legacy stamp is empty. Native auth session tables are empty, requiring a new login.
- Content includes inactive/retired sources, exact source text, original knowledge GUIDs, hashes, licensing metadata and document identity. Seasons, assignments, ranges, competition difficulty and activation dates are mapped into native Records.
- Session cards embed the original persisted payload and answer key after property-name adaptation, never regeneration. Source snapshots come from the retained source rows. Original attempt IDs, submission IDs, answer/time/hint evidence and saved feedback are retained. Nonlegacy attempts populate embedded session history; legacy duplicates remain in standalone attempt/archive records and never count twice. Missing historic feedback is explicitly marked `feedbackReconstructed` and frozen using the same available card/source/mastery fallback as legacy replay; the manifest reports its count.
- Mastery preserves its original record GUID and algorithm version, skills, level and review schedule. Native runtime migration handling rebuilds old algorithm evidence on the first subsequent attempt. Composite membership lookup keys are adapted to `season:user`, while the original membership GUID remains in the value and archive.
- Every source row is additionally retained verbatim in `legacy:<table>` Records, including its original JSON strings and identifiers. Original schema SQL is emitted in `source-schema.json`. Global tables without tenant ownership are archived once under the first organization; owned rows use their original or referenced organization.
- Supported PVP question definitions and enablement settings map into native question/settings records. Completed/abandoned legacy rooms and award records retain their raw scoring, corrections, timing ticks and evidence in archives. They are not represented as resumable Durable Objects or silently converted into native timing data.

## Explicit cutover blockers

Conversion rejects users belonging to zero/multiple organizations, mismatched role/kind, unsupported password formats, broken references, unrecognized nonempty tables, missing required row columns, multiple packs in a season scope, assignments with other than one range, sources with other than one ExactVerseText knowledge unit, invalid immutable card/attempt boundaries, unsupported enum/profile values, duplicate accepted attempts, review schedules without mastery, and statements above D1's SQL statement size limit. It supports the current PBE_STYLE_V1 version 1 profile; custom profile configurations require an explicit adapter.

All legacy PVP rooms must be Completed or Abandoned before export. Lobby/Playing states are rejected because their active process clocks cannot migrate to Durable Objects. When historic PVP rooms or awards exist, the manifest warns that native room history, trends and achievement projections still need a separate validated projection. Raw archival preservation is not a claim of UI parity for historical PVP.

## Evidence

The actual development source had 28 tables, two organizations, five users, three seasons, twelve source/knowledge units, two solo sessions, one immutable card and one attempt. Conversion produced two native organization rows, five user rows and 115 Records, including a verbatim archive of every source row. It contained no PVP tables/data and three EF migration-history entries. The adapter recognizes current EF PVP table names from migration source: `PracticeRoomRecord`, `PracticeQuestionRecord`, `PracticeSetting`, `PracticeAwardRecord`.

Five `node --test` tests pass. The actual source file SHA-256 is checked unchanged before/after export. Generated SQL executes through real SQLite constraints, and archive counts, every serialized native record, credential hashes and empty authentication sessions are verified. Another test imports converted actual records into real Miniflare/D1, installs a synthetic local test-only auth session, and verifies the native resume endpoint returns the original card ID, private-key redaction, original attempt ID/canonical feedback and completed summary. Other tests reject unsupported conversions and live PVP state, retain raw historical timing evidence, preserve duplicate flags and mark reconstructed feedback. `node --check scripts/cloudflare-export.mjs` passes.

No source DB updates, remote import, deployment or DNS changes were performed. Local SQL roundtrip and Miniflare validation do not establish production cutover readiness; the parent runbook must handle a frozen final source snapshot, backups, empty target verification, post-import counts and rollback.
