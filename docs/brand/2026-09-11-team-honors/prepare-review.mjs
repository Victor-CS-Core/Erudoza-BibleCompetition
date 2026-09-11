import sharp from 'sharp';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dir=new URL('./',import.meta.url),sources=JSON.parse(await readFile(new URL('sources.json',dir))),manifest=[];
for(const source of sources){const master='masters/'+source.key+'.png',buffer=await readFile(new URL(master,dir)),meta=await sharp(buffer).metadata(),review=source.key+'.webp';await sharp(buffer).resize(512).webp({quality:92,alphaQuality:100,effort:6}).toFile(fileURLToPath(new URL(review,dir)));const preview=await readFile(new URL(review,dir));manifest.push({...source,master,review,width:meta.width,height:meta.height,hasAlpha:meta.hasAlpha,bytes:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex'),reviewBytes:preview.length,reviewSha256:createHash('sha256').update(preview).digest('hex'),status:'pending-user-approval'});}
await writeFile(new URL('manifest.json',dir),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest.map(({key,hasAlpha,bytes})=>({key,hasAlpha,bytes}))));
