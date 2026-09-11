# Honors implementation verification

The approved daily-training concept and Pathfinder patch family are implemented on `codex/honors-public`, isolated from the original checkout in `.worktrees/honors-public`. This is a local implementation gate. No production migration or Honors deployment has occurred.

## Delivered behavior

- Training HQ reads a bounded daily projection, offers a frozen due-review set and daily drill, resumes active sessions, and recovers from changed assignments. Weekly goals support three, four or five days and an explicit IANA calendar; later preference changes take effect at the next boundary of the existing calendar.
- Accepted attempts, mission progress, first day credit, skill evidence and earned Honors commit atomically. A day counts once per student and academy across seasons. Finishing early saves actual effort without claiming a full drill. Ordinary study remains separate from explicit daily mission starts.
- Start intent IDs survive transport retries. Historical sessions remain readable. Completion routes to a persisted recap with the saved season retained in shared navigation. Interleaved sessions display individual accepted-answer provenance when an aggregate before/after pair would be misleading.
- Six Honors use original selected patch artwork: Exact Recall, Reference Ready, Chapter Strong, Review Complete, Steady Study and Full Coverage. Criteria, current progress, earned date and original scope evidence remain HTML. Partial chapter assignments are labeled as assigned scope. Legacy evidence does not manufacture new rewards.
- Passage journey presents stored wording, reference, sequence, recognition and factual recall scores with a compact HQ preview and paginated detail. No gated map, XP currency, fake readiness percentage or punitive streak reset was introduced.
- The approved embroidered brand is shared by public landing, account pages and both authenticated shells. Account availability and authentication state machines are preserved. The Team Practice recognition heading now uses “Team honors”; existing earning rules and persisted identifiers are unchanged.

## Automated checks

| Check | Result and limits |
|---|---|
| `npx vitest run --maxWorkers=2` from `apps/web` | 486 passed, one optional skip, 70 passing files after the final legacy-label correction (115.66 seconds). Includes native and frontend tests. A prior unrestricted run found two obsolete pre-redesign assertions and a five-second legacy Store test timeout while several independent runtimes were active. Assertions were updated to actual saved evidence; bounded worker execution passed the complete suite without changing timeouts or weakening assertions. |
| Final .NET suite | 252 passed, one optional load skip. Includes terminal partial-session recovery, 5,001-verse rejection, chapter-specific immutable award evidence, stale scope, concurrent credit and interleaved contributions. Build passed with zero warnings/errors; scoped `dotnet format --verify-no-changes` passed. Cached restore used `-p:NuGetAudit=false` because the vulnerability endpoint was unreachable; this is not a dependency vulnerability audit. |
| `node --test scripts/cloudflare-export.test.mjs` | Nine passed. All native migrations applied before import. A populated canonical-shaped Honors fixture verifies native resume, repeated start, repeated completion, frozen recap, Today and earned Honors; the complete Records data/revision snapshot stays unchanged. Unearned scope-label wording differs between runtimes; shape and counters agree. This is an explicit fixture comparison, not exhaustive parity for every possible dataset. |
| Native bounded read regression | Full 31,102-verse canon, three assigned verses, saved mission: 22 queries, 654 metered rows read, zero writes with both 100 and 10,000 historical attempts. This is local D1/Miniflare query evidence, not account-wide production quota or regional latency certification. |
| Web and native type checks; ESLint; both production builds | Passed. Standard build used an ignored project-local `XDG_CONFIG_HOME` to avoid writing Wrangler registry data outside the workspace. No deployment ran. |
| Honor presentation | Five shared tests cover recorded fractions, reduced motion/coarse input, bounded pointer rotation, return to rest, preference reset, animation cleanup, pending Escape lock and focus restoration. Browser evidence is recorded below/public entry audit. |

## Independent review and corrections

A fresh backend reviewer identified four P2 defects. Each was reproduced with a failing regression before correction: canonical Today retained terminal partial-session links; canonical scope silently truncated beyond 5,000 verses; canonical Chapter Strong lost its winning chapter subset; native stale-mission suggestions omitted retained due reviews. Re-review accepted all corrections. The native stale-scope regression also proves its GET does not write.

