# Profile character asset review

## Approved baseline and scope

The user approved `approved-baseline.png` as a good base on September 12, 2026 (local time). The approved direction is 2D artwork with a dimensional anime chibi appearance, with at most three options per customization category. Variations follow baseline approval; their appearance and assembled quality remain subject to review before final product integration.

Required elements:

- Student Pathfinder attire and a coach Master Guide attire option.
- One selected accessory: sash or satchel.
- Three ordered Honor positions. Each position contains an eligible earned Honor or remains empty with a dotted outline.
- Accessory changes preserve the three Honor selections and their order.
- Existing Honor profile images remain available alongside character portraits and initials; the avatar selection is independent of equipped Honors.
- Sharing reproduces the saved character, selected accessory, equipped Honors and dotted empty positions.
- Use the existing Honor artwork and eligibility evidence. The artwork pack does not award Honors or establish official Master Guide certification.

## Proposed first variation set

There are three complete character styles: short curls, side sweep, and curly bob. Each has a student/Pathfinder and a coach/Master Guide sample. These are complete appearance presets for this first review; independent hair, face, and skin controls are not implemented or established by these files. There is one standing pose, one sash and one satchel. No category requires three options merely because three is the ceiling.

| Style | Pathfinder sample | Master Guide sample |
| --- | --- | --- |
| Short curls | [Student](sources/student-curls.png) | [Coach](sources/coach-curls.png) |
| Side sweep | [Student](sources/student-sweep.png) | [Coach](sources/coach-sweep.png) |
| Curly bob | [Student](sources/student-bob.png) | [Coach](sources/coach-bob.png) |

Accessories: [sash](sources/sash.png) and [satchel](sources/satchel.png). Their fronts intentionally have no baked-in spots or patches: the eventual renderer should draw dotted spots for null slots and use existing Honor bitmaps for occupied slots.

## Generation and limitations

All eight sources were generated with the built-in `image_gen` tool using the approved baseline as the reference. `generation.json` retains the full prompts and source provenance. Originals are preserved without modification; `inventory.json` records SHA-256 hashes, dimensions and pixel modes.

**These are review sources, not production cutouts.** Every generated source is RGB: the generator baked a checkerboard into the background despite a request for transparent alpha. Source validation detected this before compositing or app integration. A user question is pending for explicit authorization to use local image processing to remove those backgrounds. No background-removal processing has run.

Accessory registration and scaling need to be checked on all six bodies after transparency is fixed. The coach variations also need review for sufficient adult visual distinction. Do not treat the requested generation coordinates as verified geometry: generated bodies have different bounds.

Next: obtain the processing-method answer, prepare and inspect true-alpha layers if authorized, register accessories and three Honor positions, then show an assembled review using the actual Honor artwork. The full profile UI, independent appearance controls, persistence, avatar propagation, sharing and production deployment remain unimplemented.
