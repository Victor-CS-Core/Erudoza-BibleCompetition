# Team Practice banner

Replaces the floating header patch at the user's request. The new painterly mountain-lodge study table features two open Bibles, a stopwatch and answer sheets; live accessible heading/copy sits in a quiet navy area. It shares the existing Training HQ landscape's palette and medium. Phone layout crops the study table below the heading.

Generated with the built-in image tool, using `apps/web/public/brand/training-landscape.png` as a style reference. The exact final prompt is in [prompt.txt](prompt.txt). The original generated 2172×724 PNG is copied unchanged to `apps/web/public/brand/team-practice-banner.png`; no local image processing was applied. Original tool output: `exec-a4658790-0b1a-454a-a624-4bac9d2c7164.png`.

Validation: 22 hub tests and a targeted Chromium check passed; the latter checked student and coach hubs at1440/390/320, image loading and no page overflow/errors. Desktop and phone captures were visually inspected. Native build, web/native TypeScript, ESLint and whitespace passed. Existing bundle-size advisory remains. This is a task-branch UI update, not a main merge or deployment.
