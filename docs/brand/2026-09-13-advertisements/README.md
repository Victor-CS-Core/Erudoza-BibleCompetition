# Erudoza advertisement materials

Revised September 13, 2026 after the user requested smaller titles, advertising research and working QR codes. Open [the gallery](index.html) to review all five final PNGs. These are marketing deliverables, not application changes or published campaigns.

| File | Intended use |
| --- | --- |
| [PBE training](exports/01-pbe-training.png) | General awareness social post |
| [PBE training with QR](exports/01-pbe-training-qr.png) | Club flyer or shared display |
| [Coach your team](exports/02-coach-your-team.png) | Coach recruitment social post |
| [Coach your team with QR](exports/02-coach-your-team-qr.png) | Coach handout or shared display |
| [Scripture study](exports/03-scripture-study.png) | Personal study feature social post |

All final images are 1080 × 1350 (4:5). Headlines are 48px, body text 28px, and the brand is 36px. Text and original emblem are separate layout elements around the illustration. This preserves exact copy, consistent smaller titles and QR geometry. The generated artwork was edited through built-in image_gen; the final advertisement layout is rendered with Chromium. No application UI or fictional account metrics appear.

## Research and strategy

Sources consulted September 13, 2026:

- [Google: responsive display creative best practices](https://support.google.com/google-ads/answer/9823397?hl=en) recommends clear, simple copy, relevant landing pages, focused images and multiple creative variants. It specifically recommends supplying images without added logos, text or simulated buttons for responsive display assets. This is placement-specific guidance, not a universal prohibition on designed social posts or flyers.
- [Meta Blueprint: mobile campaign creative](https://www.facebookblueprint.com/student/path/211557-creative-mobile-campaigns) emphasizes tailoring creative assets and applying mobile-first practices.
- [DENSO WAVE: determining QR code area](https://www.qrcode.com/en/howto/code.html) specifies a four-module clear margin around standard QR codes.

Our application of that guidance: one benefit per ad, modest titles, one visual focus and one clear action. General awareness introduces PBE preparation; coaches see assignment planning; Scripture study highlights private notes. Use QR versions for print or displays that can be scanned from another device. For phone feeds, use the non-QR versions with a clickable destination in the post or ad. This placement choice is a practical design recommendation, not a measured performance claim.

Test general training versus coaching with comparable adult-coach audiences, placements, budgets and dates. Measure completed club signups as the primary outcome if accurate conversion measurement is available; use landing-page visits and click-through as supporting metrics. Assess Scripture study separately as a feature message. Do not call a winner from a few clicks or change the audience and creative simultaneously. No advertising account was configured and no spend or conversion tracking was initiated.

For responsive Google image assets, use the clean artwork layers with separate platform headline/logo fields, preparing the required crop for the actual placement. Do not upload these complete flyer-style graphics as though they were universally suitable image assets.

## Product evidence and boundaries

Copy is grounded in `apps/web/src/features/marketing/LandingPage.tsx`, current practice setup, and the Scripture-study release audit. Colors come from `apps/web/src/styles/tokens.css`; the approved emblem and mountain artwork follow DESIGN.md. No invented pricing, testimonials, win rates, official certification or new functionality is advertised. The concurrent character-profile release does not affect the features in this campaign.

## QR and validation

Both QR images encode exactly `https://erudoza.com/`. Their source matrix is the repository's existing version-2, error-correction-Q landing QR, rendered with a four-module white quiet zone at 198 × 198 pixels (6 pixels per module including its margin). The reusable vector is [erudoza-qr.svg](erudoza-qr.svg). No generated barcode pixels are used.

`zbarimg --quiet exports/01-pbe-training-qr.png exports/02-coach-your-team-qr.png` decoded both final PNGs to the exact URL. A fresh request to the destination returned HTTP 200. All five exports passed dimension, image-loading, overflow and single-line-headline checks; all three concepts were visually inspected. Physical print/device scanning and actual campaign performance are not established by these checks.

## Reproduction

From the repository root, run `node docs/brand/2026-09-13-advertisements/render.mjs` with the repository's installed Playwright/Chromium. It creates the PNGs, QR SVG, gallery and manifest without modifying application source. [prompts.json](prompts.json) records built-in image_gen provenance; [revision-prompts.json](revision-prompts.json) contains the final artwork edits. The initial large-type generated drafts were rejected and are not final deliverables. Original tool outputs remain in the Codex generated-images directory; the final artwork layers are preserved here.
