import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const output='/tmp/erudoza-backgrounds';await mkdir(output,{recursive:true});
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1080}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
const ready=()=>page.waitForFunction(()=>document.querySelector('.character-canvas[data-ready=true]')&&[...document.querySelectorAll('.hair-thumbnail')].every(t=>t.getAttribute('aria-busy')==='false'&&t.querySelector('img')?.complete));
const nav=async name=>{await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();await ready();};
const choose=async name=>{await page.getByRole('button',{name,exact:true}).click();await ready();};
const scenes=['Mountain Sunrise','Woodland Basecamp','Starlight Camp'];let compositions=0,downloads=0;const cells=[];
try{
 await page.goto('http://127.0.0.1:5187/docs/brand/2026-09-13-profile-characters/review.html');await ready();await nav('Character');
 for(const name of scenes)assert.equal(await page.getByRole('button',{name,exact:true}).count(),1,`Missing background: ${name}`);
 assert.equal(await page.locator('.background-options button').count(),3);
 for(const body of ['Male','Female']){
  await choose(body);await choose(body==='Male'?'Short curls':'Low bun');await choose('Deep');
  await page.getByRole('group',{name:'Hair color',exact:true}).getByRole('button',{name:'Blond',exact:true}).click();await ready();await choose('Blue');
  const portraits=await page.locator('.hair-thumbnail img').evaluateAll(images=>images.map(i=>i.src));
  for(const attire of ['Pathfinder','Master Guide · coach']){
   await choose(attire);const before=await page.locator('.character-canvas').getAttribute('aria-label');const variants=[];
   for(const scene of scenes){
    await choose(scene);assert.equal(await page.locator('.character-canvas').getAttribute('aria-label'),before,'Background changed character or Honors');
    assert.deepEqual(await page.locator('.hair-thumbnail img').evaluateAll(images=>images.map(i=>i.src)),portraits,'Background changed transparent portraits');
    const data=await page.locator('.character-canvas').evaluate(c=>c.toDataURL());variants.push(data);cells.push({label:`${body} · ${attire} · ${scene}`,data});compositions++;
   }
   assert.equal(new Set(variants).size,3);
  }
 }
 for(const scene of scenes){
  await choose(scene);await nav('Share');const waiting=page.waitForEvent('download');await choose('Download review image');const file=await waiting;assert.equal(await file.failure(),null);await file.saveAs(`${output}/${scene.replaceAll(' ','-')}-export.png`);downloads++;await nav('Character');
 }
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1080});await ready();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0)),true);await page.screenshot({path:`${output}/editor-${width}.png`,fullPage:true});
 }
 const sheet=await page.evaluate(async cells=>{const c=document.createElement('canvas');c.width=1440;c.height=2080;const ctx=c.getContext('2d');ctx.fillStyle='#f6f4ee';ctx.fillRect(0,0,c.width,c.height);for(const [i,cell] of cells.entries()){const image=new Image();image.src=cell.data;await image.decode();const x=i%3*480,y=Math.floor(i/3)*520;ctx.drawImage(image,x,y,480,480);ctx.fillStyle='#102e47';ctx.font='16px system-ui';ctx.fillText(cell.label,x+12,y+506);}return c.toDataURL().split(',')[1];},cells);
 await writeFile(`${output}/scene-lineup.png`,Buffer.from(sheet,'base64'));assert.deepEqual(errors,[]);console.log(JSON.stringify({compositions,downloads,viewports:[1440,390,320],errors},null,2));
}finally{await browser.close();}
