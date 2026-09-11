# Mastery Honor profile export compatibility

The offline EF-to-native exporter supports the canonical mastery profile migration `20260911205416_MasteryHonorProfiles`. Run it only against a consistent private database snapshot, using the existing export procedure. This support does not authorize a hosted cutover or database replacement.

## Preserved data

| Canonical table | Native Records kind | Conversion |
|---|---|---|
| `MasteryHonorUnlocks` | `mastery-honor` | Converts the source unlock GUID to the deterministic organization/user/version/Honor identity. Preserves earned date, season and frozen evidence. |
| `MasteryPassageProofs` | `mastery-proof` | Preserves first mastery, retained mastery and first due-review certification dates. Maps frozen skill evidence and original accepted attempt/card/session/source identities into the bounded native proof. |
| `ProfileAvatarSelections` | `user-profile` | Resolves the selected source unlock GUID, verifies organization/user/key/version ownership, and points to the converted native unlock. An explicit initials selection remains null. |

Every source row, including its exact original JSON strings, is also retained in its `legacy:` archive. Existing `SoloBadgeAwards` and `PracticeAwardRecord` remain practice milestone history; they are never converted into mastery unlocks. Mastery eligibility is not recalculated from current skill scores during export, so a valid earned patch survives ordinary later skill decline.

Mastery records use the existing native `Records` table; this conversion adds no D1 migration. Apply all current native migrations when creating a fresh target. The export SQL contains the baseline schema, and the established import workflow applies subsequent migrations. The canonical migration is not a D1 migration.

## Validation boundaries

Conversion rejects unknown mastery keys/versions, incomplete columns, invalid earned dates, missing or cross-organization references, foreign-user or legacy-only selected unlocks, and mismatched selected keys. Proof conversion checks original attempt ownership and passage boundaries, stored evidence identity, mastery scores and unaided advanced typed retention/review evidence. Retention must be at least 48 hours after first mastery. The exporter preserves trusted canonical unlock decisions rather than attempting to recreate the full qualification history.

Active legacy PVP rooms still block cutover. Completed legacy room scoring/history remains archived, and its native room/history projection remains a separately documented limitation. This does not prevent importing already-issued mastery unlocks and their profile selections.

## Local verification

Run from the repository root:

```powershell
node --test scripts/cloudflare-export.test.mjs
```

The September 11 scoped run passed 13 tests. Coverage includes the original EF source hash/row roundtrip, immutable session and practice milestone replay, populated mastery/avatar/proof conversion, rejected invalid selections/proofs, and actual Miniflare readback after all native migrations. The profile API returns the imported selected patch and two imported unlocks in the 11-Honor catalog; same-organization identity reads agree. GETs and a rejected locked selection preserve the records byte for byte. Selecting another earned patch and resetting to initials preserve all mastery/proof evidence.

The populated mastery fixture is synthetic. These checks establish serialization and API compatibility, not the mastery qualification rules themselves, a hosted import, browser profile behavior, or a production release.
