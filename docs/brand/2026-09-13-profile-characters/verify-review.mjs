// Serve the repo at 127.0.0.1:5187. QA captures are kept outside Git.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const output='/tmp/erudoza-profile-art';await mkdir(output,{recursive:true});
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1536,height:1080}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
const ready=()=>page.waitForFunction(()=>document.querySelector('canvas[data-ready="true"]'));
const nav=async name=>{await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();await ready();};
const choose=async name=>{await page.getByRole('button',{name,exact:true}).click();await ready();};
const snapshot=()=>page.locator('canvas').evaluate(c=>c.toDataURL());
await page.goto('http://127.0.0.1:5187/docs/brand/2026-09-13-profile-characters/review.html');await ready();
assert.equal(await page.getByRole('button',{name:/satchel/i}).count(),0);
const originalAvatar=await page.locator('.avatar img').getAttribute('src');
await page.screenshot({path:`${output}/profile-v2.png`,fullPage:true});
await nav('Honors');const slot=i=>page.getByRole('combobox',{name:`Honor in spot ${i}`});
await slot(3).selectOption('team:first-fellowship');await ready();
assert.equal(await slot(2).locator('option[value="solo:exact-recall"]').evaluate(o=>o.disabled),true);
await choose('Clear all three spots');assert.equal(await page.locator('.empty-ring').count(),3);
await slot(1).selectOption('solo:chapter-strong');await slot(2).selectOption('solo:exact-recall');await ready();
await nav('Character');
const matrix=[];
for(const attire of ['Pathfinder','Master Guide · coach']){
 await choose(attire);
 for(const hair of ['Short curls','Side sweep','Curly bob']){
  await choose(hair);
  for(const skin of ['Light','Medium','Deep']){
   await choose(skin);
   const variants=[];
   for(const eyes of ['Brown','Hazel','Blue']){await choose(eyes);variants.push(await snapshot());matrix.push([attire,hair,skin,eyes]);}
   assert.equal(new Set(variants).size,3,'Eye modifiers must change rendered pixels');
   // Final blue-eye samples form the visual skin/hairstyle review grid.
   await page.locator('canvas').screenshot({path:`${output}/${attire==='Pathfinder'?'student':'coach'}-${hair.replaceAll(' ','-')}-${skin}.png`});
  }
 }
}
assert.equal(await page.locator('.avatar img').getAttribute('src'),originalAvatar);
await choose('Pathfinder');await choose('Short curls');await choose('Medium');await choose('Brown');
const bg=[];for(const name of ['Warm studio','Soft sage','Morning sky']){await choose(name);bg.push(await snapshot());}
assert.equal(new Set(bg).size,3);
await choose('Warm studio');await page.screenshot({path:`${output}/character-v2.png`,fullPage:true});
await nav('Honors');assert.equal(await slot(1).inputValue(),'solo:chapter-strong');assert.equal(await slot(2).inputValue(),'solo:exact-recall');assert.equal(await slot(3).inputValue(),'');
await nav('Profile');await page.locator('.avatar-options').getByRole('button',{name:'Character',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.avatar img')?.src.startsWith('data:'));const portrait=await page.locator('.avatar img').getAttribute('src');
await nav('Character');await choose('Blue');await nav('Profile');await page.waitForFunction(old=>document.querySelector('.avatar img')?.src!==old,portrait);
await choose('Initials');assert.equal(await page.locator('.avatar').innerText(),'AB');await choose('Honor');
await page.getByRole('combobox',{name:'Honor profile image'}).selectOption('team:first-fellowship');assert.match(await page.locator('.avatar img').getAttribute('src'),/first-fellowship/);
await nav('Share');const downloaded=page.waitForEvent('download');await choose('Download review image');const file=await downloaded;await file.saveAs(`${output}/export.png`);assert.equal(await file.failure(),null);
const viewports=[];
for(const width of [1440,390,320]){
 await page.setViewportSize({width,height:980});
 for(const attire of ['Pathfinder','Master Guide · coach']){
  await nav('Character');await choose(attire);
  for(const section of ['Profile','Character','Honors','Share']){
   await nav(section);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width} ${attire} ${section} overflow`);
   assert.equal(await page.locator('img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0)),true);
   await page.screenshot({path:`${output}/${width}-${attire==='Pathfinder'?'student':'coach'}-${section}.png`,fullPage:true});viewports.push([width,attire,section]);
  }
 }
}
await nav('Honors');await slot(3).focus();assert.equal(await slot(3).evaluate(el=>el===document.activeElement),true);
await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('textbox',{name:'Search profile pages'}).fill('char');await page.locator('.search-results').getByRole('button',{name:'Character',exact:true}).click();assert.equal(await page.getByRole('heading',{name:'Make your Pathfinder'}).count(),1);
assert.deepEqual(errors,[]);await browser.close();
console.log(JSON.stringify({appearanceCombinations:matrix.length,pageViewportChecks:viewports.length,checks:['three live eye colors','three live backgrounds','Honor ordering and duplicate prevention','empty and partial sash slots','independent avatar choices and live portrait','PNG download','page navigation and search','keyboard focus','no overflow or missing images'],errors},null,2));
