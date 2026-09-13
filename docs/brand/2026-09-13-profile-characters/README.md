# Profile character design review

[Open the interactive review](review.html) · [Pathfinder styles](assembled-review.png) · [Master Guide styles](master-guide-hairstyles.png)

Latest refinement: [before/after](refinement/before-after.png) · [neck joins](refinement/neckline-review.png) · [male colors](refinement/male-palette.png) · [female colors](refinement/female-palette.png) · [transparent portrait](refinement/transparent-portrait.png). [Research, implementation and validation notes](refinement-notes.md) explain the alignment, masking and color corrections.

Pages: [Profile](profile-review.png) · [Character](character-review.png) · [Honors](honors-review.png) · [Share](share-review.png) · [Female Master Guide creator](female-master-guide-review.png). The user's [design reference](profile-design-reference.png) guides the profile composition and four-page navigation.

[Live selector color example](selector-colors-review.png): blond hair, deep skin and blue eyes appear in every hairstyle preview and the selected character.

[Backgrounds with both body types and attires](backgrounds/scene-lineup.png) · [Dark-edge inspection](backgrounds/dark-edge-review.png) · [Background artwork and preparation notes](backgrounds/README.md).

## Current direction

The user approved the dimensional anime chibi direction as a starting point. Rendering stays 2D. The latest request supersedes the initial three-option ceiling for hairstyles and hair color:

- Male and Female body types, each mapped to its own body artwork for Pathfinder and Master Guide attire.
- Six hairstyles per body type. Male: short curls, side part, textured quiff, buzz cut, swept waves, short locs. Female: curly bob, straight bob, high ponytail, two braids, natural curls, low bun.
- Four hair colors: red, black, brown, blond.
- Three skin tones, three eye colors, and three illustrated backgrounds: Mountain Sunrise, Woodland Basecamp and Starlight Camp.
- Body changes update the hairstyle grid and remember the last hairstyle for each body type. Attire changes retain body type, hairstyle, hair color, skin, eyes, background and Honors, with the same head scale, neckline and ground reference.
- All six hairstyle thumbnails use the selected hair color, skin tone and eye color through the same transparent portrait renderer as the Profile head-shot. Outdated thumbnails are hidden while the latest appearance renders.
- A fixed sash with three ordered Honor positions. Null positions remain dotted; duplicate Honors are unavailable.
- Independent Honor, character portrait or initials profile image. Character portraits use the current head appearance with true transparency and no stage background, clothing or shadow. The downloaded full-character PNG retains the chosen illustrated background.

There is no satchel in the active renderer. Its source files remain only as design history. The review uses sample choices from the actual existing Honor artwork; it does not award Honors or claim official Pathfinder certification.

## Artwork and composition

The initial `approved-baseline.png`, eight original full-body/accessory sources, their generation prompts and hash inventory remain preserved. `prepare.py` reproduces the locally authorized neutral-background removal; `prepared/` holds those eight RGBA PNGs and eight alpha WebPs.

The twelve new hairstyles are independent **head-and-hair** layers over four fixed body/attire sources. Changing hairstyle now keeps the selected body's torso, proportions, clothing and sash placement. It does not simulate 3D geometry. The male and female sheets were created with built-in `image_gen`; [hair-generation.json](hair-generation.json) contains both complete prompts, reference and original generated paths. Project-bound copies are in `hair-sources/`.

`prepare-heads.py` splits the six-cell sheets, removes the deliberately cyan background, recovers fringe RGB from nearby opaque pixels and writes twelve PNG/WebP pairs under `heads/`, with source/output hashes. `prepare-head-masks.py` combines connected skin-color regions, filled interior holes and reviewed ear-protection regions to create the twelve skin/hair masks. This corrects the previous hair tint leaking into ear shadows. These scripts are specific to these reviewed source sheets, not general segmentation tools.

`head-landmarks.json` records each head's measured neck attachment and protected ear regions. `hair.ts` scales by iris distance, aligns the neck attachment to its body anchor, and maps source luminance through four-stop hair palettes for controlled shadows and highlights. `prepare-body-layers.py` traces each garment collar instead of retaining the old horizontal body cut; `body-layers/` contains four front garment PNG/WebP pairs and their neckline coordinates. `appearance.ts` handles body skin tones, background image fitting and ground contact shadows.

