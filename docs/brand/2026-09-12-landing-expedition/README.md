# Expedition landing artwork

September 12, 2026. The user selected [Option A](../../product/mockups/2026-09-12-pathfinder-landing/a-expedition.png), then substituted [this middle section](../../product/mockups/2026-09-12-pathfinder-landing/selected-middle-section.png) from Option B.

The built-in image generation tool reconstructed the hero and coach artwork from A and the flame and mountain sample patches from B. The complete prompts and reference mapping are in [prompts.json](prompts.json). Original generated PNGs are preserved unchanged in masters; [manifest.json](manifest.json) records their hashes and image metadata alongside the optimized outputs. These are reconstructions of the approved compositions, not pixel-identical crops of the concept boards.

Production uses responsive WebP derivatives described in [derivatives.json](derivatives.json). Both new patches retain real alpha. Empty alpha margins were trimmed and the complete patches fitted inside a 95% square with transparent padding for consistent display beside the existing feather patch. No patch artwork was cut off. The hero and coach images retain their full source compositions in the derivatives; responsive CSS controls display cropping.

The third sample image reuses the existing exact-recall WebP assets. The production Erudoza emblem remains the existing approved flame-and-Bible brand asset, with a live text wordmark. The sample flame patch does not replace that logo.

The three patches are decorative examples labeled “Sample artwork.” They do not add earned criteria, unlocks, or official Pathfinder certification. Bible pages in the hero are illustration, with no Scripture text presented as readable content.

See the [implementation audit](../../audits/2026-09-12-pathfinder-landing.md) for checks and scope.
