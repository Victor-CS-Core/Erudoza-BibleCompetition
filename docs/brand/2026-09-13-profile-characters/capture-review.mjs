// Capture review artifacts from the actual UI, with the repo served on :5187.
import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const root=new URL('.',import.meta.url),browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1536,height:1080}});
await page.goto('http://127.0.0.1:5187/docs/brand/2026-09-13-profile-characters/review.html');
const ready=()=>page.waitForFunction(()=>document.querySelector('canvas[data-ready=true]')&&[...document.querySelectorAll('.hair-thumbnail')].every(t=>t.getAttribute('aria-busy')==='false'&&t.querySelector('img')?.complete));
const nav=async name=>{await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();await ready();};
const choose=async name=>{await page.getByRole('button',{name,exact:true}).click();await ready();};
await ready();
for(const section of ['Profile','Character','Honors','Share']){
 await nav(section);await page.screenshot({path:new URL(`${section.toLowerCase()}-review.png`,root).pathname,fullPage:true});
}
await nav('Character');
const styles={Male:['Short curls','Side part','Textured quiff','Buzz cut','Swept waves','Short locs'],Female:['Curly bob','Straight bob','High ponytail','Two braids','Natural curls','Low bun']};
for(const attire of ['Pathfinder','Master Guide · coach']){
 await choose(attire);const rows=[];
 for(const body of ['Male','Female']){
  await choose(body);const row=[];
  for(const [i,hair] of styles[body].entries()){
   await choose(hair);await page.getByRole('group',{name:'Hair color',exact:true}).getByRole('button',{name:['Brown','Black','Red','Blond','Brown','Black'][i],exact:true}).click();await ready();row.push(await page.locator('canvas').evaluate(c=>c.toDataURL()));
  }rows.push(row);
  if(body==='Female'&&attire!=='Pathfinder')await page.screenshot({path:new URL('female-master-guide-review.png',root).pathname,fullPage:true});
 }
 const data=await page.evaluate(async({rows,styles,attire})=>{const c=document.createElement('canvas');c.width=2160;c.height=980;const ctx=c.getContext('2d');ctx.fillStyle='#f6f4ee';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#102e47';ctx.font='600 38px system-ui';ctx.fillText(`${attire} · Body types and hairstyles`,35,57);
 for(let r=0;r<2;r++){ctx.font='600 25px system-ui';ctx.fillText(r?'Female':'Male',35,108+r*435);for(let i=0;i<6;i++){const image=new Image();image.src=rows[r][i];await image.decode();ctx.drawImage(image,15+i*358,123+r*435,346,346);ctx.font='19px system-ui';ctx.fillText(styles[r?'Female':'Male'][i],28+i*358,497+r*435);}}return c.toDataURL().split(',')[1];},{rows,styles,attire});
 await writeFile(new URL(attire==='Pathfinder'?'assembled-review.png':'master-guide-hairstyles.png',root),Buffer.from(data,'base64'));
}
await browser.close();
