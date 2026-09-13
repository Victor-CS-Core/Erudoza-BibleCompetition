// Run with the repo served at http://127.0.0.1:5187. QA output stays outside Git.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const output = '/tmp/erudoza-profile-art';
await mkdir(output, {recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1080}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
const waitReady=()=>page.waitForFunction(()=>document.querySelectorAll('canvas[data-ready="true"]').length===4);
await page.goto('http://127.0.0.1:5187/docs/brand/2026-09-13-profile-characters/review.html');
await waitReady();
const slot=i=>page.getByRole('combobox',{name:`Honor in spot ${i}`});
const initialAvatar=await page.locator('.avatar img').getAttribute('src');
const selections=['solo:exact-recall','solo:chapter-strong','team:first-fellowship'];
await slot(2).selectOption(selections[1]);
await slot(3).selectOption(selections[2]);
await waitReady();
assert.equal(await slot(2).locator('option[value="solo:exact-recall"]').evaluate(option=>option.disabled),true);
let combinations=0;
for(const attire of ['Pathfinder','Master Guide · coach']){
  await page.getByRole('button',{name:attire,exact:true}).click();
  for(const accessory of ['Sash','Satchel']){
    await page.getByRole('button',{name:accessory,exact:true}).click();
    for(const style of ['Short curls','Side sweep','Curly bob']){
      await page.getByRole('button',{name:style,exact:true}).click();
      await waitReady();
      for(let i=1;i<=3;i++)assert.equal(await slot(i).inputValue(),selections[i-1]);
      assert.equal(await page.locator('.avatar img').getAttribute('src'),initialAvatar);
      assert.equal(await page.locator('.character-panel canvas').getAttribute('aria-busy'),'false');
      combinations++;
    }
    await page.locator('.lineup').screenshot({path:`${output}/${attire==='Pathfinder'?'student':'coach'}-${accessory.toLowerCase()}-lineup.png`});
  }
}
await page.getByRole('button',{name:'Clear all three spots'}).click();await waitReady();
assert.equal(await page.locator('.empty-ring').count(),3);
for(let i=1;i<=3;i++)assert.equal(await slot(i).inputValue(),'');
await slot(2).selectOption(selections[1]);await waitReady();
assert.equal(await page.locator('.empty-ring').count(),2);
await page.getByRole('button',{name:'Sash',exact:true}).click();await waitReady();
assert.equal(await slot(2).inputValue(),selections[1]);
await page.getByRole('button',{name:'Character',exact:true}).click();
await page.waitForFunction(()=>document.querySelector('.avatar img')?.getAttribute('src')?.startsWith('data:image/png'));
await page.getByRole('button',{name:'Initials',exact:true}).click();
assert.equal(await page.locator('.avatar').innerText(),'AB');
await page.getByRole('button',{name:'Honor',exact:true}).click();
assert.equal(await page.locator('.avatar img').getAttribute('src'),initialAvatar);
await page.getByRole('combobox',{name:'Honor profile image'}).selectOption('team:first-fellowship');
assert.match(await page.locator('.avatar img').getAttribute('src'),/first-fellowship/);
assert.equal(await slot(2).inputValue(),selections[1]);
await page.getByRole('combobox',{name:'Honor profile image'}).selectOption('solo:exact-recall');
const downloadEvent=page.waitForEvent('download');
await page.getByRole('button',{name:'Download review image',exact:true}).click();
const download=await downloadEvent;await download.saveAs(`${output}/export.png`);
assert.equal(await download.failure(),null);
await page.getByRole('button',{name:'Pathfinder',exact:true}).click();
await page.getByRole('button',{name:'Short curls',exact:true}).click();
await slot(1).selectOption(selections[0]);await slot(2).selectOption('');await waitReady();
await page.screenshot({path:`${output}/desktop-final.png`,fullPage:true});
const viewportChecks=[];
for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:980});
  for(const attire of ['Pathfinder','Master Guide · coach']){
    await page.getByRole('button',{name:attire,exact:true}).click();await waitReady();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Overflow at ${width} ${attire}`);
    assert.equal(await page.locator('img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0)),true);
    await page.screenshot({path:`${output}/${width}-${attire==='Pathfinder'?'student':'coach'}.png`,fullPage:true});
    viewportChecks.push(`${width} ${attire}`);
  }
}
// Keyboard access to native controls is preserved in the narrow layout.
await slot(3).focus();assert.equal(await slot(3).evaluate(el=>el===document.activeElement),true);
assert.deepEqual(errors,[]);
await browser.close();
console.log(JSON.stringify({combinations,viewportChecks,checks:['slot selections survive style/attire/accessory changes','duplicate choices disabled','three empty slots and partial slots','profile avatar independent','character/initials/Honor avatar modes','PNG download','no page overflow','all artwork loads','keyboard control focus'],errors},null,2));
