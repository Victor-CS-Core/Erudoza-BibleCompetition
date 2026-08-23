# Connecting erudoza.com

The public SPA is hosted on OpenAI Sites. Firebase Hosting is retired; Firebase is reserved for the future storage layer.

OpenAI Sites currently has both `erudoza.com` and `www.erudoza.com` attached. Until GoDaddy receives the record set below, the apex continues resolving to the legacy Firebase Hosting address and both Sites custom-domain certificates remain pending.

## Required GoDaddy DNS

| Type | Name | Value |
|------|------|-------|
| A | `@` | `162.159.143.30` |
| A | `@` | `172.66.3.26` |
| TXT | `_openai-site-verification` | `openai-site-verification=Yf2lnZm49UIO94zqygFMyFdEkC7bQp301uhg9I22OK4` |
| TXT | `_cf-custom-hostname` | `5115613d-519c-458a-96be-a33ae7d446b4` |
| CNAME | `www` | `custom-domains.chatgpt.site.` |
| TXT | `_openai-site-verification.www` | `openai-site-verification=qL1d-4PCxVfUGM66OsT3QhLNY0VthRc9a-COWDZ3Uuc` |
| TXT | `_cf-custom-hostname.www` | `1198484f-1629-41c7-a83d-e0357c675404` |

Leave unrelated apex TXT records, including Apple and SPF records, in place. Replacing `A @` is the apex hosting cutover; replacing `CNAME www` moves the www host from Firebase to Sites.

## Safe helper workflow

The helper is read-only by default:

```powershell
npm.cmd run connect:domain
```

To apply the exact scoped record sets, first set `GODADDY_API_KEY` and `GODADDY_API_SECRET` in the process environment, then run:

```powershell
npm.cmd run connect:domain -- --apply
```

Use GoDaddy developer API keys, never the account password.

After DNS propagates, refresh both custom-domain statuses in OpenAI Sites and confirm:

- `https://erudoza.com` serves the Sites deployment.
- `https://www.erudoza.com` serves the same application.
- `/api/*` returns the Sites bridge response until `ERUDOZA_API_BASE_URL` is configured.
