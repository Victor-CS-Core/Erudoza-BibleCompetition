"""Prepare this reviewed, neutral-checkerboard source set; not a general remover.

User authorized local image processing in the profile-character conversation.
Requires Pillow and NumPy. Originals are immutable; outputs are reproducible.
"""
from pathlib import Path
import hashlib
import json

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
# Interior background openings that are enclosed by a hand or shoulder strap.
# Seeds only activate where the neutral-background predicate is satisfied.
SEEDS = {
    "student-curls": [(278, 963)],
    "student-sweep": [(290, 953)],
    "student-bob": [(290, 946)],
    "coach-curls": [(261, 1005)],
    "coach-sweep": [(286, 963)],
    "coach-bob": [(284, 970)],
    "satchel": [(400, 780)],
}


def prepare():
    target = ROOT / "prepared"
    target.mkdir(exist_ok=True)
    records = []
    source_inventory = json.loads((ROOT / "inventory.json").read_text())
    for source in source_inventory["sources"]:
        path = ROOT / source["path"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == source["sha256"]
        rgb = Image.open(path).convert("RGB")
        pixels = np.asarray(rgb).astype(np.int16)
        neutral = (pixels.max(axis=2) - pixels.min(axis=2) <= 18) & (pixels.mean(axis=2) >= 90)
        # Flood only the outside and identified openings; preserve eye whites,
        # buckle highlights and other enclosed neutral areas of the subject.
        regions = Image.fromarray(np.where(neutral, 0, 1).astype(np.uint8)).copy()
        for seed in [(0, 0), (rgb.width-1, 0), (0, rgb.height-1), (rgb.width-1, rgb.height-1), *SEEDS.get(path.stem, [])]:
            if regions.getpixel(seed) == 0:
                ImageDraw.floodfill(regions, seed, 2)
        alpha = Image.fromarray(np.where(np.asarray(regions) == 2, 0, 255).astype(np.uint8))
        # One source-pixel inset clears checkerboard antialiasing; a subpixel
        # soft edge avoids a hard cut. This is below one rendered CSS pixel.
        alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(.35))
        output = rgb.convert("RGBA")
        output.putalpha(alpha)
        # Transparent pixels must carry no background RGB into derivatives.
        rgba = np.array(output)
        fraction = float((rgba[:, :, 3] == 0).mean())
        assert .2 < fraction < .95, f"Unexpected transparency fraction for {path.name}: {fraction}"
        rgba[rgba[:, :, 3] == 0, :3] = 0
        output = Image.fromarray(rgba)
        output.save(target / f"{path.stem}.png", optimize=True)
        output.resize((512, 768), Image.Resampling.LANCZOS).save(target / f"{path.stem}-512.webp", quality=90, method=6)
        bbox = alpha.getbbox()
        records.append({"name": path.stem, "sourceSha256": source["sha256"], "alphaBounds": bbox,
                        "transparentFraction": round(fraction, 4),
                        "width": output.width, "height": output.height,
                        "pngSha256": hashlib.sha256((target / f"{path.stem}.png").read_bytes()).hexdigest()})
    (ROOT / "preparation.json").write_text(json.dumps({"method": "neutral-checkerboard-connected-background-v1", "assets": records}, indent=2) + "\n")
    print(json.dumps(records, indent=2))


if __name__ == "__main__":
    prepare()
