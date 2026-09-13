import {expect,test,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {assertNoOverflow,login,logout} from './helpers';
import type {CharacterProfileFields,SaveCharacterProfile} from '../shared/profileCharacter';
test.use({hasTouch:true});
type Profile=CharacterProfileFields&{userId:string;avatarHonorKey:string|null;honors:{key:string;earnedAtUtc:string|null}[]};
const hash=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
const readProfile=async(page:Page)=>(await (await page.request.get('/api/v1/profile/me')).json()) as Profile;
const body=(p:Profile):SaveCharacterProfile=>({version:p.characterVersion,character:p.character,avatarKind:p.avatarKind,avatarHonorKey:p.avatarHonorKey,shareOptions:p.shareOptions,sharePatches:p.sharePatches});
const nav=async(page:Page,name:string)=>page.getByRole('navigation',{name:'Profile pages',exact:true}).getByRole('button',{name,exact:true}).click();
const choose=async(page:Page,name:string)=>page.getByRole('button',{name,exact:true}).click();
const ready=async(page:Page)=>expect(page.locator('.character-canvas').first()).toHaveAttribute('data-ready','true');
const save=async(page:Page)=>{const button=page.getByRole('button',{name:'Save changes',exact:true});await expect(button).toBeEnabled();await button.click();await expect(button).toBeDisabled();};

test('coach character, sash, avatar and share persist through the real profile API',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/'))errors.push(`${r.status()} ${r.url()}`);});
 await login(page);await page.goto('/admin/profile');await ready(page);
 expect((await readProfile(page)).honors.filter(h=>h.earnedAtUtc)).toHaveLength(3);
 await nav(page,'Character');for(const name of ['Female','Low bun','Red','Deep','Blue','Master Guide · coach','Starlight Camp'])await choose(page,name);await ready(page);
 await nav(page,'Honors');
 for(const [index,key] of ['solo:exact-recall','solo:chapter-strong','team:first-fellowship'].entries())await page.getByRole('combobox',{name:`Honor in spot ${index+1}`,exact:true}).selectOption(key);
 await nav(page,'Profile');await page.locator('.avatar-options').getByRole('button',{name:'Character',exact:true}).click();await save(page);
 const stored=await readProfile(page);expect(stored).toMatchObject({avatarKind:'character',canUseMasterGuide:true,character:{bodyType:'female',style:'low-bun',hairColor:'red',skin:'deep',eyes:'blue',attire:'coach',background:'starlight',slots:['solo:exact-recall','solo:chapter-strong','team:first-fellowship']}});
 await page.reload();await ready(page);await expect(page.locator('[data-profile-user] img[data-character-portrait]').first()).toBeVisible();
 const portrait=page.locator('[data-profile-user] img[data-character-portrait]').first();
 expect(await portrait.evaluate(async image=>{await (image as HTMLImageElement).decode();const c=document.createElement('canvas');c.width=c.height=320;c.getContext('2d')!.drawImage(image as HTMLImageElement,0,0);const data=c.getContext('2d')!.getImageData(0,0,320,320).data;return [0,319,320*319,320*320-1].every(i=>data[i*4+3]===0);})).toBe(true);
 await page.locator('.slot-grid').scrollIntoViewIfNeeded();await expect(page.locator('.slot-grid img')).toHaveCount(3);await page.waitForFunction(()=>[...document.querySelectorAll('.slot-grid img')].every(i=>(i as HTMLImageElement).complete&&(i as HTMLImageElement).naturalWidth>0));
 await page.locator('.slot-grid img').evaluateAll(images=>Promise.all(images.map(i=>(i as HTMLImageElement).decode())));
 await page.locator('.slot-grid img').last().screenshot({path:info.outputPath('team-slot.png')});
 await page.screenshot({path:info.outputPath('coach-profile-desktop.png'),fullPage:true});
 await nav(page,'Share');await choose(page,'Add Chapter Strong patch');await page.getByRole('slider',{name:'Patch rotation'}).fill('-15');await page.getByRole('switch',{name:'Your username',exact:true}).click();await page.getByRole('switch',{name:'Erudoza name',exact:true}).click();await save(page);
 const shared=await readProfile(page);expect(shared.shareOptions).toEqual({showName:false,showBrand:false,showQR:true});expect(shared.sharePatches).toHaveLength(1);
 const png=await page.locator('.share-canvas').evaluate(c=>(c as HTMLCanvasElement).toDataURL().split(',')[1]);
 const pending=page.waitForEvent('download');await choose(page,'Download image');const file=info.outputPath('profile-card.png');await (await pending).saveAs(file);expect(hash(await readFile(file))).toBe(hash(Buffer.from(png,'base64')));
 await page.reload();await nav(page,'Share');await expect(page.getByRole('button',{name:'Download image',exact:true})).toBeEnabled();expect(await page.locator('.share-canvas').evaluate(c=>(c as HTMLCanvasElement).toDataURL().split(',')[1])).toBe(png);
 await page.setViewportSize({width:390,height:844});
 const handle=page.getByRole('button',{name:'Move Chapter Strong patch',exact:true});await handle.evaluate(element=>element.scrollIntoView({block:'center',behavior:'instant'}));const bounds=(await handle.boundingBox())!;const touch=await page.context().newCDPSession(page);const point={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+20,y:point.y-25}]});await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();await save(page);expect((await readProfile(page)).sharePatches[0].x).not.toBe(shared.sharePatches[0].x);
 for(const width of [390,320]){await page.setViewportSize({width,height:844});await expect(page.getByRole('button',{name:'Download image',exact:true})).toBeEnabled();await assertNoOverflow(page);await page.screenshot({path:info.outputPath(`coach-share-${width}.png`),fullPage:true});}
 // A second saved session cannot silently overwrite this editor's unsaved draft.
 await nav(page,'Character');await choose(page,'Light');const concurrent=await readProfile(page);const request=body(concurrent);request.character={...request.character,background:'basecamp'};expect((await page.request.put('/api/v1/profile/me/character',{data:request})).status()).toBe(200);
 await choose(page,'Save changes');await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('button',{name:'Light',exact:true})).toHaveAttribute('aria-pressed','true');await choose(page,'Reload saved profile');await page.getByRole('dialog').getByRole('button',{name:'Reload saved profile',exact:true}).click();await expect(page.getByRole('button',{name:'Deep',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(errors).toEqual([]);
});

test('student defaults, locked Honors, saved identity and device-native sharing',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 // Only the unavailable OS chooser is substituted. Canvas, login, assets and persistence are real.
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'canShare',{configurable:true,value:({files}:ShareData)=>files?.length===1&&files[0].type==='image/png'});
  Object.defineProperty(navigator,'share',{configurable:true,value:(data:ShareData)=>{const target=window as unknown as {shared?:ShareData;active?:boolean};target.shared=data;target.active=navigator.userActivation.isActive;return Promise.resolve();}});
 });
 await login(page,'student.fixture');await page.goto('/student/profile');await ready(page);
 const initial=await readProfile(page);expect(initial.character.slots).toEqual([null,null,null]);expect(initial.honors.every(h=>!h.earnedAtUtc)).toBe(true);expect(initial.canUseMasterGuide).toBe(false);
 await nav(page,'Character');await expect(page.getByRole('button',{name:'Master Guide · coach',exact:true})).toBeDisabled();for(const name of ['Short locs','Black','Deep','Blue','Woodland Basecamp'])await choose(page,name);
 await nav(page,'Profile');await page.locator('.avatar-options').getByRole('button',{name:'Character',exact:true}).click();await save(page);
 await nav(page,'Honors');await expect(page.getByRole('button',{name:/^Use .+ as profile image$/}).first()).toBeDisabled();
 await nav(page,'Share');await expect(page.getByRole('button',{name:/^Add .+ patch$/})).toHaveCount(0);await expect(page.getByRole('button',{name:'Share image',exact:true})).toBeEnabled();await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Share image',exact:true}).tap();
 const payload=await page.evaluate(async()=>{const t=window as unknown as {shared:ShareData;active:boolean};const file=t.shared.files![0];const png=await new Promise<string>(resolve=>{const r=new FileReader();r.onload=()=>resolve((r.result as string).split(',')[1]);r.readAsDataURL(file);});return {keys:Object.keys(t.shared),active:t.active,name:file.name,type:file.type,png};});
 expect({...payload,png:undefined}).toEqual({keys:['files'],active:true,name:'pathfinder.png',type:'image/png',png:undefined});expect(payload.png).toBe(await page.locator('.share-canvas').evaluate(c=>(c as HTMLCanvasElement).toDataURL().split(',')[1]));
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:844});for(const section of ['Profile','Character','Honors','Share']){await nav(page,section);await ready(page);await assertNoOverflow(page);if(section==='Character')await page.screenshot({path:info.outputPath(`student-character-${width}.png`),fullPage:true});}await expect(page.getByRole('button',{name:'Share image',exact:true})).toBeEnabled();await page.screenshot({path:info.outputPath(`student-share-${width}.png`),fullPage:true});}
 await logout(page);await login(page);await page.goto('/admin/profile');await ready(page);expect((await readProfile(page)).character.bodyType).toBe('female');
 expect(errors).toEqual([]);
});
