# Character refinement — September 13, 2026

The current review corrects off-center head attachment, the line below the head, ear color bleed and overly saturated hair. Profile head-shots now have a transparent background. The original generated source sheets remain unchanged.

[Open the review](review.html?refinement=3) · [Before/after](refinement/before-after.png) · [All neck joins](refinement/neckline-review.png) · [Male palette](refinement/male-palette.png) · [Female palette](refinement/female-palette.png) · [Transparent portrait PNG](refinement/transparent-portrait.png)

## Causes and corrections

| Reported problem | Cause found in the renderer | Correction |
| --- | --- | --- |
| Some heads sit off-center | Placement used the eye midpoint, which differs from the neck center on asymmetric source heads. The ponytail's horizontal difference is about 11 source pixels. | Measure the neck attachment on every head. Keep iris distance for scale, and translate the actual neck attachment to the selected body's neckline. |
| Line underneath the head | A horizontal body cut retained parts of the original hair/neck and left a visible join. | Trace each collar, remove original dark hair remnants, and draw the new neck behind the front garment. Four body/attire layers have individual geometry. |
| Hair color reaches ears | The automatic warm-skin mask missed dark ear shadows and treated them as hair. | Add reviewed ear-protection regions with softened boundaries, protecting the shadows as well as bright skin. |
| Unnatural red/blond highlights | A single RGB multiplier drove highlights toward overly bright, saturated colors. | Map the source luminance through separate shadow, midtone, highlight and glint colors. Normalize each source's reliable hair luminance before mapping. |
| Colored fringe around wisps | Cyan removal alone left contaminated RGB in partly transparent boundary pixels. | Recover boundary color from nearby reliable opaque foreground pixels while retaining the cutout alpha. |
| Background in profile head-shot | The avatar cropped the complete character stage. | Render directly from the head layer onto a clear 320×320 canvas; fit its alpha bounds with padding. No stage, garment, sash or ground shadow is sampled. |

Hair is still dimensional source artwork rendered in 2D. The new color mapping preserves the order of source shading rather than flattening it to one color. Black retains highlights, red uses auburn/copper tones, brown has warm shadows, and blond has darker roots and restrained highlights.

## Techniques researched

These are source-backed techniques adapted to this small Canvas renderer; no Spine or Photoshop runtime dependency was introduced.

- **Attachment coordinates:** Spine's [point attachments](https://esotericsoftware.com/spine-points) provide explicit positions and rotations and can vary by skin. This supports storing measured per-head and per-body attachment coordinates instead of centering every sprite by its image box.
- **Draw order:** Spine's [slots documentation](https://esotericsoftware.com/spine-slots) explains independent attachment ordering. Here, drawing the garment collar in front of the new neck removes the need for a visible horizontal join. Its separate light/dark tint controls also reinforce controlling shadows independently from highlights.
- **Mask refinement and color decontamination:** Adobe's [selection refinement documentation](https://helpx.adobe.com/photoshop-elements/desktop/working-with-selections/making-selections.html) describes feathering, shifting edges and replacing fringe colors with nearby selected colors. Our preparation scripts use source-specific masks, small edge softening and nearby opaque RGB recovery.
- **Color versus shading:** Adobe's [blend-mode documentation](https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/blending-mode-descriptions.html) describes Color blending as retaining luminance while replacing hue/saturation. Our four-stop luminance palette follows the broader principle of separating color from shading; it is not an implementation of Adobe's Color blend mode or exact luminance preservation.
- **Filtered transparent edges:** Spine's [texture-packing documentation](https://eu.esotericsoftware.com/spine-texture-packer) discusses color bleed and alpha handling to avoid filtering artifacts. This informed edge RGB recovery. The review retains ordinary browser image alpha handling; it does not introduce a custom premultiplied-alpha pipeline.

## Verification and limits

The previous checks exercised UI behavior and image loading. They were insufficient to certify alignment and visual color quality. This pass adds checks aimed at the reported defects and enlarged visual inspection.

