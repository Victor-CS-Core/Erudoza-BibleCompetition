# Browser support and phone installation audit — September 12

Scope: Buy Me a Coffee availability across current browser engines, and a home-screen app that launches the online Erudoza site. Worktree `.worktrees/coffee-pwa`, branch `codex/coffee-pwa`, base `2a5407e`. Production and other worktrees were not modified.

## Findings and implementation

- Anonymous live HTML at `https://erudoza.com/` contained neither the configured provider script nor its visibility guard. The launcher was absent in Chromium, Firefox and WebKit. The production recipient was missing at build time; no Safari-specific account/payment rejection was established. `.env.production` now supplies the owner-approved public recipient, with an explicit empty process value retaining the disable switch.
- Public/Adult coach support now falls back to an ordinary external anchor when the provider script is unavailable. The existing popup adds an external “Open support page” link for blocked/blank frames. The shared external-link primitive preserves design-system states; route/account exclusions and dialog suppression remain intact.
- The actual provider script exposed synchronous focus-restoration failures in Firefox and WebKit after hiding its popup and replacing the launcher contents. Deferring focus by one animation frame, guarded against navigation/disposal/reopening, passed the previously failing browser cases. A separate unit regression verifies that navigation cancels deferred focus.
- The PWA manifest defines a stable root identity/scope/start URL and standalone display. The 180/192/512px icons package the approved emblem with safe-area padding. Public entry and both signed-in workspaces expose Install app. Browser prompt events survive SPA navigation, are user-initiated and single-use, support prompt-return and userChoice APIs, and hide controls after installation/standalone launch. Manual guidance uses the shared dialog in a portal to avoid inheriting footer alignment.
- No service worker, offline cache, account/session storage change, backend endpoint, data migration, payment form or payment-processing code was added.

## Verified gates

- Final source suite: 600 tests passed, one existing optional workload skip, across 80 passing test files. Web/native TypeScript, full ESLint and both production builds passed. Existing >500kB bundle advisory remains.
- Production artifacts both include exactly one provider script configured for erudoza, the manifest and all three icon files. Chromium DevTools returned no manifest errors and no installability errors for the locally served native production build.
- Earlier controlled browser run: all 51 cases passed across Chromium, Firefox and WebKit at 1440/390/320px. Additional final-source installation/legacy-userChoice/iPhone-emulation run: 17 passed. Final complete suites passed 59 official-provider-script cases and 59 contract-fixture cases (118 total), using a synthetic payment frame, across Chromium, Firefox, WebKit and iPhone 13 emulation. Four additional traced WebKit stalled-provider repetitions and all three development-engine startup checks passed. Final 320px coach/student installation captures and the generated icon were visually inspected.
- Actual provider form was loaded against the local production build on port 5197 in Chromium, Firefox and WebKit. Each showed Support Victor and the intended account. An earlier bounded probe recorded no page errors or failed requests. The final post-ordering probe again rendered all three forms without page errors; Firefox/WebKit had no failed requests, while Chromium recorded three aborted Google tracking requests with the form visible. The local API intercept was restricted to localhost. No Support/pay action, payment details, login or real account mutation was performed. Earlier overly broad API interception produced provider 401s; correcting the harness removed them.
- Independent source review found no actionable application-code issue and requested the production-default documentation correction, which is applied. Review is not a payment or device-installation certification.

## Startup resolution and verification limits

The deliberately stalled-provider test exposed intermittent WebKit startup delays with the original async application module and an empty initial root. Tracing, response interception and loading placeholders affected reproduction timing, so none was accepted as a fix. The application now uses a normal module followed by the deferred provider in document order; both final artifacts verify that order and absence of async on the app module. This removes dependence on WebKit’s async/first-paint scheduling. The unchanged stalled-provider assertion passed with tracing enabled as part of the final official-script 59-case suite. No trace suppression, timeout relaxation, global event patch or vendor-script modification was used.

The execution-order rationale follows the [HTML parser’s ordered script processing](https://html.spec.whatwg.org/multipage/parsing.html); [WebKit’s async scheduling history](https://bugs.webkit.org/show_bug.cgi?id=208896) informed the investigation but does not independently prove the internal cause on every Safari release.

WebKit on Linux and iPhone emulation do not replace physical iPhone/iPad or macOS Safari testing. Browser-install events are simulated; actual OS home-screen installation/launch remains device acceptance. Real donation completion, wallets/authentication and payout readiness are untested. The .NET backend/full gameplay suites were not rerun for this frontend-only change. CI wiring is added but no remote CI pass is claimed before a run exists. No production deployment or default-branch merge has occurred.

Ignored evidence: `.local/coffee-pwa/` and `apps/web/test-results/coffee-widget/{contract,vendor}/`. These contain local provider copies, synthetic fixtures, browser traces and captures and are excluded from source checkpoints.


Final production bundle identities: native JS SHA-256 `72ef5522dd788a8cf92af6b4a5c52c52cb85afbcb4c2e3f1905a03874b87bed5`; Sites JS `e561fa67cf7b2bb55469d0bdb2c0f4b5cb1fd5f4976ba63df3fdefc7582f5e87`; shared CSS `df97d7aefd0917c0ca1c989ffbf63f277487af09406729a7d7d92dac1ecc903e`. The script-order correction changes HTML, not those bundles.
