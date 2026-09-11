# Approved Team Honor patches — September 11

Status: all five designs, local background removal, integration and production deployment were explicitly approved by the user. The app uses these patches through the shared artwork component, including the collection, earned profile images and historical team milestones.

| Honor | Approved original | Production preparation |
| --- | --- | --- |
| First Fellowship | [Camp fellowship](masters/first-fellowship.png) | Original true alpha retained |
| Team Steady | [Trail and hiking boot](masters/team-steady.png) | [Transparent master](prepared/team-steady.png) |
| Shared Scribe | [Notebook, pencil and knot](masters/shared-scribe.png) | [Transparent master](prepared/shared-scribe.png) |
| Team Precision | [Compass rose](masters/team-precision.png) | [Transparent master](prepared/team-precision.png) |
| Rehearsal Complete | [Bible and checkmark](masters/rehearsal-complete.png) | Original true alpha retained |

The five original 1254px masters and archived review images remain byte-identical. [Prompts](prompts.json) and [source manifest](manifest.json) preserve generation provenance and approval. Built-in transparency retries returned RGB checkerboards; a subsequent built-in attempt failed opening Windows references. The user then explicitly authorized local background cleanup.

[Reproducible preparation](prepare-production.mjs) verifies each original hash before removing only neutral background connected to the outer image edges. A two-pixel transition removes the matte fringe; the enclosed embroidery remains opaque and retains its original RGB. The prepared PNGs preserve framing and dimensions. Independent comparison confirmed all fully opaque pixels match the originals. The three cleaned patches were inspected on navy, ivory and white.

Run from the repository root:

```powershell
node docs/brand/2026-09-11-team-honors/prepare-production.mjs --approved-local-cleanup
```

The [preparation manifest](preparation-manifest.json) records source/prepared hashes and pixel counts. The [production manifest](production-manifest.json) records all ten optimized 256/512px WebPs in `apps/web/public/brand/practice` (763,268 bytes total). All have true alpha. `MasteryHonorArtwork` supplies responsive sources and the shared hover lift/dip and contour shadow, with reduced-motion and touch fallbacks.

Honor keys and mastery rules are unchanged by this asset update. Historical milestones still do not unlock avatars. These are Erudoza Honors, not official Pathfinder certification. Local/live verification and deployment evidence are recorded in [the release audit](../../audits/2026-09-11-approved-team-honors-release.md).
