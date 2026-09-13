import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url)),output='/tmp/erudoza-attire-scale';await mkdir(output,{recursive:true});
const module=await build({stdin:{contents:"export * from './composition'; export * from './hair';",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'iife',globalName:'AttireTools',target:'es2022'});
const browser=await chromium.launch(),page=await browser.newPage();
try{
 await page.goto('http://127.0.0.1:5187/docs/brand/2026-09-13-profile-characters/review.html');await page.addScriptTag({content:module.outputFiles[0].text});
 const result=await page.evaluate(async()=>{
  const art=window.AttireTools,pairs=[],sheets={};
  const bounds=canvas=>{const d=canvas.getContext('2d').getImageData(0,0,1536,1536).data;let top=1536,bottom=0;for(let y=0;y<1536;y++)for(let x=0;x<1536;x++)if(d[(y*1536+x)*4+3]>=240){top=Math.min(top,y);bottom=Math.max(bottom,y);}return {top,bottom,height:bottom-top+1};};
  for(const bodyType of ['male','female']){
   const sheet=document.createElement('canvas');sheet.width=960;sheet.height=2940;const ctx=sheet.getContext('2d');ctx.fillStyle='#f6f4ee';ctx.fillRect(0,0,960,2940);
   for(const [i,style] of art.hairStyles[bodyType].entries()){
    const row=[];
    for(const [col,attire] of ['student','coach'].entries()){
     const c=document.createElement('canvas');await art.renderCharacter(c,{bodyType,style:style.key,hairColor:'brown',skin:'medium',eyes:'brown',attire,background:'sunrise',slots:['solo:exact-recall','solo:chapter-strong',null]},null,'export');row.push(bounds(c));ctx.drawImage(c,col*480,i*490,470,470);ctx.fillStyle='#102e47';ctx.font='16px system-ui';ctx.fillText(`${style.name} · ${attire==='coach'?'Master Guide':'Pathfinder'}`,col*480+16,i*490+485);
    }
    pairs.push({bodyType,style:style.key,student:row[0],coach:row[1],heightDifference:row[1].height-row[0].height,topDifference:row[1].top-row[0].top,bottomDifference:row[1].bottom-row[0].bottom});
   }
   sheets[bodyType]=sheet.toDataURL().split(',')[1];
  }
  return {pairs,sheets};
 });
 const prefix=process.argv.includes('--before')?'before-':'';
 for(const [name,data] of Object.entries(result.sheets))await writeFile(`${output}/${prefix}${name}.png`,Buffer.from(data,'base64'));
 await writeFile(`${output}/${prefix}measurements.json`,JSON.stringify(result.pairs,null,2)+'\n');
 const failures=result.pairs.filter(p=>Math.abs(p.heightDifference)>3||Math.abs(p.topDifference)>2||Math.abs(p.bottomDifference)>2||p.student.top<16||p.coach.top<16);
 if(failures.length)throw new Error(JSON.stringify(failures,null,2));
 console.log(JSON.stringify({matchedAttirePairs:result.pairs.length,maximumHeightDifference:Math.max(...result.pairs.map(p=>Math.abs(p.heightDifference)))},null,2));
}finally{await browser.close();}