The three new full-bleed scene sources and prompts are preserved under `backgrounds/`. `prepare-backgrounds.py` creates 1024px preview WebPs and 320px selector thumbnails. Export loads the original image; square preview and portrait export use centered cover fitting. `cutout_edges.py` decontaminates active sprite edges using interior colors and a fractional inset. Hair membership is independent of sprite opacity, so the renderer applies alpha once. No character stroke, glow or silhouette shadow is added. Ground shadows follow each body's measured boot position and are carried into export.

`composition.ts` draws the head behind the front garment, then the sash and existing Honor images, using an offscreen buffer; the UI commits only its latest render. Full-resolution body/head PNG layers are used for export. Its separate `renderPortrait` draws a centered, padded 320×320 transparent head-shot directly from the colored head layer. Attire, background and Honors cannot enter that portrait path.

Honor centers are measured at sash-source coordinates (282,393), (516,720), and (741,1048), with a 145-pixel radius. `verify-placement.py` checks all 360 degrees of each circle plus a 10-pixel fabric margin against the actual sash alpha, and confirms circles do not overlap. The body registration uses similarity transforms, preserving that clearance.

## Reproduce and validate

From the repository root with existing Node dependencies, Pillow and NumPy:

```sh
python docs/brand/2026-09-13-profile-characters/prepare.py
python docs/brand/2026-09-13-profile-characters/prepare-heads.py
python docs/brand/2026-09-13-profile-characters/prepare-head-masks.py
python docs/brand/2026-09-13-profile-characters/prepare-body-layers.py
python docs/brand/2026-09-13-profile-characters/prepare-backgrounds.py
node docs/brand/2026-09-13-profile-characters/build-review.mjs
python -m http.server 5187 --bind 127.0.0.1
```

With the server running:

```sh
node docs/brand/2026-09-13-profile-characters/verify-review.mjs
node docs/brand/2026-09-13-profile-characters/verify-refinement.mjs
node docs/brand/2026-09-13-profile-characters/verify-selector-previews.mjs
node docs/brand/2026-09-13-profile-characters/verify-backgrounds.mjs
node docs/brand/2026-09-13-profile-characters/verify-share.mjs
node docs/brand/2026-09-13-profile-characters/verify-native-share.mjs
node docs/brand/2026-09-13-profile-characters/verify-attire-scale.mjs
node docs/brand/2026-09-13-profile-characters/verify-skin-sash.mjs
python docs/brand/2026-09-13-profile-characters/verify-cutout-edges.py
python docs/brand/2026-09-13-profile-characters/verify-placement.py
node docs/brand/2026-09-13-profile-characters/capture-review.mjs
node docs/brand/2026-09-13-profile-characters/capture-share.mjs
./node_modules/.bin/tsc --noEmit --jsx react-jsx --target es2022 --module esnext --moduleResolution bundler --lib ES2022,DOM --allowSyntheticDefaultImports --skipLibCheck --types vite/client --resolveJsonModule docs/brand/2026-09-13-profile-characters/review.tsx
```

The review imports actual shared React UI primitives and semantic CSS. Its checked-in browser bundle is separate from the application bundle. Color changes are deterministic runtime rendering, not new generated images for each selection.

Local validation: bundle/scoped TypeScript and whitespace passed. Chromium checked all **96 body/hairstyle/attire/hair-color combinations**, distinct rendered colors, body-specific hairstyle memory, Master Guide preservation, skin/eye/background controls, Honor ordering/duplicates/empty states, independent avatars and live portraits, image download, search/navigation and keyboard focus. All four pages passed at 1440/390/320 for both bodies and both attires (**48 page/viewport checks**), with no overflow, missing images or page errors. The sash containment check passed.

