# Approved Pathfinder corner artwork

Status: **Approved by the user on September 11, 2026.** The four reviewed illustrations are integrated through the shared `PathfinderBackdrop` component. Production WebP files are byte-identical copies under `apps/web/public/assets/training/corners/`; the masters remain unchanged here.

The review now includes four distinct illustrations with alternating compositions:

| Illustration | Corner | Approved pages |
|---|---|---|
| Camp essentials | Right | Landing, Training HQ, recap |
| [Trail navigation](trail-navigation-left-v1-960.webp) | Left | Sign-in, Study |
| [Campcraft](campcraft-right-v1-960.webp) | Right | Signup, Progress |
| [Field notes](field-notes-left-v1-960.webp) | Left | Coach overview, Honors |

The [standalone review](../2026-09-11-patch-expansion-review.html) has all four original artboards and a nine-page placement selector. Trail/campcraft prompts and hashes are in [variant metadata](variants-metadata.json); the field-notes prompt and inspection record are [saved separately](field-notes-left-v1-prompt.md). These are new original compositions, not one image mirrored between pages.

The user requested Pathfinder themed page corners with ropes and camping equipment, fading toward the content, and approved the complete set after reviewing the alternating page assignments. The separate approved landscape is used as an uncropped wide banner.

## Original asset

- [Original PNG](pathfinder-corner-v1.png): 1254 × 1254. Generated with the built-in `image_gen` tool on September 11, 2026.
- [WebP preview](pathfinder-corner-v1-960.webp): 960 × 960, 99,500 bytes. Resized with Sharp's default Lanczos3 kernel and encoded at WebP quality 86; no retouching or cropping.
- [Exact generation prompt](prompt.json).
- [Dimensions, byte counts and SHA-256 hashes](manifest.json).

The original illustration combines twisted rope and a knot, a brass compass, rolled teal canvas and an unlit lantern. The cluster sits at the lower right, with a generous open ivory field toward the upper left. It complements the approved field guide and patch palette without adding new logos, text or an official Pathfinder emblem. This is opaque artwork with an ivory background, not a transparent cutout.

## Approved composition

The shared layer uses the original left/right compositions at up to 540px on desktop, 30% opacity and a diagonal fade toward content. Phones use a smaller corner at 20% opacity. Keep form fields, tables and panels on solid surfaces and never add page height just for decoration. Do not add image motion to this background; the approved collectible hover treatment belongs to patch artwork.

The existing no-sun landscape has approved 720px and 1440px WebP derivatives under `apps/web/public/assets/training/`. Shared `LandscapeBanner` preserves its complete 3:1 composition above Training HQ/public introduction and beside desktop sign-in.

## Validation and limits

The generated sources were visually inspected for composition, subject detail, open space and absence of sun/text/logos. Dimensions and hashes are recorded in the original manifests. The initial review changed no application code. Integration after approval adds only presentation and decorative route mapping; application/browser evidence is recorded separately. No production deployment is implied by artwork approval.
