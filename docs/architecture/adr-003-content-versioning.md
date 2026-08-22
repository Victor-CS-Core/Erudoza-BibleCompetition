# ADR 003 — Content Versioning

Status: Accepted
Date: 2026-08-22

## Decision

Content is imported as a versioned `ContentPack` owned by one organization.

Each `SourceUnit` stores exact canonical text, normalized comparison text, a content hash, and structured locators (`bookKey`, `chapter`, `verse`, `ordinal`). Range resolution never parses display citations.

Every imported Scripture unit creates one deterministic `ExactVerseText` knowledge unit.

If source text changes, the hash changes and dependent generated questions become stale and leave the playable pool.

## Consequences

Questions are bound to content versions. Duplicate pack/version imports are idempotent. A new version is required for changed text.
