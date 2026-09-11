# Coach onboarding and abuse controls

The native Cloudflare backend adds coach signup, recovery and invitations. A verified signup creates a separate club with an Owner. A verified invitation creates an Admin in the inviting club. Students continue to use coach-created accounts. Existing accounts cannot use invitations to change clubs, elevate their role or reset credentials.

## Production configuration

Use the existing Free Worker/D1 deployment. Required Worker secrets are `RESEND_API_KEY`, `AUTH_CODE_SECRET` (at least 32 random characters), and `TURNSTILE_SECRET_KEY`. Public settings are `TURNSTILE_SITE_KEY`, `AUTH_EMAIL_FROM` and the exact `PUBLIC_ORIGIN=https://erudoza.com`. Store secrets through Wrangler secret input, never in Git, command arguments, screenshots or chat.

The implementation returns unavailable when configuration is incomplete. Do not enable public onboarding until a verified sender and an explicitly authorized delivery test work. Resend account access and real delivery validation are still pending. The retained .NET backend has no new onboarding endpoints; its UI treats that capability as unavailable.

On September 11, a Free managed Turnstile widget named **Erudoza coach accounts** was created and read back for the single allowed hostname `erudoza.com`, with no clearance cookie. The site key is `0x4AAAAAAEwZpS57GPfAZQXr`; the private secret is in the ignored deployment directory. The widget has not yet been wired into a deployed onboarding release. Production verifies hostname and action (`coach_signup`, `coach_recovery`, `coach_invitation`) at Siteverify. Client success alone is insufficient.

## Edge protection

Cloudflare rule **Erudoza account request burst protection**, ID `5d487b83d89a4ead8a82fa56dda96a86`, is Active. It matches `starts_with(http.request.uri.path, "/api/v1/auth/")`, counts per IP, and blocks for ten seconds after more than 30 requests in ten seconds. Dashboard readback confirmed 1/1 Free rate limiting rules in use. No artificial attack traffic was sent to production. This rule excludes study and timed practice paths.

The upcoming Worker configuration disables `workers_dev` and preview URLs, rejects API requests on a host other than `PUBLIC_ORIGIN`, and uses separate rate-limit bindings before D1 queries or room allocation. API traffic allows 1,200 requests/minute/IP; account paths allow 60/minute/IP. These are approximate, local burst limits, not global accounting. Shared school/church connections can encounter these thresholds; review legitimate 429s before changing them. WebSocket messages inside established matches retain the room's own authorization/rate controls.

## Durable pilot limits

| Resource | Limit |
|---|---|
| Verification code | Six digits; ten-minute expiry; five guesses; only newest code works |
| Login ingress | 1,200/day and 600/hour globally; 100/hour/IP, plus existing per-minute login limits |
| Public onboarding ingress | Separate 1,200/day and 600/hour globally; 120/hour/IP |
| Coach invitation mutations | Separate 600/day and 300/hour globally; 120/hour/IP; read/list requests do not debit this allocation |
| Email cooldown | One minute per address, shared across account email purposes |
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

The isolated HTTPS browser pass finished at 15:56:53 UTC with 13 captures at 1440/390/320 pixels, no horizontal overflow or JavaScript errors, signup into a separate club, actual generated invitation-link acceptance, revocation, recovery/session invalidation, cross-club/student denial, keyboard use and reduced motion. Providers were intercepted locally; five synthetic emails never left the process. A first harness run completed the main flows but hit an early-403 transport abort in Playwright's Node request client; the final run verifies that denial through actual browser fetch. Real Turnstile rendering and real delivery are separate pending gates. Visual review identified a mobile shortcut reveal issue after desktop resizing; the fix passed 15 focused tests (including two new resize regressions), type/lint, rebuilt outputs and the final browser pass. Root inspected the final320px capture and confirmed the selected Coaches shortcut remains visible.

The separate 20-room/200-player regional gameplay load gate remains open.

Official references: [Turnstile server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [Worker rate-limit binding semantics](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [WAF rate limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/), [Resend limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits).