The dedicated refinement check covers **144 hairstyle/skin/hair-color combinations**, **678,444 protected inner-ear sample comparisons**, transparent borders on **144 portraits**, and **24 neck attachment registrations**. It also verifies identical portrait output when attire/background/Honors change. Enlarged neck joins across all twelve styles and both attires, both 24-portrait color sheets, refreshed profile screenshots and a matched before/after were visually inspected. Tests establish the stated pixel/interaction properties, not universal art quality; see the notes for limits. QA-only images remain outside Git; intentional review screenshots and comparison sheets are in this package.

The selector regression check reproduced the original static-thumbnail defect, then passed **120 individual thumbnail color updates** across both bodies, **four selected-thumbnail/Profile-portrait matches**, rapid changes, attire/background independence and 1440/390/320 layouts. Creator capture/verification now waits for all six rendered thumbnails as well as the main character.

## Share editor and complexion tuning — September 13

[Open Share](review.html?share=1&page=share) · [Customized desktop](share-customized-review.png) · [Phone](share-mobile-review.png) · [Downloaded card](share-customized-export.png) · [Low-bun skin comparison](refinement/low-bun-skin-tones.png)

Share has an adventure-card editor in the approved chibi art style: drag unlocked patches from the tray, tap to add, drag to move, resize, rotate, change stacking order, remove or clear, and undo/redo. Arrow keys move a focused patch; Shift takes larger steps and Delete removes it. Escape cancels an active drag. Touch supports tap addition and direct patch movement. Full rotated bounds stay inside the 1200 × 1600 image, including the soft patch shadow. Download uses the exact preview canvas composition; selection outlines are editor-only and never appear on the character or exported PNG. Interface copy calls the character a Pathfinder.

Decorations are separate from the three sash Honors and Honor/character/initials profile image. They survive page navigation and appearance/background changes within this preview. The tray accepts the profile's `earnedAtUtc` convention, filters locked entries and rejects unknown/duplicate/locked drop keys. The three shown unlocks are explicitly labeled sample data; no authenticated account collection is fetched or claimed. One copy of each available patch can decorate the card, independently of its sash placement. Forty edits are retained for undo; the preview clears on reload.

The low-bun face was overexposed because a single cheek sample landed in a source shadow. A masked forehead median and bounded highlight curve now keep all twelve hairstyles closer to their Light/Medium/Deep category while retaining shading. The body uses the same bounded tone curve. Sash direction was already upper-left shoulder to lower-right hip in screen coordinates; added checks lock that direction across all 24 head/attire combinations without mirroring art. See [refinement notes](refinement-notes.md).

Fresh local verification passed the Share interaction suite (including real Chromium native drag/drop and touch input, keyboard movement, cancellation, bounds, layering, removal, clear, history, state independence and byte-identical PNG output), 36 skin/category combinations, all prior 96 appearance and 48 page/layout cases, 12 scene/body/attire combinations and three scene downloads, 144 portrait/refinement combinations, 120 thumbnail changes, four portrait matches, 678,444 protected ear comparisons, sash containment and cutout edge checks. Desktop and 390/320px captures were inspected. Bundle/scoped TypeScript and whitespace passed. These are local Chromium/code/art checks, not Safari/Firefox, a physical-device gate, production eligibility enforcement or deployment.

## Share visibility, public QR and consistent attire height

Three independent switches show or hide the profile username, Erudoza wordmark and landing-page QR. All three start enabled; turning all off leaves the card without text or a QR. Following the user's refinement, Share has no name input or custom-name state. Its read-only profile argument uses the existing account contract's `userName`; this local review supplies the sample profile `alexbrooks` with display name Alex Brooks and derived AB initials. Production account integration remains outstanding. Names are trimmed and fitted to the card width without truncation. These visibility choices survive page and attire changes in memory; they do not alter the separate profile image or sash Honors.

The username uses bold navy lettering with a rounded white outline and a small sticker shadow in both the preview and exported PNG. The white edge belongs only to the lettering; no character outline was added. The header's profile-image circle is now 64px on desktop and 56px on phones, up from 44px, for Honor, character and initials choices alike.

