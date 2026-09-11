# erudoza.com Cloudflare DNS transition

## Current state — 2026-09-11 14:02:09.335 UTC

GoDaddy saved the custom nameservers **`elsa.ns.cloudflare.com`** and **`yevgen.ns.cloudflare.com`**. The registrar UI was read back and confirmed that setting at 13:59:27 UTC. Registration and renewal remain at GoDaddy; no domain transfer or paid upgrade was made.

Cloudflare zone **`c65e6d9c75bf399c8d726ec2414859d3`** is **Active** on the **Free Website** plan, confirmed by the API at 14:02:09.335 UTC with the same assigned nameservers. [Local zone-status evidence](../../.local/deployment/zone-status.json). All 26 reviewed portable GoDaddy records have been imported, with DNS-only routing for the imported records. One nameserver check was requested while the UI was Pending and reported that checking might take hours; that pending status is superseded by the API activation confirmation. DNSSEC was verified off in the reviewed GoDaddy UI.

The production configuration is prepared and its dry run passed, but **production has not been deployed and the Worker custom domain is not bound**. The native app remains live at [the staging origin](https://erudoza-native.fedilms-deployment-companion.workers.dev). The imported apex and www records still preserve the existing Sites host values below.

## Preserved records and TTLs

The imported set contains **2 A, 8 CNAME, 2 MX, and 14 TXT records**. Cloudflare's original 16 imported records currently use **Automatic TTL**; the ten subsequently added records retain their original numeric TTLs. The backup retains the original GoDaddy TTLs for all 26. Its numeric TTLs must not be mistaken for the current Cloudflare settings on the first 16 records.

Key values preserved in the imported zone:

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

The complete backup also preserves the two ACME TXT records, four custom-hostname TXT records, four OpenAI verification TXT records, and four GoDaddy bounce/DKIM CNAME records. Repeated TXT names have distinct values and remain separate records.

The user stated that iCloud email is unused. Existing mail records were retained; additional email delivery testing is not a cutover gate.

## Local backup and provenance

These ignored local artifacts were assembled from the exact **reviewed GoDaddy UI records**, not from a provider-generated zone export:

- [All 26 portable records, BIND format](../../.local/deployment/dns/godaddy-portable26-reviewed-ui-2026-09-11.bind)
- [All 26 portable records and authority context, JSON](../../.local/deployment/dns/godaddy-portable26-reviewed-ui-2026-09-11.json)
- [Backup provenance and TTL notes](../../.local/deployment/dns/godaddy-portable26-reviewed-ui-2026-09-11.md)
- [Count, field, and SHA-256 validation](../../.local/deployment/dns/godaddy-portable26-reviewed-ui-2026-09-11-validation.json)
- [The ten previously missing records, BIND format](../../.local/deployment/dns/godaddy-missing-10-2026-09-11.bind)

All record names and CNAME/MX targets are fully qualified; original TTLs and MX priorities were verified. The portable file deliberately omits provider NS and SOA records. The known old authority settings are `ns29.domaincontrol.com.` and `ns30.domaincontrol.com.`, TTL 3600; the SOA primary was `ns29.domaincontrol.com.`. Other SOA fields were not supplied and have not been invented. The files are local review/restore artifacts, not evidence that a new import or TTL restoration should be applied without comparing the current zone.

## Staging evidence and production boundary

The [deployment audit](../audits/2026-09-10-cloudflare-staging.md#september-11-post-reset-verification) records the September 11 post-reset checks against version `00f4b6cc-0caa-47e3-b87e-d3bf8d7640b9`:

- Administrator login/logout, secure cookies, organization isolation, empty student/season lists, the 66-book library, actual chapter/verse selectors, and desktop/mobile browser checks passed at 13:38 UTC.
- Exact shared-library SQL for Ephesians 6:1–3 returned 3 verses using 311 reads. The Ephesians source list returned 155 verses using 466 reads: **777 reads and zero writes** in total. [Sanitized metering evidence](../../.local/nkjv-d1-budget/live-read-meter-2026-09-11.json).
- No new student, season, or match fixtures were created for these checks. Populated season-summary and revision-guard queries retain their local regression evidence; they were not remeasured remotely.

The earlier complete live 5v5 match and individual study checks are recorded in the same audit. These are pilot checks, not certification of 20-room/200-player capacity or remaining account-wide Free quota.

The prepared [production configuration](../../apps/web/wrangler.production.jsonc) sets `PUBLIC_ORIGIN=https://erudoza.com` and an apex Worker custom-domain route for this zone. Its successful [local dry-run log](../../.local/deployment/production-dry-run.log) does not establish a deployed route, active certificate, or functioning production login.

The www redirect configuration was reviewed in the Cloudflare UI with condition `(http.host eq "www.erudoza.com")`, dynamic target `concat("https://erudoza.com", http.request.uri.path)`, status 301, and query-string preservation. Clicking Save as Draft opened a DNS-proxy warning requiring an additional deployment confirmation. Automatic approval review rejected proceeding while www remained DNS-only. The form was canceled; the redirect is **not confirmed stored or active**. After the apex binding works, update www to a proxied CNAME pointing to erudoza.com, verify that prerequisite, then create and enable the redirect.

### Approval review and final preflight

At 14:03 UTC, automatic approval review rejected the production Wrangler deployment before execution. It cited insufficient verification of the production target and absence of explicit authorization for the exact apex DNS replacement. No deployment or apex replacement occurred. Subsequent read-only verification confirmed the currently deployed Worker version remains `00f4b6cc-0caa-47e3-b87e-d3bf8d7640b9`; another local production dry run passed with 28 static assets and the existing D1/three Durable Object bindings. A staging/production config diff contains only the apex custom-domain route and `PUBLIC_ORIGIN` change.

Public DNS resolution through 1.1.1.1 now returns `elsa.ns.cloudflare.com` and `yevgen.ns.cloudflare.com` (NS TTL 86400). The remaining reviewable change is to replace the two legacy apex A records (`162.159.143.30`, `172.66.3.26`) with the managed custom-domain binding for `erudoza-native`, change www from `custom-domains.chatgpt.site` to a proxied CNAME at `erudoza.com`, and enable the reviewed redirect after verifying proxying. Explicit user confirmation of this exact replacement is pending because of the automatic approval rejection.

## Remaining cutover work

1. Obtain the exact record replacement confirmation required by automatic approval review; public delegation is already verified. Preserve the imported records while resolver caches converge.
2. Deploy the reviewed production configuration and bind the apex custom domain, then set and verify the proxied www record before enabling its redirect. Review resulting apex/www DNS changes while retaining the other backup records.
3. Verify production HTTPS, redirect path/query behavior, health, authentication/logout, library access, and the intended study/PVP pilot routes. Record the deployed version and final DNS/certificate state here. Keep the old host and local source backup available through acceptance.

## Rollback reference

Before any rollback, compare the current zone with the reviewed backup and preserve changes made since this snapshot. The saved registrar nameservers can be returned to **`ns29.domaincontrol.com`** and **`ns30.domaincontrol.com`** after confirming the old GoDaddy zone still contains the required records. Nameserver rollback also requires propagation time; it is not an immediate traffic switch.

The previous Sites host values are apex A **`162.159.143.30`** and **`172.66.3.26`**, plus www CNAME **`custom-domains.chatgpt.site.`**. Those values are still present in the imported Cloudflare zone at this snapshot. The complete portable backup contains their original TTLs and the associated verification records. If reverting a later application cutover while keeping Cloudflare authoritative, review and undo the native apex binding/www redirect, restore these host records, and revalidate the old host's HTTPS and verification state. Do not import the full backup blindly over newer records.

At this snapshot no production Worker deployment needs reversing: the staging configuration and workers.dev origin remain the active native deployment. The registrar readback, Cloudflare Active API status, and imported record review are the current transition evidence; Worker domain binding, redirect activation, and production-domain acceptance remain pending.
