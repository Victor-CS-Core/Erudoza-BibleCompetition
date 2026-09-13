"""Prepare the five approved embroidered sources; run from any directory.

The user authorized local background removal. This source-specific method
isolates the connected saturated patch, fills its interior, and feathers only
the outer edge. It never color-keys the ivory Bible or quill inside the rim.
"""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image, ImageFilter, ImageDraw, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT.parents[2] / 'apps/web/public/brand/simulation'
PUBLIC.mkdir(parents=True, exist_ok=True)
(ROOT / 'masters').mkdir(exist_ok=True)
manifest = []
for source in json.loads((ROOT / 'prompts.json').read_text()):
    path = ROOT / source['source']
    assert hashlib.sha256(path.read_bytes()).hexdigest() == source['sha256']
    original = Image.open(path).convert('RGB')
    rgb = np.asarray(original).astype(np.int16)
    saturated = rgb.max(axis=2) - rgb.min(axis=2) > 40
    # Bridge tiny gaps between outer rim stitches before filling the whole disk.
    silhouette = ndimage.binary_fill_holes(ndimage.binary_closing(saturated, iterations=4))
    labels, _ = ndimage.label(silhouette)
    counts = np.bincount(labels.ravel()); counts[0] = 0
    silhouette = ndimage.binary_fill_holes(labels == counts.argmax())
    assert silhouette.mean() > .70, 'Outer embroidered disk must be complete'
    # A one-pixel inward edge avoids retaining checkerboard-mixed boundary pixels.
    distance = ndimage.distance_transform_edt(silhouette)
    alpha = Image.fromarray(np.uint8(np.clip(distance - 1, 0, 1) * 255)).filter(ImageFilter.GaussianBlur(.45))
    rgba = original.convert('RGBA'); rgba.putalpha(alpha)
    box = alpha.getbbox()
    assert box and min(box[:2]) > 0 and box[2] < original.width and box[3] < original.height
    # Keep complete artwork and equal display breathing room at every size.
    cutout = rgba.crop(box)
    side = max(cutout.size)
    canvas = Image.new('RGBA', (round(side / .9), round(side / .9)))
    canvas.alpha_composite(cutout, ((canvas.width-cutout.width)//2, (canvas.height-cutout.height)//2))
    name = source['id']; master = ROOT / 'masters' / (name + '.png')
    canvas.save(master, optimize=True)
    outputs = []
    for size in (256, 512):
        output = PUBLIC / f'{name}-{size}.webp'
        canvas.resize((size, size), Image.Resampling.LANCZOS).save(output, 'WEBP', quality=92, method=6)
        check = Image.open(output)
        assert check.mode == 'RGBA' and check.getchannel('A').getextrema() == (0, 255)
        assert all(check.getpixel(p)[3] == 0 for p in [(0,0),(size-1,0),(0,size-1),(size-1,size-1)])
        outputs.append({'file': output.name, 'bytes': output.stat().st_size, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()})
    manifest.append({'id':name,'sourceSha256':source['sha256'],'master':str(master.relative_to(ROOT)),'bounds':box,'outputs':outputs})
(ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
sheet = Image.new('RGB', (1500, 670), '#f6f4ee')
draw = ImageDraw.Draw(sheet)
font = ImageFont.load_default(size=22)
for i, item in enumerate(manifest):
    patch = Image.open(PUBLIC / (item['id']+'-256.webp'))
    sheet.paste(patch, (i*300+22, 28), patch)
    draw.text((i*300+150,300),item['id'].replace('-',' ').title(),font=font,fill='#102e47',anchor='mm')
    draw.rectangle((i*300,345,(i+1)*300,670),fill='#102e47')
    sheet.paste(patch,(i*300+22,365),patch)
sheet.save(ROOT / 'collection.png')
print(json.dumps({'patches':len(manifest),'webpBytes':sum(o['bytes'] for a in manifest for o in a['outputs'])}))
