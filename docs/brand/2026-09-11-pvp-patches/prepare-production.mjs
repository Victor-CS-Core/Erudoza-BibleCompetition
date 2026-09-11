import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dir=new URL('./',import.meta.url),dest=new URL('../../../apps/web/public/brand/practice/',dir);
await mkdir(dest,{recursive:true});const sourceManifest=JSON.parse(await readFile(new URL('manifest.json',dir))),output=[];
for(const asset of sourceManifest){const input=await readFile(new URL(asset.master,dir));if(createHash('sha256').update(input).digest('hex')!==asset.sha256)throw new Error('Approved master changed: '+asset.key);
 for(const width of [256,512]){const name=`${asset.key}-${width}.webp`,file=new URL(name,dest);await sharp(input).resize(width).webp({quality:92,alphaQuality:100,effort:6}).toFile(fileURLToPath(file));const bytes=await readFile(file),metadata=await sharp(bytes).metadata();output.push({name,width,height:metadata.height,hasAlpha:metadata.hasAlpha,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),sourceSha256:asset.sha256});}
}
await writeFile(new URL('production-manifest.json',dir),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output));
