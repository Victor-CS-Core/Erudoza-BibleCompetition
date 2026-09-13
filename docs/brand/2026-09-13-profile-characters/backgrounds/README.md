# Pathfinder character environments

The user approved three environments matching Erudoza's navy, teal, sage, ivory and gold palette. These replace the three gradient choices in the local editor. They are 2D images with dimensional illustrated scenery, not a 3D scene or animation.

| Choice | Artwork | Composition |
| --- | --- | --- |
| Mountain Sunrise | [Source](sources/sunrise.png) | Alpine lake, distant mountains, pine framing and a warm stone overlook. Default selection. |
| Woodland Basecamp | [Source](sources/basecamp.png) | Pine clearing, distant trail, canvas tent and lantern at the edge. |
| Starlight Camp | [Source](sources/starlight.png) | Navy twilight, sparse stars, tent and lantern, with a warm open foreground. |

[Character comparisons](scene-lineup.png) · [Dark-edge review](dark-edge-review.png) · [Starlight export](starlight-export.png)

## Sources and integration

Each scene was created with one built-in `image_gen` call. Complete prompts and original generated paths are in [generation.json](generation.json). Each source is 1254×1254 pixels; [manifest.json](manifest.json) records original hashes and derivative sizes/hashes. Original generated images and prior character sources remain unchanged.

`prepare-backgrounds.py` makes 1024px WebPs for the character stage (about 212–281 KB each) and 320px thumbnails (about 19–27 KB each). The chosen scene is loaded before committing the next complete character render. The ready/busy state is tied to that exact configuration, including while an uncached image loads. Downloads use the original scene PNG and centered cover fitting in the existing 1200×1600 share card. The night card uses ivory text for legibility.

## Character edges

A solid navy inspection exposed residual cyan around thin hair that the ivory studio preview obscured. The old skin/hair mask also multiplied hair membership by opacity, causing partially transparent hair pixels to retain some original source color before Canvas applied alpha again.

The correction separates material membership from opacity, recovers boundary RGB from reliable interior pixels, applies a fractional matte inset, and suppresses residual cyan in unsupported isolated wisps. The same interior-color recovery is applied to the four active body sources and sash. No stroke, glow, or shadow around the character silhouette is introduced. A soft floor contact shadow is positioned at the measured boot bottoms for each body and scales with the character in downloads.

`verify-cutout-edges.py` found 2,039 cyan-contaminated edge pixels before cleanup and zero after across the twelve head PNGs, using alpha >16 and excess cyan >20 in a two-pixel boundary band. This is a targeted color-fringe check, not proof that every antialiased boundary pixel is artistically perfect. Native hair highlights and fabric seams remain part of the source illustration.

## Review evidence

- Inspected all three scenes with both body types and both attires: 12 complete compositions. Inspected all twelve hairstyles in black and blond on navy, plus the Starlight download and desktop/mobile editor captures.
- The background browser check verifies three choices, 12 scene/body/attire combinations, unchanged character/Honor selections and portrait thumbnails across background changes, three PNG downloads and 1440/390/320 layouts.
- The existing portrait, ear protection, neck registration, selector color and sash-placement checks remain relevant; commands and current results are in the parent README and repository progress log.

Profile head-shots and hairstyle thumbnails remain transparent. Backgrounds affect full-character previews and shared images only. This is still local design review, with no production profile persistence or deployment.
