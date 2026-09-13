// Capture review artifacts from the actual UI, with the repo served on :5187.
import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const root=new URL('.',import.meta.url),browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1536,height:1080}});
await page.goto('http://127.0.0.1:5187/docs/brand/2026-09-13-profile-characters/review.html');
const ready=()=>page.waitForFunction(()=>document.querySelector('canvas[data-ready=true]'));
const nav=async name=>{await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();await ready();};
await ready();
for(const section of ['Profile','Character','Honors','Share']){
 await nav(section);await page.screenshot({path:new URL(`${section.toLowerCase()}-review.png`,root).pathname,fullPage:true});
}
await nav('Character');const rows=[];
for(const attire of ['Pathfinder','Master Guide · coach']){
 await page.getByRole('button',{name:attire,exact:true}).click();const row=[];
 for(const [hair,skin,eyes,bg] of [['Short curls','Medium','Brown','Warm studio'],['Side sweep','Deep','Hazel','Soft sage'],['Curly bob','Light','Blue','Morning sky']]){
  for(const choice of [hair,skin,eyes,bg])await page.getByRole('button',{name:choice,exact:true}).click();await ready();row.push(await page.locator('canvas').evaluate(c=>c.toDataURL()));
 }rows.push(row);
}
const data=await page.evaluate(async rows=>{const c=document.createElement('canvas');c.width=1500;c.height=1210;const ctx=c.getContext('2d');ctx.fillStyle='#f6f4ee';ctx.fillRect(0,0,1500,1210);ctx.fillStyle='#102e47';ctx.font='600 36px system-ui';ctx.fillText('Your Pathfinder · Appearance and sash review',40,58);
for(let r=0;r<2;r++){ctx.font='600 24px system-ui';ctx.fillText(r?'Master Guide attire · coach':'Pathfinder attire',40,112+r*545);for(let i=0;i<3;i++){const image=new Image();image.src=rows[r][i];await image.decode();ctx.drawImage(image,30+i*490,130+r*545,470,470);ctx.font='18px system-ui';ctx.fillText(['Short curls · Medium · Brown · Studio','Side sweep · Deep · Hazel · Sage','Curly bob · Light · Blue · Sky'][i],40+i*490,625+r*545);}}return c.toDataURL().split(',')[1];},rows);
await writeFile(new URL('assembled-review.png',root),Buffer.from(data,'base64'));await browser.close();
