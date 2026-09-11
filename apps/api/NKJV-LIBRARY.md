The NKJV library is installed through a maintenance operation, before accepting user traffic. The supplied PDF and extracted book files stay on the server. The API never imports books in response to an organization request.

From the repository root, migrate the intended database, then install the server-only manifest. Pass configuration flags before the final operation flag (the .NET configuration parser may otherwise consume an adjacent option as a value):

```powershell
dotnet run --project apps/api/src/Erudoza.Api --no-launch-profile -- --Database:ConnectionString="Data Source=C:/server/erudoza.db" --migrate-only
dotnet run --project apps/api/src/Erudoza.Api --no-launch-profile -- --Database:ConnectionString="Data Source=C:/server/erudoza.db" --Library:ManifestPath="C:/server/content/nkjv/library-manifest.json" --install-nkjv-library
```

Production also requires the existing HTTPS origin, persistent data-protection key path and production configuration. This task does not run these operations against a live database or deploy any files. For a local isolated check, add `--environment Development` and `--Seed:Enabled=false` before the final operation flag and select an explicit scratch database.

Installation checks the 66-book manifest, SHA-256 of every file, all chapter/verse coordinates, the contiguous global ordinal sequence, stable IDs, and installed immutable content. Repeating the operation reuses the same pack, document, source and knowledge rows. Conflicting files or installed data cause an error before replacement; the existing text is retained. A knowledge row uses its verse's stable source ID in its separate table. Source provenance retains the supplied PDF hash and book hash, with the product approval status `approved`; the content is never marked public-domain.

`GET /api/v1/organizations/{orgId}/library` is coach-authorized and returns stored chapter/verse metadata. A missing installation returns HTTP 503. Global reads require both the reserved library owner and the pack's `IsBuiltIn` flag; legacy private records remain tenant scoped. The reserved owner is `00000000-0000-4000-8000-000000000066`.

Scope requests support `packs: [{contentPackId, includes, excludes}]`. New multi-book selections require built-in packs. An editable legacy season may retain and edit private packs already present in its saved scope; another private pack cannot be newly introduced through this shape. Legacy single-pack requests remain readable for older clients. Assignments reference one pack and range each, and students can have assignments across books. Range validation checks actual stored endpoints and every intended intermediate coordinate. Season exclusions continue to filter the assignment's eligible verses. Existing study/PVP snapshots and private histories remain in place.

Manual import, catalog import, and catalog metadata HTTP routes return 410. Test fixtures exercise the preserved internal migration importer directly through a test-only helper; no runtime flag reopens those public routes.

Verification includes the real supplied 31,102-verse manifest installed twice into an ephemeral SQLite database, global sharing and tenant isolation, immutable records, six-chapter bounds, multi-book study/coverage/progress/PVP, and SQLite migration plus generated SQL Server `bit` migration SQL. A live SQL Server migration and production provisioning remain deployment checks.
