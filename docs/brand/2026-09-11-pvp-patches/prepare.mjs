import sharp from 'sharp';
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dir=new URL('./',import.meta.url), masters=new URL('masters/',dir);
await mkdir(masters,{recursive:true});
const inputs={
  'team-a':'exec-dbb8f643-2ab8-42b4-8431-cecd91308df1.png',
  'team-b':'exec-6b0d3b7b-6af2-4269-a158-04ca0527f6bd.png',
  'team-practice':'exec-29077ea5-7b17-4042-a01b-da15a715e814.png'
};
const records=[];
for(const [key,generated] of Object.entries(inputs)){
 const master=new URL(key+'.png',masters);
 try{await readFile(master);}catch{await copyFile('C:/Users/victo/.codex/generated_images/01a090eb-acfd-7d80-800c-f4995c65b177/'+generated,master);}
 const bytes=await readFile(master), metadata=await sharp(bytes).metadata();
 if(!metadata.hasAlpha)throw new Error(key+' lacks requested real alpha');
 const preview=new URL(key+'.webp',dir);await sharp(bytes).resize(512).webp({quality:92,alphaQuality:100,effort:6}).toFile(fileURLToPath(preview));
 const derivative=await readFile(preview),raw=await sharp(bytes).ensureAlpha().raw().toBuffer();
 let transparentPixels=0;for(let i=3;i<raw.length;i+=4)if(raw[i]===0)transparentPixels++;
 records.push({key,generated,approval:'proposal; awaiting user review',method:'built-in image_gen; original unchanged; resized WebP only',master:'masters/'+key+'.png',width:metadata.width,height:metadata.height,hasAlpha:metadata.hasAlpha,transparentPixels,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),preview:key+'.webp',previewBytes:derivative.length,previewSha256:createHash('sha256').update(derivative).digest('hex')});
}
await writeFile(new URL('manifest.json',dir),JSON.stringify(records,null,2)+'\n');console.log(JSON.stringify(records));
