# Coach onboarding and abuse controls

The native Cloudflare backend adds coach signup, recovery and invitations. A verified signup creates a separate club with an Owner. A verified invitation creates an Admin in the inviting club. Students continue to use coach-created accounts. Existing accounts cannot use invitations to change clubs, elevate their role or reset credentials.

## Production configuration

Use the existing Free Worker/D1 deployment. Required Worker secrets are `RESEND_API_KEY`, `AUTH_CODE_SECRET` (at least 32 random characters), and `TURNSTILE_SECRET_KEY`. Public settings are `TURNSTILE_SITE_KEY`, `AUTH_EMAIL_FROM` and the exact `PUBLIC_ORIGIN=https://erudoza.com`. Store secrets through Wrangler secret input, never in Git, command arguments, screenshots or chat.

The implementation returns unavailable when configuration is incomplete. The native security secrets, public site key and restricted `RESEND_API_KEY` are deployed. Resend account access and sender verification are complete; authorized real delivery validation remains pending. The intended sender is `Erudoza <accounts@auth.erudoza.com>`, but `AUTH_EMAIL_FROM` remains absent from both the live Worker and versioned production configuration to keep account email actions unavailable until the controlled test is ready. The retained .NET backend has no new onboarding endpoints; its UI treats that capability as unavailable.

There is no separate activation flag: adding the final required email setting immediately enables the public endpoints. First verify the sender and complete an explicitly authorized provider delivery test while one required Worker setting is absent. Then complete configuration for a controlled real signup-code/Turnstile check. If that check fails, remove `RESEND_API_KEY` and verify `/api/v1/auth/coach-options` returns unavailable. Keep the public sender in versioned Wrangler configuration so later deployments preserve it. Do not change `PUBLIC_ORIGIN` or the Turnstile hostname to the sending subdomain.

On September 11, a Free managed Turnstile widget named **Erudoza coach accounts** was created and read back for the single allowed hostname `erudoza.com`, with no clearance cookie. The site key is `0x4AAAAAAEwZpS57GPfAZQXr`; the private secret is in the ignored deployment directory and the native Worker secret store. Production code verifies hostname and action (`coach_signup`, `coach_recovery`, `coach_invitation`) at Siteverify when email onboarding is configured. Client success alone is insufficient; the real widget/delivery flow is not yet live-tested.

## Edge protection

Cloudflare rule **Erudoza account request burst protection**, ID `5d487b83d89a4ead8a82fa56dda96a86`, is Active. It matches `starts_with(http.request.uri.path, "/api/v1/auth/")`, counts per IP, and blocks for ten seconds after more than 30 requests in ten seconds. Dashboard readback confirmed 1/1 Free rate limiting rules in use. No artificial attack traffic was sent to production. This rule excludes study and timed practice paths.

The deployed Worker configuration disables `workers_dev` and preview URLs, rejects API requests on a host other than `PUBLIC_ORIGIN`, and uses separate rate-limit bindings before D1 queries or room allocation. API traffic allows 1,200 requests/minute/IP; account paths allow 60/minute/IP. These are approximate, local burst limits, not global accounting. Shared school/church connections can encounter these thresholds; review legitimate 429s before changing them. WebSocket messages inside established matches retain the room's own authorization/rate controls.

## Durable pilot limits

| Resource | Limit |
|---|---|
| Verification code | Six digits; ten-minute expiry; five guesses; only newest code works |
| Login ingress | 1,200/day and 600/hour globally; 100/hour/IP, plus existing per-minute login limits |
| Public onboarding ingress | Separate 1,200/day and 600/hour globally; 120/hour/IP |
| Coach invitation mutations | Separate 600/day and 300/hour globally; 120/hour/IP; read/list requests do not debit this allocation |
| Email cooldown | One minute per address, shared across account email purposes |
| Email requests | Six/day/address and 30/day/IP |
| Delivery attempts | 80/day and 2,400/month globally; provider failures remain charged |
| Invitation sends and resends | Six/day/coach, 20/day/club; ten pending invitations/club |
| Invitation validity | Seven days; resend rotates secret; revoke invalidates acceptance |
| New clubs | Ten/day |
| Active adult coaches | 20/club |
| Student creation and password reset attempts | 30/day/coach, 60/day/club, 300/day globally |
| Administrative write attempts | 300/day/coach, 600/day/club, 3,000/day globally |
| Stored students and seasons | 100 students including inactive; 12 seasons including archived, per club |

Counters use UTC windows and atomic database operations. Earlier reservations remain charged when a later check denies a request; already saturated IP buckets and outer global counters do not keep writing. Public onboarding cannot consume the reserved login/invitation-management allocations. Capacity is checked before password work and again within the write transaction. Study answers are excluded from the administrative write budgets. Defaults are pilot controls, not a claim that all possible application traffic fits the shared Free quota.

## Operations and verification

Invitation links keep their secret in the fragment and remove it from browser history. They must never be copied into logs or analytics. Do not send test invitations to real third parties without explicit authorization. Provider test doubles belong only to local test runtimes; never ship a bypass header, fixed production verification code, public inbox or email preview endpoint.

Use Cloudflare security events for the scoped rule and Worker request/error metrics for connection failures and 429/503 trends. Do not attach log tails during active matches because they can replace the authoritative Durable Object runtime. Validate normal coach/student use after changing thresholds. Free limits can still be exhausted by sustained distributed abuse; these controls reduce exposure rather than guarantee availability.

Apply additive D1 migration `0003_coach_onboarding.sql` **before** deploying the updated Worker, including a deployment that leaves public signup unavailable. Existing login now uses `AuthBudgets`. All local fixtures/tests apply the same migration list. Preserve the administrator, club and immutable Scripture records; no data reset belongs to this release.

