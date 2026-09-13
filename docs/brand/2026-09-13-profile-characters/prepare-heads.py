"""Split the two generated sprite sheets and key their cyan review backgrounds."""
from pathlib import Path
import hashlib,json
import numpy as np
from PIL import Image,ImageFilter
from cutout_edges import clean_edges
root=Path(__file__).resolve().parent
names={'male':['curls','side-part','quiff','buzz','waves','locs'],'female':['curly-bob','straight-bob','ponytail','braids','natural-curls','low-bun']}
manifest=[]
for body,styles in names.items():
 path=root/'hair-sources'/f'{body}-six.png'
 sheet=Image.open(path).convert('RGB');assert sheet.size==(1536,1024)
 for index,name in enumerate(styles):
  cell=sheet.crop(((index%3)*512,(index//3)*512,(index%3+1)*512,(index//3+1)*512))
  rgb=np.array(cell).astype(float)
  cyan=np.minimum(rgb[:,:,1],rgb[:,:,2])-rgb[:,:,0]
  alpha=np.clip((105-cyan)/75,0,1)
  # Recover edge color from nearby opaque foreground, rather than clamping
  # green/blue to red (which created colored fringes on thin strands).
  reliable=(alpha>=.999).astype(float)
  weight=np.array(Image.fromarray((reliable*255).astype('uint8')).filter(ImageFilter.BoxBlur(3))).astype(float)/255
  edge=(alpha>0)&(alpha<1)
  for ch in range(3):
   summed=np.array(Image.fromarray((rgb[:,:,ch]*reliable).astype('uint8')).filter(ImageFilter.BoxBlur(3))).astype(float)
   recovered=summed/np.maximum(weight,.001)
   rgb[:,:,ch][edge]=recovered[edge]
  rgba=np.dstack((rgb,alpha*255)).astype('uint8');rgba[rgba[:,:,3]==0,:3]=0
  out=clean_edges(Image.fromarray(rgba),inset=.65)
  # Isolated wisps can have no opaque neighbor. Remove residual cyan there;
  # this brown-hair source set contains no cyan foreground material.
  clean=np.array(out);spill=(np.minimum(clean[:,:,1].astype(float),clean[:,:,2])-clean[:,:,0]>8)&(clean[:,:,3]>0)
  for channel in (1,2):clean[:,:,channel][spill]=np.minimum(clean[:,:,channel][spill],clean[:,:,0][spill])
  out=Image.fromarray(clean);out.save(root/'heads'/f'{body}-{name}.png')
  out.save(root/'heads'/f'{body}-{name}.webp',quality=94,method=6)
  assert out.getchannel('A').getextrema()==(0,255)
  manifest.append({'body':body,'style':name,'source_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'png_sha256':hashlib.sha256((root/'heads'/f'{body}-{name}.png').read_bytes()).hexdigest(),'transparent_fraction':float((np.array(out.getchannel('A'))==0).mean())})
(root/'heads/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Prepared 12 full-color head layers with real alpha and WebP derivatives.')
