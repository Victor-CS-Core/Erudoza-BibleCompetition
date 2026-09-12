# Install Erudoza on a phone

Erudoza includes a web app manifest and home-screen icons. Open **Install app** on the public landing page or at the bottom of the signed-in coach/student workspace. A supported browser can show its native prompt; otherwise the same control opens installation instructions.

- iPhone/iPad: open Erudoza in Safari, use Share (possibly inside More), choose Add to Home Screen, enable Open as Web App if shown, and tap Add.
- Android: use Install app, or the browser menu’s Install app / Add to Home screen option.
- Desktop: Chrome/Edge offer installation in their address bar or menu. Safari on supported macOS versions offers File → Add to Dock. Browsers without installation can bookmark the site.

The icon launches `/` in a standalone window on supporting devices. Existing routing handles authentication. An internet connection is required. This release adds no service worker, offline data cache, push notifications, app-store package, or new authentication storage. A device may require signing in again when first launched from the home screen.

`apps/web/public/manifest.webmanifest` contains the stable app identity, root scope/start URL, display mode and icon declarations. Both builds copy those public files. The Apple touch icon is 180×180; manifest icons are 192×192 and 512×512. `apps/web/scripts/prepare-app-icons.mjs` reproducibly packages the approved emblem using the shared paper token, with padding for OS masks. Regenerate from the repository root with `node apps/web/scripts/prepare-app-icons.mjs` after intentionally updating that artwork or token.

Install prompts are retained across SPA navigation, invoked only by a user click, and consumed once even after cancellation/error. Installed/standalone windows hide the redundant control. Browser prompt UI and actual home-screen launch still require device acceptance; simulated browser events prove our UI handling, not OS installation.

References: [Apple’s iPhone installation instructions](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios), [MDN installability requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [MDN user-triggered installation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Trigger_install_prompt).