A separate UI reviewer identified three P2 defects: recap navigation dropped selected season, stale 409s offered endless retries, and pending-goal dates were formatted in the browser calendar. Navigation now retains/normalizes the persisted season; conflicts lead to the selected HQ while uncertain network failures retain exact-payload retry; pending activation displays the original training calendar and its timezone. Focused student tests passed after corrections. A final acceptance review found an eighth P2: canonical legacy evidence could be mislabeled as never practiced when its level was Unknown. A failing canonical-shaped UI regression reproduced it; the presentation now prioritizes its recorded legacy algorithm. All six journey tests passed after that correction.

These bounded source reviews are not a penetration test. No high-impact unresolved finding was established by those reviews.

## Visual and browser evidence

Root inspected the actual built UI with an isolated native fixture on ports 8889/8890. Desktop HQ and Honors at 1440px and phone views at 320px had no page overflow. The selected logo, hero and visible Honors loaded; offscreen collection artwork intentionally loads lazily. Honor details show readable criteria, keep the label/focus target stationary, focus Close and fit within the viewport. The public landing was also inspected at 1440/390/320, with sign-in at 320. Browser screenshots from test runners remain ignored test artifacts.

The Impeccable detector returned one mechanical false positive for `<img {...trainingAssets.journey}>`: the real `src` is supplied by the typed asset object, and the built browser loaded that exact WebP successfully. Public/auth sources returned no detector findings. No scanner suppression was added.

Full native browser: six cases passed in 6.5 minutes, including the ten-player, ten-question match and the Honors drill/replay/scope recovery scenario. The [native public/account audit](2026-09-11-public-entry.md) records 55 passing views plus actual pointer, reduced-motion and coarse-touch checks. Full canonical browser: 36 passed and two expected opt-in UI audit skips in 14.5 minutes, across Chromium and Pixel 7. Both complete ten-player matches passed. The new shared scenario covers two full drills, a partial session, repeated start/completion, frozen recap, selected-season navigation, one day credit, deferred goals and changed-assignment recovery. Browser runs used the frozen source before the final legacy-only display correction. Its six focused regressions, type checks, lint and both builds passed afterward; the final full Vitest rerun passed 486 tests with one optional skip. Canonical development logs included stopped-during-negotiation messages and native teardown logged WSARecv #64; both browser commands exited successfully. The original local API on 5080 and production data were untouched.

## Art and approval

The user approved the patch family and logo, then authorized implementation after including public entry pages. Existing approval was retained. Source masters, hashes, generation prompts and selected variants remain in the original asset package. Twenty optimized WebPs total 758,992 bytes; each Honor is below 40 KB, logo below 13 KB and illustration below 140 KB. The Academy completion reference derivatives are unused by product UI; recap uses the approved embroidered logo or genuinely earned Honors. No additional patch artwork was invented or presented as approved.

Coach receives the shared approved brand and existing student-progress improvements. A new Coach HQ layout and aggregate query remain the separately documented recommendation, requiring a concrete Coach mockup before implementation.

## Release boundary

The email task’s already-approved source checkpoint through `b291af4` was fast-forwarded into this branch before the implementation checkpoint. It preserves the activated sender and operational evidence; it did not modify Honors behavior. See [the release procedure](../operations/honors-release.md) for the concrete pending change set, migration order and rollback limits. Commit, push and deployment are separate gates.


Browser artifacts: native report "apps/web/test-results/native-browser-dc9da830-7198-4f4d-917e-76c97d12b9a6.json"; canonical output "apps/web/test-results/e2e-caa069ce-257b-48a4-a56b-71f3768e386d". Final native build uses index-LCOvbLyb.js (SHA-256 8629f0914e07f322b4195e48048b101cc5c7b233c71d6b0b05df506f6a91cf2e) and unchanged index-DmazB_ul.css. All 19 source-master and 20 derivative hashes matched the manifest; scoped text scan found no high-confidence secret patterns. New documentation links resolve; historical PROGRESS links to private ignored production artifacts remain in the main checkout, not this isolated worktree.
