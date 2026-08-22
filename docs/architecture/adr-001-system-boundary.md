# ADR 001 — System Boundary

Status: Accepted
Date: 2026-08-22

## Decision

Erudoza is a multi-organization Scripture competition learning engine.

- Organization is the tenant boundary from the first schema.
- The React SPA never holds privileged secrets or OpenAI keys.
- Canonical Scripture lives in the relational content model, not Blob Storage and not model memory.
- Blob Storage is only for file-like imports/exports/media.
- The Study Engine depends on interfaces. AI is an optional generation path behind validation.

## Consequences

Every protected query is organization-scoped. Cross-tenant leakage is an integration-test failure, not a product setting.
