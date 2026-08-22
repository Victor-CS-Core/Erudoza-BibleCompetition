# Connecting erudoza.com

Do not share a GoDaddy username or password with the implementation agent.

Host the public SPA on Firebase Spark. See `docs/operations/firebase-host.md`. Do not point the domain at a paid Azure App Service.

Firebase Hosting already has custom domains `erudoza.com` and `www.erudoza.com` (www redirects to the apex). Nameservers are GoDaddy (`ns29.domaincontrol.com` / `ns30.domaincontrol.com`). SSL stays pending until these DNS records exist.

## Required GoDaddy DNS

Apply these at GoDaddy DNS, or run `python3 scripts/connect-godaddy-dns.py` after setting `GODADDY_API_KEY` / `GODADDY_API_SECRET`.

| Type | Name | Value | Notes |
|------|------|-------|-------|
| A | `@` | `199.36.158.100` | Replace the current Cloudflare A records |
| TXT | `@` | `hosting-site=erudoza` | Keep existing Apple and SPF TXT records |
| TXT | `_acme-challenge` | value from Firebase | SSL ownership for the apex |
| CNAME | `www` | `erudoza.web.app` | Replace `custom-domains.chatgpt.site` |
| TXT | `_acme-challenge.www` | value from Firebase | SSL ownership for www |

Leave the existing apex TXT records `apple-domain=…` and `v=spf1 include:icloud.com ~all` in place. ACME TXT values rotate; the script reads the live values from Firebase before writing DNS.

The SPA `PUBLIC_ORIGIN` / `VITE_PUBLIC_ORIGIN` must be `https://erudoza.com` after the certificate is active.

## Safer credential path

1. Add `OPENAI_API_KEY` as an environment secret only if generation jobs will run on a later API host. Study and simulation work without OpenAI.
2. Create GoDaddy **API keys** (not the account password) at https://developer.godaddy.com/keys and store `GODADDY_API_KEY` / `GODADDY_API_SECRET`.
3. Authenticate the Firebase CLI (`npx firebase-tools login --no-localhost`) to deploy Hosting and attach domains.
4. After DNS propagates and Firebase shows the certificate as active, set `PUBLIC_ORIGIN=https://erudoza.com`.
