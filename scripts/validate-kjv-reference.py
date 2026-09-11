"""Validate PDF-extracted KJV against the publisher's independently downloaded VPL.

python scripts/validate-kjv-reference.py --reference-zip PATH/eng-kjv2006_vpl.zip

This standard-library-only comparator never changes or supplies corpus wording.
Download the optional reference archive from the URL below; it is not a runtime
dependency and does not need to be committed. A nonzero exit means validation
failed. Every remaining difference is retained in the JSON report.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REFERENCE_URL = "https://ebible.org/Scriptures/eng-kjv2006_vpl.zip"
REFERENCE_DETAILS = "https://ebible.org/find/details.php?all=1&id=eng-kjv2006"
TRANSLATE = str.maketrans({"\u2019": "'", "\u2018": "'", "\u201c": '"', "\u201d": '"', "\u2010": "-", "\u2011": "-", "\u00ad": "", "\u00b6": ""})


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.translate(TRANSLATE)).strip()


def join_heading_lines(lines: list[dict]) -> str:
    text = ""
    for line in lines:
        # Preserve an existing compound hyphen at a physical PDF line boundary.
        # PSA 60 splits Aram-naharaim across two separately retained heading lines.
        separator = "" if text.endswith("-") else " "
        text += separator + line["text"]
    return text.strip()


def load_reference(path: Path) -> tuple[dict, dict, dict]:
    archive_bytes = path.read_bytes()
    with zipfile.ZipFile(path) as archive:
        xml_bytes = archive.read("eng-kjv2006_vpl.xml")
        about = archive.read("eng-kjv2006_about.htm").decode("utf-8-sig")
    verses, counts = {}, {}
    for element in ET.fromstring(xml_bytes):
        book = element.attrib["b"]
        chapter, verse = (int(element.attrib[k]) for k in ("c", "v"))
        key = f"{book}:{chapter}:{verse}"
        if key in verses:
            raise ValueError(f"Duplicate publisher reference: {key}")
        text = "".join(element.itertext()).strip()
        if not text or "\ufffd" in text:
            raise ValueError(f"Invalid publisher text: {key}")
        verses[key] = text
        chapter_counts = counts.setdefault(book, {})
        chapter_counts[str(chapter)] = chapter_counts.get(str(chapter), 0) + 1
        if chapter_counts[str(chapter)] != verse:
            raise ValueError(f"Non-consecutive publisher numbering: {key}")
    dates = re.findall(r"\b\d{4}-\d{2}-\d{2}\b", about)
    metadata = {
        "publisher": "eBible.org / Crosswire Bible Society",
        "editionId": "eng-kjv2006",
        "url": REFERENCE_URL,
        "detailsUrl": REFERENCE_DETAILS,
        "publisherDate": dates[-1] if dates else None,
        "archiveSha256": sha(archive_bytes),
        "xmlEntry": "eng-kjv2006_vpl.xml",
        "xmlSha256": sha(xml_bytes),
        "use": "Independent comparison only; no reference text substituted into extraction.",
    }
    return verses, counts, metadata


def compare(master_path: Path, reference_zip: Path, evidence_path: Path) -> dict:
    reference, chapter_counts, reference_metadata = load_reference(reference_zip)
    master_bytes = master_path.read_bytes()
    master = json.loads(master_bytes.decode("utf-8-sig"))
    details_path = master_path.with_name("extraction-details.json")
    details = read_json(details_path)
    evidence = read_json(evidence_path)
    if evidence["sourceSha256"] != details["sourceSha256"]:
        raise ValueError("Edition evidence belongs to a different source PDF.")
    if evidence["referenceArchiveSha256"] != reference_metadata["archiveSha256"]:
        raise ValueError("Publisher archive changed; audit edition differences before accepting new evidence.")
    known_differences = {item["key"]: item for item in evidence["differences"]}
    units = [u for document in master["documents"] for u in document["units"]]
    keys = [f"{u['bookKey']}:{u['chapter']}:{u['verse']}" for u in units]
    actual = dict(zip(keys, units))
    duplicate_keys = [key for key, n in Counter(keys).items() if n > 1]
    duplicate_ordinals = [key for key, n in Counter(u["ordinal"] for u in units).items() if n > 1]
    missing = [key for key in reference if key not in actual]
    extra = [key for key in actual if key not in reference]
    actual_counts = {}
    for unit in units:
        counts = actual_counts.setdefault(unit["bookKey"], {})
        chapter = str(unit["chapter"])
        counts[chapter] = counts.get(chapter, 0) + 1
    invalid_unicode = [key for key, u in actual.items() if "\ufffd" in u["text"]]
    exact, normalized, no_whitespace = 0, 0, 0
    superscriptions, edition_differences, unresolved = [], [], []
    for key, expected in reference.items():
        if key not in actual:
            continue
        unit = actual[key]
        text = unit["text"]
        a, b = normalize(text), normalize(expected)
        exact += text == expected
        no_whitespace += re.sub(r"\s+", "", a) == re.sub(r"\s+", "", b)
        if a == b:
            normalized += 1
            continue
        book, chapter, verse = key.split(":")
        lines = [h for h in details["headings"] if h["bookKey"] == book and h["chapter"] == int(chapter) and h["kind"] == "chapter-heading"]
        heading = join_heading_lines(lines)
        if book == "PSA" and verse == "1" and heading and normalize(heading + " " + text) == b:
            superscriptions.append({"key": key, "sourcePages": sorted({line["page"] for line in lines}), "headingLineCount": len(lines), "joinedHeadingSha256": sha(heading.encode("utf-8"))})
            continue
        item = known_differences.get(key)
        if item and item["sourceForm"] in a and a.replace(item["sourceForm"], item["publisherVplForm"]) == b:
            edition_differences.append({"key": key, "sourcePages": unit["sourcePages"], "sourceForm": item["sourceForm"], "publisherVplForm": item["publisherVplForm"], "extractedText": text, "publisherText": expected})
            continue
        unresolved.append({"key": key, "sourcePages": unit["sourcePages"], "extractedText": text, "publisherText": expected})
    count_matches = actual_counts == chapter_counts
    order_matches = keys == list(reference)
    valid = not (missing or extra or duplicate_keys or duplicate_ordinals or invalid_unicode or unresolved) and count_matches and order_matches
    return {
        "schema": "erudoza-kjv-validation-v1",
        "status": "passed" if valid else "failed",
        "source": {"file": details["sourceFile"], "sha256": details["sourceSha256"], "pdfPages": details["pdfPages"], "extractionVersion": details["extractionVersion"]},
        "master": {"file": master_path.name, "sha256": sha(master_bytes)},
        "extractionDetails": {"file": details_path.name, "sha256": sha(details_path.read_bytes())},
        "reference": reference_metadata,
        "summary": {"books": len(chapter_counts), "chapters": sum(len(c) for c in chapter_counts.values()), "referenceVerses": len(reference), "extractedVerses": len(units), "exactTextMatches": exact, "normalizedTextMatches": normalized, "noWhitespaceTextMatches": no_whitespace, "separatePsalmSuperscriptions": len(superscriptions), "documentedSourceEditionDifferences": len(edition_differences), "verifiedVerses": normalized + len(superscriptions) + len(edition_differences), "unresolvedDifferences": len(unresolved), "chapterCountsMatch": count_matches, "canonicalVerseOrderMatches": order_matches},
        "normalization": ["Collapse whitespace", "Normalize curly quotes to straight quotes", "Normalize U+2010 and U+2011 hyphens", "Remove soft hyphen and paragraph marker U+00B6"],
        "chapterVerseCounts": chapter_counts,
        "psalmHeadingHandling": {"rule": "For comparison only, prepend the independently extracted chapter heading to Psalm verse 1. Join physical heading lines with spaces, except immediately after an existing compound hyphen. Keep the import verse text and heading metadata separate.", "metadataFile": details_path.name, "verifiedReferences": superscriptions},
        "sourceEditionDifferences": {"rule": "Retain source PDF forms. Accept only each explicitly audited reference and exact source-to-publisher form difference; preserve full differences below.", "evidenceFile": evidence_path.name, "evidenceSha256": sha(evidence_path.read_bytes()), "differences": edition_differences},
        "sourceLayoutCorrections": {"ligatures": "Deduplicated repeated references to the same PDF glyph before assembling text.", "discretionaryHyphensRemoved": details["discretionaryHyphensRemoved"], "otherHeadingCounts": dict(Counter(h["kind"] for h in details["headings"]))},
        "missingReferences": missing,
        "extraReferences": extra,
        "duplicateReferences": duplicate_keys,
        "duplicateOrdinals": duplicate_ordinals,
        "invalidUnicodeReferences": invalid_unicode,
        "unresolvedDifferences": unresolved,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-zip", type=Path, required=True)
    parser.add_argument("--master", type=Path, default=ROOT / "content/kjv/kjv-1769.master.json")
    parser.add_argument("--evidence", type=Path, default=ROOT / "content/kjv/source-edition-differences.json")
    parser.add_argument("--output", type=Path, default=ROOT / "content/kjv/validation-report.json")
    args = parser.parse_args()
    try:
        report = compare(args.master, args.reference_zip, args.evidence)
    except (ValueError, KeyError, OSError, zipfile.BadZipFile) as error:
        parser.error(str(error))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], **report["summary"]}, indent=2))
    if report["status"] != "passed":
        sys.exit(1)


if __name__ == "__main__":
    main()
