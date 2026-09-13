// Verify the visible selector artwork follows the current appearance, not source colors.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const output='/tmp/erudoza-selector-previews';await mkdir(output,{recursive:true});
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1080}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>{
 const thumbnails=[...document.querySelectorAll('.hair-thumbnail')];
 return document.querySelector('.character-canvas[data-ready="true"]')&&thumbnails.length===6&&thumbnails.every(t=>t.getAttribute('aria-busy')!=='true'&&t.querySelector('img')?.complete&&t.querySelector('img')?.naturalWidth>0);
});
const pixels=()=>page.locator('.hair-thumbnail img').evaluateAll(images=>images.map(image=>{
 const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;c.getContext('2d').drawImage(image,0,0);return c.toDataURL();
}));
const choose=async name=>{await page.getByRole('button',{name,exact:true}).click();await ready();};
const chooseIn=async(group,name)=>{await page.getByRole('group',{name:group,exact:true}).getByRole('button',{name,exact:true}).click();await ready();};
let changedThumbnails=0,portraitMatches=0;
try{
 await page.goto('http://127.0.0.1:5187/docs/brand/2026-09-13-profile-characters/review.html');
 await page.getByRole('navigation').getByRole('button',{name:'Character',exact:true}).click();await ready();
 for(const body of ['Male','Female']){
  await choose(body);
  for(const [group,options] of [['Hair color',['Red','Black','Brown','Blond']],['Skin tone',['Light','Medium','Deep']],['Eye color',['Hazel','Blue','Brown']]]){
   for(const option of options){
    const before=await pixels();await chooseIn(group,option);const after=await pixels();
    after.forEach((image,i)=>{assert.ok(image!==before[i],`${body} thumbnail ${i+1} did not update after ${group}: ${option}`);changedThumbnails++;});
   }
  }
  const appearance=await pixels();
  for(const name of ['Master Guide · coach','Starlight Camp','Pathfinder','Mountain Sunrise']){await choose(name);assert.deepEqual(await pixels(),appearance,`${name} changed head-only thumbnails`);}
  for(const name of body==='Male'?['Short curls','Short locs']:['Curly bob','Low bun']){
   await choose(name);assert.deepEqual(await pixels(),appearance,'Selecting a hairstyle changed other hairstyle previews');
   const expected=await page.getByRole('button',{name,exact:true}).locator('img').getAttribute('src');
   await page.getByRole('navigation').getByRole('button',{name:'Profile',exact:true}).click();
   await page.waitForFunction(src=>document.querySelector('.avatar-options button[aria-label="Character"] img')?.getAttribute('src')===src,expected);portraitMatches++;
   await page.getByRole('navigation').getByRole('button',{name:'Character',exact:true}).click();await ready();
  }
 }
 // Rapid changes must settle on the final appearance rather than an earlier async render.
 for(const name of ['Red','Black','Brown','Blond'])await page.getByRole('group',{name:'Hair color',exact:true}).getByRole('button',{name,exact:true}).click();await ready();
 const final=await pixels();await chooseIn('Hair color','Red');await chooseIn('Hair color','Blond');assert.deepEqual(await pixels(),final);
 await chooseIn('Eye color','Blue');
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1080});await ready();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`${output}/female-blond-deep-${width}.png`,fullPage:true});
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({changedThumbnails,portraitMatches,viewports:[1440,390,320],errors},null,2));
}finally{await browser.close();}
