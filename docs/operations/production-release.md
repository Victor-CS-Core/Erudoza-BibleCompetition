# Production release runbook

The supported target is **OpenAI Sites SPA + same-origin Worker bridge → HTTPS Azure App Service .NET API → Azure SQL**. SQLite is local/test only. Firebase Hosting is retired; no Firebase replacement backend is implemented. `infra/bicep/main.bicep` is a reviewable target configuration, not evidence of a deployed service. Do not publish or provision as part of local validation.

## External prerequisites and release gates

An operator must select the Azure subscription, resource group, region, resource prefix and approved Sites deployment. Obtain deployment credentials through the organization's secret manager. Confirm App Service supports the requested .NET 10 runtime in that region. Choose the legal content packs, initial organization/coach, retention policy, support owner and recovery objectives before using real student records.

Provision Azure resources only after approval. Supply `sqlAdminPassword` and `databaseConnectionString` as secure deployment parameters, never source-controlled parameter files or command-line literals. The full runtime connection string must target the provisioned server/database with `Encrypt=True;TrustServerCertificate=False`, using a dedicated least-privilege SQL runtime login, not the SQL administrator. For example, its shape is `Server=tcp:<prefix>sql.database.windows.net,1433;Database=erudoza;User ID=<runtime-user>;Password=<secret>;Encrypt=True;TrustServerCertificate=False;`. A DBA creates this principal and grants the required application read/write permissions after schema migration. A separate migration principal needs schema-change permissions. Rotate both credentials under the organization's procedure.

SQL firewall rules default to none. Discover all App Service outbound addresses and approve migration-runner addresses, then explicitly supply `sqlAllowedIpAddresses`. Do not enable the broad “Allow Azure services” rule. A private-endpoint/VNet design is an operator alternative requiring additional infrastructure. The template creates an unused Key Vault and storage account for future operational integration; it does not grant access or claim that keys/secrets are encrypted there. Secure app settings remain readable by authorized Azure operators; use Key Vault references and grant the API identity secret access if required by policy.

## Required runtime configuration

| Setting | Production value |
| --- | --- |
| `ASPNETCORE_ENVIRONMENT` | `Production` |
| `PUBLIC_ORIGIN` | Exact HTTPS Sites application origin, normally `https://erudoza.com` |
| `Database__Provider` | `SqlServer` |
| `Database__ConnectionString` | Full encrypted SQL connection string injected as a secret |
| `Database__ApplySchema` | `false` (single explicit migration step below) |
| `Seed__Enabled` | `false` |
| `ExposeDebugAnswers` | `false` |
| `DataProtection__KeyPath` | `/home/erudoza/keys` on persistent App Service storage |
| `WEBSITES_ENABLE_APP_SERVICE_STORAGE` | `true` |
| Sites Worker `ERUDOZA_API_BASE_URL` | Exact API HTTPS origin, e.g. `https://<prefix>api.azurewebsites.net` |

The Worker binding is runtime configuration, not a browser `VITE_` variable. Configure it through the selected Sites deployment's supported configuration mechanism, then verify the deployed bridge. Never point it at the Sites origin itself. The Worker preserves origin and cookies, declines automatic redirects, strips caller-supplied forwarding headers, uses a 15-second upstream timeout, and returns a generic non-cacheable 503 for network and backend server failures. Production cookies must be Secure/HttpOnly and have no backend-only Domain attribute. Do not trust arbitrary forwarded identity headers to implement rate limits.

The API login limiter partitions by the actual network peer address. Requests routed through Sites can share Worker egress addresses and therefore share a rate-limit bucket. Tune and load-test the configured limits against realistic coach/student concurrency before launch, and validate the hosting perimeter's separate abuse controls. Do not fix shared buckets by trusting user-supplied `X-Forwarded-For`; per-client attribution requires a separately verified trusted-proxy design. Local `.env` and `.dev.vars` files, including environment-specific variants, are excluded from the generated Sites distribution; inject production bindings separately.

## Prepare and migrate

