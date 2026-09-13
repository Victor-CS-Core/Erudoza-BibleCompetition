# Profile character asset review

[Open the interactive profile review](review.html) · [Appearance sheet](assembled-review.png)

Pages: [Profile](profile-review.png) · [Character](character-review.png) · [Honors](honors-review.png) · [Share](share-review.png). The user’s [supplied design reference](profile-design-reference.png) guides the two-column profile composition and four-page navigation.

The review now uses prepared transparent layers and the actual existing Honor bitmaps. Choose from three hairstyles, three skin tones, three eye colors and three soft gradient backgrounds, with Pathfinder/Master Guide attire samples, a fixed sash, and three Honor spots. Empty positions stay dotted; duplicates are unavailable. The profile-image preview independently supports an Honor choice, the current character portrait or initials. Download uses the same composition function with full-resolution PNG source layers.

## Approved baseline and scope

The user approved `approved-baseline.png` as a good base on September 12, 2026 (local time). The approved direction is 2D artwork with a dimensional anime chibi appearance, with at most three options per customization category. Variations follow baseline approval; their appearance and assembled quality remain subject to review before final product integration.

Required elements:

- Student Pathfinder attire and a coach Master Guide attire option.
- A sash for every character; the satchel option was removed at the user’s request.
- Three ordered Honor positions. Each position contains an eligible earned Honor or remains empty with a dotted outline.
- Style and attire changes preserve the three Honor selections and their order.
- Existing Honor profile images remain available alongside character portraits and initials; the avatar selection is independent of equipped Honors.
- Sharing reproduces the saved character, sash, equipped Honors and dotted empty positions.
- Use the existing Honor artwork and eligibility evidence. The artwork pack does not award Honors or establish official Master Guide certification.

## Proposed first variation set

There are three complete character styles: short curls, side sweep, and curly bob. Each has a student/Pathfinder and a coach/Master Guide sample. Skin tone and eye color now use independent runtime controls, retained across hairstyle and attire changes. Hairstyle still selects one of the six original full-character source images: their subtle face/body differences remain a review limitation. A final modular hair system with identical face geometry has not been delivered. There is one standing pose, one sash. No category requires three options merely because three is the ceiling.

| Style | Pathfinder sample | Master Guide sample |
| --- | --- | --- |
| Short curls | [Student](prepared/student-curls.png) | [Coach](prepared/coach-curls.png) |
| Side sweep | [Student](prepared/student-sweep.png) | [Coach](prepared/coach-sweep.png) |
| Curly bob | [Student](prepared/student-bob.png) | [Coach](prepared/coach-bob.png) |

Accessory: [sash](prepared/sash.png). Its front intentionally has no baked-in spots or patches: the renderer draws dotted spots for null slots and uses existing Honor bitmaps for occupied slots.

## Generation and limitations

The inactive satchel source and derivatives are retained only as design history; the review renderer does not load or support them.

All eight sources were generated with the built-in `image_gen` tool using the approved baseline as the reference. `generation.json` retains the full prompts and source provenance. Originals are preserved without modification; `inventory.json` records SHA-256 hashes, dimensions and pixel modes.

Every original generated source is RGB: the generator baked a checkerboard into the background despite a request for transparent alpha. The user explicitly authorized local image processing to remove it. `prepare.py` removes the connected neutral checkerboard and identified openings, preserves enclosed eye whites and buckle highlights, insets the boundary by one source pixel and softens it by 0.35 pixels. The process is specific to these reviewed sources, not a general background-removal tool. It verifies source hashes before processing and asserts a reasonable transparent fraction before writing output.

`prepared/` contains eight full-resolution RGBA PNG layers and eight 512px-wide WebP derivatives with alpha. `preparation.json` records output hashes, bounds and transparent fractions. All source hashes still match. All eight cutouts were inspected on split ivory/navy backgrounds before assembly.

`composition.ts` registers the sash to individually inspected shoulder/hip coordinates on each of the six bodies. It places larger upright Honor images at measured sash centerline coordinates (282,393), (516,720), and (741,1048), with a source radius of 145 pixels, drawing dotted outlines only for null positions. `verify-placement.py` checks every degree of each circle plus a 10-pixel fabric margin against the real sash alpha and checks non-overlap. Similarity transforms preserve this clearance on every body. Rendering uses a buffer and commits only the current selection, avoiding stale asynchronous renders. The generated coordinates in the prompts are not assumed to be the actual geometry.

`appearance.ts` applies deterministic, source-specific skin and iris color modifiers during browser rendering; original bitmaps are untouched. Skin regions and luminance mapping preserve the sampled shading; iris controls preserve pupils and catchlights. Profile portraits and exports use the same appearance renderer. The three background choices are code-rendered studio gradients (warm, sage, sky), not generated landscape illustrations. The original reference pose and custom uniform have not yet been recreated exactly.

## Reproduce and validate

From the repository root, with the existing Node dependencies plus local Pillow and NumPy:

```sh
python docs/brand/2026-09-13-profile-characters/prepare.py
node docs/brand/2026-09-13-profile-characters/build-review.mjs
python -m http.server 5187 --bind 127.0.0.1
```

Open `http://127.0.0.1:5187/docs/brand/2026-09-13-profile-characters/review.html`. While the server runs, verify with:

```sh
node docs/brand/2026-09-13-profile-characters/verify-review.mjs
python docs/brand/2026-09-13-profile-characters/verify-placement.py
node docs/brand/2026-09-13-profile-characters/capture-review.mjs
```

The standalone review imports the actual shared React Button, Panel, PageHeader, Badge, Notice and Select primitives and the existing semantic token/control CSS. Its bundle does not modify the deployed application bundle. `review.bundle.js` is the reproducible browser artifact for this review.

Local verification: bundle/scoped TypeScript and whitespace passed. Chromium exercised 54 attire/hairstyle/skin/eye combinations, three visibly different eye colors and backgrounds, Honor ordering/duplicates/empty states, independent avatar selection and updated portraits, PNG download, search/navigation, keyboard focus, and all four pages at 1440/390/320 for both attires (24 page/viewport checks). No overflow, missing images or page errors. All 18 skin/hairstyle/attire samples were visually inspected in a contact sheet; narrow pages, profile/creator screenshots and export were inspected. Honor placement passed the alpha-containment check. A final shadow-only refinement was checked through fresh page captures. QA-only captures stay outside Git; the four review screenshots and updated appearance sheet are intentional deliverables.

## Approval and product boundary

Next is the user's review of these assembled variations, accessory fit and coach visual distinction. Skin, eye and background controls are independently implemented in the review; hairstyle source geometry still needs the modular-art refinement described above. The review exposes both attire samples for inspection; it is not an authorization mechanism. Its three Honor choices are explicitly sample choices, not assertions that a user has earned them. It makes no API requests or account writes. The final profile pages, server-side coach/Honor enforcement, saved configurations, avatar propagation and native sharing remain future product integration. No main integration or live deployment is claimed.
