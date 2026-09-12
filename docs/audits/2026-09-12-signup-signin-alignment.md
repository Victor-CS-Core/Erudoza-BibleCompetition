# Signup and sign-in alignment

The user requested that signup match the existing sign-in design. The change is isolated on codex/signup-signin-alignment, based on main faf35d5.

Signup uses the existing landscape modifier and Camp essentials corner artwork. Its form now inherits sign-in's 390px maximum width and 32px heading gap, with matching back-link arrow, full-width primary actions and footer. The separate coach illustration is retained for recovery and invitation. Signup keeps its own coach copy, fields, verification, resend and authentication logic.

The only narrow-phone exception is the security widget. Form fields keep the same 20px inset as sign-in, while the widget can extend to 300px. Browser inspection reproduced an undersized widget container once the long verification form introduced a scrollbar. Final 320px viewport measurements show equal 305px client/scroll widths, a 300px widget, and a 44px primary action. The code helper text also retains clear spacing before the name field.

Validation:

- All 46 existing login, onboarding and artwork tests passed before and after implementation. The existing signup artwork expectation was updated; account-flow tests are unchanged.
- Native production build, web/native TypeScript, full ESLint and Git whitespace passed. The existing bundle-size advisory remains. The complete application suite and canonical build were not rerun for this presentation-only follow-up.
- Signup email and verification forms were inspected in Chrome at 1440, 390 and 320px. Desktop form width is 390px and heading margin is 32px, matching sign-in. Both routes share the same landscape, corner and footer. The password visibility control still toggles without submission.
- Browser code-step inspection used an ignored local development fixture: mock options/code receipt and a clearly labeled 300px security placeholder. No real CAPTCHA, email delivery, account creation or password change was exercised. The normal native fixture reports coach-service unavailability, which remains honest in its preview.
- Existing route-assignment tests verify that recovery, invitation and coach/student artwork remain unchanged. No workspace control or global typography token was modified.

The layout preview is http://localhost:5209/signup while its transient user service is running. Local verification and a task-branch push do not establish a main merge, remote CI result or deployment.
