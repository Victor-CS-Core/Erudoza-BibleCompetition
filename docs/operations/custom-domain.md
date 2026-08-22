# Connecting erudoza.com

Do not share a GoDaddy username or password with the implementation agent.

`erudoza.com` can be attached only after a live host exists. Provision that host with `docs/operations/azure-host.md` into resource group `rg-erudoza` (never a Filosage group).

## Required records (once a host exists)

At GoDaddy DNS for `erudoza.com`:

- Apex `A` or `ALIAS` to the static SPA host
- `www` `CNAME` to the SPA host
- `api` `CNAME` to the Azure API host, or a reverse-proxy path on the same origin

The SPA `PUBLIC_ORIGIN` must be `https://erudoza.com`.

## Safer credential path

1. Add `OPENAI_API_KEY` as an environment secret. Keep `OpenAI__Enabled=false` until generation jobs are reviewed. Study and simulation work without OpenAI.
2. If DNS should be automated later, create GoDaddy API keys at https://developer.godaddy.com and store `GODADDY_API_KEY` / `GODADDY_API_SECRET`. Do not use the account password.
3. Authenticate Vercel in Cursor if the SPA should be hosted there, or provide Azure credentials for the API + SQL path in `infra/bicep/main.bicep`.
4. After a host exists, point apex `A`/`ALIAS` and `www` to the SPA, then set `PUBLIC_ORIGIN=https://erudoza.com`.
