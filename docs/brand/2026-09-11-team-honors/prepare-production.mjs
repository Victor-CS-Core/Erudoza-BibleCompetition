// Reproduce only after explicit authorization for local background cleanup.
// Original approved masters remain byte-identical; no artwork is redrawn.
import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

assert.ok(process.argv.includes('--approved-local-cleanup'), 'Local cleanup authorization is required');
const directory=new URL('./',import.meta.url);
const destination=new URL('../../../apps/web/public/brand/practice/',directory);
const prepared=new URL('prepared/',directory);
const sha=value=>createHash('sha256').update(value).digest('hex');
await mkdir(prepared,{recursive:true});await mkdir(destination,{recursive:true});
const originals=JSON.parse(await readFile(new URL('manifest.json',directory),'utf8'));
const preparation=[],outputs=[];
for(const asset of originals){
 const source=await readFile(new URL(asset.master,directory));
 assert.equal(sha(source),asset.sha256,'Approved source changed: '+asset.key);
 assert.equal(asset.status,'user-approved');
 let master=source,stats={method:'Original true-alpha master',sourceSha256:asset.sha256};
 if(!asset.hasAlpha){
  const {data,info:{width,height}}=await sharp(source).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const total=width*height,background=new Uint8Array(total),queue=new Int32Array(total);let head=0,tail=0;
  const neighbors=index=>{const x=index%width,y=Math.floor(index/width);return [x?index-1:-1,x<width-1?index+1:-1,y?index-width:-1,y<height-1?index+width:-1];};
  const neutral=index=>{const r=data[index*3],g=data[index*3+1],b=data[index*3+2];return Math.min(r,g,b)>90&&Math.max(r,g,b)-Math.min(r,g,b)<=22;};
  const enqueue=index=>{if(index>=0&&!background[index]&&neutral(index)){background[index]=1;queue[tail++]=index;}};
  for(let x=0;x<width;x++){enqueue(x);enqueue((height-1)*width+x);}
  for(let y=0;y<height;y++){enqueue(y*width);enqueue(y*width+width-1);}
  while(head<tail)for(const next of neighbors(queue[head++]))enqueue(next);
  const removed=tail;
  assert.ok(removed>total*.1&&removed<total*.3,'Unexpected exterior area: '+asset.key);
  const distance=new Uint8Array(total);distance.fill(255);head=0;tail=0;
  for(let i=0;i<total;i++)if(background[i]){distance[i]=0;queue[tail++]=i;}
  while(head<tail){const i=queue[head++];if(distance[i]>=4)continue;for(const next of neighbors(i))if(next>=0&&distance[next]>distance[i]+1){distance[next]=distance[i]+1;queue[tail++]=next;}}
  const rgba=Buffer.alloc(total*4);let opaqueInterior=0,edgePixels=0;
  for(let i=0;i<total;i++){
   if(background[i])continue;
   let alpha=1,backgroundReference=-1,foregroundReference=-1;
   if(distance[i]<3){
    const x=i%width,y=Math.floor(i/width);let foregroundDistance=Infinity,backgroundDistance=Infinity;
    for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++){
     const nx=x+dx,ny=y+dy,d=dx*dx+dy*dy;if(nx<0||nx>=width||ny<0||ny>=height)continue;
     const other=ny*width+nx;
     if(distance[other]>=3&&d<foregroundDistance){foregroundDistance=d;foregroundReference=other;}
     if(background[other]&&d<backgroundDistance){backgroundDistance=d;backgroundReference=other;}
    }
    if(foregroundReference>=0&&backgroundReference>=0){
     let numerator=0,denominator=0;
     for(let channel=0;channel<3;channel++){const bg=data[backgroundReference*3+channel],delta=data[foregroundReference*3+channel]-bg;numerator+=(data[i*3+channel]-bg)*delta;denominator+=delta*delta;}
     alpha=Math.max(0,Math.min(1,numerator/Math.max(1,denominator)));
    }
    edgePixels++;
   }else opaqueInterior++;
   for(let c=0;c<3;c++)rgba[i*4+c]=alpha===1?data[i*3+c]:Math.round(Math.max(0,Math.min(255,(data[i*3+c]-data[backgroundReference*3+c]*(1-alpha))/Math.max(.001,alpha))));
   rgba[i*4+3]=Math.round(alpha*255);
  }
  for(let i=0;i<total;i++)if(distance[i]>=3)for(let c=0;c<3;c++)assert.equal(rgba[i*4+c],data[i*3+c],'Interior RGB changed');
  assert.equal(rgba[(Math.floor(height/2)*width+Math.floor(width/2))*4+3],255,'Patch center was removed');
  master=await sharp(rgba,{raw:{width,height,channels:4}}).png().toBuffer();
  const filename='prepared/'+asset.key+'.png';await writeFile(new URL(filename,directory),master);
  stats={method:'Border-connected neutral exterior removal; two-pixel edge dematting; interior RGB preserved',sourceSha256:asset.sha256,file:filename,sha256:sha(master),width,height,removedExteriorPixels:removed,opaqueInteriorPixels:opaqueInterior,edgePixels,hasAlpha:true};
 }
 preparation.push({key:asset.key,...stats});
 for(const width of [256,512]){
  const name=asset.key+'-'+width+'.webp';
  const bytes=await sharp(master).resize(width).webp({quality:92,alphaQuality:100,effort:6}).toBuffer();
  const metadata=await sharp(bytes).metadata();assert.equal(metadata.hasAlpha,true);assert.equal(metadata.width,width);assert.equal(metadata.height,width);
  await writeFile(new URL(name,destination),bytes);
  outputs.push({name,width,height:metadata.height,hasAlpha:true,bytes:bytes.length,sha256:sha(bytes),sourceSha256:asset.sha256,preparedSha256:sha(master)});
 }
}
await writeFile(new URL('preparation-manifest.json',directory),JSON.stringify(preparation,null,2)+'\n');
await writeFile(new URL('production-manifest.json',directory),JSON.stringify(outputs,null,2)+'\n');
console.log(JSON.stringify({prepared:preparation,outputs,bytes:outputs.reduce((sum,item)=>sum+item.bytes,0)},null,2));
