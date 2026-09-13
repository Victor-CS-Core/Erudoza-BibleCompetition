// Intentional deliverables from the real UI. Run against the loopback review server.
import {chromium,expect} from '@playwright/test';
const root=new URL('.',import.meta.url),browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:1180}});
const ready=()=>page.waitForFunction(()=>document.querySelector('canvas[data-ready=true]')&&[...document.querySelectorAll('.hair-thumbnail')].every(t=>t.getAttribute('aria-busy')==='false'));
const choose=async name=>{await page.getByRole('button',{name,exact:true}).click();await ready();};
try{
 await page.goto('http://127.0.0.1:5187/docs/brand/2026-09-13-profile-characters/review.html?page=character');await ready();
 await choose('Female');await choose('Low bun');await page.getByRole('group',{name:'Hair color',exact:true}).getByRole('button',{name:'Red',exact:true}).click();await ready();await choose('Woodland Basecamp');
 await page.screenshot({path:new URL('refinement/low-bun-character.png',root).pathname,fullPage:true});
 await page.getByRole('navigation').getByRole('button',{name:'Share',exact:true}).click();await ready();
 await choose('Add Chapter strong patch');await page.getByRole('slider',{name:'Patch rotation'}).fill('-15');await ready();await choose('Add First fellowship patch');await page.getByRole('slider',{name:'Patch rotation'}).fill('10');await ready();
 await expect(page.getByRole('button',{name:'Download review image',exact:true})).toBeEnabled();
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:new URL('share-customized-review.png',root).pathname,fullPage:true});
 const pending=page.waitForEvent('download');await choose('Download review image');await (await pending).saveAs(new URL('share-customized-export.png',root).pathname);
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:new URL('share-mobile-review.png',root).pathname,fullPage:true});
}finally{await browser.close();}
