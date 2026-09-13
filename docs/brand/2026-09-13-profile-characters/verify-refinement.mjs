// Pixel and registration checks target the visual regressions reported by the user.
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url)),output='/tmp/erudoza-refinement';await mkdir(output,{recursive:true});
const module=await build({stdin:{contents:"export * from './composition'; export * from './hair';",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'iife',globalName:'ReviewTools',target:'es2022'});
const browser=await chromium.launch(),page=await browser.newPage();await page.goto('http://127.0.0.1:5187/docs/brand/2026-09-13-profile-characters/review.html');await page.addScriptTag({content:module.outputFiles[0].text});
const result=await page.evaluate(async()=>{
 const art=window.ReviewTools;let comparisons=0,portraits=0,registrationChecks=0,earSamples=0;
 const assert=(ok,message)=>{if(!ok)throw Error(message);};
 const sheets={};const joins=document.createElement('canvas');joins.width=1800;joins.height=1280;const jc=joins.getContext('2d');jc.fillStyle='#f6f4ee';jc.fillRect(0,0,1800,1280);
 for(const [bodyIndex,bodyType] of ['male','female'].entries()){
  const sheet=document.createElement('canvas');sheet.width=1120;sheet.height=1740;const sc=sheet.getContext('2d');sc.fillStyle='#f6f4ee';sc.fillRect(0,0,sheet.width,sheet.height);sc.fillStyle='#102e47';sc.font='600 24px system-ui';sc.fillText(`${bodyType==='male'?'Male':'Female'} · Hair color and edge review`,20,36);
  for(const [styleIndex,style] of art.hairStyles[bodyType].entries()){
   const name=`${bodyType}-${style.key}`,head=await art.loadImage(`heads/${name}.png`),mask=await art.loadImage(`heads/${name}-mask.png`);
   for(const skin of ['light','medium','deep']){
    let base=null;
    for(const [colorIndex,hairColor] of ['red','black','brown','blond'].entries()){
     const config={bodyType,style:style.key,hairColor,skin,eyes:'brown',attire:'student',background:'sunrise',slots:['solo:exact-recall',null,null]};
     const headCanvas=art.appearanceHead(head,mask,name,skin,'brown',hairColor),pixels=headCanvas.getContext('2d').getImageData(0,0,512,512).data;
     if(!base)base=pixels;
     for(const [cx,cy,rx,ry] of art.headAnchors[name].ears){
      for(let y=Math.ceil(cy-ry*.8);y<=cy+ry*.8;y++)for(let x=Math.ceil(cx-rx*.8);x<=cx+rx*.8;x++){
       if(((x-cx)/(rx*.8))**2+((y-cy)/(ry*.8))**2>=1)continue;
       const i=(y*512+x)*4;if(!pixels[i+3])continue;
       for(let k=0;k<4;k++)assert(pixels[i+k]===base[i+k],`${name} ${skin} ${hairColor}: hair color modified an ear pixel at ${x},${y}`);
       earSamples++;
      }
     }comparisons++;
     const portrait=document.createElement('canvas');await art.renderPortrait(portrait,config);const pd=portrait.getContext('2d').getImageData(0,0,320,320).data;
     for(let n=0;n<320;n++){assert(pd[(n*320)*4+3]===0&&pd[(n*320+319)*4+3]===0&&pd[n*4+3]===0&&pd[((319*320)+n)*4+3]===0,`${name}: portrait background or clipped edge`);}
     portraits++;
     if(skin==='medium'){
      sc.drawImage(portrait,colorIndex*280,styleIndex*275+55,265,245);sc.fillStyle='#102e47';sc.font='16px system-ui';sc.fillText(`${style.name} · ${hairColor}`,colorIndex*280+10,styleIndex*275+317);
     }
    }
   }
   const config={bodyType,style:style.key,hairColor:'brown',skin:'medium',eyes:'brown',background:'sunrise',slots:['solo:exact-recall',null,null]};
   for(const [attireIndex,attire] of ['student','coach'].entries()){
    const body=art.bodySources[bodyType][attire],p=art.headPlacement(name,body),target=art.bodyHeadRegistration[body].neck,anchor=art.headAnchors[name].neck;
    assert(Math.abs(p.x+anchor[0]*p.scale-target[0])<.001&&Math.abs(p.y+anchor[1]*p.scale-target[1])<.001,`${name} ${body} neck registration`);registrationChecks++;
    const c=document.createElement('canvas');await art.renderCharacter(c,{...config,attire},null,'export');
    // Crop precisely around the neckline and face; use ivory behind true alpha.
    const row=bodyIndex*2+attireIndex;jc.drawImage(c,530,210,480,500,styleIndex*300,row*320,290,290);jc.fillStyle='#102e47';jc.font='15px system-ui';jc.fillText(`${bodyType} ${style.name} · ${attire}`,styleIndex*300+3,row*320+309);
   }
  }
  sheets[bodyType]=sheet.toDataURL().split(',')[1];
 }
 // Portrait output must be independent of attire/background/Honor selections.
 const config={bodyType:'female',style:'ponytail',hairColor:'red',skin:'medium',eyes:'blue',background:'sunrise',attire:'student',slots:[null,null,null]};
 const a=document.createElement('canvas'),b=document.createElement('canvas');await art.renderPortrait(a,config);await art.renderPortrait(b,{...config,attire:'coach',background:'starlight',slots:['solo:exact-recall',null,null]});assert(a.toDataURL()===b.toDataURL(),'Portrait inherited body/background/Honors');
 return {comparisons,portraits,registrationChecks,earSamples,sheets,joins:joins.toDataURL().split(',')[1]};
});
for(const [name,data] of Object.entries(result.sheets))await writeFile(`${output}/${name}-palette.png`,Buffer.from(data,'base64'));
await writeFile(`${output}/neckline-review.png`,Buffer.from(result.joins,'base64'));
const {sheets,joins,...checks}=result;console.log(JSON.stringify(checks,null,2));await browser.close();
