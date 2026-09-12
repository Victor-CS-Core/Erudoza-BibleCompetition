# PBE site copy audit

Applied [Humanizer 3.0.0](https://github.com/blader/humanizer/blob/main/SKILL.md) in embedded editing mode. Reviewed an inventory from 92 frontend source files across public entry, accounts, coach administration, student study/progress, Honors, Team Practice, shared navigation, support, installation and the design-system reference. Also reviewed server-generated training messages and updated matching native/C# wording. Coach-authored questions, imported Scripture, stored discussions and historical evidence were not rewritten.

The copy now names SDA Pathfinder Bible Experience training, uses direct study actions, and removes generic motivational filler. Examples:

| Before | After |
| --- | --- |
| Sample artwork | Illustrations of study patches, not official Pathfinder Honors. |
| Ready for the journey. | Ready for PBE. |
| Own the moment. | Prepare for PBE. |
| Find your rhythm | Weekly practice goal |
| Keep exploring | More practice options |
| Your PBE chapter journey | Your PBE chapter progress |

Preserved routes, Scripture text, scoring, achievement requirements, authentication, styles and assets. The footer's two decorative separator spans were removed with its replaced slogan. Existing test expectations follow the new text; no new copy-only tests were added.

Validation: 535 frontend tests passed across 62 files. A final Team Practice wording adjustment passed its four component tests. Native production build includes web/native TypeScript checks and passed; full ESLint and whitespace passed. The C# Application project built with zero warnings/errors using the retained SDK 10.0.303; the default shell's dotnet had no SDK. Full backend suites and hosted authentication were not rerun for these string-only changes.

Headless Chromium loaded the built landing, sign-in, coach overview, Training HQ and Honors pages at 1440, 390 and 320 pixels. All 15 checks had no page overflow, broken images or page errors. Inspected landing/student phone and coach desktop captures. Authenticated views used local intercepted fixture responses, not production accounts; this does not certify every live state. Temporary inventories, logs and captures remain outside Git. No merge or deployment is included in this task.
