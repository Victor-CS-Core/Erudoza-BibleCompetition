# Connecting erudoza.com

Do not share a GoDaddy username or password with the implementation agent.

`erudoza.com` can be attached only after a live host exists. The scaffold is not yet deployed.

## Required records (once a host exists)

At GoDaddy DNS for `erudoza.com`:

- Apex `A` or `ALIAS` to the static SPA host
- `www` `CNAME` to the SPA host
- `api` `CNAME` to the Azure API host, or a reverse-proxy path on the same origin

The SPA `PUBLIC_ORIGIN` must be `https://erudoza.com`.

## Safer credential path

1. Add `OPENAI_API_KEY` as an environment secret. Leave `OpenAI__Enabled=false` until generation jobs are reviewed.
2. If DNS should be automated later, create GoDaddy API keys at https://developer.godaddy.com and store `GODADDY_API_KEY` / `GODADDY_API_SECRET`. Do not use the account password.
3. Authenticate Vercel in Cursor if the SPA should be hosted there, or provide Azure credentials for the API + SQL path in `infra/bicep/main.bicep`.
