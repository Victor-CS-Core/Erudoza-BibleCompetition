# Erudoza

Study. Master. Compete.

**Start work here:** read [PROGRESS.md](PROGRESS.md) for the current state, completed gates, blockers, and next actions. Every agent must follow the checkpoint workflow in [AGENTS.md](AGENTS.md).

Erudoza is a Scripture competition training app. Coaches set up seasons, assign passages and choose each student's difficulty. Students practise with rule-based activities, save their progress and revisit passages due for review. No AI service or model key is required or supported.

Primary public origin: https://erudoza.com

Production is live on Cloudflare Free (Workers, Durable Objects, and D1). The `erudoza-native` Worker serves the apex; HTTP apex and www requests redirect to HTTPS apex with path and query preserved. Administrator/library, TLS, redirect/no-loop, and WebSocket rejection-guard checks passed on September 11. See [the progress log](PROGRESS.md) and [DNS runbook](docs/operations/erudoza-cloudflare-dns.md) for current deployment evidence and limits. OpenAI Sites is the previous host; Firebase Hosting is legacy.

## Stack

- SPA: React 19, TypeScript, Vite 8, Tailwind CSS 4
- Native API: Cloudflare Workers, Durable Objects for authoritative Team Practice rooms, D1 storage
- Existing API: .NET 10, ASP.NET Core, EF Core; retained for compatibility and local/test workflows
- Data: local D1/SQLite without Docker; hosted native D1 contains the admin and shared NKJV library
- App host: Cloudflare Workers static assets and the active `erudoza.com` custom-domain binding; DNS is on Cloudflare Free
- Previous deployment path: Sites API bridge plus Azure App Service/Azure SQL; retained templates do not provision paid resources automatically
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

- Coaches select passages from the built-in 66-book NKJV library at `/admin/content`. Chapter and verse choices follow the stored book structure. Manual Scripture imports and translation selection have been retired.
- Study activities: Missing Words, Verse Builder, Reference Match, What Comes Next, and True/False. All use stored verse text and coach-selected difficulty.
- Competition simulation uses the season rule profile. `PBE_STYLE_V1` forbids multiple-choice in simulation.
- Library selection and study need no AI setup. Seasons and students reference shared verses without creating additional packs. See [Scripture workflow](docs/operations/scripture-imports.md).
- `https://erudoza.com` is the active native application origin. Registration stays at GoDaddy; DNS is on Cloudflare Free. The approved legacy apex records were replaced and the proxied www redirect is active. The [DNS runbook](docs/operations/erudoza-cloudflare-dns.md) contains the reviewed original-record backup and rollback details.
- The workers.dev address uses the same Worker and is not a separate staging environment. Production origin checks reject browser writes/WebSocket upgrades from the old origin; `wrangler.staging.jsonc` is a rollback configuration.
- The fresh academy starts with Team Practice disabled. Coaches can use **Enable Team Practice** in the UI and prepare their question bank. Existing live staging 5v5 and local browser matches verify pilot gameplay; the production-domain checks covered rejection guards, without creating another room or retesting a successful 101 upgrade. The 20-room/200-player regional load gate remains open.
- [Native operations](docs/operations/cloudflare-native.md) covers D1 provisioning, authentication, real-time rooms, timing, and free-tier constraints. The [deployment audit](docs/audits/2026-09-10-cloudflare-staging.md#september-11-production-domain-acceptance) records completed production acceptance and its limits. The older [Azure release runbook](docs/operations/production-release.md) remains a reference for the retained backend.
- The supplied NKJV dataset is private server provisioning material, installed in hosted D1 and checkpointed in the approved private repository. It is not bundled into public assets or uploaded by the frontend build; this does not assert public redistribution permission.
- Install the [validated NKJV library](content/nkjv/README.md) once through [the .NET maintenance command](apps/api/NKJV-LIBRARY.md) or local D1 provisioning. Missing installation returns a clear unavailable message. Previous KJV files and saved study history remain archived; builds do not install or upload Scripture.
- The supplied flame-and-open-book mark is integrated through a replaceable Erudoza wordmark component.
