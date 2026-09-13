# Scripture study implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent persistence task, then review the combined implementation. Track gates in PROGRESS.md.

**Goal:** Ship the user-approved Scripture study preview, verify it locally end to end, merge main, and deploy the existing production Worker.

**Architecture:** The existing shared coach/student library remains the entry point. Account-private notebook entries persist through matching native and canonical APIs. UI components separate text selection/rendering, notebook management, and page navigation; shared primitives and semantic styles retain the existing app shell.

**Tech stack:** React, TanStack Query, TypeScript, Cloudflare Worker/D1 Records, .NET/EF, Vitest, Playwright.

**Spec:** User approved the interactive Scripture study concept in this task and explicitly authorized implementation, local e2e, main integration and production deployment. Scope: phrase/verse highlights in Promises/People/Review, personal notes with editing/deletion, chapter bookmarks, filterable notebook with passage navigation, hide/reveal selected words, readable text size and Focus mode. Preserve full installed catalog, chapter navigation, URL season context and assignment markers. Coach sharing, training integration, custom collections and extra research tools are future work.

## Global constraints

- Account-private saved annotations, never organization-wide or browser-only persistence. Authentication and organization checks apply to every read/write; coach cannot inspect student notebooks.
- Existing Scripture is immutable. Server validates anchors against active built-in sources and derives citation/quote. Offsets use UTF-16, matching JS/.NET string indexing. One selection stays within one verse; entire verse selection is available via its numbered button on keyboard/touch.
- Existing shared UI primitives/tokens, navy header, ivory reader, teal actions, system sans UI and serif Scripture. At 320/390px stack notebook below reading; Focus hides notebook. Books stay available via a collapsed browser after selecting a book.
- Preserve notes during failed requests, retry without silent overwrites, show conflicts and require reloading notebook before retrying. Versioned writes prevent competing tabs from dropping entries.
- No production resets, new credentials, secrets/config changes or fabricated progress. Root owns shared documents, explicit commits/push and release. Retain isolated worktree and ignored QA evidence.

## API contract

Base `/api/v1/organizations/{orgId}/library/notebook`.

```ts
type NotebookKind = 'highlight' | 'note' | 'bookmark';
type HighlightColor = 'Promises' | 'People' | 'Review';
type NotebookEntryInput = {
  kind: NotebookKind; contentPackId: string; chapter: number;
  sourceUnitId: string | null; startOffset: number | null; endOffset: number | null;
  color: HighlightColor | null; note: string | null;
};
type NotebookEntry = NotebookEntryInput & {
  id: string; bookName: string; citation: string; quote: string; updatedAtUtc: string;
};
type StudyNotebook = { version: number; entries: NotebookEntry[] };
// GET base -> StudyNotebook (empty version 0; no writes)
// PUT base/entries/{UUID} body { version: number, entry: NotebookEntryInput } -> StudyNotebook
// DELETE base/entries/{UUID}?version=N -> StudyNotebook
```

Bookmark: source/offsets/color/note null, valid chapter; one bookmark per book/chapter. Notes/highlights: valid nonempty trimmed text selection inside source; note is 1..2000 trimmed characters with color null; highlight has one enum color and note null. Reject source/pack/chapter mismatch, inactive/nonlibrary packs, forged anchors, unknown kind/color, invalid version/ID, null/oversized payload. Cap 200 entries per account with a clear capacity message (editing/deleting still allowed), per-input body cap 16KiB. Same range highlight updates replace the prior color; same chapter bookmark upserts without duplicates. Overlapping highlights may coexist; latest color renders on overlap. User/organization identity always comes from authenticated context. Existing record storage may be reused under a dedicated kind without affecting activity data. Native and canonical backends must match this contract, including 409 conflicts on stale revisions and competing initial writes.

### Task 1: Private notebook persistence (delegated)

**Files:** new native application/notebook.ts and notebook.test.ts, native application.ts routing; canonical application/service/DTO and endpoint files with integration tests, EF changes only if existing scoped JSON records cannot safely be reused.

- [x] Write failing HTTP tests for empty read, create/update/delete/reload, exact canonical quote, nonlibrary/mismatched/out-of-range rejection, notes bounds, stale writes, competing writes, user/organization isolation and no training changes.
- [x] Run and establish missing-route failures, then implement bounded validation and atomic revision writes on both runtimes.
- [x] Run backend covering tests/type checks, self-review and report paths/evidence. Root checkpoints after task review; no independent commit or shared docs edits.

### Task 2: Approved shared reader and notebook

**Files:** src/api/types.ts and client.ts; features/admin/ContentPage.tsx and tests; new components/scripture/StudyReader.tsx, StudyNotebook.tsx, selection.ts and tests; shared tokens/design-system.css; content-library.css composition.

- [x] Run existing ContentPage baseline tests. Add failing behavior tests for verse selection, range offsets and overlap rendering, note save/failure/edit/delete, bookmark toggle, notebook filter/navigation, Focus and recall.
- [x] Add API client using the exact contract above. Key queries by organization/user; only replace cached notebook after successful server responses. On conflicts reload notebook while retaining note draft and permit explicit retry. Disable writes until notebook has loaded and during mutations.
- [x] Implement actual DOM Range selection within one verse and keyboard/touch verse-number selection; render canonical text slices with semantic highlight classes. Selection menu stays outside canonical text; preserve selection on action activation.
- [x] Implement notebook filters, location links, editor, deletion confirmation, empty/error/loading states. Reset selection/recall on chapter change; keep note editor anchored to original passage when navigating. Never print untrusted note HTML.
- [x] Implement responsive approved composition and shared study tokens. Validate component tests, both TS checks, lint and build.

### Task 3: Local acceptance and review

**Files:** e2e/native-scripture-study.spec.ts, playwright.scripture-study.config.ts; docs/audits/2026-09-13-scripture-study.md; PROGRESS.md and DESIGN.md.

- [x] Use local native Miniflare with installed actual NKJV catalog and synthetic users. Exercise real mouse phrase selection, keyboard whole verse selection, touch controls, saving/reloading highlights/notes/bookmarks, editing/deleting, filters/cross-book navigation, recall/Focus/size, failed network save with preserved draft, and independent user data.
- [x] Test coach and student routes at 1440/390/320 and inspect screenshots; verify no horizontal overflow or browser errors. Run canonical integration tests for same persistence flows; native is production release target.
- [x] Run full native/web tests with documented Node26 storage flag, both TS checks, lint, native production build, applicable canonical suite. Request independent branch review; fix important findings and rerun affected checks.
- [x] Update log with evidence/limits, explicitly stage scoped source/docs/tests, commit/push task branch and verify remote SHA.

### Task 4: Authorized integration and production

- [x] Fetch/reconcile latest main, preserve concurrent changes, verify combined tree and normally fast-forward/push main (no force push).
- [x] Inspect production bindings and existing release commands; record previous Worker, migration status, private D1 export and restore integrity check. Native storage uses existing Records so no schema migration is planned.
- [x] Build/dry-run the exact integrated source, deploy with existing wrangler.production.jsonc, verify active version, public health/auth behavior and served artifact hashes. Log authenticated-production acceptance limits honestly; never use real user notebooks for smoke tests.
- [x] Commit/push final release record and report deployed result with local test evidence.
