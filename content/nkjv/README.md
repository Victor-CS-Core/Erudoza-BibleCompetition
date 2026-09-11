# Erudoza built-in NKJV library

This is server-side data for the sole built-in New King James Version library. It is not a public asset and must never be imported into a browser module or copied into a static client bundle.

The user supplied `New-King-James-Version Bible.pdf` and approved its use in this application. On 2026-09-11, the repository was verified private and the user authorized source checkpoints and pushes, including the required server provisioning inputs. The extraction payloads retain `licensingStatus: supplied-private`; provisioning records the application's approval as `licensingStatus: approved` and preserves the source's `supplied-private` provenance. These labels and the private repository checkpoint do not assert public-domain status, a publisher license, or permission for public redistribution. Native D1 staging has already been provisioned; current deployment and DNS gates are recorded in [PROGRESS.md](../../PROGRESS.md).

## Validated source

- PDF SHA-256: `980b65ec2b6f0961f4e738129a8da88f497f958578c1a47cdddbe20395e13aa9`.
- 66 books, 1,189 chapters, 31,102 numbered verses; global ordinals 1-31,102.
- Two independent PDF extractors agree on every non-whitespace glyph. The character parser preserves actual PDF space glyphs rather than inserting spaces into wrapped hyphenated or justified words.
- Nineteen visible annotation-like digits were excluded from 16 verses. `annotation-removals.json` records every before/after edit and source page; no words or punctuation were supplied from another Bible. The number `666` in Revelation 13:18 remains intact.
- `manifest.json`, `validation-report.json`, and `REPORT.md` contain extraction provenance. `nkjv.master.json` includes verse source pages and marker geometry. Existing KJV archives and historical organization content remain unchanged.

`library-manifest.json` is the runtime installation contract: version, PDF hash, stable pack IDs, relative file paths, book-file hashes, and the actual chapter/verse structure. Each `import-packs/` file is an `ImportContentPackRequest` source payload. It is installed by provisioning, never through a user-facing import action.

## Stable IDs and D1 storage

The library organization is `00000000-0000-4000-8000-000000000066`. IDs hash UTF-8 `erudoza:nkjv:v1:` plus `book:GEN`, `document:GEN`, or `verse:GEN:1:1` with SHA-256; the first 16 bytes receive version nibble 5 and the RFC 4122 variant, then format directly as hexadecimal UUID groups. No platform-specific GUID byte reordering is used.

The D1 SQL seeds 66 `pack` records with `isBuiltIn: true` and 31,102 `source` records with `canonicalText`; each source belongs to its stable pack through `owner_id`. A `library-version/nkjv-v1` ready record is written only by the final statement after all content has been checked and the expected record counts are present. Requests do not perform installation or duplicate text for seasons or students.

A rerun is a no-op for identical rows and revisions. Any conflicting same-version JSON, owner, organization metadata, or final manifest fingerprint triggers a database constraint error rather than replacing it. Do not suppress such errors or mark the library ready by hand. Inspect the conflict and source hashes. If the first installation is interrupted before readiness, it remains unavailable and can be rerun to finish the identical content.

## Local validation and provisioning

From the repository root, these commands only validate files and generate SQL; the script never contacts a database:

```powershell
node apps/web/scripts/nkjv-library.mjs --validate
node apps/web/scripts/nkjv-library.mjs --write-sql
```

The generated server-only SQL is `content/nkjv/generated/nkjv-v1.sql` and is ignored by Git because it can be reproduced from the checked-in pack files. Do not put it in a public directory. Use the same Node runtime for validation and tests; local verification used Node 24 and its SQLite runtime.

After the local native D1 schema exists, local provisioning can be run from `apps/web`:

```powershell
npx wrangler d1 migrations apply DB --local --config wrangler.native.jsonc
npx wrangler d1 execute DB --local --config wrangler.native.jsonc --file ../../content/nkjv/generated/nkjv-v1.sql
```

The `--local` flag is intentional: these example commands provision a local database. The approved remote D1 staging import has already completed; its reconciliation and metered write receipts are recorded in the [staging audit](../../docs/audits/2026-09-10-cloudflare-staging.md). Do not repeat that import as part of a source checkpoint. The script itself never invokes Wrangler. Verification uses an in-memory SQLite database and an ephemeral Miniflare D1 database; deployment changes follow the gates in [PROGRESS.md](../../PROGRESS.md).

Focused verification, from `apps/web`:

```powershell
node ../../node_modules/vitest/vitest.mjs run scripts/nkjv-library.test.ts
```

The tests check all file hashes and coordinates, cross-runtime IDs, full seed counts, readiness ordering, preserved legacy records, rerun idempotency, rejection of changed source bytes and existing different verse text, and complete execution on the native local D1 engine.
