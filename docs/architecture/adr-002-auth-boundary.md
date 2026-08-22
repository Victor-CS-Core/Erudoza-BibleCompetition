# ADR 002 — Authentication Boundary

Status: Accepted
Date: 2026-08-22

## Decision

Adult administrators authenticate with email + password.

Student identities are coach-provisioned:

- username required
- email optional/absent
- organization membership required
- no public profile or directory

The API is authoritative. SPA route guards are UX only.

Authentication uses ASP.NET Core Identity cookie sessions (`SameSite=Lax`, HTTP-only). Unauthorized API calls return 401/403 rather than HTML login redirects.

## Consequences

Child accounts do not require public-facing email. Organization admins reset student credentials from the Students page. There is no email-based forgot-password flow for students.
