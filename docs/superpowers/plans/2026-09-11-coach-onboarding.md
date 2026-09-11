# Coach signup, invitations and abuse protection

The user approved email-code verification followed by password login and explicitly requested coach invitations and protection against bots/malicious use. Implement on the production Cloudflare Worker and existing React app. Preserve student provisioning, organization isolation, shared Scripture and existing sessions. No paid upgrades or authentication-platform migration.

## Decisions and boundaries

- A verified signup creates a new organization and Adult Owner. Invitations create an Adult Admin in the inviting organization. Existing Adult Owner/Admin accounts can manage invitations; neither public inputs nor invitation bodies choose roles or organization IDs.
- A user belongs to one organization. Do not move an existing account across organizations, change an existing account's password via invitation acceptance, or use an invitation to reactivate an account.
- Registration and adult recovery use six-digit email codes, ten-minute expiry, at most five guesses, one send per email per minute, and invalidation of previous pending codes. Invitations expire after seven days; resending rotates their secret and invalidates old acceptance challenges. Revocation is immediate. Acceptance requires a fresh email code as well as the invitation secret.
- All code-request endpoints require server-verified Turnstile, including expected hostname and action. Missing production email/challenge configuration fails closed. Do not deploy a bypass header, magic code, test key or public email-preview endpoint.
- Apply per-IP, per-email, per-actor, per-organization and global limits before expensive password work or email sends. Global delivery budget is at most 80 attempts/day and 2,400/month, below the researched Resend Free caps. Authentication/recovery must return generic identity responses; do not reveal membership in other organizations.
- Limit new organizations to ten/day for the initial free-tier rollout, invitations to ten pending per organization, six sends/day per inviting actor and twenty/day per organization. Budgets must be atomic under concurrency and expiry indexes must permit bounded cleanup. Do not trust client IP headers outside the trusted Cloudflare ingress contract. No in-memory-only security counters.
- Codes are stored as purpose-bound keyed digests with a Worker secret. Invitation secrets have at least 256 random bits and are stored only as hashes. No codes, passwords, email bodies or invitation secrets in application logs or public responses. Links use a URL fragment; the UI removes it from browser history after reading it.
- Consume a challenge, provision its account/organization or change credentials, and issue/revoke session evidence transactionally. Concurrent redemptions create at most one account; retries cannot recreate organizations or revive revoked invitations. Recheck invitation validity, inviter authorization and user eligibility at acceptance.
- Native Cloudflare is the current production backend. The retained .NET backend continues its existing login/student workflows; new UI handles absent onboarding availability gracefully. New onboarding endpoints are not silently advertised as supported by .NET.

### Security review additions

- Disable the production workers.dev route and reject alternate request origins before database/room access. Use Cloudflare rate-limit bindings as a cheap burst filter (1,200 API and 60 account requests/minute/IP), with separate durable counters for exact account/email limits. Shared club connections and timed gameplay must be considered when validating these pilot thresholds.
- Bound existing login counters and their cleanup; limit random identity attacks before creating persistent per-identity rows. Protect existing administrator mutations and password hashing as well as public signup. Pilot ceilings are 100 stored students and 12 stored seasons per organization, 20 active adult coaches, and daily attempt budgets for administrative writes. Record final tested values in the operations runbook.
- New adult passwords contain 12–128 characters. Existing student and login compatibility remain intact.
- Rate limits reduce abuse; they cannot guarantee uninterrupted availability against distributed attacks or preserve the entire shared free-tier quota. No production abuse/load test is authorized by these defensive changes.

## HTTP contract

All paths below are under `/api/v1`; JSON errors use existing Problem Details and same-origin enforcement. No response includes a secret except the existing secure HttpOnly session cookie. Successful verification/signup/invitation completion returns the existing `Me` shape. Password reset returns 204 and requires a fresh login.

```ts
type CoachOptions = { available: boolean; turnstileSiteKey: string | null };
type CodeReceipt = { challengeId: string; expiresAt: string; resendAfterSeconds: number };
type InvitationDetails = { organizationName: string; emailHint: string; expiresAt: string };
type Coach = { userId: string; displayName: string; email: string | null; role: "Owner" | "Admin" };
type CoachInvitation = { id: string; email: string; createdAt: string; expiresAt: string;
  status: "pending" | "accepted" | "revoked" | "expired" };
// GET /auth/coach-options -> CoachOptions
// POST /auth/signup/code { email, turnstileToken } -> 202 CodeReceipt
// POST /auth/signup/complete { challengeId, code, displayName, organizationName, password } -> Me
// POST /auth/password/code { email, turnstileToken } -> 202 CodeReceipt
// POST /auth/password/complete { challengeId, code, password } -> 204
// POST /auth/invitation/details { token } -> InvitationDetails
// POST /auth/invitation/code { token, email, turnstileToken } -> 202 CodeReceipt
// POST /auth/invitation/complete { challengeId, code, displayName, password } -> Me
// GET /organizations/:org/coaches -> Coach[]
// GET /organizations/:org/coach-invitations -> CoachInvitation[] (bounded recent list)
// POST /organizations/:org/coach-invitations { email } -> 201 CoachInvitation
// POST /organizations/:org/coach-invitations/:id/resend -> CoachInvitation
// DELETE /organizations/:org/coach-invitations/:id -> 204
```

