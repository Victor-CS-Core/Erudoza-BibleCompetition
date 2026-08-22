# Connecting erudoza.com

Do not share a GoDaddy username or password with the implementation agent.

Host the public SPA on Firebase Spark. See `docs/operations/firebase-host.md`. Do not point the domain at a paid Azure App Service.

## Live status

- **https://erudoza.com** serves the Spark Hosting site (SSL from Google Trust Services).
- **https://erudoza.web.app** remains the default Hosting URL.
- `www.erudoza.com` is attached on the same site and redirects to the apex. GoDaddy already has `CNAME www → erudoza.web.app`. Some resolvers may still cache the previous ChatGPT custom-domain CNAME for up to an hour.

Firebase Hosting has custom domains `erudoza.com` and `www.erudoza.com`. Nameservers stay on GoDaddy (`ns29.domaincontrol.com` / `ns30.domaincontrol.com`).

## Required GoDaddy DNS

These records are already written. Re-run `python3 scripts/connect-godaddy-dns.py` (or `npm run connect:domain`) only if they drift. The script needs `GODADDY_API_KEY` / `GODADDY_API_SECRET`.

| Type | Name | Value | Notes |
|------|------|-------|-------|
| A | `@` | `199.36.158.100` | Firebase Hosting |
| TXT | `@` | `hosting-site=erudoza` | Keep existing Apple and SPF TXT records |
| TXT | `_acme-challenge` | value from Firebase | SSL ownership for the apex |
| CNAME | `www` | `erudoza.web.app` | Replaces `custom-domains.chatgpt.site` |
| TXT | `_acme-challenge.www` | value from Firebase | SSL ownership for www |

Leave the existing apex TXT records `apple-domain=…` and `v=spf1 include:icloud.com ~all` in place. ACME TXT values rotate; the script reads the live values from Firebase before writing DNS.

The SPA `PUBLIC_ORIGIN` / `VITE_PUBLIC_ORIGIN` should be `https://erudoza.com` if a later build needs an absolute public origin.

## Safer credential path

1. Add `OPENAI_API_KEY` as an environment secret only if generation jobs will run on a later API host. Study and simulation work without OpenAI.
2. Create GoDaddy **API keys** (not the account password) at https://developer.godaddy.com/keys and store `GODADDY_API_KEY` / `GODADDY_API_SECRET`.
3. Authenticate the Firebase CLI (`npx firebase-tools login --no-localhost`) to deploy Hosting and attach domains.
4. After DNS propagates, confirm `https://erudoza.com` returns the Erudoza landing page.
