# Scripture library and activities

Coaches choose from the built-in 66-book New King James Version library at `/admin/content`, select one or more books for a season, then assign chapters and verses to students. Missing Words, Verse Builder, Reference Match, What Comes Next, and True/False continue to use the stored text and coach-selected difficulty. No AI setup is required.

The book, chapter, and verse controls derive their options from validated stored content. Changing a parent choice resets invalid dependent choices. Assignments offer only the season's available passages, including its exclusions. The API also rejects nonexistent endpoints and missing intermediate coordinates.

The library is installed once and shared across organizations. Seasons and assignments store references and ranges, so another coach, season, or student does not create another copy of a book. Organization accounts, assignments, discussion, study evidence, and mastery remain private.

Students can use **Read passage** during Practice and Review, with book/chapter/verse navigation and text/reference search. It reads only their effective assigned scope. Long chapters are paged in full. Reading before checking an answer uses the existing hint flag and preserves the draft answer. Simulation retains its existing rules.

Manual and external catalog Scripture import routes return HTTP 410. The UI no longer offers uploads or other translations. Existing private packs, seasons, source IDs, and historical answers remain intact. Older single-pack API requests remain compatible; the new multi-book contract can retain a historical season's existing pack, but new book selections use NKJV.

See the [NKJV source and D1 provisioning guide](../../content/nkjv/README.md) and [.NET installation guide](../../apps/api/NKJV-LIBRARY.md). Installation validates file hashes and content before writing. Conflicting same-version text is rejected. The files stay server-side and are not included in the browser bundle. The earlier [KJV extraction](../../content/kjv/README.md) remains an archive.

Deployment and DNS changes remain paused. All installation and migration validation for this change used isolated local databases.
