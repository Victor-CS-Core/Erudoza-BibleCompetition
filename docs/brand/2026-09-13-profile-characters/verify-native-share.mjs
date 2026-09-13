// Real editor, with only the unavailable OS-sharing boundary substituted in Chromium.
import {chromium,expect} from '@playwright/test';
import {mkdir,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const output='/tmp/erudoza-native-share';await mkdir(output,{recursive:true});
const browser=await chromium.launch(),errors=[];
const pngHash=data=>createHash('sha256').update(Buffer.from(data,'base64')).digest('hex');
async function open(mode='supported'){
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 await page.addInitScript(mode=>{
  const test=window.shareTest={calls:[],outcome:'success',holdBlobs:false,heldBlobs:[]};
  Object.defineProperty(navigator,'canShare',{configurable:true,value:mode==='missing'?undefined:({files})=>{if(mode==='throws')throw new DOMException('Blocked','NotAllowedError');return mode!=='unsupported'&&files?.length===1&&files[0] instanceof File&&files[0].type==='image/png';}});
  Object.defineProperty(navigator,'share',{configurable:true,value:mode==='missing'?undefined:data=>{
   test.calls.push({data,active:navigator.userActivation.isActive});
   if(test.outcome==='cancel')return Promise.reject(new DOMException('Canceled','AbortError'));
   if(test.outcome==='error')return Promise.reject(new DOMException('Unavailable','NotAllowedError'));
   if(test.outcome==='hold')return new Promise(resolve=>{test.resolveShare=resolve;});
   return Promise.resolve();
  }});
  const encode=HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob=function(callback,...args){encode.call(this,blob=>{if(test.holdBlobs)test.heldBlobs.push(()=>callback(blob));else callback(blob);},...args);};
 },mode);
 await page.goto('http://127.0.0.1:5187/docs/brand/2026-09-13-profile-characters/review.html?page=share');
 await page.waitForFunction(()=>document.querySelector('.share-canvas[data-ready=true]'));
 return page;
}
const image=page=>page.locator('.share-canvas').evaluate(c=>c.toDataURL().split(',')[1]);
async function payload(page){return page.evaluate(async()=>{
 const {data,active}=window.shareTest.calls.at(-1),file=data.files[0];
 const png=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(file);});
 return {keys:Object.keys(data),name:file.name,type:file.type,png,active};
});}
try{
 const page=await open(),share=page.getByRole('button',{name:'Share image',exact:true});
 await expect(share).toBeVisible();await expect(share).toBeEnabled();
 let downloads=0;page.on('download',()=>downloads++);
 await page.getByRole('button',{name:'Add Chapter strong patch',exact:true}).tap();await expect(share).toBeEnabled();
 let before=await image(page);await share.tap();let result=await payload(page);
 assert.deepEqual({...result,png:pngHash(result.png)},{keys:['files'],name:'pathfinder.png',type:'image/png',png:pngHash(before),active:true});assert.equal(downloads,0);
 await page.evaluate(()=>window.shareTest.outcome='cancel');await share.tap();await expect(share).toBeEnabled();assert.equal(downloads,0);assert.equal(await image(page),before);await expect(page.locator('.share-status')).toBeEmpty();
 await page.evaluate(()=>window.shareTest.outcome='error');await share.tap();await expect(page.locator('.share-status')).toContainText('Download');assert.equal(downloads,0);
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download review image',exact:true}).tap();await (await pending).saveAs(`${output}/fallback.png`);assert.deepEqual(await readFile(`${output}/fallback.png`),Buffer.from(before,'base64'));
 // Older encoding callbacks must not replace the current card after rapid visibility changes.
 await page.evaluate(()=>{window.shareTest.holdBlobs=true;window.shareTest.outcome='success';});
 await page.getByRole('switch',{name:'Your username',exact:true}).tap();await page.waitForFunction(()=>window.shareTest.heldBlobs.length===1);
 await page.getByRole('switch',{name:'Erudoza name',exact:true}).tap();await page.waitForFunction(()=>window.shareTest.heldBlobs.length===2);await expect(share).toBeDisabled();
 await page.evaluate(()=>window.shareTest.heldBlobs.pop()());await expect(share).toBeEnabled();await page.evaluate(()=>{window.shareTest.heldBlobs.pop()();window.shareTest.holdBlobs=false;});
 before=await image(page);await share.tap();result=await payload(page);assert.equal(pngHash(result.png),pngHash(before));assert.deepEqual(result.keys,['files']);assert.equal(result.active,true);
 await page.evaluate(()=>window.shareTest.outcome='hold');await share.tap();await expect(page.getByRole('button',{name:'Sharing…',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Download review image',exact:true})).toBeDisabled();await page.evaluate(()=>window.shareTest.resolveShare());await expect(share).toBeEnabled();
 await page.getByRole('navigation').getByRole('button',{name:'Character',exact:true}).tap();await page.getByRole('button',{name:'Master Guide · coach',exact:true}).tap();await page.getByRole('navigation').getByRole('button',{name:'Share',exact:true}).tap();await expect(share).toBeEnabled();await page.evaluate(()=>window.shareTest.outcome='success');await share.tap();result=await payload(page);assert.equal(result.name,'master-guide.png');assert.equal(pngHash(result.png),pngHash(await image(page)));
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${output}/phone-share-${width}.png`,fullPage:true});}
 await page.close();
 for(const mode of ['missing','unsupported','throws']){
  const fallback=await open(mode),download=fallback.getByRole('button',{name:'Download review image',exact:true});await expect(download).toBeEnabled();await expect(fallback.getByRole('button',{name:'Share image',exact:true})).toHaveCount(0);
  const expected=await image(fallback),pending=fallback.waitForEvent('download');await download.tap();const file=`${output}/${mode}.png`;await (await pending).saveAs(file);assert.deepEqual(await readFile(file),Buffer.from(expected,'base64'));assert.equal(await fallback.evaluate(()=>window.shareTest.calls.length),0);await fallback.close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({checks:['current PNG file in native share','immediate user-activated call','no extra username/text/URL metadata','cancel preserves edits without downloading','failure offers manual download','stale PNG callback discarded','pending share prevents duplicate actions','Master Guide PNG','missing/unsupported/blocked API fallbacks'],viewports:[390,320],errors},null,2));
}finally{await browser.close();}
