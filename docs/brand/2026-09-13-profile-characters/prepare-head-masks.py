"""Build source-specific skin/hair selection masks from the neutral brown heads."""
from pathlib import Path
import re,json
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
root=Path(__file__).resolve().parent
source=(root/'hair.ts').read_text()
landmarks=json.loads((root/'head-landmarks.json').read_text())
items=re.findall(r"'((?:male|female)-[^']+)':\[\[(\d+),(\d+),\d+,\d+\],\[(\d+),(\d+),",source)
for name,x1,y1,x2,y2 in items:
 im=Image.open(root/'heads'/f'{name}.png').convert('RGBA');rgb=np.array(im).astype(float);r,g,b=rgb[:,:,0],rgb[:,:,1],rgb[:,:,2]
 candidate=(r>105)&(r-g>32)&(g-b>12)&(rgb[:,:,3]>0)
 mask=Image.fromarray(np.uint8(candidate)*255).copy()
 cx=(int(x1)+int(x2))//2;cy=(int(y1)+int(y2))//2
 for dx,dy in [(-25,40),(25,40),(0,-60),(0,120),(-130,30),(130,30)]:
  x,y=cx+dx,cy+dy
  if 0<=x<512 and 0<=y<512 and mask.getpixel((x,y))==255:ImageDraw.floodfill(mask,(x,y),128)
 skin=Image.fromarray(np.uint8(np.array(mask)==128)*255)
 # Fill enclosed eye/brow/mouth holes to protect those from hair color.
 outside=skin.copy();ImageDraw.floodfill(outside,(0,0),128)
 filled=Image.fromarray(np.uint8(np.array(outside)!=128)*255)
 # Protect the manually reviewed ear extents, including dark inner-ear pixels
 # rejected by the color flood. A narrow inward feather prevents tint spill.
 protection=Image.new('L',(512,512));pen=ImageDraw.Draw(protection)
 for x,y,rx,ry in landmarks[name]['ears']:
  pen.ellipse((x-rx,y-ry,x+rx,y+ry),fill=255)
 filled=Image.fromarray(np.maximum(np.array(filled),np.array(protection)))
 filled=filled.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(.65))
 # Channels encode skin membership and hair membership, no source recoloring.
 sk=np.array(filled).astype(float)/255;alpha=rgb[:,:,3]/255
 result=np.zeros((512,512,3),dtype='uint8');result[:,:,0]=(sk*255).astype('uint8');result[:,:,1]=((1-sk)*alpha*255).astype('uint8')
 Image.fromarray(result).save(root/'heads'/f'{name}-mask.png')
print('Prepared 12 skin/hair region masks.')
