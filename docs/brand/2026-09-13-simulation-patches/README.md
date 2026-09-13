# Simulation achievement patches

Five new embroidered app achievements, using the existing navy/gold patch family with a teal inner rim. The original PVP and Scripture artwork is unchanged. These are Erudoza practice achievements, not official Pathfinder certification.

| Key | Motif | Eligibility |
| --- | --- | --- |
| first-rehearsal | Bible and sunrise | Complete one simulation. |
| event-ready | Bible and stopwatch | Complete a standard90-question FullEvent simulation. |
| steady-team | Connected trail markers | Complete five simulations on at least three UTC dates. |
| trusted-scribe | Quill and answer sheet | Explicitly submit30 distinct questions across completed simulations. |
| team-precision | Compass and Bible | At least30 distinct questions at90% aggregate finalized accuracy. |

## Provenance and preparation

Built-in image generation created five original RGB PNGs. `prompts.json` preserves exact prompts, source-relative paths and SHA-256 hashes. All originals contained baked checkerboards. The user explicitly authorized local image processing to remove them and export transparent assets.

Run `prepare.py` with Python, Pillow, NumPy and SciPy. The verified environment used Pillow12.3.0, NumPy2.5.3, SciPy1.18.1. The script verifies original hashes, closes small gaps in saturated rim stitches, isolates/fills the complete outer disk, feathers its inward boundary, and adds equal transparent margin. It preserves enclosed ivory details rather than treating them as background. This process is tailored to these five sources; it is not a general background-removal algorithm.

`masters/` contains RGBA PNG masters. Public256/512 WebP derivatives live in `apps/web/public/brand/simulation/` relative to the repository root. `manifest.json` records hashes, bounds and byte sizes. `collection.png` shows each final patch on ivory and navy. All ten WebPs have true alpha with transparent corners and opaque interiors; all five complete disks were visually inspected on both surfaces. An initial segmentation that selected disconnected motifs was rejected and corrected before publishing these outputs.

Use shared `PatchArtwork`/`MasteryHonorArtwork` with keys prefixed `simulation:`. Locked previews use the existing muted appearance. Eligibility and current profile selection are server-verified; art availability does not grant an achievement.
