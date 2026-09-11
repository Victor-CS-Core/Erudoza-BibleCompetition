# Pathfinder corner artwork proposals

Status: **Awaiting user approval.** This asset is for a standalone visual review; it has not been integrated into application pages or styles.

The review now includes four distinct illustrations with alternating compositions:

| Illustration | Corner | Proposed pages |
|---|---|---|
| Camp essentials | Right | Landing, Training HQ, recap |
| [Trail navigation](trail-navigation-left-v1-960.webp) | Left | Sign-in, Study |
| [Campcraft](campcraft-right-v1-960.webp) | Right | Signup, Progress |
| [Field notes](field-notes-left-v1-960.webp) | Left | Coach overview, Honors |

The [standalone review](../2026-09-11-patch-expansion-review.html) has all four original artboards and a nine-page placement selector. Trail/campcraft prompts and hashes are in [variant metadata](variants-metadata.json); the field-notes prompt and inspection record are [saved separately](field-notes-left-v1-prompt.md). These are new original compositions, not one image mirrored between pages.

The user requested Pathfinder themed page corners with ropes and camping equipment, fading toward the content, and asked to see the new direction before applying it. The separate approved landscape remains available for the proposed wide banner.

## Original asset

- [Original PNG](pathfinder-corner-v1.png): 1254 × 1254. Generated with the built-in `image_gen` tool on September 11, 2026.
- [WebP preview](pathfinder-corner-v1-960.webp): 960 × 960, 99,500 bytes. Resized with Sharp's default Lanczos3 kernel and encoded at WebP quality 86; no retouching or cropping.
- [Exact generation prompt](prompt.json).
- [Dimensions, byte counts and SHA-256 hashes](manifest.json).

The original illustration combines twisted rope and a knot, a brass compass, rolled teal canvas and an unlit lantern. The cluster sits at the lower right, with a generous open ivory field toward the upper left. It complements the approved field guide and patch palette without adding new logos, text or an official Pathfinder emblem. This is opaque artwork with an ivory background, not a transparent cutout.

## Proposed composition

Use this only in the separate approval preview until approved. A lower-right, stationary corner illustration at roughly 560–720px on desktop can sit behind the page canvas at restrained opacity, fading away from content. Keep form fields, tables and panels on solid surfaces. At phone widths, reduce its scale and strength so primary actions remain clear. Do not add image motion to this background; the approved collectible hover treatment belongs to patch artwork.

The existing no-sun landscape has approved 720px and 1440px WebP derivatives under `apps/web/public/assets/training/`. A wide banner should preserve its panoramic composition instead of using a tall side crop. Banner placement and corner visibility remain decisions for the standalone review.

## Validation and limits

The generated source was visually inspected for composition, subject detail, open space and absence of sun/text/logos. Both files decoded successfully with Sharp; their dimensions and hashes are recorded in the manifest. No application code, live page styling, account workflow, database or production deployment changed as part of this proposal.
