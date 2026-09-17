// Real browser interaction checks for the local review. Generated QA stays in /tmp.
import {chromium, expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const output='/tmp/erudoza-share';await mkdir(output,{recursive:true});
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:1080}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
const ready=()=>page.waitForFunction(()=>document.querySelector('canvas[data-ready=true]'));
const nav=async name=>{await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();await ready();};
const handle=name=>page.getByRole('button',{name:`Move ${name} patch`,exact:true});
const add=name=>page.getByRole('button',{name:`Add ${name} patch`,exact:true});
const patchState=()=>page.locator('[data-patch-key]').evaluateAll(nodes=>nodes.map(n=>({key:n.dataset.patchKey,x:+n.dataset.x,y:+n.dataset.y,size:+n.dataset.size,rotation:+n.dataset.rotation})));
try{
 await page.goto('http://127.0.0.1:5187/docs/brand/2026-09-13-profile-characters/review.html');await ready();
 const model=await build({stdin:{contents:"export * from './share';",resolveDir:fileURLToPath(new URL('.',import.meta.url)),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'ShareTools',target:'es2022'});await page.addScriptTag({content:model.outputFiles[0].text});
 const modelChecks=await page.evaluate(()=>{
  const m=window.ShareTools,collection=[{key:'earned',title:'Earned',src:'example.webp',earnedAtUtc:'2026-09-13T00:00:00Z'},{key:'locked',title:'Locked',src:'example.webp',earnedAtUtc:null}];
  const current=m.addPlacement([],collection,'earned');let history=m.emptyShareHistory;
  for(let i=0;i<60;i++)history=m.recordShare(history,[{...current[0],x:250+i}]);
  return {available:m.unlockedPatches(collection).map(p=>p.key),locked:m.addPlacement(current,collection,'locked').length,unknown:m.addPlacement(current,collection,'unknown').length,duplicate:m.addPlacement(current,collection,'earned').length,history:history.past.length,branchFuture:m.recordShare(m.undoShare(history),[{...current[0],x:400}]).future.length};
 });assert.deepEqual(modelChecks,{available:['earned'],locked:1,unknown:1,duplicate:1,history:40,branchFuture:0});
 const avatar=await page.locator('.avatar img').getAttribute('src');
 await nav('Share');await expect(page.getByRole('heading',{name:'Unlocked patches',exact:true})).toBeVisible();
 assert.equal(await page.locator('.share-patch-tray button').count(),3);
 await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeDisabled();
 const card=page.locator('.share-stage');
 // Real native drag and drop from the tray, followed by pixel-position checks.
 await add('Exact recall').dragTo(card,{targetPosition:{x:90,y:220}});await ready();
 await expect(handle('Exact recall')).toBeVisible();const box=await card.boundingBox();let state=await patchState();
 assert.ok(Math.abs(state[0].x-90/box.width*1200)<3);assert.ok(Math.abs(state[0].y-220/box.height*1600)<3);
 // Unknown/locked transfer data cannot create a patch.
 await card.evaluate(el=>{const transfer=new DataTransfer();transfer.setData('application/x-erudoza-patch','solo:review-complete');el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:200,clientY:300}));});
 assert.equal((await patchState()).length,1);
 await add('Chapter strong').click();await ready();await expect(add('Chapter strong')).toBeDisabled();
 await handle('Chapter strong').focus();const before=await patchState();await page.keyboard.press('ArrowLeft');await page.keyboard.press('Shift+ArrowUp');await ready();state=await patchState();
 assert.equal(state[1].x,before[1].x-4);assert.equal(state[1].y,before[1].y-24);
 await page.getByRole('slider',{name:'Patch size'}).fill('28');await page.getByRole('slider',{name:'Patch rotation'}).fill('45');await ready();
 state=await patchState();assert.equal(state[1].size,336);assert.equal(state[1].rotation,45);
 // Drag to an edge; the rotated square must remain wholly inside the export.
 const h=await handle('Chapter strong').boundingBox();await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(box.x+1,box.y+1,{steps:12});await page.mouse.up();await ready();
 state=await patchState();const extent=336*Math.SQRT2/2;assert.ok(state[1].x>=extent);assert.ok(state[1].y>=extent);
 const clamped=state;await page.getByRole('button',{name:'Undo',exact:true}).click();await ready();assert.notDeepEqual(await patchState(),clamped);
 await page.getByRole('button',{name:'Redo',exact:true}).click();await ready();assert.deepEqual(await patchState(),clamped);
 await page.getByRole('button',{name:'Send backward',exact:true}).click();await ready();assert.equal((await patchState())[0].key,'solo:chapter-strong');
 await page.getByRole('button',{name:'Bring forward',exact:true}).click();await ready();assert.equal((await patchState())[1].key,'solo:chapter-strong');
 // Escape cancels a pointer drag without recording an edit.
 const start=await handle('Chapter strong').boundingBox();await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*.8,box.y+box.height*.6,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();await ready();assert.deepEqual(await patchState(),clamped);
 await page.getByRole('button',{name:'Remove patch',exact:true}).click();await ready();assert.equal((await patchState()).length,1);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await ready();assert.equal((await patchState()).length,2);
 await nav('Honors');assert.equal(await page.getByRole('combobox',{name:'Honor in spot 1'}).inputValue(),'solo:exact-recall');assert.equal(await page.getByRole('combobox',{name:'Honor in spot 2'}).inputValue(),'solo:chapter-strong');assert.equal(await page.getByRole('combobox',{name:'Honor in spot 3'}).inputValue(),'');
 await nav('Character');await page.getByRole('button',{name:'Female',exact:true}).click();await ready();await page.getByRole('button',{name:'Master Guide · coach',exact:true}).click();await ready();await nav('Share');assert.deepEqual(await patchState(),clamped);assert.equal(await page.locator('.avatar img').getAttribute('src'),avatar);
 await page.getByRole('button',{name:'Starlight Camp',exact:true}).click();await ready();
 const preview=await page.locator('canvas').evaluate(c=>c.toDataURL().split(',')[1]);const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download review image',exact:true}).click();const download=await pending;await download.saveAs(`${output}/decorated-export.png`);assert.equal(await download.failure(),null);assert.deepEqual(await readFile(`${output}/decorated-export.png`),Buffer.from(preview,'base64'),'Downloaded PNG must exactly match the preview canvas, without selection outlines');
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1080});await ready();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await expect(page.getByRole('button',{name:'Download review image',exact:true})).toBeEnabled();await page.screenshot({path:`${output}/share-${width}.png`,fullPage:true});}
 await page.getByRole('button',{name:'Clear patches',exact:true}).click();await ready();assert.equal((await patchState()).length,0);await page.getByRole('button',{name:'Undo',exact:true}).click();await ready();assert.equal((await patchState()).length,2);
 // Touch-style tap-to-add and direct touch-pointer move.
 const shareUrl=page.url();await page.close(); // free the desktop page's canvas/GPU state before mobile emulation (renderer OOM on 2-CPU headless)
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await mobile.goto(shareUrl);await mobile.waitForFunction(()=>document.querySelector('canvas[data-ready=true]'));await mobile.getByRole('navigation').getByRole('button',{name:'Share',exact:true}).tap();await mobile.waitForFunction(()=>document.querySelector('.share-canvas[data-ready=true]'));await mobile.getByRole('button',{name:'Add First fellowship patch',exact:true}).tap();await expect(mobile.getByRole('button',{name:'Move First fellowship patch',exact:true})).toBeAttached();
 const touchHandle=mobile.getByRole('button',{name:'Move First fellowship patch',exact:true});await touchHandle.scrollIntoViewIfNeeded();const rect=await touchHandle.boundingBox();const cdp=await mobile.context().newCDPSession(mobile);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:rect.x+rect.width/2,y:rect.y+rect.height/2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:rect.x+rect.width/2-35,y:rect.y+rect.height/2-50}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await mobile.waitForFunction(()=>document.querySelector('.share-canvas[data-ready=true]'));assert.notEqual(await touchHandle.getAttribute('data-x'),'230');await mobile.close();
 assert.deepEqual(errors,[]);console.log(JSON.stringify({checks:['unlocked-only tray/drop','native drag placement','tap addition','keyboard movement','size and rotation','rotated bounds','pointer cancellation','undo/redo','layering/removal/clear','persistent decoration state','independent avatar and sash','Master Guide compatibility','pixel-identical PNG export','real touch movement'],viewports:[1440,390,320],errors},null,2));
}finally{await browser.close();}