1. Record the exact Git revision and immutable frontend/API artifacts. Run `npm ci`, `npm run build:web`, `npm run test:web`, `npm run test:e2e`, and `dotnet test apps/api/Erudoza.sln`. The repository SDK is 10.0.303 with patch roll-forward; CI reads `global.json`. Require successful remote CI for this same revision.
2. Publish the API artifact with `dotnet publish apps/api/src/Erudoza.Api -c Release -o artifacts/api`. Use a temporary environment configured exactly as production, with the migration-principal connection string supplied by the secret store.
3. Rehearse on a restored Azure SQL staging database first. Freeze writes and record a recoverable pre-change backup point before production migration. Run `dotnet artifacts/api/Erudoza.Api.dll --migrate-only` once from the authorized runner. Require exit code 0, capture sanitized logs, inspect `__EFMigrationsHistory`, and record duration and schema version. This invokes the application's legacy-schema-aware upgrader; do not substitute `EnsureCreated` or blindly baseline an unknown database.
4. Restore the runtime-principal connection setting and deploy the API artifact with `Database__ApplySchema=false`. Never run multiple schema upgraders concurrently. Do not use development seeding to create production users.
5. Bootstrap the initial coach with the offline `--bootstrap-admin` operation. Inject `Operations__AdminEmail`, `Operations__AdminPassword` and `Operations__OrganizationName` through the operator's secret environment, run `dotnet artifacts/api/Erudoza.Api.dll --bootstrap-admin`, then remove those environment values. Keep passwords out of process arguments, logs and shell history. For verified coach recovery use the same controlled environment with `--reset-admin-password`; verify identity out of band, record the event without the password, and confirm prior sessions are invalidated. Run these commands only with explicit operator authorization.
6. Connect the Sites bridge and publish the matched frontend only after API/database checks pass. Import authorized Scripture content and configure a synthetic acceptance season before onboarding real students.

## Deployed acceptance

- Check API and Sites `/api/v1/health`; require successful database readiness, not merely a running HTTP process. Verify anonymous `/api/v1/me` returns 401 and outages return 503 without database details.
- Attempt the documented development logins: both must fail. Sign in with a provisioned synthetic coach and inspect the cookie for Secure, HttpOnly and SameSite=Lax through the public origin. Verify a cross-origin mutation is rejected and sign-out clears the session.
- Complete coach creation of a season/student, passage assignment/correction, activation, student study submission and resumed progress. Inspect activity responses to confirm debug answers are absent.
- Reset the synthetic student's password; the old password and existing cookie must fail. Exercise failed/slow `/me`, account switching and login throttling without real account lockouts.
- Restart the API and verify a valid synthetic login remains readable with the persistent key ring. Confirm key directory survives redeployment and that multiple instances share it before scaling out.
- Record desktop/mobile and accessibility checks, backup restore evidence, revision, environment, operator and timestamps. Local tests do not establish deployed acceptance.

## Backups, restoration and rollback

The template requests 14-day Azure SQL point-in-time retention. Verify the effective policy and first completed backup before admitting real data; choose long-term retention and geographic redundancy with the data owner. Back up the Data Protection key ring separately with restricted access and encryption at rest. Keys may be stored unencrypted by ASP.NET on disk, so restrict the persistent share and use platform encryption; use a supported encrypted shared key store before deployment if policy requires application-level key wrapping. Do not remove old keys still needed by valid cookies.

Before release, restore an Azure SQL backup to a **new isolated database**, give only the recovery runner access, point a staging API at it, run health/read checks and a synthetic study flow, and measure actual RPO/RTO. Never rehearse restoration over live data. Document who approves recovery and how traffic is frozen during it. Preserve audit data and restrict access to restored student records.

Keep the previous immutable API and Sites artifacts. The Basic plan does not provide a slot-based rollout here. Use a maintenance window or separately approved staging host. On failure, freeze writes and restore previous application artifacts only if compatible with the new schema. Do not automatically run down-migrations. For incompatible schema/data changes, restore the recorded pre-change point to a new database, reconcile any accepted writes with the data owner, switch the secret connection setting, restart, and repeat acceptance checks before reopening traffic. Restore matching keys or deliberately revoke sessions with user communication if the key ring was compromised.

## Monitoring and sign-off

Assign an on-call owner and configure external probes of both public bridge and API health. Alert on sustained 5xx/503, latency, failed DB connectivity, SQL capacity/storage, restart loops and unusual authentication failure volume. Route App Service structured logs to the approved sink with retention and secret/PII redaction. The template's Application Insights connection string alone is not proof the API emits telemetry; verify ingestion or explicitly configure a supported instrumentation path. Test an alert and acknowledgment before launch.

Outstanding until externally verified: resource provisioning, SQL principal/firewall setup, HTTPS/DNS and Sites binding, migration on Azure SQL, coach provisioning/recovery, live journey, key persistence across restart/scale, restore drill, monitoring/alerts and clean remote CI. Keep release status blocked until these have evidence.
