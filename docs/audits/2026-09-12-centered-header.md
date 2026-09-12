# Centered header C — September 12

The user selected C from the responsive header previews. Desktop search now fills the entire space between the brand and account, and the redundant All sections button is removed. On phones, the original emblem and text wordmark are centered between a search icon and avatar. Both side controls have 44px targets; search is unboxed and the account chevron is hidden. Coach, Student, focused Study and Team Practice share the layout.

The command center, Ctrl/Cmd+K, mobile More, saved desktop pins, account mode switching, permissions and selected-season navigation retain their existing behavior. Organization and mode remain visible in the account menu. Shared Button styles supply the responsive inverse icon appearance; older conflicting header size caps and phone overrides were removed. No API, database, support-widget behavior or activity scoring changed.

## Local verification

- Before implementation, four browser views reproduced the capped search, unequal gaps, off-center phone branding, boxed mobile search, account chevron and redundant All sections in both roles. Baseline navigation tests passed 33/33 after applying the host's already-documented `NODE_OPTIONS=--no-experimental-webstorage` flag. Without that flag, Node 26's experimental storage shadowed jsdom storage before the tests could run; no application fix was needed.
- Final web/native test suite: **627 passed, one existing optional skip**. Full ESLint, web/native TypeScript and both production builds passed. The existing bundle-size advisory remains.
- The production native bundle passed **90 rendered views** across Chromium, Firefox and WebKit: Coach overview/practice and Student HQ/practice/study, each at 1440, 1024, 761, 760, 390 and 320px. Checks cover full desktop search width, centered phone branding, non-overlapping 44px controls, phone header height, unboxed search, hidden account chevron and no horizontal overflow. Representative desktop and phone captures were inspected.
- **24 menu/keyboard flows** passed across the same three engines and both roles: search/filter/Escape/focus restoration, account/Escape, More/Escape and Ctrl/Cmd+K. An initial production-preview probe sampled More focus before the existing requestAnimationFrame restoration; the harness was corrected to wait for the actual focus state, and the complete final run passed. No production code changed for that harness correction.
- The updated support/command integration test passed **3/3** on the production preview across Chromium, Firefox and WebKit, including command-dialog suspension of the support widget and student exclusion.
- An independent read-only review found no actionable issue and separately reran the 33 navigation tests successfully. Existing canonical command-center tests now include the header geometry assertions; that .NET-backed suite was not run in this task.

These are local results, using browser API fixtures and blocked external resources or the existing local provider contract. They do not establish a deployed release, hosted authentication, live payment behavior or physical-device acceptance. No remote CI result is claimed.

Ignored evidence is under `apps/web/.local/header-centered/` in `.worktrees/header-centered`, including the baseline/final JSON reports and viewport captures. The verified native entry is `index-Chdqamcg.js`, with stylesheet `index-DYpiOBGX.css`. The separate main checkout is unchanged. Next: commit and push the scoped task branch; main integration and production deployment remain separate actions.
