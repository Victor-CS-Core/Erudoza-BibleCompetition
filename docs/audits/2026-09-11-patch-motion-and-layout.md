# Patch motion, approved layout restoration and artwork review

## Delivered locally

The user reconfirmed the original daily-training mockup after identifying visual drift. The learner frame and HQ now follow its compact proportions, navigation, mission action order, weekly hierarchy and passage tiles. Honors cards and session recap follow the same composition while retaining actual saved counts, criteria, assignment scope, season links, early completion and legacy/interleaved evidence.

`PatchArtwork` now gives every approved patch bitmap a size-aware 2–6px lift, up to seven degrees of pointer-facing dip, at most 2.5% scale and two contour-shadow layers. Logos across public/account/Coach/student screens, Honors and recap art share it. Bounds, copy and controls stay stationary. Center hover lifts even when rotation is zero; pointer exit settles; reduced motion, touch/coarse pointers, hidden pages, blur and unmount are handled.

The existing approved layout and assets remain separate from new proposals. Four original corner illustrations, two composed left and two right, the embroidered name concept and panoramic landscape placement are saved under `docs/brand/` and shown only in the standalone approval page. A nine-page selector changes the proposed image and corner. No new artwork import or public asset was added to the application. The wordmark concept is opaque RGB; its transparent production version remains preparation work after approval. Original masters and exact built-in image-generation prompts are retained.

## Verification

- Final frontend suite: **288 passed across 40 files** (`npx vitest run src --maxWorkers=2`). ESLint, TypeScript/native TypeScript and both builds passed. Vite reports a nonblocking main-chunk size advisory at roughly 504kB (149kB gzip); the canonical build also reports the dependency's punycode deprecation warning.
- Final isolated native browser round: **27 page/viewport captures**, covering HQ, Honors, recap, progress, Coach, landing, login, signup and artwork review at 1440/390/320. No page overflow, broken completed images or JavaScript page errors. Six additional placement captures compare left/right illustrations at those widths.
- **10 motion checks**: learner logo, next Honor, collection, detail dialog, recap, Coach logo, landing/login/signup logos, and coarse-touch behavior. Browser evidence records center lift, opposite pointer rotations and shadow offsets, unchanged surface bounds, immediate reduced-motion reset and return to rest. Keyboard dialog close restores focus. Unpinning the active shortcut on a 320px viewport keeps it visible.
- **Nine artwork-route checks** separately verify actual `::after` image URLs, left/right background positions, fade angles and HTTP asset availability. The earlier generic report queried `::before` and therefore recorded `none`; `route-artwork-proof.json` corrects that measurement. Browser screenshots show both real compositions.
- Independent source review caught the active-shortcut reordering effect missing pin dependencies; a failing regression demonstrated it, and the fix passed. The first motion harness expected unitless zero CSS serialization; Chromium normalizes to `0px`, so the harness was corrected. These were not hidden application failures.

Ignored local evidence: `.local/patch-refinement-browser/report.json`, `route-artwork-proof.json`, captures and local-only harness scripts. Native preview uses in-memory fixtures at port 8887; the original mockup stays at 4317 and the approval gallery at 4318. Old port 8889 is left intact. No real email, production account mutation, deployment or new backend/full-gameplay suite was performed for this presentation change.

## Approval and release boundary

Await the user's approval of the lettering, banner placement, four background illustrations and page mapping before integrating those proposals. The layout restoration and existing-patch motion are already authorized. This audit establishes local checks, not deployment. Git checkpoint and push are recorded separately in `PROGRESS.md`.
