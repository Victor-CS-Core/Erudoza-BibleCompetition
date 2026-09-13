"""Create optimized review images from preserved built-in-generated backgrounds."""
from pathlib import Path
from PIL import Image
import hashlib,json
root=Path(__file__).resolve().parent/'backgrounds';records=[]
for name in ['sunrise','basecamp','starlight']:
    source=root/'sources'/f'{name}.png';image=Image.open(source).convert('RGB')
    assert image.width==image.height
    derivatives=[]
    for width,suffix,quality in [(1024,'',92),(320,'-320',85)]:
        path=root/f'{name}{suffix}.webp'
        image.resize((width,width),Image.Resampling.LANCZOS).save(path,quality=quality,method=6)
        derivatives.append({'path':path.name,'width':width,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    records.append({'name':name,'source':f'sources/{name}.png','dimensions':list(image.size),'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'derivatives':derivatives})
(root/'manifest.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(records,indent=2))
