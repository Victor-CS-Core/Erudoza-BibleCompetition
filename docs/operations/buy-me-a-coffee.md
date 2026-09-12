# Optional Buy Me a Coffee support

Erudoza can load the official Buy Me a Coffee widget for voluntary support. Production builds include the owner-supplied public Erudoza recipient through `apps/web/.env.production`. Development and test modes remain unconfigured unless explicitly enabled. An explicit empty `VITE_BUY_ME_A_COFFEE_URL` in the build process disables support. A missing or invalid `VITE_BUY_ME_A_COFFEE_URL` injects neither the provider script nor its visibility guard, and the application omits donation controls.

The app does not collect card details, create checkout sessions, store donation records, or award access or study progress for payments. The provider owns its payment interface and confirmation. Opening or closing its widget is not evidence of a completed donation.

## Account and widget prerequisites

The owner supplied the official generated embed for creator `erudoza`; the configured public profile is [Erudoza on Buy Me a Coffee](https://buymeacoffee.com/erudoza). This establishes the intended recipient and embed settings, but does not establish completed payout onboarding or a successful payment. Do not substitute a demonstration creator or another person's page. Do not add payment credentials to the repository or any `VITE_` variable; these values are public browser configuration.

The supplied account-generated embed uses creator ID `erudoza` and the current integration URL: [Buy Me a Coffee widget script](https://cdnjs.buymeacoffee.com/1.0.0/widget.prod.min.js). Erudoza intentionally replaces the snippet's default orange with the shared teal token and its greeting with an empty message. Verify the live account widget and required payment onboarding before claiming the feature can receive payments. If the provider changes the embed contract, update and verify the adapter before enabling it.

Use the provider's supported payment interface. Do not frame an arbitrary profile page or build a local form that appears to process money. Payment authentication, wallet approval, or card verification may open a provider-managed window or redirect; verify the actual account flow before promising that every payment step stays on the Erudoza page.

## Configure the web build

Both web configurations run with `apps/web` as the Vite root. The root `.env.example` documents available settings, but a root `.env` is not automatically loaded by these workspace builds.

For local development, create an ignored `apps/web/.env.local` and fill in the real verified profile URL:

```dotenv
VITE_BUY_ME_A_COFFEE_URL=https://buymeacoffee.com/erudoza
```

Alternatively, inject `VITE_BUY_ME_A_COFFEE_URL` into the shell or CI environment that runs the Vite process. Process environment values take precedence over environment files. The shared plugin uses Vite's resolved `envDir` and current mode, so mode-specific files follow Vite's ordinary precedence. Do not change `envDir` just for this feature.

Accepted values use HTTPS on exactly `buymeacoffee.com` or `www.buymeacoffee.com` and contain one creator segment. The segment must start with an ASCII letter or digit and contain at most 100 letters, digits, underscores, or hyphens. A trailing slash and explicit default port 443 are accepted; the canonical URL removes them and `www`. Credentials, other hosts or ports, query strings, fragments, encoded paths, and additional path segments disable the feature. Surrounding whitespace is ignored. A syntactically valid URL still requires the account verification above.

Restart the development server after changing this setting. Rebuild the selected deployment artifact to change production configuration:

```powershell
npm run build:web
npm --workspace apps/web run build:native
```

These commands produce the Sites and native Cloudflare artifacts respectively; use the build appropriate to the deployment. This setting is baked into HTML and browser code. Adding it only to a deployed Worker runtime binding will not enable the feature. Clearing it and rebuilding disables the integration. Account setup, deployment, and any real payment are separate operator actions.

## Build and application boundary

The shared `coffeeWidgetPlugin` in both Vite configurations injects one deferred official widget script at the end of the HTML body, after the app module and before `DOMContentLoaded`, with `data-cfasync="false"`. It derives the creator ID from the validated profile and the widget color from the shared `--er-teal` token in `apps/web/src/styles/tokens.css`. No second color palette is maintained. The greeting message is empty to avoid unsolicited prompts.

The application uses a normal module script, followed in document order by the deferred provider script. Vite places the built app module in the head and leaves the provider at the end of the body. The browser executes the app after parsing, before the optional provider and without waiting for `DOMContentLoaded`. The provider still registers its own handler before that event fires. Keep this order: placing a deferred provider before the app blocks startup on its CDN, while using an async app module can encounter WebKit’s first-paint scheduling delay on the initially empty root. `main.tsx` retains a parsing guard for alternate entry hosts. Browser regression tests deliberately withhold the provider through rendering and coach sign-in, with tracing enabled.

An earlier head style hides `#bmc-wbtn`, `#bmc-iframe`, and `#bmc-close-btn` until the root HTML element has `data-erudoza-coffee-ready="true"`. This avoids a visible widget flash before the application decides whether the current role and screen may show it. The runtime adapter owns that attribute and must remove it when the widget is unavailable or ineligible. The guard controls visibility, not network access: when configured, the deferred provider script loads for the SPA even before role eligibility is known.

Script ID: `erudoza-coffee-widget-script`. Guard ID: `erudoza-coffee-visibility-guard`. The runtime and build share `parseCoffeeProfile` and `COFFEE_WIDGET_SCRIPT_URL` from `src/features/support/coffeeConfig.ts`; they must agree on the same profile. The provider script should not be inserted again by React effects or on navigation.

The repository currently defines caching rules in `apps/web/public/_headers` and no Content Security Policy. Check the actual deployed headers and browser console for both deployment targets: hosting configuration may add policies absent from source. If a policy blocks the integration, use the current provider's documented origins and supported embed requirements. Do not broadly disable security headers to make it load.

## Verification and release evidence

Run the focused configuration checks with:

```powershell
npm --workspace apps/web run test -- src/features/support/coffeeConfig.test.ts scripts/coffeeWidgetPlugin.test.ts
```

These exercise URL rejection and canonicalization, Vite mode and environment-directory loading, process-value precedence, absence when disabled, token-derived widget color, script ordering and attributes, visibility guarding, and duplicate prevention. They use isolated fixture directories and do not contact a recipient or submit payments.

Run the dedicated browser suite from the repository root, with workspace dependencies and Playwright Chromium, Firefox and WebKit installed:

```powershell
npm --workspace apps/web run build:native
$env:COFFEE_WIDGET_PREVIEW = "1"
node node_modules/@playwright/test/cli.js test --config apps/web/playwright.coffee.config.ts
```

Leave `COFFEE_WIDGET_SCRIPT_FILE` unset to use the built-in provider DOM-contract fixture. With `COFFEE_WIDGET_PREVIEW=1`, the config serves the previously built native production artifact on port 5195. Without it, the config starts native Vite development with the Erudoza support URL. Both modes intercept application API requests; no backend or production account is required. Tests cover keyboard opening, closing, focus cycling through the test iframe, Escape, repeated opening, browser history, coach/student/account visibility, command-dialog suspension, duplicate prevention, stalled or blocked scripts, and the three viewport sizes. Screenshots and failure traces go under `apps/web/test-results/coffee-widget/contract`.

To exercise a locally saved and inspected copy of the official provider script instead, set an absolute script path. For example, after saving the script at `.tmp/coffee-widget-vendor.js`:

```powershell
$env:COFFEE_WIDGET_SCRIPT_FILE = (Resolve-Path .tmp/coffee-widget-vendor.js).Path
node node_modules/@playwright/test/cli.js test --config apps/web/playwright.coffee.config.ts
Remove-Item Env:COFFEE_WIDGET_SCRIPT_FILE
```

That mode stores evidence under `apps/web/test-results/coffee-widget/vendor`. Both modes use synthetic Adult coach and Student identities, intercept the payment iframe with a clearly labeled test form, and disable payment submission. The official-script override verifies the vendor's outer DOM behavior with the app adapter; it still does not test the live account checkout, provider form accessibility, payment availability, payout setup, wallet/card authentication, or deployed headers. Keep live account verification separate.

Also verify the adapter's tests and both production builds. Browser acceptance must cover the approved public and coach entry points, student and focused-study exclusions, opening/closing/reopening, keyboard focus and Escape, navigation/account changes, script blocking or failure, no unsolicited greeting, and 320px, 390px, and 1440px layouts. Confirm shared coach and student workflows remain intact.

The account-generated snippet and profile are supplied; payout readiness and real payment validation remain unperformed. A local provider stub or a green build does not establish live widget availability, successful card or wallet payment, payment authentication behavior, accessibility inside the provider's cross-origin UI, settlement, refunds, or deployed policy compatibility. Record account-specific browser checks separately, including the tested origin and account, without recording payment credentials. Do not submit a real payment merely to complete UI verification.

### Local account inspection — 2026-09-10

The production native frontend was served at `http://127.0.0.1:5196` with the actual CDN script and `erudoza` account form. Chromium opened, closed, and reopened the popup without changing the Erudoza URL or opening another browser page. The form currently displays **Support Victor**, controlled by the Buy Me a Coffee profile. Desktop (1440px) and mobile (390px and 320px) captures confirmed the frame and close control stay within the viewport without page overflow. The official overlay uses Erudoza's navy backdrop; the launcher is hidden while the popup is open.

A $1 amount was entered only to inspect the next checkout screen. The provider's embedded Stripe payment fields loaded on that screen. No payment details were entered, no Pay action was taken, and no payment was submitted. This verifies local account rendering and checkout entry, not payment completion, wallet authentication, payout readiness, or production hosting policy compatibility. The local preview used a signed-out API fixture; coach/student transitions were separately verified with synthetic accounts.

The focused frontend run passed 56 tests, both frontend builds passed, and frontend typecheck and lint passed. The dedicated browser suite passed all seven checks with both the contract fixture and the locally inspected official widget script; the final official-script run also passed after the overlay styling changes. Its payment frame remains synthetic, separate from the live account inspection above. Production activation still requires the same build-time URL setting and deployment of the resulting artifact.

### Codex in-app preview limitation — 2026-09-10

A subsequent manual-click report was reproduced in the Codex in-app browser at the same localhost origin. The launcher opened the overlay and assigned the correct provider URL, but its frame remained on `about:blank`. The official generated widget on an isolated page, without Erudoza's adapter or styles, failed the same way. Both the `www` URL and its canonical destination remained blank when framed; the provider form loaded when opened directly as a top-level page. The available browser diagnostics did not expose a specific navigation error.

The identical built Erudoza landing page was then tested through a normal click in Microsoft Edge, where the embedded form loaded successfully without leaving the landing page. Use an external browser for local live-widget acceptance in this environment. Standalone Chromium or Edge success does not establish compatibility with Codex's embedded browser. No application workaround, automatic redirect, or security-setting change was introduced for this browser-specific failure.


### Browser compatibility and production configuration — September 12

Anonymous inspection of `https://erudoza.com/` found no provider script or visibility guard in the deployed HTML, and the launcher was absent in Chromium, Firefox and WebKit. The prior production artifact was unconfigured; this is not evidence of a Safari-only rendering defect. Source now preserves the already-approved public recipient in `.env.production` for both production build targets. Rebuild and deploy the paired artifact to activate it; runtime Worker variables alone do not enable the widget.

An eligible public visitor or Adult coach now has a normal “Buy me a coffee” link when the provider script is unavailable. Once the adapter binds, it replaces that link with the existing popup launcher. The popup also contains an always-available “Open support page” link. These links open the validated recipient in a new tab using native anchor navigation, so content blockers or cross-origin iframe restrictions do not remove the support option. There is no automatic redirect and no iframe-load-success guess. Student mode and account pages keep their existing exclusions; application dialogs suppress the fallback.

The browser suite includes Chromium, Firefox and WebKit at 1440/390/320 pixels, blocked script/frame navigation, keyboard focus, installation help, manifest/icon delivery, simulated browser-prompt outcomes and standalone detection. CI runs the suite against the native production build with isolated API/payment fixtures. Browser fonts are blocked in the harness to avoid unrelated network timing; Firefox intentionally uses one additional Tab to enter an iframe’s form.

Actual account form rendering was separately inspected in all three engines against the locally served production build at port 5197. The form showed Support Victor and the new external link; no payment action was taken. An initial manual harness intercepted provider API routes too broadly and caused 401 diagnostics; origin-scoped reruns removed those errors. The final probe rendered all three forms without page errors, with three aborted Google tracking requests in Chromium and none in Firefox/WebKit. WebKit on Linux is Safari-engine coverage, not physical iPhone/iPad or macOS Safari certification. Full payment completion, wallet authentication and payout readiness remain untested. See the [browser/PWA audit](../audits/2026-09-12-browser-support-and-installation.md) for final gates.
