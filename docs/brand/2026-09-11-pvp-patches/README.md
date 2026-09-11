# Team Practice patch proposals — September 11, 2026

Status: **new artwork for user review; not applied to the app**. These original assets respond to the request for a more game-like PVP experience while retaining the approved embroidered Pathfinder theme. They preserve the existing Team 1 mountain and Team 2 Bible identities. Erudoza itself remains a text wordmark beside the approved flame-and-Bible patch.

Review the images in the [interactive Team Practice mockup](../../product/mockups/2026-09-11-team-practice.html). All mockup participants, scores and interactions are illustrative. These three emblems represent team identity; they do not create earned Honors or ranks.

| Asset | Intended use | Review image | Preserved master |
| --- | --- | --- | --- |
| Team 1 | Teal mountain shield for roster, scoreboard and match result | [512px WebP](team-a.webp) | [Original PNG](masters/team-a.png) |
| Team 2 | Coral Bible shield for roster, scoreboard and match result | [512px WebP](team-b.webp) | [Original PNG](masters/team-b.png) |
| Team Practice | Paired shields and rope knot for hub identity | [512px WebP](team-practice.webp) | [Original PNG](masters/team-practice.png) |

All three masters are 1254 × 1254 RGBA PNGs with verified transparent pixels outside the embroidery. The tool produced real alpha directly; no background extraction, recoloring or retouching was performed. The 512px WebPs total 354,430 bytes. These are review derivatives; production sizing can be tuned to approved placements later.

## Provenance

- Generated with the built-in `image_gen` tool, one call per asset. Exact prompts: [prompts.json](prompts.json).
- Generated files were copied into this package, leaving originals intact. [manifest.json](manifest.json) records source filenames, dimensions, alpha checks, byte counts and SHA-256 hashes for masters and derivatives.
- [prepare.mjs](prepare.mjs) recreates the resized WebPs from the preserved masters with Sharp (quality 92, alpha quality 100, effort 6). Run from the repository root with `node docs/brand/2026-09-11-pvp-patches/prepare.mjs`.
- The preview applies a smooth pointer-facing lift/dip and soft silhouette shadow to patch artwork only. The pointer target remains stationary; reduced motion and touch rest. Approved implementation should reuse `PatchArtwork` rather than duplicating the preview script.

## Remaining artwork scope

The source-defined Team Honors remain First Fellowship, Team Steady, Shared Scribe, Team Precision and Rehearsal Complete. Their five dedicated patch assets are follow-up implementation work after this core design review. The proposed identity patches must not be substituted for earned award evidence. Existing approved general Honors assets, panorama and page-corner artwork remain unchanged.
