# Profile character design review

[Open the interactive review](review.html) · [Pathfinder styles](assembled-review.png) · [Master Guide styles](master-guide-hairstyles.png)

Latest refinement: [before/after](refinement/before-after.png) · [neck joins](refinement/neckline-review.png) · [male colors](refinement/male-palette.png) · [female colors](refinement/female-palette.png) · [transparent portrait](refinement/transparent-portrait.png). [Research, implementation and validation notes](refinement-notes.md) explain the alignment, masking and color corrections.

Pages: [Profile](profile-review.png) · [Character](character-review.png) · [Honors](honors-review.png) · [Share](share-review.png) · [Female Master Guide creator](female-master-guide-review.png). The user's [design reference](profile-design-reference.png) guides the profile composition and four-page navigation.

[Live selector color example](selector-colors-review.png): blond hair, deep skin and blue eyes appear in every hairstyle preview and the selected character.

## Current direction

The user approved the dimensional anime chibi direction as a starting point. Rendering stays 2D. The latest request supersedes the initial three-option ceiling for hairstyles and hair color:

- Male and Female body types, each mapped to its own body artwork for Pathfinder and Master Guide attire.
- Six hairstyles per body type. Male: short curls, side part, textured quiff, buzz cut, swept waves, short locs. Female: curly bob, straight bob, high ponytail, two braids, natural curls, low bun.
- Four hair colors: red, black, brown, blond.
- Three skin tones, three eye colors, three soft gradient backgrounds.
- Body changes update the hairstyle grid and remember the last hairstyle for each body type. Attire changes retain body type, hairstyle, hair color, skin, eyes, background and Honors.
- All six hairstyle thumbnails use the selected hair color, skin tone and eye color through the same transparent portrait renderer as the Profile head-shot. Outdated thumbnails are hidden while the latest appearance renders.
- A fixed sash with three ordered Honor positions. Null positions remain dotted; duplicate Honors are unavailable.
- Independent Honor, character portrait or initials profile image. Character portraits use the current head appearance with true transparency and no stage background, clothing or shadow. The downloaded full-character PNG retains the chosen studio background.

There is no satchel in the active renderer. Its source files remain only as design history. The review uses sample choices from the actual existing Honor artwork; it does not award Honors or claim official Pathfinder certification.

## Artwork and composition

The initial `approved-baseline.png`, eight original full-body/accessory sources, their generation prompts and hash inventory remain preserved. `prepare.py` reproduces the locally authorized neutral-background removal; `prepared/` holds those eight RGBA PNGs and eight alpha WebPs.

The twelve new hairstyles are independent **head-and-hair** layers over four fixed body/attire sources. Changing hairstyle now keeps the selected body's torso, proportions, clothing and sash placement. It does not simulate 3D geometry. The male and female sheets were created with built-in `image_gen`; [hair-generation.json](hair-generation.json) contains both complete prompts, reference and original generated paths. Project-bound copies are in `hair-sources/`.

`prepare-heads.py` splits the six-cell sheets, removes the deliberately cyan background, recovers fringe RGB from nearby opaque pixels and writes twelve PNG/WebP pairs under `heads/`, with source/output hashes. `prepare-head-masks.py` combines connected skin-color regions, filled interior holes and reviewed ear-protection regions to create the twelve skin/hair masks. This corrects the previous hair tint leaking into ear shadows. These scripts are specific to these reviewed source sheets, not general segmentation tools.

`head-landmarks.json` records each head's measured neck attachment and protected ear regions. `hair.ts` scales by iris distance, aligns the neck attachment to its body anchor, and maps source luminance through four-stop hair palettes for controlled shadows and highlights. `prepare-body-layers.py` traces each garment collar instead of retaining the old horizontal body cut; `body-layers/` contains four front garment PNG/WebP pairs and their neckline coordinates. `appearance.ts` handles body skin tones and studio gradients.

