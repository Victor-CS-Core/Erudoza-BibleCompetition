# Original Erudoza artwork — 11 September 2026

Status: **Pathfinder patch style approved; embroidered Erudoza logo explicitly approved**. The student interaction mockup is approved. The user named the feature **Honors System** and requested pointer-following tilt. Production integration has not started.

Open the [artwork review gallery](review.html) to inspect the complete family, compare the earlier academy shields with the requested Pathfinder-inspired patches, and check badges at 48, 96, and 160 pixels on ivory, navy, and soft teal.

## Proposed collection

The recommended **Pathfinder edition (v2)** combines Erudoza navy/teal/ivory with warm gold and restrained red, embroidered honor-style patches, mountains, Scripture, a neckerchief, compass, and lantern. These are original Erudoza app honors, with their own criteria. They do not assert official Pathfinder rank or honor completion.

The reference is the General Conference Youth Ministries explanation of [Pathfinder symbolism](https://www.gcyouthministries.org/ministries/pathfinders/meaning-of-the-pathfinder-club-emblem/), including gold, blue, red, white, the downward triangle, and the sword's relationship to Scripture. Outdoor-learning context was checked against the [official Pathfinder ministry overview](https://www.gcyouthministries.org/ministries/pathfinders/). We used this thematic vocabulary in original compositions and retained the Erudoza identity.

| Asset | Source master | Proposed use |
|---|---|---|
| Journey into Scripture | [Pathfinder hero](masters/pathfinder-v2/pathfinder-journey-hero-v3.png) | Site welcome, Training HQ, season introduction; mobile uses a right-hand crop |
| A guide for the journey | [Coach illustration](masters/pathfinder-v2/pathfinder-coach-guide-v2.png) | Compact coach welcome and preparation/empty-state moments |
| A moment to celebrate | [Completion illustration](masters/academy-v1/practice-complete-v1.png) | Session recap and meaningful progress |
| Exact Recall | [Quill patch](masters/pathfinder-v2/exact-recall-v2.png) | Exact wording achievement |
| Reference Ready | [Compass patch](masters/pathfinder-v2/reference-ready-v2.png) | Scripture reference achievement |
| Chapter Strong | [Bible patch](masters/pathfinder-v2/chapter-strong-v2.png) | Assigned chapter-scope achievement |
| Review Complete | [Review patch](masters/pathfinder-v2/review-complete-v2.png) | Selected review set completed |
| Steady Study | [Calendar patch](masters/pathfinder-v2/steady-study-v2.png) | Four qualifying weeks |
| Full Coverage | [Map patch](masters/pathfinder-v2/full-coverage-v2.png) | Practice throughout the assigned scope |

The earlier **Academy edition (v1)** is preserved under `masters/academy-v1/`: six enamel shields and two supporting illustrations, plus the shared completion illustration. The gallery's Compare artwork selector compares the sets. The new Pathfinder family is the default after the user's thematic request.

## Source and delivery details

- Generated with the built-in `image_gen` tool, one request per individual asset. No CLI/API fallback or stock image substitution was used.
- [prompts.json](prompts.json) preserves every exact generation prompt and its asset key. [manifest.json](manifest.json) records all 19 source masters, dimensions, bytes, SHA-256 hashes, generation mode, and approval/selection state.
- Hero masters are 2172 × 724 PNG; Coach masters are 1536 × 1024 PNG. Each badge and the completion illustration is 1254 × 1254 PNG.
- Badge/completion files have actual RGBA transparency. Pixel-format and corner-alpha inspection confirms transparent or near-transparent corners; the manifest retains the exact samples. RGB illustrations intentionally have an ivory paper background.
- Original generated files were copied byte-for-byte into this package. The hero v3 was edited with the built-in image tool at the user's request: the sun and rays were removed and the compass refined. Earlier masters are retained. No external raster editing, cropping, recompression, or retouching was performed. The gallery scales/crops only for presentation.
- Neither sample student records nor Scripture text is embedded in the new images. The label, earned date, criterion and state will be accessible HTML, separate from the art.

## Integration after approval

The approved family and logo are recorded below. Create optimized responsive derivatives in `apps/web/public/assets/training/` through the asset pipeline, preserving source masters here. Set a measured size budget after comparing visual quality; do not ship multi-megabyte source PNGs as initial UI downloads. Keep separate badge files instead of crop coordinates in a sprite sheet.

Use explicit dimensions and responsive sources. Lazy-load collection/secondary images, with intentional loading for the visible HQ hero. Keep artwork out of forms/tables and preserve readable controls on solid surfaces. Validate actual 320/390px crops, transparent edges on light and dark surfaces, and badge silhouettes at 48/96/160px. Decorative illustrations get empty alt text when nearby copy supplies their meaning; standalone meaningful images need concise alternatives.

Shared honor rules and release checks are in the [implementation plan](../../superpowers/plans/2026-09-11-daily-training-progression.md) and [design specification](../../superpowers/specs/2026-09-11-daily-training-progression-design.md). Coach information hierarchy is covered separately in the [Coach recommendations](../../product/2026-09-11-coach-workspace-recommendations.md).

## Approval record

- Requested direction: SDA Pathfinder thematic, original high-quality site art and badges.
- Proposed selection: Pathfinder honors v2, revised hero v3, and embroidered logo v2. The existing completion illustration is retained as a reference for a future patch treatment.
- User asset approval: "the art design and logos I approve are the patches style one"; the transparent logo was then explicitly approved with "That logo is perfect."
- Production integration: not started.

## Verification

Every generated image was visually inspected. All 19 masters were checked for dimensions, pixel format, corner alpha and SHA-256; their raw bytes are preserved. Gallery checks passed at 1440/390/320 pixels with all 10 current images loaded and no page overflow. Honor size/surface controls were exercised at 48/96/160 pixels; opposite pointer positions produced opposite signed rotations within 7 degrees, and Device preference reset transforms to none on the current reduced-motion device. Inline scripts parse. Touch/coarse behavior and production React cleanup remain implementation-stage checks. The documentation checkpoint is recorded in PROGRESS. This package is a design review, not a deployed feature or proof that honor rules are implemented.

## Approved logo and motion

[Embroidered Erudoza logo](masters/pathfinder-v2/erudoza-logo-patch-v2.png) applies the approved thread treatment to the existing flame-and-Bible mark. The first generated logo had a baked checkerboard; it was rejected and replaced using built-in background extraction. The retained logo has genuine alpha transparency. Its generation and correction prompts are preserved.

The gallery applies smooth pointer-following tilt to honor art only, bounded to 7 degrees with 70ms exponential easing. It returns to rest on exit and defaults to disabling for reduced motion, coarse input, and hidden pages. The gallery alone offers an explicit Motion > Preview tilt override so the requested effect can be inspected even on a reduced-motion device; production uses the device preference. The labels and target layout remain still. The plan specifies a reusable HonorArtwork component with cleanup and browser checks; production motion has not been implemented.

## Recommended next assets

### Public landing and account pages

The [public entry design brief](../../product/2026-09-11-public-entry-design.md) explicitly includes the landing page, sign-in, coach signup, password recovery and coach invitations. Reuse the approved embroidered logo across their shared branding, the refined no-sun landscape on the landing page, and the Coach illustration in an optional desktop account side panel. Keep the phone form compact and readable. These placements need concrete page previews; the logo and patch-family approvals are already recorded. Small-size derivatives and transparent edges must be checked before production integration.

### Additional recognition assets

1. Recreate the session-completion book/laurel emblem as a patch so the recap matches the Honors System.
2. Recreate the existing Team Practice honors in the same family: first-fellowship, rehearsal-complete, shared-scribe, team-precision, and team-steady. Preserve their actual earning rules and finalized-match evidence.
3. Add small season crests for collection headers and completed-season keepsakes once their role and criteria are defined.

Keep navigation icons simple at small sizes and retain the painted landscape style for large illustrations. These next assets are recommendations, not completed new assets or changes to existing match awards.
