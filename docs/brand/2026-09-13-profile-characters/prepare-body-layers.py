"""Trace the garment neckline instead of cutting through skin horizontally."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFilter
import numpy as np,json
root=Path(__file__).resolve().parent
# Full-resolution source coordinates follow the collar's inner V. New head
# necks sit behind this garment edge; none of the original head is retained.
curves={
 'student-curls':[[0,620],[380,563],[408,550],[424,529],[440,524],[460,549],[486,571],[510,587],[530,565],[551,544],[570,524],[589,537],[610,549],[648,562],[1024,620]],
 'student-bob':[[0,650],[382,597],[416,581],[432,559],[452,552],[471,574],[493,600],[511,614],[527,592],[550,568],[573,552],[592,569],[607,588],[650,598],[1024,650]],
 'coach-curls':[[0,670],[384,612],[414,597],[433,565],[448,564],[468,594],[491,622],[511,639],[533,609],[551,585],[574,564],[590,580],[612,602],[650,619],[1024,670]],
 'coach-bob':[[0,650],[377,596],[410,577],[429,551],[442,540],[462,570],[488,592],[509,609],[531,581],[551,555],[574,540],[590,563],[609,582],[650,600],[1024,650]],
}
(root/'body-layers').mkdir(exist_ok=True)
for name,line in curves.items():
 source=Image.open(root/'prepared'/f'{name}.png').convert('RGBA')
 mask=Image.new('L',(4096,6144));ImageDraw.Draw(mask).polygon([(x*4,y*4) for x,y in line+[[1024,1536],[0,1536]]],fill=255)
 mask=mask.resize((1024,1536),Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(.4))
 rgba=np.array(source);yy,xx=np.indices((1536,1024))
 # Curly source hair extends below the jaw at the collar corners. Remove
 # these dark remnants; the ivory/yellow garment is outside this range.
 oldHair=(yy<635)&((xx<455)|(xx>566))&(rgba[:,:,0]<115)&(rgba[:,:,1]<90)&(rgba[:,:,2]<72)
 alpha=np.array(source.getchannel('A'),dtype=float)*np.array(mask)/255
 alpha[oldHair]=0
 source.putalpha(Image.fromarray(alpha.astype('uint8')))
 source.save(root/'body-layers'/f'{name}.png');source.resize((512,768),Image.Resampling.LANCZOS).save(root/'body-layers'/f'{name}.webp',quality=95)
(root/'body-layers/necklines.json').write_text(json.dumps(curves,indent=2)+'\n')
print('Prepared four garment layers with traced collar occlusion.')
