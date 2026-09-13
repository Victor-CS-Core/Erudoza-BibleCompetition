"""Check the reported chroma-key fringe; artistic edge quality also needs inspection."""
from pathlib import Path
from PIL import Image,ImageFilter
import numpy as np
root=Path(__file__).resolve().parent;count=0;heads=0
for path in (root/'heads').glob('*.png'):
    if '-mask' in path.name:continue
    rgba=np.array(Image.open(path)).astype(float)
    edge=np.array(Image.fromarray(rgba[:,:,3].astype('uint8')).filter(ImageFilter.MinFilter(5)))<250
    spill=edge&(rgba[:,:,3]>16)&(np.minimum(rgba[:,:,1],rgba[:,:,2])-rgba[:,:,0]>20)
    count+=int(np.count_nonzero(spill));heads+=1
assert heads==12
assert count==0,f'{count} cyan-contaminated visible edge pixels remain'
print(f'{heads} head PNGs: no cyan fringe pixels above the reviewed opacity/chroma thresholds.')
