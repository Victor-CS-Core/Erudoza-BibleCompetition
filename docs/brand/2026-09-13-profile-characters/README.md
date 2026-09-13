# Profile character asset review

[Open the interactive assembly review](review.html) · [View the assembled sheet](assembled-review.png)

The review now uses prepared transparent layers and the actual existing Honor bitmaps. Choose among the three complete character styles, Pathfinder/Master Guide attire samples, a fixed sash, and three Honor spots. Empty positions stay dotted; duplicates are unavailable. The profile-image preview independently supports an Honor choice, the current character portrait or initials. Download uses the same composition function with full-resolution PNG source layers.

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

There are three complete character styles: short curls, side sweep, and curly bob. Each has a student/Pathfinder and a coach/Master Guide sample. These are complete appearance presets for this first review; independent hair, face, and skin controls are not implemented or established by these files. There is one standing pose, one sash. No category requires three options merely because three is the ceiling.

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

`composition.ts` registers the sash to individually inspected shoulder/hip coordinates on each of the six bodies. It places the three existing Honor images at fixed sash coordinates, drawing dotted outlines only for null positions. Rendering uses a buffer and commits only the current selection, avoiding stale asynchronous renders. The generated coordinates in the prompts are not assumed to be the actual geometry.

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
```

The standalone review imports the actual shared React Button, Panel, PageHeader, Badge, Notice and Select primitives and the existing semantic token/control CSS. Its bundle does not modify the deployed application bundle. `review.bundle.js` is the reproducible browser artifact for this review.

Local verification: the review bundle and scoped TypeScript check passed. Chromium checked all six style/attire combinations, preservation of three selected Honors, duplicate prevention, empty/partial states, independent avatar modes and Honor choice, a real 1200×1600 PNG download, keyboard focus, and artwork loading without page errors. Both attire samples fit at 1440, 390 and 320 pixels without page overflow. Both complete attire lineups, narrow student/coach views and the export were inspected. QA captures remain outside the repository.

## Approval and product boundary

Next is the user's review of these assembled variations, accessory fit and coach visual distinction. The three complete styles combine face, hair and skin; separate appearance categories have not been implemented. The review exposes both attire samples for inspection; it is not an authorization mechanism. Its three Honor choices are explicitly sample choices, not assertions that a user has earned them. It makes no API requests or account writes. The final profile pages, server-side coach/Honor enforcement, saved configurations, avatar propagation and native sharing remain future product integration. No main integration or live deployment is claimed.
