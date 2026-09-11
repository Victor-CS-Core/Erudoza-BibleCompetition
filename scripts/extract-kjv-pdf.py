"""Extract the supplied eBible KJV PDF without OCR or generated Bible wording.

Usage: python scripts/extract-kjv-pdf.py SOURCE.pdf --output content/kjv
Requires pdfplumber and pypdf. The PDF is read only; output is UTF-8 JSON.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor
import hashlib
import json
from pathlib import Path
import re

BOOKS = list(zip(
    "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV".split(),
    "Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|1 Samuel|2 Samuel|1 Kings|2 Kings|1 Chronicles|2 Chronicles|Ezra|Nehemiah|Esther|Job|Psalms|Proverbs|Ecclesiastes|Song of Solomon|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|1 Corinthians|2 Corinthians|Galatians|Ephesians|Philippians|Colossians|1 Thessalonians|2 Thessalonians|1 Timothy|2 Timothy|Titus|Philemon|Hebrews|James|1 Peter|2 Peter|1 John|2 John|3 John|Jude|Revelation".split("|"),
))
MARKERS = set("*\u2020\u2021\u00a7\u00b6")
VERSE_PATTERN = re.compile(r"\[V:(\d+)\]")
EXTRACTION_VERSION = 2
DISCRETIONARY_BREAKS = {"LEV:4:22": ("command-ments", "commandments"), "2KI:21:11": ("abomina-tions", "abominations"), "EPH:2:11": ("Uncircumci-sion", "Uncircumcision")}


def join_layout(text: str) -> str:
    return re.sub(r"(?<=\w)-\s+(?=\w)", "-", re.sub(r"\s+", " ", text)).strip()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_pages(job: tuple[str, int, int]) -> list[dict]:
    import pdfplumber
    filename, start, end = job
    result = []
    with pdfplumber.open(filename) as pdf:
        for i in range(start, end):
            page = pdf.pages[i]
            # Horizontal rules separate the apparatus from Scripture on this edition.
            footer = min((line["top"] for line in page.lines if line["x1"] - line["x0"] > 100), default=page.height)
            lines = []
            for line in page.extract_text_lines(x_tolerance=1, y_tolerance=2, return_chars=True):
                if line["top"] < 44 or line["top"] >= footer:
                    continue
                # pdfplumber expands multi-letter ligatures in its text map, and
                # return_chars repeats the same source glyph for each letter.
                # Deduplicate positioned glyphs, never replace word spellings.
                unique = {(c["text"], c["x0"], c["x1"], c["top"], c["fontname"], c["size"]): c for c in line["chars"]}
                chars = sorted(unique.values(), key=lambda c: c["x0"])
                if all(c["size"] > 12 for c in chars):
                    lines.append({"type": "chapter" if line["text"].isdigit() else "title", "text": line["text"]})
                    continue
                # Verse numerals are 6.7248pt; the text (including italic supplied words)
                # is 8.9664pt. Footnotes also use small type, but are below the rule.
                output, previous, number = [], None, ""
                for c in chars:
                    t = c["text"]
                    if c["size"] < 8 and t.isdigit():
                        number += t
                        previous = None
                        continue
                    if number:
                        output.append(" [V:" + number + "] ")
                        number = ""
                    if t in MARKERS:
                        continue
                    if previous is not None and c["x0"] - previous["x1"] > 1:
                        output.append(" ")
                    output.append(t)
                    previous = c
                if number:
                    output.append(" [V:" + number + "] ")
                text = re.sub(r"\s+", " ", "".join(output)).strip()
                if text:
                    lines.append({"type": "text", "text": text, "x0": round(line["x0"], 2), "x1": round(line["x1"], 2), "italic": all("Italic" in c["fontname"] for c in chars)})
            result.append({"page": i + 1, "lines": lines})
            page.close()
    return result


def assemble(pages: list[dict], starts: dict[int, int]) -> tuple[list[dict], list[dict]]:
    documents, headings = [], []
    document, current = None, None
    chapter, verse, ordinal = 1, 0, 0
    subscription = False
    for page in pages:
        page_number = page["page"]
        if page_number in starts:
            book_index = starts[page_number]
            key, name = BOOKS[book_index]
            document = {"name": name, "units": []}
            documents.append(document)
            current, chapter, verse = None, 1, 0
            subscription = False
            # A gap prevents What Comes Next from crossing from one book to another.
            ordinal += 1
        assert document is not None, page_number
        for line in page["lines"]:
            if line["type"] == "title":
                headings.append({"bookKey": key, "chapter": chapter, "page": page_number, "kind": "book-title", "text": line["text"]})
                continue
            if line["type"] == "chapter":
                next_chapter = int(line["text"])
                assert next_chapter == chapter + 1 or (next_chapter == 1 and verse == 0), (key, chapter, next_chapter, page_number)
                chapter, verse, current = next_chapter, 0, None
                continue
            if key == "PSA" and chapter == 119 and re.fullmatch(r"[\u0590-\u05ff]\s*[A-Z]+\.", line["text"]):
                headings.append({"bookKey": key, "chapter": chapter, "beforeVerse": verse + 1, "page": page_number, "kind": "acrostic-heading", "text": line["text"]})
                continue
            # Epistle subscriptions are unnumbered italic notes on the final
            # page of their book. Preserve them separately from the last verse.
            final_book_page = page_number + 1 in starts
            if line.get("italic") and final_book_page and book_index >= 44 and (subscription or "written" in line["text"].lower()):
                subscription = True
                headings.append({"bookKey": key, "chapter": chapter, "page": page_number, "kind": "subscription", "text": line["text"]})
                continue
            parts = VERSE_PATTERN.split(line["text"])
            if parts[0]:
                if current is None:
                    headings.append({"bookKey": key, "chapter": chapter, "page": page_number, "kind": "chapter-heading", "text": parts[0]})
                else:
                    current["text"] += " " + parts[0]
                    current["sourcePages"][1] = page_number
            for index in range(1, len(parts), 2):
                next_verse = int(parts[index])
                assert next_verse == verse + 1, (key, chapter, verse, next_verse, page_number, line["text"])
                verse = next_verse
                ordinal += 1
                current = {"citation": f"{document['name']} {chapter}:{verse}", "bookKey": key, "chapter": chapter, "verse": verse, "ordinal": ordinal, "text": parts[index + 1].strip(), "sourcePages": [page_number, page_number]}
                document["units"].append(current)
    for doc in documents:
        for unit in doc["units"]:
            unit["text"] = join_layout(unit["text"])
            locator = f"{unit['bookKey']}:{unit['chapter']}:{unit['verse']}"
            if locator in DISCRETIONARY_BREAKS:
                before, after = DISCRETIONARY_BREAKS[locator]
                assert before in unit["text"], (locator, "Discretionary break changed; review the source.")
                unit["text"] = unit["text"].replace(before, after)
            assert unit["text"] and "\ufffd" not in unit["text"], unit
    for heading in headings:
        heading["text"] = join_layout(heading["text"])
    return documents, headings


def main() -> None:
    from pypdf import PdfReader
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output", type=Path, default=Path("content/kjv"))
    parser.add_argument("--cache", type=Path, default=Path("tmp/pdfs/kjv/pages-v2.json"))
    parser.add_argument("--workers", type=int, default=3)
    args = parser.parse_args()
    reader = PdfReader(args.pdf)
    book_pages = sorted(reader.get_destination_page_number(dest) + 1 for dest in reader.named_destinations.values())
    starts = {page: index for index, page in enumerate(book_pages)}
    assert len(starts) == 66 and len(reader.pages) == 921, "Unexpected edition/layout; review before extraction."
    source_hash = hashlib.sha256(args.pdf.read_bytes()).hexdigest()
    if args.cache.exists():
        cache = json.loads(args.cache.read_text(encoding="utf-8"))
        assert cache["sha256"] == source_hash, "Cache does not match source PDF."
        assert cache["extractionVersion"] == EXTRACTION_VERSION, "Cache extraction version is stale."
        pages = cache["pages"]
    else:
        pages = []
        jobs = [(str(args.pdf.resolve()), start, min(start + 30, len(reader.pages))) for start in range(4, len(reader.pages), 30)]
        with ProcessPoolExecutor(max_workers=args.workers) as pool:
            for batch in pool.map(read_pages, jobs):
                pages.extend(batch)
                print(f"Extracted PDF pages through {batch[-1]['page']}/{len(reader.pages)}", flush=True)
        write_json(args.cache, {"sha256": source_hash, "extractionVersion": EXTRACTION_VERSION, "pages": pages})
    documents, headings = assemble(pages, starts)
    counts_path = Path(__file__).resolve().parents[1] / "content/kjv/canonical-counts.json"
    expected = json.loads(counts_path.read_text(encoding="utf-8"))["chapterVerseCounts"]
    expected_locators = {(key, int(ch), v) for key, chapters in expected.items() for ch, count in chapters.items() for v in range(1, count + 1)}
    actual_locators = [(u["bookKey"], u["chapter"], u["verse"]) for doc in documents for u in doc["units"]]
    assert len(actual_locators) == len(set(actual_locators)) == 31102 and set(actual_locators) == expected_locators, "Missing, duplicate or unexpected verse references; no corpus written."
    master = {"packKey": "kjv-1769-pdf", "version": 1, "locale": "en", "sourceType": "Scripture", "licensingStatus": "public-domain", "documents": documents}
    write_json(args.output / "kjv-1769.master.json", master)
    write_json(args.output / "extraction-details.json", {"sourceFile": args.pdf.name, "sourceSha256": source_hash, "extractionVersion": EXTRACTION_VERSION, "pdfPages": len(reader.pages), "bookCount": len(documents), "verseCount": sum(len(d["units"]) for d in documents), "discretionaryHyphensRemoved": DISCRETIONARY_BREAKS, "headings": headings})
    print(f"Saved {len(documents)} books; {sum(len(d['units']) for d in documents)} verses.", flush=True)


if __name__ == "__main__":
    main()
