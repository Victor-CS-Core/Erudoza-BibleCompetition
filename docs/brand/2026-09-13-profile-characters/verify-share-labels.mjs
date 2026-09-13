import {chromium,expect} from '@playwright/test';
import {mkdir,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const sharp=require('sharp');
// Optional independent test-only decoder; no QR library enters the app bundle.
const jsQR=require(process.env.ERUDOZA_QR_DECODER??'/tmp/erudoza-qr-tools-js/node_modules/jsqr');
const output='/tmp/erudoza-share-labels';await mkdir(output,{recursive:true});
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1180}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
const ready=()=>page.waitForFunction(()=>document.querySelector('canvas[data-ready=true]'));
const toggle=name=>page.getByRole('switch',{name,exact:true});
const image=()=>page.locator('canvas').evaluate(c=>c.toDataURL().split(',')[1]);
async function decode(width=1200){const {data,info}=await sharp(Buffer.from(await image(),'base64')).resize({width}).ensureAlpha().raw().toBuffer({resolveWithObject:true});return jsQR(new Uint8ClampedArray(data),info.width,info.height)?.data;}
try{
 await page.goto('http://127.0.0.1:5187/docs/brand/2026-09-13-profile-characters/review.html?page=share');await ready();
 await expect(page.getByText('Give your Pathfinder a card of its own with the patches you’ve earned.',{exact:true})).toBeVisible();
 assert.equal(await page.getByText(/give your chibi/i).count(),0);
 for(const name of ['Your name','Erudoza name','Landing-page QR code']){await expect(toggle(name)).toBeVisible();await expect(toggle(name)).toHaveAttribute('aria-checked','true');}
 await page.getByRole('textbox',{name:'Name on card',exact:true}).fill('Jordan Rivers');await ready();
 const named=await image();assert.equal(await decode(),'https://erudoza.com/');
 await toggle('Your name').click();await ready();assert.notEqual(await image(),named);
 await toggle('Erudoza name').click();await ready();assert.equal(await decode(),'https://erudoza.com/','QR must work when the wordmark is hidden');
 await toggle('Landing-page QR code').click();await ready();assert.equal(await decode(),undefined);
 const clean=await image();await toggle('Your name').click();await ready();assert.notEqual(await image(),clean);await toggle('Your name').click();await toggle('Erudoza name').click();await ready();assert.notEqual(await image(),clean);assert.equal(await decode(),undefined);
 await toggle('Landing-page QR code').click();await ready();
 await page.getByRole('button',{name:'Add Chapter strong patch',exact:true}).click();await ready();
 // Drag a large patch into the QR footer. It must be kept outside its quiet zone.
 const patch=page.getByRole('button',{name:'Move Chapter strong patch',exact:true});await page.getByRole('slider',{name:'Patch size'}).fill('28');await ready();const pb=await patch.boundingBox(),card=await page.locator('.share-stage').boundingBox();await page.mouse.move(pb.x+pb.width/2,pb.y+pb.height/2);await page.mouse.down();await page.mouse.move(card.x+card.width*.95,card.y+card.height*.95,{steps:10});await page.mouse.up();await ready();assert.equal(await decode(),'https://erudoza.com/');
 const placement=await patch.getAttribute('data-patch-key');
 await page.getByRole('navigation').getByRole('button',{name:'Character',exact:true}).click();await ready();await page.getByRole('button',{name:'Master Guide · coach',exact:true}).click();await ready();await page.getByRole('navigation').getByRole('button',{name:'Share',exact:true}).click();await ready();
 await expect(toggle('Your name')).toHaveAttribute('aria-checked','false');await expect(toggle('Erudoza name')).toHaveAttribute('aria-checked','true');await expect(toggle('Landing-page QR code')).toHaveAttribute('aria-checked','true');await expect(page.getByRole('textbox',{name:'Name on card'})).toHaveValue('Jordan Rivers');assert.equal(await patch.getAttribute('data-patch-key'),placement);
 for(const scene of ['Mountain Sunrise','Starlight Camp']){
  await page.getByRole('button',{name:scene,exact:true}).click();await ready();assert.equal(await decode(),'https://erudoza.com/');assert.equal(await decode(600),'https://erudoza.com/','QR must also decode after reducing the card to 600px wide');
  const before=await image(),pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download review image',exact:true}).click();const download=await pending;const file=`${output}/${scene.replaceAll(' ','-')}.png`;await download.saveAs(file);assert.deepEqual(await readFile(file),Buffer.from(before,'base64'));
 }
 await toggle('Your name').click();await ready();await page.getByRole('textbox',{name:'Name on card'}).fill('A very long display name to check fitting');await ready();assert.equal(await decode(),'https://erudoza.com/');
 await page.getByRole('textbox',{name:'Name on card'}).fill('   ');await ready();const blankName=await image();await toggle('Your name').click();await ready();assert.equal(await image(),blankName,'Empty names must not render stray title text');
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await ready();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await toggle('Your name').focus();await page.keyboard.press('Space');await ready();await page.screenshot({path:`${output}/share-${width}.png`,fullPage:true});}
 assert.deepEqual(errors,[]);console.log(JSON.stringify({checks:['Pathfinder wording','three independent switches','editable sample name','no text when hidden/blank','QR independently decodes to public landing','patch exclusion from QR footer','state preserved through attire/navigation','day/night exported PNG parity','long name','keyboard switches'],viewports:[1440,390,320],errors},null,2));
}finally{await browser.close();}
