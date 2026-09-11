# erudoza.com Cloudflare DNS transition

## Current state — 2026-09-11, verified through 14:56:46 UTC

GoDaddy saved the custom nameservers **`elsa.ns.cloudflare.com`** and **`yevgen.ns.cloudflare.com`**. The registrar UI was read back and confirmed that setting at 13:59:27 UTC. Registration and renewal remain at GoDaddy; no domain transfer or paid upgrade was made.

Cloudflare zone **`c65e6d9c75bf399c8d726ec2414859d3`** is **Active** on the **Free Website** plan, confirmed by the API at 14:02:09.335 UTC with the same assigned nameservers. [Local zone-status evidence](../../.local/deployment/zone-status.json). The initial import preserved all 26 reviewed portable GoDaddy records. The approved application cutover subsequently replaced the apex records and updated www as recorded below. DNSSEC was verified off in the reviewed GoDaddy UI.

**Production is live and the app-domain gate is complete:** [https://erudoza.com](https://erudoza.com) is bound to `erudoza-native`, deployed version **`4958cd54-65b8-4060-9f68-ca59bdb22a6a`**, with `PUBLIC_ORIGIN=https://erudoza.com`. The user explicitly approved these exact replacements. The existing www record is now a **Proxied CNAME to `erudoza.com`, Automatic TTL**, verified in the Cloudflare UI.

Active Single Redirect **`269651cea73a457786211151fda5c516`** uses condition `(http.host eq "www.erudoza.com")`, dynamic target `concat("https://erudoza.com", http.request.uri.path)`, status **301**, and query-string preservation. Both HTTP and HTTPS www requests were verified to redirect directly to HTTPS apex with their path and query intact.

Cloudflare **Always Use HTTPS** is enabled and checked in the UI. Final bounded verification confirmed HTTP apex redirects to HTTPS apex, HTTP www redirects directly to HTTPS apex, and the resulting HTTPS login page returns 200 without a redirect loop; path and query are preserved.

The workers.dev URL is the **same Worker**, not a separate staging deployment. It may still serve public content, but production origin checks reject browser writes and WebSocket upgrades using the old origin. [The staging configuration](../../apps/web/wrangler.staging.jsonc) is a rollback configuration, not a concurrently usable staging application.

## Original record backup and cutover changes

The original imported set contained **2 A, 8 CNAME, 2 MX, and 14 TXT records**. Cloudflare's first 16 imported records used **Automatic TTL**; the ten subsequently added records retained their original numeric TTLs. The backup retains the original GoDaddy TTLs for all 26. Its values describe the reviewed pre-cutover record set, not the current managed apex binding or www target.

Before managed apex binding, deletion was limited to A `162.159.143.30` and A `172.66.3.26`; the other **24 imported records were retained at that step**. The existing www CNAME was subsequently updated to the approved proxied apex target. This runbook does not claim a fresh total UI record count after Cloudflare created the managed binding.

Key original values retained for rollback:

| Name | Type | Value | Original GoDaddy TTL |
|---|---|---|---:|
| apex | A | `162.159.143.30` | 600 |
| apex | A | `172.66.3.26` | 600 |
| www | CNAME | `custom-domains.chatgpt.site.` | 600 |
| pay | CNAME | `paylinks.commerce.godaddy.com.` | 3600 |
| _domainconnect | CNAME | `_domainconnect.gd.domaincontrol.com.` | 3600 |
| apex | MX | priority 10 `mx01.mail.icloud.com.` | 3600 |
| apex | MX | priority 10 `mx02.mail.icloud.com.` | 3600 |
| apex | TXT | `v=spf1 include:icloud.com ~all` | 600 |
| apex | TXT | `apple-domain=e3sHrmtNHZJMO2ID` | 600 |
| apex | TXT | `hosting-site=erudoza` | 600 |
| _dmarc | TXT | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` | 3600 |
| sig1._domainkey | CNAME | `sig1.dkim.erudoza.com.at.icloudmailadmin.com.` | 3600 |

The complete backup also preserves the two ACME TXT records, four custom-hostname TXT records, four OpenAI verification TXT records, and four GoDaddy bounce/DKIM CNAME records. These unrelated records were retained during the cutover. Repeated TXT names have distinct values and remain separate records.

The user stated that iCloud email is unused. Existing mail records were retained; additional email delivery testing is not a cutover gate.

## Local backup and provenance

These ignored local artifacts were assembled from the exact **reviewed GoDaddy UI records**, not from a provider-generated zone export:

- [All 26 portable records, BIND format](../../.local/deployment/dns/godaddy-portable26-reviewed-ui-2026-09-11.bind)
- [All 26 portable records and authority context, JSON](../../.local/deployment/dns/godaddy-portable26-reviewed-ui-2026-09-11.json)
- [Backup provenance and TTL notes](../../.local/deployment/dns/godaddy-portable26-reviewed-ui-2026-09-11.md)
- [Count, field, and SHA-256 validation](../../.local/deployment/dns/godaddy-portable26-reviewed-ui-2026-09-11-validation.json)
- [The ten previously missing records, BIND format](../../.local/deployment/dns/godaddy-missing-10-2026-09-11.bind)

All record names and CNAME/MX targets are fully qualified; original TTLs and MX priorities were verified. The portable file deliberately omits provider NS and SOA records. The known old authority settings are `ns29.domaincontrol.com.` and `ns30.domaincontrol.com.`, TTL 3600; the SOA primary was `ns29.domaincontrol.com.`. Other SOA fields were not supplied and have not been invented. The files are local review/restore artifacts, not evidence that a new import or TTL restoration should be applied without comparing the current zone.

## Staging evidence and production acceptance

The [deployment audit](../audits/2026-09-10-cloudflare-staging.md#september-11-post-reset-verification) records the September 11 post-reset checks against version `00f4b6cc-0caa-47e3-b87e-d3bf8d7640b9`:

- Administrator login/logout, secure cookies, organization isolation, empty student/season lists, the 66-book library, actual chapter/verse selectors, and desktop/mobile browser checks passed at 13:38 UTC.
- Exact shared-library SQL for Ephesians 6:1–3 returned 3 verses using 311 reads. The Ephesians source list returned 155 verses using 466 reads: **777 reads and zero writes** in total. [Sanitized metering evidence](../../.local/nkjv-d1-budget/live-read-meter-2026-09-11.json).
- No new student, season, or match fixtures were created for these checks. Populated season-summary and revision-guard queries retain their local regression evidence; they were not remeasured remotely.

The earlier complete live 5v5 match and individual study checks are recorded in the same audit. These are pilot checks, not certification of 20-room/200-player capacity or remaining account-wide Free quota.

The [production configuration](../../apps/web/wrangler.production.jsonc) has now been deployed successfully. Production checks passed:

- **14:42:27–14:42:34 UTC:** real administrator login, secure cookies, anonymous/cross-origin rejection, organization isolation, empty student/season lists, all 66 library books, actual chapter/verse bounds, layouts at 1440/390/320 pixels, and logout revocation. No browser runtime exceptions were captured. [Browser report](../../.local/deployment/production-smoke/library-report.json).
- **14:44:41 UTC:** public delegation, trusted hostname-valid apex/www certificates using TLS 1.3, native health with connected D1 and the expected timing contract, HTTP/HTTPS www redirects, and served entry JS/CSS hashes matching the validated native build. Both hosts resolved to `104.21.66.111` and `172.67.159.115` through the tested resolvers. Certificates observed then expire on November 21, 2026. These are observed edge answers/certificates, not permanent configuration values. [Edge report](../../.local/deployment/production-edge/latest.json).
- **14:45:21 UTC:** one additional encoded-path/query redirect probe preserved the exact path and query bytes. [Encoded redirect report](../../.local/deployment/production-edge/encoded-redirect.json).
- **14:49:48–14:49:50 UTC:** WebSocket upgrade rejection guards returned 401 for anonymous access, 403 for forged Origin, and 403 for an authenticated invalid-room request reaching the feature/route guard while `practiceEnabled=false`. Logout returned 204. [Guard report](../../.local/deployment/production-ws-guards.json).
- **14:56:46 UTC:** after an earlier HTTP apex probe returned 200, Always Use HTTPS was enabled. Exactly three anonymous GETs verified HTTP apex → HTTPS apex 301, HTTP www → HTTPS apex 301 with identical path/query, and final HTTPS `/login` 200 with no Location header or loop. [HTTPS-upgrade report](../../.local/deployment/production-edge/https-upgrade-latest.json).

The production guard check created **no room** and did **not** attempt a successful 101 connection or a post-domain full match. Gameplay evidence remains the earlier live staging 5v5 match and 39 passing local browser cases (5 native and 34 .NET); it does not certify 20 rooms/200 players. The fresh academy's Team Practice flag is false by default. A coach can use **Enable Team Practice** in the UI and prepare a reviewed question bank. Existing private administrator credentials were retained; only their saved URL was updated to the apex.

### Approval review, binding retry, and resolution

At 14:03 UTC, automatic approval review rejected the production Wrangler deployment before execution. It cited insufficient verification of the production target and absence of explicit authorization for the exact apex DNS replacement. That rejected attempt made no deployment or apex replacement. Follow-up target verification and a local production dry run passed with 28 static assets and the existing D1/three Durable Object bindings. The staging/production config diff contained only the apex custom-domain route and `PUBLIC_ORIGIN` change.

The user then replied **“Approved”** to the exact private repository destination and website-record replacements. The first approved production deploy uploaded the Worker but the custom-domain binding returned error **`100117`** while the two legacy apex A records remained. This was a partial deployment, not an atomic no-op. Removing exactly the approved A records and retrying produced the final successful deployment/binding at version `4958cd54-65b8-4060-9f68-ca59bdb22a6a`. The www CNAME was updated and its Proxied state verified before the redirect was enabled. These approval and technical blockers are resolved.

The same approval explicitly covered uploading the reviewed source to the existing private `Victor-CS-Core/Erudoza-BibleCompetition` repository. The push to `origin/codex/cloudflare-free-port` then succeeded, advancing `af237aa..47732ba` and including implementation commit `912ba0a`. See [PROGRESS.md](../../PROGRESS.md) for validation evidence and the completed source checkpoint. This Git push does not establish a production deployment or a GitHub CI run.

## Completed gate and remaining work

The production DNS/app-domain gate is complete. No DNS or exact-approval blocker remains. The primary agent still needs to commit and push this final documentation checkpoint; the last confirmed source tip is `47732ba`. The user's new gray-text/green-background contrast audit is a separate active checkpoint tracked in [PROGRESS.md](../../PROGRESS.md).

The separate 20-room/200-player regional load gate remains open. A successful production-domain 101 upgrade/full match was not added by the bounded guard checks. Keep the reviewed backups available, and use the normal coach workflow to enable Team Practice and prepare academy content when needed.

## Rollback reference

Before any rollback, compare the current zone with the reviewed backup and preserve changes made since this snapshot. The saved registrar nameservers can be returned to **`ns29.domaincontrol.com`** and **`ns30.domaincontrol.com`** after confirming the old GoDaddy zone still contains the required records. Nameserver rollback also requires propagation time; it is not an immediate traffic switch.

The previous Sites host values are apex A **`162.159.143.30`** and **`172.66.3.26`**, plus www CNAME **`custom-domains.chatgpt.site.`**. They were replaced by the approved native binding and proxied redirect configuration. The complete portable backup contains their original TTLs and associated verification records. If reverting the application cutover while keeping Cloudflare authoritative, review and remove the managed apex binding, disable the www redirect, restore the legacy host records, and revalidate the old host's HTTPS and verification state. Preserve unrelated records; do not import the full backup blindly over newer records.

The current Worker version is `4958cd54-65b8-4060-9f68-ca59bdb22a6a` with production `PUBLIC_ORIGIN`. Returning its interactive use to workers.dev also requires a reviewed deployment/origin rollback: the staging configuration targets this same Worker and shared D1/DO bindings. It must not be deployed as though it were a separate staging service. Do not reimport or overwrite hosted user/library data as part of a DNS rollback.
