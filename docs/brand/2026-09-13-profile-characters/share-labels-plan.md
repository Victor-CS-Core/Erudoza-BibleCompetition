# Share visibility, landing QR and attire scale

**Goal:** Use Pathfinder as the character's name, independently hide/show the card name and Erudoza branding, optionally include a real public-landing QR at bottom right, and keep the selected person's height stable when changing attire.

**Scope:** Continue the authorized local design review, using existing shared primitives/tokens. Keep account integration and deployment separate. Three visibility switches; the editable example name is explicitly sample data. QR contains only the documented public landing URL, never a preview/localhost URL or private profile identifier.

- [x] Reproduce attire height differences with alpha bounds for every hairstyle and both attires. Inspect the measured neck/sole anchors before changing framing.
- [x] Normalize garment/sash/patch geometry to the selected body's Pathfinder neck and floor reference, using uniform scaling; render the head at the same reference scale for either attire. Preserve source art and headshots. Verify 12 paired silhouettes, 24 collar joins and sash direction/containment.
- [x] Add failing browser checks for the Pathfinder wording, independent visibility switches, live sample name, unchanged decoration/account state, PNG parity and QR decoding from exported day/night cards.
- [x] Generate a reproducible QR matrix for the verified public landing origin, with a four-module quiet zone and error correction. No runtime network image service or production dependency is needed.
- [x] Store the three visibility choices and example name in App so navigation preserves them. Paint names/QR in the same export path as the preview. Keep patches clear of the active QR footer and permit a fully text-free image when all three switches are off.
- [x] Run scoped build/TypeScript, Share and existing rendering/selector/background checks; inspect desktop/phone and matching Pathfinder/Master Guide comparisons. Refresh intentional captures, document evidence and limits, update PROGRESS.md.
- [ ] Explicitly commit/push and verify the task-branch checkpoint.

Implementation is authorized by the user's request and runs inline in the current task branch.
