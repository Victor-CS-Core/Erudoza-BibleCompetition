# Public entry and shared Honors browser audit

Date: 2026-09-11. Final isolated native run passed at **17:20:00 UTC**.

## Build and isolation

The browser served the worktree's built native frontend (`index-DBSsoaSR.js`, `index-DmazB_ul.css`) through an isolated Miniflare HTTPS runtime on port 8895. It applied the native migration list to in-memory D1 and used synthetic local accounts. Turnstile Siteverify and Resend were intercepted inside that local runtime; seven synthetic email payloads stayed in memory. All other provider destinations were rejected. No production request, account, invitation, email, deployment or data change belongs to this pass.

The browser replaced the external Turnstile script with a keyboard-operable fixed **300px by 65px** test control. This proves the narrow layout can accommodate the minimum widget width. It does not validate Cloudflare's real iframe, challenge, third-party accessibility or delivery. The separately recorded live email activation is outside this visual audit; this run does not repeat or certify that delivery.

Build SHA-256 values:

- JavaScript: `577768f5deeb02d22898b4eb92517d5d226c6eef69703dc71b8a04029b3a5ded`.
- CSS: `fca8241c336e7121c97a0a36bdaebba6d15783aa5f63f4e145a7b97768f60488`.

## Executed browser checks

The final run captured **55 views** with zero page JavaScript errors and no horizontal page overflow. Eighteen states were captured at 1440, 390 and 320 CSS pixels; keyboard/reduced motion was additionally captured at 320px:

- Landing and login.
- Signup email, code, wrong-code error, expired code, loading, unavailable/retry and signed-in notice.
- Invitation email, code, missing-link error and revoked-link error.
- Recovery email, code and success.
- Coach directory and student home, validating the shared brand in both workspaces.

The native flows verified a real locally generated six-digit code creates a separate club and Owner session; the actual emitted invitation URL removes its fragment and joins only its intended club as Admin; revocation invalidates that emitted link; password recovery invalidates the original session and permits login with the new password. Cross-club coach reads and student invitation mutations were rejected with 403. Students did not receive the Coaches navigation action.

Wrong-code submission exposes its linked error and restores code-field focus. Entering the code stage focuses that field. Resend is disabled during cooldown; advancing the browser clock beyond expiry disables completion and shows expiry guidance. Completing the local challenge and resending returns to an active code state. Change email returns to the email form. Keyboard Tab and Enter operate the local challenge under reduced motion. Held and unavailable capability responses verify loading transitions and retry without activating providers.

The 320px code form and 390px invitation capture were visually inspected: fields, notices, actions and normal scrolling remain readable; the fixed-width local security control fits. Desktop signup was inspected for separate artwork/form placement. These inspections are representative, not a claim of manual review of every pixel in all 55 captures.

## Shared Honors motion

The actual production `HonorArtwork` component on `/admin/design-system` was exercised with opposing pointer locations. Its inline rotations settled at `rotateX(4.892deg) rotateY(-4.892deg)` and `rotateX(-4.890deg) rotateY(4.890deg)`, within the seven-degree bound. The enclosing element's bounds did not change. Switching to reduced motion cleared the transform. A separate mobile context confirmed a coarse pointer and no transform for a touch pointer event.

## Retained evidence and limits

Ignored local artifacts in this worktree:

- `.local/public-entry-audit.mjs`: adapted isolated onboarding harness.
- `.local/public-entry-browser-verified/report.json`: final checks, sizes, motion values and completion time.
- `.local/public-entry-browser-verified/*.png`: final captures.
- `.local/public-entry-verified-run.log`: runtime output.

The initial run measured 348px immediately after a desktop-to-320px resize. Waiting two animation frames before measuring resolved that timing race without changing application source; the subsequent 49-view run passed. A later expanded run reached all behavioral and motion assertions but failed because the harness encoded an ellipsis incorrectly in its loading selector. Replacing that selector with an ASCII regular expression produced the final 55-view pass. Earlier reports remain under `.local/public-entry-browser/`, `.local/public-entry-browser-final/` and `.local/public-entry-browser-complete/`.

The local runtime logs include TLS unknown-certificate handshake diagnostics from the self-signed HTTPS setup; browser contexts explicitly accepted that local certificate, executed the checks and reported no page JavaScript errors. This is not production TLS evidence.

This agent did not run canonical .NET browser tests, full application suites, real password-manager autofill, OS clipboard paste, physical keyboard-open/zoom checks or an exhaustive 44px coarse-control measurement. Coordinating-agent evidence should record those separately if executed. No source change, commit, staging, push or deployment was performed by this browser audit.
