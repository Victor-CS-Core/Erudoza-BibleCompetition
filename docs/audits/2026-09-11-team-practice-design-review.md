# Team Practice design review — September 11, 2026

The user requested a substantial PVP visual redesign with patch artwork, following a separate request to restore Erudoza as text. This gate prepares an interactive review, preserving the user's earlier request to see new artwork before application. PVP application code, data contracts and gameplay remain unchanged.

## Deliverables and source grounding

- [Interactive mockup](../product/mockups/2026-09-11-team-practice.html): hub, lobby, live match and results, with Coach/student review controls and original team art. Sample data and simulated interactions are explicitly identified outside the application canvas. Proposed mobile bottom navigation is confined to this review.
- [Design and implementation brief](../product/2026-09-11-team-practice-redesign.md): existing roles, phases, authoritative timing, private discussion, readiness, scoring, appeals/finality, current routes and implementation checks. A read-only source audit traced `PracticePage`, DTOs and the native room/award implementation; the brief avoids invented matchmaking, ranks or XP.
- [Three original core patches](../brand/2026-09-11-pvp-patches/README.md): Team 1's teal mountain shield, Team 2's coral Bible shield and the paired Team Practice emblem. Built-in image generation used one request per asset. Exact prompts, byte-identical masters, derivative recipe and hashes are preserved. Five dedicated Team Honor replacements remain later work, with current keys/criteria documented.

## Asset verification

Each original is 1254 × 1254 RGBA with actual alpha, not a painted transparency grid. Fully transparent pixel counts are 597,049, 561,059 and 412,126 for Team 1, Team 2 and the activity emblem. All three originals and their 512px WebP derivatives were visually inspected. Team identities, stitching, trim colors and readable silhouettes match the requested family. Only resizing/encoding was performed; source pixels and alpha were not retouched. Derivatives total 354,430 bytes. The saved manifest records exact hashes and sizes.

The derivative script initially passed a URL object to Sharp's output API, which requires a filesystem string. Converting with `fileURLToPath` resolved the preparation error; all three derivatives and the manifest were generated successfully afterward. This did not modify any master or app source.

## Review verification

- Final static-preview browser gate completed **2026-09-11T19:49:55.044Z**: **30 views** (five screens × Student/Coach × 1440/390/320) passed with all visible images loaded, no page overflow or JavaScript errors, and exact stable mobile tab labels. Final hub, Coach question and artwork screenshots were visually inspected. Evidence: ignored `.local/pvp-preview-check/report.json` and adjacent captures.
- **Five motion checks** passed: all three new patches respond to pointer position while their bounding boxes remain stationary; reduced motion resets every patch; a touch/coarse context remains at rest. The new images blend cleanly on both navy and ivory.
- **Eight simulated flows** passed: More dialog/Escape; readiness before Start; draft then final locking; local team discussion; explicit match exit/cancel; consistent 5v5/30-question setup; Coach no-deadline reading/response completion/judgment permissions; and provisional results. These are mockup checks, not real multiplayer/API tests.
- Independent source review found four misleading demo behaviors: Coach advancement during Response, advancement after judging only one unresolved team, a nonplaying Coach discussion composer, and an ignored format choice. The correction batch disables advancement during Response, places response completion in an explicitly labeled control outside the product canvas, shows Team 2 already judged before the remaining Team 1 judgment, makes moderation read-only, and fixes format per the declared example role. Mobile role selection is fully legible, sample counts match choices, desktop labels are preserved, and provisional copy does not call the score final. Switching role clears local sample messages rather than relabeling their author. The final flows above exercise the corrected behavior.
- The first server launch served the HTML at `/` without redirecting, so relative JS failed to load. Redirecting to the artifact's actual path resolved the review-host issue before the first rendered batch. No application route changed.
- JavaScript syntax and whitespace checks passed. Thirty-one local Markdown targets in the brief and asset README resolved. The review is open in a retained in-app browser tab at `http://127.0.0.1:4318/docs/product/mockups/2026-09-11-team-practice.html`.

## Limits

This artifact demonstrates visual hierarchy and interactions using sample data. It does not establish a real multiplayer match, deployed code, earned awards, authoritative timer/score behavior, or mobile keyboard behavior in the actual application. No production deployment, hosted account/data action, backend change, or database migration belongs to this design gate. The prior text-name correction has its own passing checks in the wordmark/header audit. Source checkpoints and the next action are recorded in `PROGRESS.md`.
