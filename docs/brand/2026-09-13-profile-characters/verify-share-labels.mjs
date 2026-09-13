import {chromium,expect} from '@playwright/test';
import {mkdir,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
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
async function outlinedName(named,hidden){
 const pixels=async data=>sharp(Buffer.from(data,'base64')).extract({left:0,top:0,width:1200,height:120}).ensureAlpha().raw().toBuffer();
 const a=await pixels(named),b=await pixels(hidden);let white=0,ink=0;
 for(let i=0;i<a.length;i+=4){if(a[i]===b[i]&&a[i+1]===b[i+1]&&a[i+2]===b[i+2])continue;if(a[i]>245&&a[i+1]>245&&a[i+2]>245)white++;if(a[i]<40&&a[i+1]<65&&a[i+2]<90)ink++;}
 assert.ok(white>200&&ink>200,'Visible username needs both a white sticker edge and dark lettering');
}
try{
 await page.goto('http://127.0.0.1:5187/docs/brand/2026-09-13-profile-characters/review.html?page=share');await ready();
 await expect(page.getByText('Give your Pathfinder a card of its own with the patches you’ve earned.',{exact:true})).toBeVisible();
 assert.equal(await page.getByText(/give your chibi/i).count(),0);
 assert.equal(await page.getByRole('textbox').count(),0,'Sharing must not offer a custom name field');
 for(const name of ['Your username','Erudoza name','Landing-page QR code']){await expect(toggle(name)).toBeVisible();await expect(toggle(name)).toHaveAttribute('aria-checked','true');}
 await expect(page.getByText('Uses your profile username: alexbrooks.',{exact:true})).toBeVisible();
 const named=await image();assert.equal(await decode(),'https://erudoza.com/');
 await toggle('Your username').click();await ready();assert.notEqual(await image(),named);await outlinedName(named,await image());
 await toggle('Erudoza name').click();await ready();assert.equal(await decode(),'https://erudoza.com/','QR must work when the wordmark is hidden');
 await toggle('Landing-page QR code').click();await ready();assert.equal(await decode(),undefined);
 const clean=await image();await toggle('Your username').click();await ready();assert.notEqual(await image(),clean);await toggle('Your username').click();await toggle('Erudoza name').click();await ready();assert.notEqual(await image(),clean);assert.equal(await decode(),undefined);
 await toggle('Landing-page QR code').click();await ready();
 await page.getByRole('button',{name:'Add Chapter strong patch',exact:true}).click();await ready();
 // Drag a large patch into the QR footer. It must be kept outside its quiet zone.
 const patch=page.getByRole('button',{name:'Move Chapter strong patch',exact:true});await page.getByRole('slider',{name:'Patch size'}).fill('28');await ready();const pb=await patch.boundingBox(),card=await page.locator('.share-stage').boundingBox();await page.mouse.move(pb.x+pb.width/2,pb.y+pb.height/2);await page.mouse.down();await page.mouse.move(card.x+card.width*.95,card.y+card.height*.95,{steps:10});await page.mouse.up();await ready();assert.equal(await decode(),'https://erudoza.com/');
 const placement=await patch.getAttribute('data-patch-key');
 await page.getByRole('navigation').getByRole('button',{name:'Character',exact:true}).click();await ready();await page.getByRole('button',{name:'Master Guide · coach',exact:true}).click();await ready();await page.getByRole('navigation').getByRole('button',{name:'Share',exact:true}).click();await ready();
 await expect(toggle('Your username')).toHaveAttribute('aria-checked','false');await expect(toggle('Erudoza name')).toHaveAttribute('aria-checked','true');await expect(toggle('Landing-page QR code')).toHaveAttribute('aria-checked','true');await expect(page.getByText('Uses your profile username: alexbrooks.',{exact:true})).toBeVisible();assert.equal(await patch.getAttribute('data-patch-key'),placement);
 for(const scene of ['Mountain Sunrise','Starlight Camp']){
  await page.getByRole('button',{name:scene,exact:true}).click();await ready();assert.equal(await decode(),'https://erudoza.com/');assert.equal(await decode(600),'https://erudoza.com/','QR must also decode after reducing the card to 600px wide');
  const hidden=await image();await toggle('Your username').click();await ready();await outlinedName(await image(),hidden);
  const before=await image(),pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download review image',exact:true}).click();const download=await pending;const file=`${output}/${scene.replaceAll(' ','-')}.png`;await download.saveAs(file);assert.deepEqual(await readFile(file),Buffer.from(before,'base64'));
  await toggle('Your username').click();await ready();
 }
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await ready();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await toggle('Your username').focus();await page.keyboard.press('Space');await ready();await page.screenshot({path:`${output}/share-${width}.png`,fullPage:true});}
 // Real painter: profile identity is independent of card-editing options and display names.
 const module=await build({stdin:{contents:"export {paintShareCard} from './share';",resolveDir:fileURLToPath(new URL('.',import.meta.url)),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'ShareIdentityTest',target:'es2022'});
 await page.addScriptTag({content:module.outputFiles[0].text});
 const identity=await page.evaluate(()=>{
  const base=document.createElement('canvas');base.width=1200;base.height=1600;
  function render(userName,displayName='Ignored display name',showName=true){const c=document.createElement('canvas');window.ShareIdentityTest.paintShareCard(c,base,[],new Map(),{userName,displayName},{showName,showQR:false,showBrand:false});return c;}
  const first=render('casey.trails'),other=render('morgan.river'),same=render('casey.trails','A changed display name');
  const long=render('a-very-long-profile-username-that-must-remain-inside-the-card-12345');const d=long.getContext('2d').getImageData(0,0,1200,1600).data;let left=1200,right=0;
  for(let y=0;y<1600;y++)for(let x=0;x<1200;x++)if(d[(y*1200+x)*4+3]>32){left=Math.min(left,x);right=Math.max(right,x);}
  return {changesWithUsername:first.toDataURL()!==other.toDataURL(),ignoresDisplayName:first.toDataURL()===same.toDataURL(),blankIsHidden:render('   ').toDataURL()===render('casey.trails','Unused',false).toDataURL(),left,right};
 });
 assert.equal(identity.changesWithUsername,true);assert.equal(identity.ignoresDisplayName,true);assert.equal(identity.blankIsHidden,true);assert.ok(identity.left>=40&&identity.right<=1160,'Long profile username must fit inside card margins');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({checks:['Pathfinder wording','three independent switches','profile username with no custom field','white sticker outline on day/night scenes','QR independently decodes to public landing','patch exclusion from QR footer','state preserved through attire/navigation','day/night exported PNG parity','keyboard switches'],viewports:[1440,390,320],errors},null,2));
}finally{await browser.close();}