`composition.ts` draws the head behind the front garment, then the sash and existing Honor images, using an offscreen buffer; the UI commits only its latest render. Full-resolution body/head PNG layers are used for export. Its separate `renderPortrait` draws a centered, padded 320×320 transparent head-shot directly from the colored head layer. Attire, background and Honors cannot enter that portrait path.

Honor centers are measured at sash-source coordinates (282,393), (516,720), and (741,1048), with a 145-pixel radius. `verify-placement.py` checks all 360 degrees of each circle plus a 10-pixel fabric margin against the actual sash alpha, and confirms circles do not overlap. The body registration uses similarity transforms, preserving that clearance.

## Reproduce and validate

From the repository root with existing Node dependencies, Pillow and NumPy:

```sh
python docs/brand/2026-09-13-profile-characters/prepare.py
python docs/brand/2026-09-13-profile-characters/prepare-heads.py
python docs/brand/2026-09-13-profile-characters/prepare-head-masks.py
python docs/brand/2026-09-13-profile-characters/prepare-body-layers.py
node docs/brand/2026-09-13-profile-characters/build-review.mjs
python -m http.server 5187 --bind 127.0.0.1
```

With the server running:

```sh
node docs/brand/2026-09-13-profile-characters/verify-review.mjs
node docs/brand/2026-09-13-profile-characters/verify-refinement.mjs
node docs/brand/2026-09-13-profile-characters/verify-selector-previews.mjs
python docs/brand/2026-09-13-profile-characters/verify-placement.py
node docs/brand/2026-09-13-profile-characters/capture-review.mjs
./node_modules/.bin/tsc --noEmit --jsx react-jsx --target es2022 --module esnext --moduleResolution bundler --lib ES2022,DOM --allowSyntheticDefaultImports --skipLibCheck --types vite/client --resolveJsonModule docs/brand/2026-09-13-profile-characters/review.tsx
```

The review imports actual shared React UI primitives and semantic CSS. Its checked-in browser bundle is separate from the application bundle. Color changes are deterministic runtime rendering, not new generated images for each selection.

Local validation: bundle/scoped TypeScript and whitespace passed. Chromium checked all **96 body/hairstyle/attire/hair-color combinations**, distinct rendered colors, body-specific hairstyle memory, Master Guide preservation, skin/eye/background controls, Honor ordering/duplicates/empty states, independent avatars and live portraits, image download, search/navigation and keyboard focus. All four pages passed at 1440/390/320 for both bodies and both attires (**48 page/viewport checks**), with no overflow, missing images or page errors. The sash containment check passed.

The dedicated refinement check covers **144 hairstyle/skin/hair-color combinations**, **678,444 protected inner-ear sample comparisons**, transparent borders on **144 portraits**, and **24 neck attachment registrations**. It also verifies identical portrait output when attire/background/Honors change. Enlarged neck joins across all twelve styles and both attires, both 24-portrait color sheets, refreshed profile screenshots and a matched before/after were visually inspected. Tests establish the stated pixel/interaction properties, not universal art quality; see the notes for limits. QA-only images remain outside Git; intentional review screenshots and comparison sheets are in this package.

The selector regression check reproduced the original static-thumbnail defect, then passed **120 individual thumbnail color updates** across both bodies, **four selected-thumbnail/Profile-portrait matches**, rapid changes, attire/background independence and 1440/390/320 layouts. Creator capture/verification now waits for all six rendered thumbnails as well as the main character.

## Approval and product boundary

This remains an interactive design review with in-memory selections, not production profile functionality. Master Guide is exposed for comparison here; role authorization and earned-only Honor eligibility will use the existing account system during product integration. No account API calls, saves, production avatar propagation or native sharing have been added. Download creates a local 1200×1600 PNG.

Head sprites have small generated differences in face geometry; they are not yet interchangeable hair-only layers over one pixel-identical face. The original reference pose and uniform are not recreated exactly. Final art approval, account persistence, eligibility/coach enforcement and live profile integration remain future work. Commit/push verification does not establish a deployment.