Turnstile action values: `coach_signup`, `coach_recovery`, `coach_invitation`. Shared bindings: `RESEND_API_KEY`, `AUTH_CODE_SECRET`, `TURNSTILE_SECRET_KEY` (secrets), `TURNSTILE_SITE_KEY`, `AUTH_EMAIL_FROM`. The app uses the configured `PUBLIC_ORIGIN` in all emails, never a request-provided redirect or Host header. The email sender uses Resend's HTTPS API with a bounded timeout and idempotency key, escaped HTML/plain text and no tracking.

## Task 1 — Native onboarding and atomic evidence

Owned files: `apps/web/worker/native/onboarding/*`, native `auth.ts`, `index.ts`, `types.ts`, new `apps/web/migrations/0003_coach_onboarding.sql`, and focused native tests/test fixture hooks. Separate email/Turnstile integrations, rate limits and transactional account handling rather than growing the existing routing file.

Write failing native tests first. Exercise the HTTP contract with injectable delivery/Turnstile adapters only in test builds. Cover signup, invitation issue/list/resend/revoke/accept, recovery/session revocation, generic unknown identities, malformed bodies, expired/wrong/replayed codes, code/send/IP limits, student/other-organization denial, duplicate email races, simultaneous redemptions, cancellation races, unavailable/rejected providers and missing configuration. Inspect D1 evidence to prove no partial organization/user/session writes. Preserve all existing auth tests.

Validation: `npm run test:native --workspace apps/web`, `npm run typecheck:native --workspace apps/web`. Root reviews implementation/security and stages only intended files at a verified gate.

## Task 2 — Signup and coach management UI

Owned files: `apps/web/src/features/auth/*`, new coach management page in `features/admin`, new `src/api/onboarding.ts`, route/navigation integration, `AuthContext.tsx`, landing/login links, and UI tests. Read `DESIGN.md`; use shared primitives, navy/ivory/teal tokens, existing layout and accessible confirmation dialog. No palette/animation redesign.

Add `/signup`, `/forgot-password`, `/join-coach`, and `/admin/coaches`. Make coach signup discoverable on landing/login; keep student guidance. Code fields accept paste/autofill and numeric keyboard; label expiry/cooldown, focus invalid fields, disable repeated submissions, reset Turnstile after each use, and handle token expiry/unavailable service. A received invitation secret is kept only for the acceptance flow and never interpolated into network URLs or analytics. Existing authenticated accounts must sign out before claiming a different account; clear all private frontend caches when accepting a new session.

Show coaches and invitation status, send/resend, and a confirmation before revocation. No email/club/role access based solely on UI visibility. Tests cover successful and failing flows, resend state, expired/revoked invite, provider-unavailable state, cache clearing, student navigation isolation and a harmless fallback on retained .NET's missing availability endpoint.

Validation: web lint/type checks/tests and both builds. Targeted local Playwright signup/new-club, invitation/new-coach, password recovery, rejected student/cross-club requests; coach/student layouts at 1440/390/320, keyboard and reduced motion.

## Task 3 — Provider setup, review and rollout

Root owns provider/dashboard operations, integration harness, operations documentation and `PROGRESS.md`. Prepare production configuration and securely provision generated secrets. User input is needed for Resend account access; do not request secrets in chat. Verify the sending subdomain through scoped DNS additions without replacing website or unrelated mail records. Keep Free plans and explicit email/account budgets.

Review the complete change for organization isolation, account takeover, replay/concurrency, brute-force and email-budget exhaustion. Verify migrations locally before any remote migration. The live onboarding UI remains unavailable until Resend and Turnstile are configured and an authorized real delivery test succeeds. Do not send invitations to real third parties without the user's explicit instruction.

At each verified gate update the shared progress log, commit and push `codex/cloudflare-free-port`. Preserve fresh production admin/library and existing application data. Record deployed version and bounded acceptance evidence separately from local tests; keep the unrelated 200-player regional load gate open.

## References checked September 11

- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- https://resend.com/docs/api-reference/emails/send-email
- https://resend.com/pricing
- https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
