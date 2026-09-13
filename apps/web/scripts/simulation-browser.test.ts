// @vitest-environment node
import {expect,it} from 'vitest';
import {chromium,type Page} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {probeFixture} from '../worker/native/practice/pbe-room-source-fixture';
import type {PracticeRoom,PracticeBootstrap} from '../src/api/practice';
import {TEST_ORG} from '../worker/native/test-runtime';

// Opt-in real-browser acceptance against an isolated native backend. Never production.
it.skipIf(process.env.SIMULATION_BROWSER!=='1')('rehearses together through real native HTTP/WebSocket and checks C layouts',async()=>{
 const f=await probeFixture(); f.useRealClock();
 const backend=await f.app.runtime.ready;
 const server=await createServer({configFile:resolve('vite.native.config.ts'),server:{https:{key:await readFile(resolve('../../.local/browser-key.pem')),cert:await readFile(resolve('../../.local/browser-cert.pem'))},host:'127.0.0.1',port:5214,strictPort:true,proxy:{'/api':{target:backend.origin,ws:true,headers:{Origin:'https://erudoza.test'}}}}});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const base=`/organizations/${TEST_ORG}/practice`,origin='https://127.0.0.1:5214',out=resolve('../../.local/browser');
 await mkdir(out,{recursive:true});
 const errors:string[]=[],screens:string[]=[];
 const json=async<T=PracticeRoom>(actor:number,path:string,data?:unknown)=>{const r=await f.call(actor,path,data);expect(r.status,await r.clone().text()).toBeLessThan(300);return r.json() as Promise<T>;};
 async function student(n:number){const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});const cookie=n<0?(await f.app.login()).headers.get('set-cookie')!.split(';')[0]:f.players[n].cookie;const [name,...parts]=cookie.split('=');await context.addCookies([{name,value:parts.join('='),url:origin,secure:true}]);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return page;}
 async function capture(page:Page,name:string){screens.push(name);for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(120);await page.locator('img[loading=lazy]').evaluateAll(images=>images.forEach(image=>{image.loading='eager';}));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' '+width).toBe(true);await expect.poll(()=>page.locator('img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>0)),{timeout:5000,message:name+' images'}).toBe(true);await page.screenshot({path:`${out}/${name}-${width}.png`,fullPage:await page.locator('dialog[open]').count()===0});}await page.setViewportSize({width:1440,height:1000});}
 try{
  await server.listen();
  await f.app.db.prepare("UPDATE Records SET data=json_set(data,'$.name','Genesis practice') WHERE kind='season' AND id=?").bind(f.season).run();
  for(const [index,name] of ['Noah','Eli','Maya','Sofia','Josiah','Grace'].entries())await f.app.db.prepare('UPDATE Users SET display_name=? WHERE id=?').bind(name,f.players[index].id).run();
  const a=await student(0),b=await student(1);
  await a.goto(`${origin}/student/practice?seasonId=${f.season}`);
  await expect.poll(()=>a.getByRole('button',{name:'Set up simulation',exact:true}).count()).toBe(1);
  await capture(a,'hub');
  await a.getByRole('button',{name:'Set up simulation',exact:true}).click();
  await capture(a,'editor-material');
  await a.getByRole('tab',{name:'Timers',exact:true}).click();
  await a.getByRole('combobox',{name:'Preset',exact:true}).selectOption('ShortPractice');
  await capture(a,'editor-timers');
  await a.getByRole('tab',{name:'Team',exact:true}).click();
  await a.getByRole('dialog').getByRole('combobox',{name:'Team size',exact:true}).selectOption('2');
  await capture(a,'editor-team');
  await a.getByRole('tab',{name:'Review',exact:true}).click();
  await capture(a,'editor-review');
  await a.getByRole('button',{name:/Create practice room|Save setup/}).click();
  await a.waitForURL(/\/student\/practice\/[a-f0-9-]+/);
  const id=new URL(a.url()).pathname.split('/').at(-1)!;
  expect((await f.call(0,`${base}/rooms/${id}`,undefined,{'x-test-room-real-clock':'1'})).status).toBe(200);
  let room=await json(0,`${base}/rooms/${id}`);
  const command=async(n:number,action:string,payload={})=>{room=await json(0,`${base}/rooms/${id}`);room=await json(n,`${base}/rooms/${id}/commands`,{commandId:crypto.randomUUID(),revision:room.revision,action,...payload});return room;};
  await command(0,'invite',{targetUserId:f.players[1].id,team:1});
  const bootstrap=await json<PracticeBootstrap>(1,`${base}/bootstrap`);
  await json(1,`${base}/invitations/${bootstrap.invitations.find(i=>i.roomId===id)!.id}/accept`,{team:1});
  await command(0,'scribe',{targetUserId:f.players[1].id});
  await b.goto(`${origin}/student/practice/${id}?seasonId=${f.season}`);
  await capture(a,'lobby');
  await command(0,'ready');await command(1,'ready');await command(0,'start');
  await expect.poll(()=>a.getByRole('button',{name:'I’m ready to hear the question'}).count()).toBe(1);
  await capture(a,'presentation');
  // Force the supported no-speech path to exercise real two-reading acknowledgment.
  await a.evaluate(()=>{Object.defineProperty(window,'speechSynthesis',{configurable:true,value:undefined});});
  await a.getByRole('button',{name:'I’m ready to hear the question'}).click();
  await a.getByRole('button',{name:'Finished first reading'}).click();
  await a.getByRole('button',{name:'Finished second reading'}).click();
  await b.getByRole('button',{name:/Scribe ready|Ready for the response|ready.*respond|Ready to answer|Confirm.*ready/i}).click();
  await expect.poll(async()=> (await json(0,`${base}/rooms/${id}`)).phase,{timeout:15000}).toBe('Response');
  await expect.poll(()=>b.locator('.practice-answer input,.practice-answer textarea').count()).toBeGreaterThan(0);
  const fields=b.locator('.practice-answer input,.practice-answer textarea');
  await fields.nth(0).fill('Alpha');await fields.nth(1).fill('Beta');
  await capture(b,'scribe-response');
  await capture(a,'member-response');
  expect(await a.getByRole('button',{name:/Submit team answer|Lock team answer|Lock final answer/}).count()).toBe(0);
  await b.getByRole('button',{name:/Submit team answer|Lock team answer|Lock final answer/}).click();
  await expect.poll(async()=> (await json(0,`${base}/rooms/${id}`)).phase).toBe('AnswerLocked');
  const locked=await json(0,`${base}/rooms/${id}`);expect(locked.results).toHaveLength(0);
  await capture(b,'answer-locked');
  await expect.poll(async()=> (await json(0,`${base}/rooms/${id}`)).phase,{timeout:10000}).toBe('Review');
  await capture(b,'answer-review');
  // Complete the remaining nine questions using the same real authority and clock.
  for(let index=1;index<10;index++){
   await expect.poll(async()=>{room=await json(0,`${base}/rooms/${id}`);return room.phase;},{timeout:18000}).toBe('Presentation');
   const questionId=room.question!.id;
   await command(0,'present',{questionId,delivery:'TextFallback'});
   await command(1,'present-ready',{questionId});
   await expect.poll(async()=> (await json(0,`${base}/rooms/${id}`)).phase,{timeout:6000}).toBe('Response');
   await command(1,'submit',{questionId,answers:['Alpha','Beta']});
  }
  await expect.poll(async()=> (await json(0,`${base}/rooms/${id}`)).status,{timeout:18000}).toBe('Completed');
  await expect.poll(()=>b.getByRole('button',{name:'Practice again',exact:true}).count()).toBe(1);
  await capture(b,'results');
  await b.getByRole('button',{name:'Practice again',exact:true}).click();
  await capture(b,'practice-again');
  await writeFile(`${out}/completion-diagnostics.json`,JSON.stringify({room:await json(0,`${base}/rooms/${id}`),bootstrap:await json<PracticeBootstrap>(0,`${base}/bootstrap`),profile:await json(0,'/profile/me'),records:await f.app.db.prepare("SELECT kind,data FROM Records WHERE kind IN ('mastery-honor','simulation-eligibility')").all()},null,2));
  await a.goto(`${origin}/student/profile`);
  await capture(a,'profile-before-selection');
  try{await expect.poll(()=>a.getByRole('button',{name:'Use First Rehearsal as profile image'}).isEnabled(),{timeout:25000}).toBe(true);}catch(error){await writeFile(`${out}/profile-failure.json`,JSON.stringify({profile:await json(0,'/profile/me'),text:await a.locator('body').innerText()},null,2));throw error;}
  await a.getByRole('button',{name:'Use First Rehearsal as profile image'}).click();
  await expect.poll(()=>a.getByRole('button',{name:'Wearing First Rehearsal as profile image'}).count()).toBe(1);
  await capture(a,'profile-earned');
  await a.goto(`${origin}/student/practice?seasonId=${f.season}`);
  await a.getByRole('button',{name:'Set up PVP',exact:true}).click();
  await a.getByRole('combobox',{name:'Practice mode',exact:true}).selectOption('Pbe');
  await a.getByRole('dialog').getByRole('combobox',{name:'Team size',exact:true}).selectOption('2');
  await capture(a,'pvp-setup');
  await a.getByRole('button',{name:'Create room',exact:true}).click();
  await a.waitForURL(/\/student\/practice\/[a-f0-9-]+/);
  const pvpId=new URL(a.url()).pathname.split('/').at(-1)!;
  let pvp=await json(0,`${base}/rooms/${pvpId}`);expect(pvp.teamCount).toBe(2);expect(pvp.simulation).toBeFalsy();
  expect((await f.call(0,`${base}/rooms/${pvpId}`,undefined,{'x-test-room-real-clock':'1'})).status).toBe(200);
  const pvpCommand=async(n:number,action:string,payload={})=>{pvp=await json(0,`${base}/rooms/${pvpId}`);pvp=await json(n,`${base}/rooms/${pvpId}/commands`,{commandId:crypto.randomUUID(),revision:pvp.revision,action,...payload});};
  for(const [n,team] of [[1,1],[2,2],[3,2]]){
   await pvpCommand(0,'invite',{targetUserId:f.players[n].id,team});
   const invite=(await json<PracticeBootstrap>(n,`${base}/bootstrap`)).invitations.find(i=>i.roomId===pvpId)!;
   await json(n,`${base}/invitations/${invite.id}/accept`,{team});
  }
  await capture(a,'pvp-lobby');
  for(let n=0;n<4;n++)await pvpCommand(n,'ready');
  await pvpCommand(0,'start');
  await pvpCommand(0,'present',{questionId:pvp.question!.id,delivery:'TextFallback'});
  await pvpCommand(2,'present',{questionId:pvp.question!.id,delivery:'TextFallback'});
  await expect.poll(async()=>(await json(0,`${base}/rooms/${pvpId}`)).phase,{timeout:6000}).toBe('Response');
  await capture(a,'pvp-response');
  const coach=await student(-1);
  await coach.goto(`${origin}/admin/practice?seasonId=${f.season}#create-room`);
  await expect.poll(()=>coach.getByRole('dialog',{name:'PVP setup'}).count()).toBe(1);
  await capture(coach,'coach-pvp-setup');
  expect(errors).toEqual([]);
  await writeFile(`${out}/acceptance.json`,JSON.stringify({screens,widths:[1440,390,320],errors,backend:'isolated native test runtime'},null,2));
 }finally{await browser.close();await server.close();await f.app.runtime.dispose();}
},300000);
