# Host Erudoza on Azure

Erudoza uses its own resource group (`rg-erudoza` by default) tagged `project=erudoza`. Do not place these resources in a Filosage resource group.

## Cost

The stack is the cheapest always-on option that still runs .NET 10 on Linux and Azure SQL:

- App Service Linux **B1** (needed for Always On, custom domains, and .NET 10)
- Azure SQL **Basic** (2 GB)
- No App Insights, Log Analytics, Storage, or Key Vault in this pass

The OpenAI key is stored only in App Service application settings. Generation still cannot bypass evidence validation or coach approval.

## Deploy

This Cloud Agent environment is not logged into Azure until you provide a service principal. After that:

```bash
export AZURE_SUBSCRIPTION_ID=...
export AZURE_TENANT_ID=...
export AZURE_CLIENT_ID=...
export AZURE_CLIENT_SECRET=...
export OPENAI_API_KEY=...   # optional; enables generation jobs
export PATH="$HOME/.dotnet:$PATH"
./infra/scripts/deploy.sh
```

The script refuses to create or reuse a resource group whose name looks like Filosage, and refuses an existing group that is not tagged `project=erudoza`.

## First login

Seeded identities are the same as local development. Change those passwords after the first sign-in. Debug answers are off in production.

## Custom domain

After the App Service URL is live, point `erudoza.com` as described in `docs/operations/custom-domain.md`, then redeploy with `publicOrigin=https://erudoza.com`.
