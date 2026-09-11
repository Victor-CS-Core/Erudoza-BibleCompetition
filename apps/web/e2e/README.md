# Real API browser tests

Run from `apps/web` with `npm run test:e2e` (or from the root with `npm run test:e2e --workspace apps/web`). In PowerShell, pass Playwright filters directly: `node ../../node_modules/@playwright/test/cli.js test --project=chromium`.

Playwright starts both required services and refuses to reuse occupied ports:
- API: `node ./scripts/e2e-api.mjs`, port 5083. Builds using a copy of the repository SDK pin from a fresh temporary directory with `dotnet build <project> --artifacts-path <unique path>`; creates a fresh SQLite database there. Development seeding is explicitly enabled and debug answers are disabled.
- Web: `node ./scripts/e2e-web.mjs`, port 5183. Uses the actual Worker and frontend with a fresh temporary Wrangler configuration pointing exclusively to 5083. It never reads or changes the developer's `.dev.vars` and has no development API proxy fallback.

Every invocation generates a random password shared only by its seeded test accounts and test workers. A mistaken route to an existing API therefore fails sign-in before any application mutation. Existing development accounts cannot satisfy that guard. Login throttling has an explicit test-only allowance of 1000; API integration tests cover the production limit separately.

Artifacts use a unique subdirectory of `test-results`, avoiding cleanup of other local files or running server binaries. Temporary API databases/builds are retained for diagnostic inspection. Desktop Chrome and Pixel 7 projects run serially. Authenticated journeys use real HTTP requests, native confirmation dialogs, and the installed NKJV Daniel text to solve the actual activity displayed. No debug answer is used; the card response is checked for answer leakage.

`command-center.spec.ts` covers coach and student search navigation, keyboard focus, nested season actions, shortcut persistence after reload, role separation after account switching, and responsive page overflow. It saves desktop/mobile screenshots in each run's output directory. Account sign-out is reached through the shared Account menu in the browser helpers.

For a populated page audit, set `ERUDOZA_UI_AUDIT=1` and run `playwright test ui-audit`. This opt-in suite creates an isolated active season, a real student assignment, a recorded attempt, and a published practice bank. It captures coach setup/management, student study modes/progress, and practice/lobby screens, plus public pages and the design reference. The mobile project checks every captured route at 320, 390, and 430 pixels; screenshots use 390 pixels. Desktop captures use 1440 pixels. The attached `route-coverage` JSON labels each state so an unavailable review or empty-history screen is not mistaken for a populated activity. Long live-match behavior is covered by `practice.spec.ts` separately.

Set `ERUDOZA_UI_AUDIT_FOCUS=assignments` as well for the focused assignment overflow check. Library metadata and all application writes use the isolated real API; the login helper does not mock catalog data. Native-only specs use `playwright.native.config.ts` and are excluded from this .NET configuration.

`built-in-library.spec.ts` checks all 66 books, read-only library controls, keyboard preview, actual Ephesians/Jude chapter and verse bounds, dependent selection resets, persisted multi-book season scopes and student assignments, and student reading at 1440, 390 and 320 pixels. Run against native with `npx playwright test --config=playwright.native.config.ts built-in-library.spec.ts`. `native-scripture-reader.spec.ts` uses built-in NKJV Psalm 119 to verify pagination/search and preservation of an activity answer in progress.
