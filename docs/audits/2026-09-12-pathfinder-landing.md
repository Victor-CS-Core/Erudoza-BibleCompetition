# Pathfinder landing implementation

September 12, 2026. Local implementation on codex/landing-pathfinder-mockups, isolated from main and production.

## Approved direction and scope

The user chose [A — The Expedition](../product/mockups/2026-09-12-pathfinder-landing/a-expedition.png), then requested [B’s middle section](../product/mockups/2026-09-12-pathfinder-landing/selected-middle-section.png). The implementation combines A’s navy illustrated hero and coach panel with numbered training steps, a divider and three sample patches.

The existing brand emblem, text wordmark, shared PatchArtwork motion and login/signup routes remain in use. PageHeader accepts an optional div wrapper and title ID with its previous defaults intact; buttons add an opt-in large size. InstallApp accepts optional presentation props without changing its state logic. Support components remain present. No worker, schema, gameplay, permission or authentication behavior changed.

Copy received an embedded draft/audit/final pass using [Humanizer 3.0.0](https://github.com/blader/humanizer/blob/main/SKILL.md), retrieved read-only from the author's repository into ignored local storage. The skill was not globally installed. The approved hero headline stays; supporting text names the actual passage, review, rehearsal and coach actions. Sample patches are labeled, with no invented participation metrics, award criteria or testimonials.

The [artwork package](../brand/2026-09-12-landing-expedition/README.md) preserves four generated PNG originals, exact prompts, metadata, hashes and nine optimized WebP derivatives. The third patch reuses the existing feather artwork. Generated art reconstructs the approved composition; the typeset UI and responsive layout are real components.

## Verification

- Landing regression: the revised content/sample expectations failed before implementation, then all six tests passed. Entry routing, exact existing emblem and non-interactive sample Honors are covered.
- Full web/native source suite: 628 tests passed, one existing optional skip, across 81 passing files. This host's Node 26 native webstorage initially shadowed the jsdom storage fixture; rerunning with NODE_OPTIONS=--no-experimental-webstorage resolved the environment conflict. No application storage logic was changed.
- Final canonical web and native production builds, web/native TypeScript, full ESLint and whitespace checks passed. The existing bundle-size advisory remains.
- Chrome local browser review covered desktop and phone widths 1440, 1100, 762, 760, 390 and 320. Final 320px heading uses two lines at 26px. No horizontal overflow or broken images was observed, and visible controls retained targets of at least 44px. Desktop and full phone captures were visually inspected.
- Keyboard entry focused Skip to content; Enter moved focus to public-main. Heading order, labeled regions and sample figure were inspected.
- Shared-style smoke covered Coach overview and Student Mode at 1440, 390 and 320 with a local fixture owner account. Both loaded without overflow or broken images and retained their existing heading sizes. This verifies those local surfaces, not every populated workspace or a separate student authentication session.
- Independent source review found a low-contrast desktop Install app label against the sky. The label was changed from teal to navy; final computed styling and responsive placement were checked. The reviewer closed the finding after source-pixel calculations across the entire control rectangle, including cover cropping and the gradient: minimum 5.59:1 at 1440px, 6.74:1 at 1100px and 4.55:1 at 762px. No remaining concrete blocker was found.
- Local browser console inspection found no warnings or errors during the reviewed page state.
- Four masters are byte-identical to the generated originals; the supplied middle-section reference is also unchanged. Nine derivatives match the metadata recipe, total 694,830 bytes, and all patch alpha ranges span 0–255. The manifest records SHA-256 hashes.

Browser work used a local native fixture and development server. The support provider was not configured in this preview; support logic retains its passing source-suite coverage, but this task does not establish a new live-provider browser gate. Chrome displayed its native installation prompt; installation acceptance and physical-device behavior were not exercised. The existing install source tests passed. The updated landing-phone E2E specification was not run through its CLI; equivalent responsive checks above were performed through the browser tool.

## Delivery boundary

The preview is http://localhost:5208/ while the task-owned development service is running. Local verification does not establish a main merge, remote CI result or live deployment. The task branch checkpoint is recorded in PROGRESS.md.
