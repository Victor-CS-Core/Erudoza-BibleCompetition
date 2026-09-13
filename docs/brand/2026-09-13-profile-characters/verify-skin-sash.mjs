// Regression for the washed-out low-bun face and the required on-screen sash direction.
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url)),output='/tmp/erudoza-skin-sash';await mkdir(output,{recursive:true});
const module=await build({stdin:{contents:"export * from './composition'; export * from './hair'; export {skinTones} from './appearance';",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'iife',globalName:'SkinTools',target:'es2022'});
const browser=await chromium.launch(),page=await browser.newPage();
try{
 await page.goto('http://127.0.0.1:5187/docs/brand/2026-09-13-profile-characters/review.html');await page.addScriptTag({content:module.outputFiles[0].text});
 const result=await page.evaluate(async()=>{
  const art=window.SkinTools,failures=[],measurements=[],sheets={};let sashChecks=0;
  for(const bodyType of ['female','male']){
   const sheet=document.createElement('canvas');sheet.width=1050;sheet.height=1980;const sc=sheet.getContext('2d');sc.fillStyle='#f6f4ee';sc.fillRect(0,0,1050,1980);
   for(const [row,style] of art.hairStyles[bodyType].entries()){
    const name=`${bodyType}-${style.key}`,[left,right]=art.headEyes[name],cx=(left[0]+right[0])/2,cy=(left[1]+right[1])/2,unit=(right[0]-left[0])/120;
    const head=await art.loadImage(`heads/${name}.png`),mask=await art.loadImage(`heads/${name}-mask.png`);
    const maskCanvas=document.createElement('canvas');maskCanvas.width=512;maskCanvas.height=512;maskCanvas.getContext('2d').drawImage(mask,0,0);const masks=maskCanvas.getContext('2d').getImageData(0,0,512,512).data;
    for(const [col,tone] of art.skinTones.entries()){
     const config={bodyType,style:style.key,hairColor:'brown',skin:tone.key,eyes:'brown',attire:'student',background:'sunrise',slots:['solo:exact-recall','solo:chapter-strong',null]};
     const c=art.appearanceHead(head,mask,name,tone.key,'brown','brown'),data=c.getContext('2d').getImageData(0,0,512,512).data,samples=[];
     // A broad central forehead region has no eyes, mouth or cheek blush.
     for(let y=Math.round(cy-92*unit);y<cy-55*unit;y++)for(let x=Math.round(cx-30*unit);x<cx+30*unit;x++){
      const i=(y*512+x)*4;if(masks[i]<250||data[i+3]<250)continue;samples.push([data[i],data[i+1],data[i+2]]);
     }
     if(samples.length<400)failures.push(`${name}: insufficient forehead samples`);
     const median=samples.map(rgb=>.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]).sort((a,b)=>a-b)[Math.floor(samples.length/2)];
     const target=.2126*tone.rgb[0]+.7152*tone.rgb[1]+.0722*tone.rgb[2],nearWhite=samples.filter(([r,g,b])=>r>245&&g>230&&b>200).length;
     if(nearWhite)failures.push(`${name} ${tone.key}: ${nearWhite} washed-out forehead pixels`);
     if(Math.abs(median-target)>28)failures.push(`${name} ${tone.key}: forehead luminance ${median.toFixed(1)} drifts from category ${target.toFixed(1)}`);
     measurements.push({name,skin:tone.key,median,nearWhite});
     const portrait=document.createElement('canvas');await art.renderPortrait(portrait,config);sc.drawImage(portrait,col*350+25,row*330,300,300);sc.fillStyle='#102e47';sc.font='16px system-ui';sc.fillText(`${style.name} · ${tone.name}`,col*350+16,row*330+320);
    }
    for(const attire of ['student','coach']){
     const reg=art.registration[art.bodySources[bodyType][attire]];
     if(!(reg.shoulder[0]<512&&reg.hip[0]>512&&reg.shoulder[1]<reg.hip[1]))failures.push(`${name} ${attire}: sash must descend upper-left to lower-right on screen`);
     sashChecks++;
    }
   }
   sheets[bodyType]=sheet.toDataURL().split(',')[1];
  }
  const lowBun=document.createElement('canvas');lowBun.width=1050;lowBun.height=330;const lc=lowBun.getContext('2d');lc.fillStyle='#f6f4ee';lc.fillRect(0,0,1050,330);
  for(const [i,tone] of art.skinTones.entries()){
   const portrait=document.createElement('canvas');await art.renderPortrait(portrait,{bodyType:'female',style:'low-bun',hairColor:'brown',skin:tone.key,eyes:'brown',attire:'coach',background:'sunrise',slots:[null,null,null]});lc.drawImage(portrait,25+i*350,0,300,300);lc.fillStyle='#102e47';lc.font='18px system-ui';lc.fillText(`Low bun · ${tone.name}`,30+i*350,320);
  }
  sheets['low-bun']=lowBun.toDataURL().split(',')[1];
  return {failures,measurements,sashChecks,sheets};
 });
 for(const [name,data] of Object.entries(result.sheets))await writeFile(`${output}/${name}-skin-tones.png`,Buffer.from(data,'base64'));
 const {sheets,...summary}=result;await writeFile(`${output}/checks.json`,JSON.stringify(summary,null,2)+'\n');
 if(result.failures.length)throw new Error(result.failures.join('\n'));
 console.log(JSON.stringify({skinCombinations:result.measurements.length,sashChecks:result.sashChecks,washedOutForeheadPixels:0},null,2));
}finally{await browser.close();}
