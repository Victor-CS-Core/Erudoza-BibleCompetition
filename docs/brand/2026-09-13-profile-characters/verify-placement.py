"""Verify every patch circumference plus its fabric margin at source scale."""
from pathlib import Path
import math
import re
from PIL import Image

root = Path(__file__).resolve().parent
source = (root / 'composition.ts').read_text()
centers = [(int(x), int(y)) for x, y in re.findall(r'\[(\d+),(\d+)\]', re.search(r'const centers: Point\[\] = (.*);', source).group(1))]
radius = int(re.search(r'const radius = (\d+)\*matrix.scale', source).group(1))
sash = Image.open(root / 'prepared/sash.png').convert('RGBA')
for x, y in centers:
    for degrees in range(360):
        angle = math.radians(degrees)
        point = (round(x + math.cos(angle) * (radius + 10)), round(y + math.sin(angle) * (radius + 10)))
        assert sash.getpixel(point)[3] >= 240, (x, y, point)
# Every body uses a similarity transform, preserving the verified radius/margin.
for left, right in zip(centers, centers[1:]):
    assert math.dist(left, right) > radius * 2 + 10
print('All three Honor circles have a 10-source-pixel fabric margin and do not overlap.')
