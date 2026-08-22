# Erudoza

Study. Master. Compete.

Erudoza is a Scripture competition learning engine. The first scaffold proves one organization-scoped vertical slice: admin season setup, specialist assignment, student study, deterministic Missing Words, attempt persistence, and mastery/review updates.

Primary public origin: https://erudoza.com

Current Spark host: https://erudoza.web.app

## Stack

- SPA: React 19, TypeScript, Vite 8, Tailwind CSS 4
- API: .NET 10, ASP.NET Core, EF Core
- Data: SQLite for local/test without Docker
- Public host: Firebase Hosting on the Spark (no-cost) plan
- Local optional dependencies: SQL Server + Azurite via `infra/local/compose.yaml`

## Quick start

```bash
cp .env.example .env
npm ci
export PATH="$HOME/.dotnet:$PATH"
dotnet restore apps/api/Erudoza.sln
dotnet run --project apps/api/src/Erudoza.Api --urls http://localhost:5080
npm run dev:web
```

Open http://localhost:5173

### Seeded development identities

| Role    | Identifier           | Password        |
|---------|----------------------|-----------------|
| Admin   | admin@erudoza.local  | DevAdmin!234    |
| Student | daniel.student       | DevStudent!234  |

Student accounts do not require email. Coaches reset student passwords from `/admin/students`.

## Commands

```bash
npm run build:web
npm run test:web
npm run test:e2e
dotnet test apps/api/Erudoza.sln
```

## Notes

- Canonical Scripture is stored in the relational content model. The development pack is synthetic sample text. Coaches can import another versioned pack from `/admin/content`; changed wording requires a new version.
- Study activities in this slice: Missing Words, Verse Builder, Reference Match, and What Comes Next. All are deterministic and use stored verse text.
- Competition simulation uses the season rule profile. `PBE_STYLE_V1` forbids multiple-choice in simulation.
- OpenAI is optional. Leave `OpenAI__Enabled=false` unless `OPENAI_API_KEY` is set. Generation still cannot bypass the question validator or coach approval.
- `https://erudoza.com` is the public Spark Hosting origin. See `docs/operations/firebase-host.md`. Firebase Spark cannot run the .NET API. Do not share a GoDaddy password.
- The final logo is a separate approval artifact. The UI uses a replaceable Erudoza wordmark.
