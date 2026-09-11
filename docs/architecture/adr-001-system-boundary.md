# ADR 001 — System Boundary

Status: Accepted
Date: 2026-08-22

## Decision

Erudoza is a multi-organization Scripture competition learning engine.

- Organization is the tenant boundary from the first schema.
- The React SPA never holds privileged secrets.
- Canonical Scripture lives in the relational content model.
- Blob Storage is only for file-like imports/exports/media.
- The Study Engine depends on deterministic activity-provider interfaces. There is no AI generation path.

## Consequences

Every protected query is organization-scoped. Cross-tenant leakage is an integration-test failure, not a product setting.
