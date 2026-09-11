"""Build an app-compatible season pack from the extracted KJV master (no network).

python scripts/build-kjv-pack.py --range DAN:1-12 --range REV:1-22 \
    --pack-key kjv-daniel-revelation --output content/kjv/examples/daniel-revelation.json
python scripts/build-kjv-pack.py --all-books --output content/kjv/import-packs

Ranges accept BOOK:CHAPTER[-CHAPTER] or BOOK:CHAPTER:VERSE[-CHAPTER:VERSE].
Ordinals are retained, so omitted passages never become false verse successors.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

MAX_VERSES = 5000
MAX_BYTES = 1_800_000
FIELDS = ("citation", "bookKey", "chapter", "verse", "ordinal", "text")
ROOT = Path(__file__).resolve().parents[1]


def encode(pack: dict) -> bytes:
    return (json.dumps(pack, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def pack_for(master: dict, documents: list[dict], key: str) -> dict:
    if not key or len(key) > 160:
        raise ValueError("Pack key must contain 1 to 160 characters.")
    return {"packKey": key, "version": master["version"], "locale": master["locale"], "sourceType": "Scripture", "licensingStatus": master["licensingStatus"], "documents": [{"name": d["name"], "units": [{k: u[k] for k in FIELDS} for u in d["units"]]} for d in documents if d["units"]]}


def validate(pack: dict) -> None:
    units = [u for d in pack["documents"] for u in d["units"]]
    if not 1 <= len(units) <= MAX_VERSES:
        raise ValueError(f"Selected {len(units):,} verses; current importer accepts 1 to {MAX_VERSES:,}. Select a smaller season scope.")
    if len(encode(pack)) > MAX_BYTES:
        raise ValueError("Pack exceeds the conservative 1.8 MB import budget. Select fewer chapters.")
    if len({u["ordinal"] for u in units}) != len(units) or len({(u["bookKey"], u["chapter"], u["verse"]) for u in units}) != len(units):
        raise ValueError("Duplicate ordinal or verse reference.")
    for u in units:
        if not (0 < u["ordinal"] <= 100000 and 0 < u["chapter"] <= 200 and 0 < u["verse"] <= 1000 and 0 < len(u["text"]) <= 12000):
            raise ValueError(f"Invalid source unit: {u['citation']}")
        if "\ufffd" in u["text"]:
            raise ValueError(f"Invalid Unicode in {u['citation']}")


def save(path: Path, pack: dict) -> dict:
    validate(pack)
    data = encode(pack)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    units = [u for d in pack["documents"] for u in d["units"]]
    return {"file": path.name, "packKey": pack["packKey"], "version": pack["version"], "verseCount": len(units), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "firstVerse": units[0]["citation"], "lastVerse": units[-1]["citation"]}


def select(master: dict, ranges: list[str], key: str) -> dict:
    selected = set()
    docs_by_key = {d["units"][0]["bookKey"]: d for d in master["documents"]}
    pattern = re.compile(r"^([1-3]?[A-Z]{2,3}):(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?$")
    for spec in ranges:
        match = pattern.fullmatch(spec.upper())
        if not match:
            raise ValueError(f"Invalid range {spec!r}. Use DAN:1-12 or JHN:3:16-3:21.")
        book, first_ch, first_v, last_ch, last_v = match.groups()
        if book not in docs_by_key:
            raise ValueError(f"Unknown book key {book}.")
        if first_v is not None and last_ch is not None and last_v is None:
            raise ValueError("Verse ranges must repeat the end chapter, e.g. JHN:3:16-3:21.")
        if first_v is None and last_v is not None:
            raise ValueError("Use either chapter ranges or explicit verse ranges at both ends.")
        units = docs_by_key[book]["units"]
        counts = {u["chapter"]: u["verse"] for u in units}
        start_ch, end_ch = int(first_ch), int(last_ch or first_ch)
        if start_ch not in counts or end_ch not in counts:
            raise ValueError(f"Chapter does not exist in {spec}.")
        start = (start_ch, int(first_v or 1))
        end = (end_ch, int(last_v or first_v or counts[end_ch]))
        if start > end or start[1] < 1 or start[1] > counts[start_ch] or end[1] < 1 or end[1] > counts[end_ch]:
            raise ValueError(f"Verse range is outside the source: {spec}.")
        selected.update(u["ordinal"] for u in units if start <= (u["chapter"], u["verse"]) <= end)
    docs = [{"name": d["name"], "units": [u for u in d["units"] if u["ordinal"] in selected]} for d in master["documents"]]
    result = pack_for(master, docs, key)
    validate(result)
    return result


def all_books(master: dict, output: Path, source_sha256: str) -> None:
    entries = []
    for book_index, doc in enumerate(master["documents"], 1):
        book_key = doc["units"][0]["bookKey"].lower()
        # Every Bible book is one complete importable pack, including all of Psalms.
        # Fail visibly rather than truncate or silently split a book.
        pack = pack_for(master, [doc], f"kjv-1769-pdf-{book_key}")
        entries.append(save(output / f"{book_index:02d}-{book_key}.json", pack))
    manifest = {"schema": "erudoza-kjv-import-manifest-v1", "sourcePackKey": master["packKey"], "sourceMasterSha256": source_sha256, "packCount": len(entries), "verseCount": sum(e["verseCount"] for e in entries), "maxVersesPerPack": MAX_VERSES, "maxBytesPerPack": MAX_BYTES, "packs": entries}
    output.mkdir(parents=True, exist_ok=True)
    (output / "manifest.json").write_bytes(encode(manifest))
    print(f"Saved {len(entries)} import packs containing {manifest['verseCount']:,} verses.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--master", type=Path, default=ROOT / "content/kjv/kjv-1769.master.json")
    parser.add_argument("--range", action="append", default=[], dest="ranges")
    parser.add_argument("--all-books", action="store_true")
    parser.add_argument("--pack-key", default="kjv-selected-passages")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if bool(args.ranges) == args.all_books:
        parser.error("Choose --all-books or at least one --range.")
    master_bytes = args.master.read_bytes()
    master = json.loads(master_bytes.decode("utf-8"))
    try:
        if args.all_books:
            all_books(master, args.output, hashlib.sha256(master_bytes).hexdigest())
        else:
            info = save(args.output, select(master, args.ranges, args.pack_key))
            print(f"Saved {info['verseCount']:,} verses ({info['bytes']:,} bytes) to {args.output}")
    except ValueError as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
