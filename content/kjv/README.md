# KJV source and reusable app packs

**Archive notice:** Erudoza now uses the [built-in NKJV library](../nkjv/README.md). Manual Scripture imports have been retired. The import instructions below document the earlier workflow; these KJV files and validation records remain preserved for history.

The supplied `KJVtext.pdf` has been extracted into **66 books, 1,189 chapters and 31,102 numbered verses**. The original PDF remains at `C:/Users/victo/OneDrive/Documents/KJVtext.pdf`; this directory contains the reusable text and its validation evidence. This is the King James Version, distinct from the previously documented private NKJV source.

## Files to use

| File | Purpose |
| --- | --- |
| [kjv-1769.master.json](kjv-1769.master.json) | Complete Bible archive, including each verse's original PDF page range. Use this to build packs; it exceeds the app's single-import limit. |
| [import-packs/manifest.json](import-packs/manifest.json) | Index and SHA-256 hashes of all 66 app-compatible, whole-book JSON packs. |
| [import-packs/19-psa.json](import-packs/19-psa.json) | All **2,461 verses of Psalms**, ending at Psalms 150:6, in one pack. |
| [examples/daniel-revelation.json](examples/daniel-revelation.json) | Optional combined pack containing all 761 verses of Daniel and Revelation. |
| [validation-report.json](validation-report.json) | Verse counts, source hashes and independent text-comparison results. |
| [extraction-details.json](extraction-details.json) | PDF provenance, separately preserved headings and printer subscriptions, and three audited line-break hyphen repairs. |
| [source-edition-differences.json](source-edition-differences.json) | Evidence for 14 differences between the supplied PDF and the publisher's newer reference edition. |
| [import-verification.json](import-verification.json) | Local native API/D1 import and exact readback evidence; this is not a production deployment receipt. |

Every imported verse retains `bookKey`, `chapter`, `verse`, `citation`, `ordinal` and `text`. Pack metadata includes version, locale, source type and `public-domain` licensing status. Headings, footnotes and printer subscriptions are not mixed into numbered verse text. Italicized supplied words are retained as plain text. Ordinals preserve gaps between books and omitted passages so a "What Comes Next" activity cannot mistake an unrelated verse for a successor.

## Import once and reuse

1. Open **Content packs → Import a pack file (advanced)** at `/admin/content#import-pack`.
2. Paste the contents of a desired whole-book JSON file and import it. Use the manifest to locate other books; do not paste the full master or manifest as an import.
3. Select that stored pack when setting up a season, then choose the book/chapter/verse ranges and assign students. Another season can select the same pack with different ranges without copying its verses.

Matching imports by coaches **within the same organization** reuse the existing pack and source IDs, including simultaneous requests and different proposed pack names. Matching requires the same selected verse references, exact wording, ordinal ordering, version, locale, source type and licensing status. Recognized catalog translations retain separate edition identities, even when a short selected passage has identical wording in two translations. Changed wording under an existing name/version is rejected; use a new version for revisions. Archived or retired content is not silently reactivated. Separate organizations retain their existing data boundary.

Prefer season scopes over new subset packs. The current season model selects one pack: for a season spanning several books, build a combined pack once and reuse it. The combined example is an alternative to a whole-book import for that season; importing overlapping but nonidentical packs will store overlapping verses separately. There is no new per-student or per-season copy of the source text.

Students can open **Read passage** during Practice or Review, navigate by book/chapter/verse, and search assigned text or references such as `Psalms 119:176`. Long chapters are paged, not truncated. The reader respects the season scope and student assignments. Reading before an answer uses the existing study-hint flag; Simulation retains its existing rules.

## Limits and storage

All 66 complete books fit the 5,000-verse per-pack ceiling. The native import endpoint accepts up to 2 MiB; the builder uses a conservative 1,800,000-byte output budget. Oversized selections fail with an error instead of dropping verses. Native source inserts are divided into bounded chunks within one atomic transaction to fit D1's per-value limit.

For the Cloudflare native app, import through its authenticated API so the existing D1 content model can serve activities and the reader. An archive stored in R2 alone would not populate those systems. No cloud resources were created, no production data was imported, and these source JSON files are not automatically included in the web build.

## Rebuild and verify

Run from the repository root. PDF extraction requires `pypdf` and `pdfplumber`; pack building and comparison use the Python standard library.

```powershell
python scripts/extract-kjv-pdf.py "C:/Users/victo/OneDrive/Documents/KJVtext.pdf" --output content/kjv
python scripts/build-kjv-pack.py --all-books --output content/kjv/import-packs
python scripts/build-kjv-pack.py --range DAN:1-12 --range REV:1-22 --pack-key kjv-daniel-revelation --output content/kjv/examples/daniel-revelation.json
python scripts/test-kjv-tools.py
python scripts/validate-kjv-reference.py --reference-zip PATH/eng-kjv2006_vpl.zip
node scripts/verify-kjv-import.ts
```

The native import verifier runs with Node 24 and the repository's installed npm dependencies. It imports all 66 books into an ephemeral local Miniflare/D1 database, checks exact readback and reuse, and refreshes `import-verification.json`. It does not connect to the application's persistent or cloud database.

Ranges accept `BOOK:CHAPTER[-CHAPTER]` or `BOOK:CHAPTER:VERSE[-CHAPTER:VERSE]`, for example `JHN:3:16-3:21`. Overlapping selectors are deduplicated. Invalid references, reversed ranges and oversized selections are rejected. The extractor is tailored to this PDF layout and validates the complete canonical verse inventory before writing the master.

The independent reference is the [publisher's matching KJV edition](https://ebible.org/eng-kjv2006/) and its [verse-per-line archive](https://ebible.org/Scriptures/eng-kjv2006_vpl.zip). It is used only for comparison. The supplied PDF's wording is retained, including the documented edition differences; the validation report records zero unresolved differences. The reference archive and extraction caches remain optional local scratch files, not application dependencies.
