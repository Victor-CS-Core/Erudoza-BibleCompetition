"""Exercise selection and complete-book export against the extracted source."""
import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("build_kjv_pack", ROOT / "scripts/build-kjv-pack.py")
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class KjvPackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        master_bytes = (ROOT / "content/kjv/kjv-1769.master.json").read_bytes()
        cls.master = json.loads(master_bytes.decode("utf-8"))
        cls.source_sha256 = hashlib.sha256(master_bytes).hexdigest()

    def test_every_book_exports_whole_with_exact_source_text(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            builder.all_books(self.master, output, self.source_sha256)
            manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual((manifest["packCount"], manifest["verseCount"]), (66, 31102))
            self.assertEqual(manifest["sourceMasterSha256"], self.source_sha256)
            for source_doc, entry in zip(self.master["documents"], manifest["packs"]):
                pack = json.loads((output / entry["file"]).read_text(encoding="utf-8"))
                self.assertEqual(len(pack["documents"]), 1)
                self.assertEqual(pack["documents"][0]["units"], [{k: u[k] for k in builder.FIELDS} for u in source_doc["units"]])
                builder.validate(pack)
            psalms = json.loads((output / "19-psa.json").read_text(encoding="utf-8"))
            self.assertEqual(len(psalms["documents"][0]["units"]), 2461)
            self.assertEqual(psalms["documents"][0]["units"][-1]["citation"], "Psalms 150:6")

    def test_selected_ranges_preserve_gaps_and_deduplicate_overlap(self):
        pack = builder.select(self.master, ["JHN:3:16-3:18", "JHN:3:18-3:19", "JHN:4:1"], "selected")
        units = pack["documents"][0]["units"]
        self.assertEqual([u["citation"] for u in units], ["John 3:16", "John 3:17", "John 3:18", "John 3:19", "John 4:1"])
        self.assertGreater(units[-1]["ordinal"], units[-2]["ordinal"] + 1)
        self.assertEqual(units[1]["ordinal"], units[0]["ordinal"] + 1)

    def test_adjacent_books_cannot_be_false_next_verse(self):
        pack = builder.select(self.master, ["GEN:50:26", "EXO:1:1"], "book-boundary")
        a, b = [d["units"][0] for d in pack["documents"]]
        self.assertGreater(b["ordinal"], a["ordinal"] + 1)

    def test_multi_book_season_includes_every_requested_chapter(self):
        pack = builder.select(self.master, ["DAN:1-12", "REV:1-22"], "kjv-season")
        self.assertEqual([len(d["units"]) for d in pack["documents"]], [357, 404])
        self.assertEqual(pack["licensingStatus"], "public-domain")

    def test_invalid_or_oversized_selection_fails_without_truncation(self):
        for ranges in (["PSA:151"], ["JHN:3:99"], ["JHN:3:21-3:16"], ["JHN:3:16-21"], ["XYZ:1"], ["GEN:1-50", "EXO:1-40", "PSA:1-150"]):
            with self.subTest(ranges=ranges), self.assertRaises(ValueError):
                builder.select(self.master, ranges, "invalid")


if __name__ == "__main__":
    unittest.main()
