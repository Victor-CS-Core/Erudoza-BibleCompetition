# User-supplied NKJV extraction

Passed: 66 books, 1,189 chapters, 31,102 verses in canonical order. No missing, extra, duplicate, empty, or unassigned verse text. Global ordinal 1 through 31,102.

Source: `New-King-James-Version Bible.pdf` (5,860,647 bytes; 1,815 pages). SHA-256: `980b65ec2b6f0961f4e738129a8da88f497f958578c1a47cdddbe20395e13aa9`. Verse pages 3-1814; front matter and final blank page excluded.

The master and 66 files under `import-packs/` contain only text from the supplied PDF. The old KJV count file was used solely as a structural numbering reference. The source PDF and existing KJV content were not modified. No source or verse text was uploaded.

Two independent extraction engines agreed on all non-whitespace glyphs in all 31,102 verses. The primary character-level parser uses actual PDF space glyphs and avoids the secondary parser's 267 whitespace-only differences around wrapped hyphens and justified words. All PDF body glyphs are accounted for before normalization.

The PDF visibly contains 19 annotation-like digits in 16 verses. The exact before/after text and page evidence are recorded in `annotation-removals.json`; these digits were excluded without inventing or replacing any words or punctuation. The legitimate `666` in Revelation 13:18 remains. Original punctuation/capitalization quirks remain. This is extraction fidelity validation, not independent publisher certification.

Rendered and visually inspected source pages: 3, 544, 846, 1013, 1635, 1814, 1815. No unresolved extraction discrepancies.

`manifest.json` supplies version/source/provenance, per-book and master SHA-256 hashes, `supplied-private` licensing, and `approved-for-this-app` user authorization. It does not label NKJV public domain or authorize external publication.
