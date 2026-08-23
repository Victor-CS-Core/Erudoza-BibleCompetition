# Erudoza

Study. Master. Compete.

Erudoza is a Scripture competition learning engine. The first scaffold proves one organization-scoped vertical slice: admin season setup, specialist assignment, student study, deterministic Missing Words, attempt persistence, and mastery/review updates.

Primary public origin: https://erudoza.com

Hosting target: OpenAI Sites. The Firebase Hosting origin is legacy and is not the application deployment target.

## Stack

- SPA: React 19, TypeScript, Vite 8, Tailwind CSS 4
- API: .NET 10, ASP.NET Core, EF Core
- Data: SQLite for local/test without Docker
- Public host: OpenAI Sites with a Cloudflare Worker-compatible Vite build
- Firebase: reserved for the future application storage layer; it is not used for hosting
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
- OpenAI is optional. Set `OPENAI_API_KEY` to draft short-answer candidates from stored verses. Study games still run without it. Generation cannot bypass the question validator or coach approval. See `docs/operations/openai-and-scripture.md`.
- `https://erudoza.com` is the public application origin and is managed through OpenAI Sites. See `docs/operations/firebase-host.md` for the retired Firebase Hosting boundary.
- Sites serves the SPA and its same-origin API bridge. The current .NET API remains a separate development service until a production API or Firebase-backed replacement is connected through `ERUDOZA_API_BASE_URL`.
- The supplied NKJV dataset is private local source material and is not bundled into the public site or uploaded by the build.
- The supplied flame-and-open-book mark is integrated through a replaceable Erudoza wordmark component.
