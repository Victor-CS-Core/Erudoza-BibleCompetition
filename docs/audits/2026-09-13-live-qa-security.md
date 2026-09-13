# Live production visual QA and security audit — September 13, 2026

## Scope

Read-only review of `https://erudoza.com` as it was live on September 13, 2026. The review covered public entry points, the authenticated student and coach workspaces available in the browser, live HTTP responses, anonymous API behavior, the shipped asset index, and the native worker's security-sensitive paths. The attack simulation used harmless fake identifiers and an XSS canary; it did not guess real passwords, create accounts, submit invitations, change profile data, or attempt destructive actions.

## Visual QA

Checked the live public routes `/`, `/login`, `/signup`, `/forgot-password`, and `/join-coach`, plus the student routes `/student`, `/student/study`, `/student/library`, `/student/honors`, `/student/progress`, `/student/assignments`, `/student/profile`, and `/student/practice`. Checked coach routes `/admin`, `/admin/seasons`, `/admin/seasons/new`, `/admin/students`, `/admin/coaches`, `/admin/assignments`, `/admin/content`, `/admin/profile`, `/admin/practice`, `/admin/practice/reviews`, and `/admin/design-system`.

- Desktop route checks loaded the expected headings, with no visible runtime-error notices, broken images, or horizontal overflow.
- Public landing and sign-in were visually checked at 320px and 390px widths. The coach dashboard was visually checked at 390px and the desktop routes at the normal browser width. The layouts remained usable and did not overflow.
- The Honors page had four offscreen lazy images with `naturalWidth=0` before scrolling; they were below the viewport and intentionally marked `loading="lazy"`, not failed assets.
- Browser console/dev-log sampling for the authenticated student and coach tabs returned no warnings or errors.

### Visual finding

**VQA-01 — Support widget blocks the coach dashboard in the current live session (Medium usability).** A Buy Me a Coffee donation popup opened over the entire coach dashboard, preventing access to the underlying controls until it was closed/minimized. After minimizing the widget, the dashboard was usable and the support link remained available. This was observed in the current production session; the audit does not establish that it occurs for every new visitor.

## Security checks

### Live HTTP/API probes

- `/api/v1/health` returned `200` with a successful database check; `/api/v1/me`, profile, organization, and library reads returned `401` without a session.
- Cross-origin and missing-origin unsafe requests to login, logout, and an avatar write returned `403 Request origin is not allowed.`
- A correct-origin login attempt using a clearly fake `.invalid` identifier returned generic `401 Invalid credentials`, did not set a cookie, and did not reveal whether the identity existed.
- An evil-origin CORS preflight did not receive an `Access-Control-Allow-Origin` response.
- Query-string XSS canaries were not reflected into the HTML or visible text on the landing, login, or library routes.
- Probes for `.git/HEAD`, `.env`, Wrangler configuration, package metadata, source maps, unknown routes, and directory indexes returned the SPA shell or a generic API response; no source or secret file contents were exposed.
- The shipped production dependency audit reported zero known vulnerabilities in production dependencies. The focused native security regression suites passed 83 tests across seven files.

### Security findings

**SEC-01 — Browser security headers are absent (Medium defense-in-depth).** Sampled `200` HTML, `200` health JSON, and `401` authenticated API responses did not include `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, or `Permissions-Policy`. HTTPS does redirect from HTTP, but HSTS is still useful after the first secure visit. Add an edge/worker response policy, with a CSP designed around the app's required assets, and verify it on both HTML and API responses. Framing protection is especially important for authenticated screens.

**SEC-02 — Third-party support JavaScript runs in the page context without CSP or integrity protection (Medium supply-chain risk).** The live HTML loads `https://cdnjs.buymeacoffee.com/1.0.0/widget.prod.min.js`, including on the sign-in page. The build integration in `apps/web/scripts/coffeeWidgetPlugin.ts:34-51` supplies no `integrity`/nonce, and the production worker does not add a CSP. No compromise was observed, but a compromised or unexpectedly changed vendor script could interact with the app's same-origin page and authenticated requests. Prefer a plain outbound support link on authenticated pages, or isolate the widget; if it must remain, constrain it with a narrowly scoped CSP and use vendor-supported integrity/version pinning.

**SEC-03 — Health endpoint discloses internal runtime detail (Low information disclosure).** The unauthenticated body includes `database: true`, `runtime: "cloudflare"`, and `timing: "server-event-time-v1"` from `apps/web/worker/native/index.ts:38`. This is not an access-control bypass, but `{status:"ok"}` or an internal-only diagnostic would expose less operational detail.

## Source-level controls reviewed

- `apps/web/worker/native/auth.ts:23-35` requires a hashed, unexpired session bound to the current credential version and active user; `:37-40` requires the configured public origin for unsafe requests; `:60-70` uses a secure, HttpOnly, SameSite session cookie.
- `apps/web/worker/native/perimeter.ts:17-36` enforces the public host, URL length limits, required rate-limit bindings, and Cloudflare ingress-IP rate limits before database work.
- `apps/web/worker/native/index.ts:41-58` authenticates before protected routes and enforces organization identity matching; `:60-63` masks unexpected errors.
- `apps/web/worker/native/types.ts:19-26` bounds JSON request bodies and rejects invalid JSON.

These controls explain the observed 401/403 boundaries, but they do not replace a full penetration test.

## Limits and next actions

No successful break-in was found in this bounded audit. It was not a certification or a full OWASP ZAP/DAST run. The available authenticated browser session represented one account, so a separate low-privilege student session was not available for a complete cross-role IDOR matrix. No brute-force campaign, token theft, password reset, account/invitation flow, write mutation, or physical-device Safari check was attempted.

Recommended order: ship response headers and framing/CSP policy; remove or isolate the vendor widget from authenticated pages; reduce health-response detail; then repeat the audit with separate coach, student, and unrelated-organization accounts and verify the live policies at the edge.
