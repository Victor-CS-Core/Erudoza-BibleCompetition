# Approved embroidered Erudoza wordmark

Status: **approved, transparently prepared and integrated on September 11, 2026**. After approving the visual design, the user explicitly approved local background removal when the built-in tool could not produce transparency. The app uses the transparent derivatives through shared `PatchArtwork`, with an accessible text name and the existing responsive header proportions.

The selected concept uses ivory embroidery, navy edging, and a fine gold outer stitch. The spelling and complete letter contours were visually inspected in the original and the 640px preview.

## Files

| File | Dimensions | Format / alpha | Purpose |
| --- | --- | --- | --- |
| [erudoza-wordmark-concept.png](erudoza-wordmark-concept.png) | 2172 × 724 | RGB PNG; **no alpha** | Unmodified generated source on a white background |
| [320px preview](preview/erudoza-wordmark-concept-320.webp) | 320 × 107 | RGB WebP; **no alpha** | Small approval preview, 10,182 bytes |
| [640px preview](preview/erudoza-wordmark-concept-640.webp) | 640 × 213 | RGB WebP; **no alpha** | Large approval preview, 34,768 bytes |
| [Transparent master](erudoza-wordmark-alpha-v1.png) | 2172 × 724 | RGBA PNG | Original canvas, locally extracted alpha |
| [Production 320px](../../../apps/web/public/brand/erudoza-wordmark-320.webp) | 320 × 78 | RGBA WebP | Cropped responsive name, 17,594 bytes |
| [Production 640px](../../../apps/web/public/brand/erudoza-wordmark-640.webp) | 640 × 157 | RGBA WebP | Larger/dense-display name, 51,138 bytes |

The source canvas ratio is 3:1. The opaque review files retain white padding and belong on a white art board. Production derivatives crop to 2114 × 518 around the complete stitched silhouette with eight source pixels of transparent padding; their heights are rounded to whole pixels. Only the production files are used as transparent overlays.

## Provenance and preparation

- Generated with the built-in image-generation tool. The initial creative prompt is preserved in [prompt.txt](prompt.txt).
- Selected source: `exec-26f5d035-fcef-4401-af3a-169f7b547728.png`, generated September 11, 2026.
- The original source remains unmodified. Sharp created the initial downscaled approval previews at quality 90, effort 6; those preview files received no matting or retouching.
- Follow-up built-in transparency requests produced opaque RGB files (a checkerboard depiction and a black background). Their alpha output failed inspection and they were not selected or copied into this package.
- After approval, one further built-in background-extraction attempt (`exec-b30407fb-b1a8-4602-8b86-865288ee7484.png`) again returned RGB with a baked checkerboard, confirmed with Sharp metadata. It was rejected for production. Its exact prompt is preserved in [background-extraction-attempt.txt](background-extraction-attempt.txt).
- The user then explicitly approved local background removal. [prepare-alpha.mjs](prepare-alpha.mjs) verifies the original SHA-256, identifies eight connected paper regions without erasing the pale thread highlights, resolves only the three-pixel antialiased edge against nearby opaque thread, and crops/resizes the production derivatives. WebP quality is 92, alpha quality 100, effort 6. Run the saved script from the repository root with Node and Sharp available.
- The master has genuine alpha: 904,219 transparent pixels, 11,860 partially transparent edge pixels and 656,449 opaque pixels. Every opaque pixel retains its original RGB values, including 16,719 near-white thread pixels. The opaque master source and its visual design remain unchanged. Production files and preparation details are recorded in [alpha-manifest.json](alpha-manifest.json).
- Independent asset/source review and inspection on navy, ivory and white found clean edges and readable lettering at representative header sizes. Rendered app headers and shared motion are verified separately in the integration audit.

## SHA-256

| File | SHA-256 |
| --- | --- |
| `erudoza-wordmark-concept.png` | `94483a6e88593a589fb43493ed487c0055d1c2eb4f27b048ab8b036109ace893` |
| `preview/erudoza-wordmark-concept-320.webp` | `eec1bea52bf4f6769e65aa2fb5a61ec5dadb43b175b829c1b64f02888144db06` |
| `preview/erudoza-wordmark-concept-640.webp` | `675cfa9ec32b5106b7dfb203693844b885975a8aba6941b11d9f785f861d1db3` |
