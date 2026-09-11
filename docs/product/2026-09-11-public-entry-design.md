# Public landing and account entry design

Date: 2026-09-11. Status: added to the design scope at the user's request. The embroidered logo and patch family are approved; these page compositions still need a concrete preview before implementation.

This is the public entry companion to the [daily training plan](../superpowers/plans/2026-09-11-daily-training-progression.md) and [design specification](../superpowers/specs/2026-09-11-daily-training-progression-design.md). Read [DESIGN.md](../../DESIGN.md) and [PROGRESS.md](../../PROGRESS.md) at execution. Apply one recognizable Erudoza identity from the first visit through account entry, student training and the [Coach workspace](2026-09-11-coach-workspace-recommendations.md).

## Page composition and artwork

| Surface | Visitor task and composition | Artwork treatment |
|---|---|---|
| `/` landing | Explain Scripture competition training, show how assigned practice/review/team preparation work, and offer clear student sign-in and coach account entry. Keep the brand and sign-in visible in the header; pair the first message and actions with the landscape. Follow with actual product workflow examples and a coach section. | Approved embroidered wordmark mark and revised no-sun landscape. A small Honors preview may show sample patches labeled as examples after Honors is available. Keep text on solid readable surfaces. |
| `/login` sign-in | A compact welcome and one form headed **Sign in**, followed by coach account/recovery links and explicit student help. Desktop can retain the brand/art side panel; mobile places a small brand header directly above the form. | Use the approved logo as the primary brand moment and a restrained landscape in the separate desktop panel. No honor collection or celebratory motion around credentials. |
| `/signup` coach signup | Lead with **Create your club** and explain that this creates a coach account and a new club. Show the actual email/security-check step, then code, name, club name and password. Progress copy may describe those two existing stages; it must not introduce another account-creation flow. | Same account-entry composition and logo as sign-in. The approved Coach field-guide illustration can support the separate desktop panel. On small screens, prioritize the active form and its security check. |
| `/forgot-password` and `/join-coach` | Carry the same layout through coach recovery and invitation acceptance. Preserve mode-specific titles, student guidance, invited club/email hint and actionable invalid/expired-link states. | Reuse the account-entry family; no additional artwork generation is required to make these routes consistent. |

Use the navy, ivory and teal semantic palette, shared controls, system sans for interface copy and Georgia only for Scripture/branding. Patch texture belongs in the original artwork; it does not become an input border, button treatment or background underneath labels. Keep simple interface icons. Honor tilt remains a decorative effect on honor artwork, never the logo, forms or primary actions.

The landing page can demonstrate the Honors System only when those capabilities are implemented and released. Before then, retain current truthful product copy or clearly mark a review-only preview as a concept. Do not publish fabricated student results, participant counts, testimonials, guaranteed mastery, or claims of official SDA endorsement. Student sign-in remains `/login`; coach creation remains `/signup`, and existing coach sign-in remains available. Signup availability comes from the current account service, never from static promotional copy.

## Current source and behavior to preserve

| Source | Responsibility and constraints |
|---|---|
| `apps/web/src/features/marketing/LandingPage.tsx` | Public header, sign-in/study/coach actions, workflow explanation, create-club link, support widget and footer. Keep destinations, support access and skip navigation usable. Any proposed CTA relabeling appears in the page preview before implementation. |
| `apps/web/src/features/auth/LoginPage.tsx` | Email-or-username login, current-password autocomplete, Show/Hide, Caps Lock notice, pending lock and linked error messages. A Student goes to `/student`; other authenticated users go to `/admin`. No new role selector or student self-signup. |
| `apps/web/src/features/auth/CoachOnboardingPage.tsx` | Signup, recovery and invitation modes share availability, verification and completion behavior. Preserve existing fields, 6-digit code, password rules, resend cooldown/expiry, Change email, pending lock, signed-in-account notice and return/sign-out actions. |
| `apps/web/src/features/auth/TurnstileChallenge.tsx`, `useCoachOptions.ts`, and `apps/web/src/api/onboarding.ts` | Retain the security check, action identity, token expiry/reset, rate-limit retry and availability fallback. Unsupported/unconfigured backends must show the existing unavailable/retry state. A visual refresh does not activate email delivery or add .NET onboarding endpoints. |
| `apps/web/src/components/brand/ErudozaWordmark.tsx` | Shared brand mark used across public and authenticated screens. Preserve `compact` and `inverted` behavior and accessible link names. Its current image dimensions are 36/48px, with 40/56px account-page CSS overrides; inspect all actual sizes when swapping the asset. |
| `apps/web/src/styles/training-public.css`, `training-login.css`, and `coach-onboarding.css` | Page composition only. Preserve the narrow-screen security-widget accommodation, control foreground contrast, error wrapping and natural form scrolling. |
| `apps/web/src/app/router.tsx` and `apps/web/src/auth/AuthContext.tsx` | Preserve route identities, mode remounting, authentication/session acceptance, role routing and cache isolation. Keep invitation tokens in mounted flow memory, remove the URL fragment, and do not put tokens or form secrets in screenshots or saved fixtures. |

At the September 11 planning checkpoint, public email onboarding is unavailable pending sender configuration and authorized delivery validation. This is a current operations state to recheck, not a permanent design assumption. Include both available and unavailable states in the preview and verification. Existing signup success creates a club and Owner account, accepts the returned session and opens `/admin`; recovery success directs the user to sign in; invitation success creates an Admin in the invited club. Decorative progress indicators must reflect these real states. Preserve the existing session acceptance and private-cache cleanup; do not duplicate authentication logic in a visual wrapper.

## Asset placement and responsive requirements

- Use optimized derivatives of the [approved original assets](../brand/2026-09-11-original-assets/README.md), with a shared brand source and explicit dimensions. Inspect the logo at 24/32/36/40/48/56px on navy and ivory; use the existing simplified mark at small sizes if embroidery loses clarity until an appropriate derivative is approved.
- Reuse the refined landscape for the landing hero and the Coach illustration for the account side panel only where its crop remains legible. Do not stretch square patches into wide banners. Retain source masters and record every derivative's source and intended use.
- At 320px, use a single column with a compact brand header, readable form labels, visible primary action through normal scrolling, and no sideways page movement. Do not force the entire long signup form into one viewport. Account for keyboard-open and zoomed layouts without fixed overlays covering fields.
- Turnstile's existing flexible widget needs 300px: preserve the current narrow-screen padding accommodation below 380px. Test actual rendering with the existing isolated local setup instead of assuming the form grid will fit it.
- At 390px and 1440px, verify clear student/coach entry, logo transparency, correct image crops, readable error/notice text and controls at least 44px for coarse pointers. Preserve password-manager autocomplete, paste, visible keyboard focus, focus after code/error transitions and reduced motion.
- Load only the public assets needed for the current route. Do not fetch authenticated training data or bundle all Honors masters on the landing page. Set measured image budgets during asset optimization and compare source bytes, transferred bytes and visual quality before shipping.

## Preview and acceptance

Before implementation, present landing, sign-in and signup together at desktop and phone sizes using the approved assets. Include signup email and code/account stages, an unavailable-service state, and one clear error state. Include recovery/invitation examples to establish continuity. Record page-composition approval separately from the already approved logo and patch art; do not ask to reapprove those assets.

The implementation checkpoints live in the main plan's **Public entry companion phase**. Review public, account, student and Coach screens together after a shared logo/style change. Preserve existing behavioral coverage and add only missing meaningful route, state or responsive assertions. This document was checked against source; it does not claim a newly rendered public mockup, fresh browser pass, account activation or deployment.