The bottom-right footer pairs the QR with the Erudoza wordmark when both are enabled. An opaque plate preserves contrast on all three backgrounds; movable patches stay outside the active footer, including their rotated bounds and shadow margin. The preview and downloaded PNG use the same painter. The QR encodes only [the public Erudoza landing page](https://erudoza.com/), confirmed against the repository's documented production origin and an HTTP 200 readback on September 13. It contains no account identifier or local preview address.

`landing-qr.json` stores a version 2 QR with Q error correction and a four-module quiet zone. The checked-in matrix is rendered directly; no runtime QR dependency or network image service was added. Optional test-only dependencies can be installed outside the project:

```sh
python3 -m venv /tmp/erudoza-qr-tools
/tmp/erudoza-qr-tools/bin/pip install qrcode==8.2
/tmp/erudoza-qr-tools/bin/python docs/brand/2026-09-13-profile-characters/prepare-landing-qr.py
npm install --prefix /tmp/erudoza-qr-tools-js --no-package-lock --ignore-scripts --no-audit --no-fund jsqr@1.4.0
node docs/brand/2026-09-13-profile-characters/verify-share-labels.mjs
```

The verification script uses existing `sharp` plus the independent jsQR decoder; set `ERUDOZA_QR_DECODER` to its module path when installed elsewhere. It checks the absence of an editable name field, independent switches, visible white/dark lettering on day/night cards, retained options/decorations, keyboard operation at 1440/390/320, patch exclusion and identical preview/download bytes. Direct rendering also checks that changing `userName` changes the card, changing `displayName` does not, blank usernames paint nothing and long usernames fit the margins. Day and night cards decode to the public URL at both 1200px and 600px widths. This is software decoding, not a physical-camera or print test.

Master Guide's inconsistent height came from different source neck-to-sole distances. The male version was 66–74px shorter and the female version 52–53px taller across hairstyles. `bodyFrame` now uniformly scales each garment, sash and all three Honors together to the corresponding Pathfinder neck/ground reference; the same head placement is used for either attire. A shared 32px top inset also prevents the tallest hairstyle from clipping. All twelve pairs now differ by at most one rendered pixel in height. Original art and transparent headshots remain unchanged. Inspect the [male attire pairs](refinement/male-attire-scale.png), [female attire pairs](refinement/female-attire-scale.png) and [24 collar joins](refinement/neckline-review.png).

## Native phone sharing

On secure pages in browsers that support PNG file sharing, **Share image** opens the device's native sharing interface. The phone supplies the destinations, such as AirDrop or installed messaging apps, according to its capabilities and settings. Download remains available; browsers without file-sharing support show Download as the primary action. Canceling leaves the card unchanged and does not trigger a download. A sharing error offers a manual download fallback.

The editor prepares the current 1200×1600 PNG after changes settle, before enabling Share. The tap invokes `navigator.share` immediately with that file, preserving the required user activation. Generation keys discard stale encoding callbacks after edits. Pathfinder and Master Guide use descriptive filenames. Only the composed PNG is sent: hidden usernames, wordmarks and QR codes are not reintroduced as separate share text, titles or URLs. Pending sharing disables duplicate share/download actions. Implementation follows the [W3C Web Share specification](https://www.w3.org/TR/web-share/) and [file capability detection](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/canShare).

The dedicated local Chromium test substitutes only the OS-sharing API boundary and verifies the actual rendered PNG, active tap, cancellation, failures, stale encodings, duplicate-action protection, Master Guide and missing/unsupported/blocked API fallbacks. It checks 390px and 320px layouts with touch input; the existing Share/visibility/export regressions also pass. This does not establish actual iPhone/AirDrop or Android target delivery. Physical-device acceptance remains to be performed on an HTTPS-hosted review; a phone cannot access this computer's loopback URL.

## Approval and product boundary

This remains an interactive design review with in-memory selections, not production profile functionality. Master Guide is exposed for comparison here; role authorization and earned-only Honor eligibility will use the existing account system during product integration. No account API calls, saves or production avatar propagation have been added. Download creates a local 1200×1600 PNG; supported devices can share the same file through their native menu.

Head sprites have small generated differences in face geometry; they are not yet interchangeable hair-only layers over one pixel-identical face. The original reference pose and uniform are not recreated exactly. Final art approval, account persistence, eligibility/coach enforcement and live profile integration remain future work. Commit/push verification does not establish a deployment.