- **144 appearance combinations:** twelve hairstyles × three skin tones × four hair colors.
- **678,444 ear samples:** exact RGBA equality across hair colors inside the inner 80% of the reviewed ear ellipses. This protects those measured regions; it does not prove every boundary pixel is correctly segmented.
- **144 transparent portraits:** all pixels on all four outer borders have zero alpha. Changing attire, background and Honors also produces byte-identical portrait output in the independence test. The portrait implementation draws only the head layer; normal UI card backgrounds remain part of the interface.
- **24 head/body registrations:** all twelve styles align their measured neck anchor to both attire anchors. This proves coordinate consistency, not the aesthetic quality of every source landmark.
- **Existing UI regression checks:** 96 body/hairstyle/attire/hair-color combinations and 48 page/viewport checks at 1440, 390 and 320 pixels, including selections, preserved Honors, keyboard focus, download, search and missing-image/overflow checks, passed.
- **Sash geometry:** all three Honor circles, with a 10-source-pixel fabric margin, remain inside the sash and do not overlap.
- **Visual review:** inspected 24 enlarged neckline combinations and 48 medium-skin color portraits, the refreshed profile page and a matched female ponytail/Master Guide before/after. Dedicated pixel checks cover other skin tones; every possible appearance combination has not received separate artistic approval.
- Bundle generation, scoped TypeScript and Git whitespace checks passed. Reproduction commands are in [README.md](README.md).

The masks and garment traces are tailored to these source images. New poses or source sheets require new reviewed landmarks and masks. Conservative ear protection may retain original dark strands near an ear; the generated heads also retain subtle face differences. They are head-and-hair swaps rather than identical-face hair-only layers. The source uniform and pose still differ from the user's exact reference.

This remains a local interactive design review awaiting visual approval. It does not save account preferences, enforce coach eligibility, publish profiles or deploy production changes.

## Follow-up: complexion category consistency

The reported low-bun face exposed a separate brightness problem. The original recoloring used one cheek pixel as its exposure reference; that coordinate landed in a shadow in the low-bun source. The central forehead in Medium consequently had luminance 189.7 instead of the category's 132.2, and the Light version contained 1,536 near-white forehead pixels under the documented threshold.

The renderer now samples the median of a broad skin-masked forehead region, avoiding eyes, brows and cheek blush. A bounded highlight curve prevents channel clipping and retains separate Light/Medium/Deep shade families. Head, transparent portrait, live selectors, full character and share-card output use the same mapping; bodies use the same bounded curve. Original head and body PNGs/masks remain unchanged.

[Low-bun categories](refinement/low-bun-skin-tones.png) · [All female categories](refinement/female-skin-tones.png) · [All male categories](refinement/male-skin-tones.png) · [Reported hairstyle in the editor](refinement/low-bun-character.png)

`verify-skin-sash.mjs` first reproduced washed-out pixels/category drift, then passed 36 head/skin combinations with no sampled forehead pixels above R245/G230/B200 simultaneously, and median forehead luminance within 28 of its category. The test covers this measured region, not every skin pixel or universal color accuracy. Enlarged 36-portrait sheets were visually inspected. Existing ear, alpha, hairstyle-selector, neck-registration and UI regression checks were rerun successfully.

The sash is defined in screen coordinates: upper left to lower right. All 24 hairstyle/attire attachment checks retain that direction; the existing correct sash geometry and patch artwork were not mirrored. This orientation description is explicit because anatomical left/right reverses when facing the character.

## Follow-up: attire height and framing

The source bodies used different proportions: male Pathfinder neck-to-sole distance was 872px versus 813px for Master Guide; female Pathfinder was 761px versus 821px for Master Guide. Attire-specific iris distances also slightly changed head scale. The actual rendered male Master Guide was 66–74px shorter and female Master Guide 52–53px taller, depending on hairstyle.

`bodyFrame` in `hair.ts` uses each body's Pathfinder neck and sole as shared references. It uniformly scales and translates the garment, sash and Honors as a group, while the head uses the same reference placement for either attire. Neither the source art nor its aspect ratio is modified. A 32px common top inset keeps the previously clipped quiff inside the square stage; ground shadows follow the normalized boot position.

`verify-attire-scale.mjs` reproduced all twelve mismatches before the correction. The corrected opaque silhouette heights differ by at most one pixel; head tops and boot bottoms remain within two pixels between attires, with at least 16px of headroom. Fresh checks also passed all 24 normalized neck registrations. These bounds exclude the soft ground shadow. All twelve paired silhouettes and 24 enlarged collar joins were inspected; this preserves the approved source uniform differences and does not claim new final artwork approval.

[Male attire comparison](refinement/male-attire-scale.png) · [Female attire comparison](refinement/female-attire-scale.png). QR and text visibility details are documented in [README.md](README.md).
