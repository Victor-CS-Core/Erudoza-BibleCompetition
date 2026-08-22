# Erudoza

Study. Master. Compete.

Erudoza is a Scripture competition learning engine. The first scaffold proves one organization-scoped vertical slice: admin season setup, specialist assignment, student study, deterministic Missing Words, attempt persistence, and mastery/review updates.

Primary public origin: https://erudoza.com

## Stack

- SPA: React 19, TypeScript, Vite 8, Tailwind CSS 4
- API: .NET 10, ASP.NET Core, EF Core
- Data: Azure SQL in production; SQLite for local/test without Docker
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

Student accounts do not require email.

## Commands

```bash
npm run build:web
npm run test:web
npm run test:e2e
dotnet test apps/api/Erudoza.sln
```

## Notes

- Canonical Scripture is stored in the relational content model. The development pack is synthetic sample text.
- OpenAI is not required for the scaffold. Generation is behind `IGenerativeQuestionService` with a fake provider.
- The final logo is a separate approval artifact. The UI uses a replaceable Erudoza wordmark.
