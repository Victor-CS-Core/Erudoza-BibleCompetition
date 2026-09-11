# Erudoza — Product Requirements Document

Status: Product definition, revision 4
Date: 2026-09-09
Product name: Erudoza
Primary domain: https://erudoza.com
Tagline: Study. Master. Compete.

This file is the authoritative product specification for the scaffold. The full locked decisions from the implementation package remain in force:

1. Multi-organization domain boundary from the first schema.
2. React / TypeScript / Vite / Tailwind SPA.
3. .NET 10 / ASP.NET Core API.
4. Azure SQL in production; SQL Server-compatible local development. The scaffold also supports SQLite so the vertical slice can run without Docker.
5. Blob Storage only for file-like data.
6. Exact approved Scripture is stored in the relational content model.
7. Students do not require email accounts.
8. Configurable Rule Profiles, with built-in `PBE_STYLE_V1`.
9. All new activities are built from stored Scripture using programmed rules; there is no AI question-generation service.
10. Coaches select Foundation, Standard or Advanced for each student in each season. Sessions preserve their starting difficulty and rule profile.
11. The first scaffold proves one admin-to-student vertical slice.
12. The product name is Erudoza. The public origin is https://erudoza.com. The tagline is Study. Master. Compete.
13. The final logo remains a separate approval artifact.

See `docs/brand/erudoza-brand-guide.md` for the material system and `docs/architecture` for ADRs.