Local integrated verification on September 11: 148 native tests passed with one optional load skip; 283 remaining web/script tests passed; integrated lint, native/web type checking and both builds passed. The independent source review covered onboarding, invitation/session handling and the perimeter; root separately reviewed the reviewer's administrative limit implementation. The production dry run accepts all existing bindings plus the two rate-limit bindings.

The isolated HTTPS browser pass finished at 15:56:53 UTC with 13 captures at 1440/390/320 pixels, no horizontal overflow or JavaScript errors, signup into a separate club, actual generated invitation-link acceptance, revocation, recovery/session invalidation, cross-club/student denial, keyboard use and reduced motion. Providers were intercepted locally; five synthetic emails never left the process. A first harness run completed the main flows but hit an early-403 transport abort in Playwright's Node request client; the final run verifies that denial through actual browser fetch. Real Turnstile rendering and real delivery are separate pending gates. Visual review identified a mobile shortcut reveal issue after desktop resizing; the fix passed 15 focused tests (including two new resize regressions), type/lint, rebuilt outputs and the final browser pass. Root inspected the final 320px capture and confirmed the selected Coaches shortcut remains visible.

## Deployed release

Source checkpoint `c7c5a10` is committed and pushed to the approved private task branch. The additive migration applied successfully (14 commands, 13.94ms), and a subsequent migration listing returned none pending. A transient API 7403 from the initial read cleared after OAuth/account verification and a single retry; it did not apply a partial migration.

Worker **`ae692b55-06f8-4afe-a683-abb85d21ec51`** is deployed on `erudoza.com`. The final live smoke finished at **16:06:27 UTC** on September 11: healthy native API/D1; email availability false and code requests rejected 503; workers.dev 404; exact HTML/JS/CSS build hashes; preserved admin login, all 66 library books and logout/session revocation; coach availability layouts at 1440/390/320 with no overflow or JavaScript errors. No new production accounts, invitations, content or email deliveries. The initial smoke had a local artifact-path error after four successful guard checks; the corrected run and earlier report are retained under `.local/deployment/onboarding/`.

The final native browser regression also passed **5/5** in 6.3 minutes, including a complete ten-player 5v5 with ten scored questions, refresh recovery and achievements. Those games used isolated local fixtures. The separate 20-room/200-player regional gameplay load gate remains open.

## Resend sender preparation — September 11

The user's existing Resend account is on Transactional Free. Dashboard readback showed zero of 100 daily and zero of 3,000 monthly emails used; pay-as-you-go was disabled. Those are point-in-time account-wide values, not reserved app capacity. The application's 80/day and 2,400/month delivery caps remain lower than the provider limits; any other app or receiving traffic in the same account also consumes its quota.

Sending domain **`auth.erudoza.com`**, ID `4b7f7876-511a-48ba-9aac-f48f38fb9cb9`, is verified in North Virginia (`us-east-1`). Resend recorded DNS verification at 16:24 UTC and domain verification at 16:25 UTC. Sending is enabled, receiving is disabled, tracking is not configured, and TLS is **Enforced**. Recipient servers without TLS will fail delivery rather than receive account codes unencrypted.

Three records were added to Cloudflare after checking the names were unused: TXT `resend._domainkey.auth` with the provider's public DKIM key; MX `send.auth` to `feedback-smtp.us-east-1.amazonses.com`, priority 10; TXT `send.auth` with `v=spf1 include:amazonses.com ~all`. All are DNS-only with automatic TTL. Public DNS-over-HTTPS independently returned all three exact values. The existing apex DMARC quarantine policy remains unchanged; no apex website or mail record was replaced. Resend's automatic DNS setup stalled before authorization, so these records were entered directly in Cloudflare and verified through the saved domain page.

The key is named **Erudoza production account emails**, ID `dc8d5ae2-87ae-4eb1-819a-7d2cb19f8c1a`, with **Sending access** restricted to **auth.erudoza.com**. Automatic approval review initially rejected its creation pending explicit scope approval. The user then created the prepared key and reported that action. Its saved permission/domain were read back, and the value was transferred directly through browser controls into the encrypted `RESEND_API_KEY` secret in `erudoza-native`. No key value was printed or written into Git; its temporary clipboard copy was cleared. The Cloudflare settings readback shows **Secret / Value encrypted**. This resolves the key-creation blocker.

The resulting Worker version is **`0cef3225-f062-49d7-8f97-b0cf409f71e0`**, deployed at **16:33:02 UTC** with message **Add secret: RESEND_API_KEY**. No application code or frontend build was replaced. At **16:33:49 UTC**, three public DNS records matched and `/api/v1/auth/coach-options` still returned `{available:false,turnstileSiteKey:null}`. Evidence is retained in `.local/deployment/onboarding/sender-preparation.json`. A temporary sender-config dry run passed against the existing bindings; the activating field was then removed from source until test authorization arrives, so another task's normal deployment cannot enable emails prematurely.

Remaining activation work: obtain the pending authorization for one setup email and one signup code to the user's own Resend account address, complete the delivery preflight, add the intended sender to versioned production configuration and deploy it for the real signup widget/code request. An app 202 or stored `delivered=1` proves provider acceptance only; check provider delivery status and actual recipient receipt. Stop before signup completion, password changes or third-party invitations unless separately authorized. No paid plan was enabled and no real email was sent during sender preparation.

Official references: [Turnstile server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [Worker rate-limit binding semantics](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [WAF rate limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/), [Resend limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits).
