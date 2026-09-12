import { expect, test, type APIRequestContext, type Browser, type Page, type TestInfo } from "@playwright/test";
import { login, assertNoOverflow } from "./helpers";
import { randomUUID } from "node:crypto";

async function json(api: APIRequestContext, path: string, data?: unknown) {
  const response = data === undefined ? await api.get(path) : await api.post(path, { data });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.status() === 204 ? undefined : response.json();
}
async function setup(page: Page) {
  await login(page);
  const me = await json(page.request, "/api/v1/me");
  const org = `/api/v1/organizations/${me.organizationId}`;
  const path = `${org}/practice`;
  await json(page.request, `${path}/enabled`, { enabled: true });
  const packs = await json(page.request, `${org}/content-packs`);
  const pack = packs.find((p: { packKey: string }) => p.packKey === "dev-daniel");
  const units = await json(page.request, `${org}/content-packs/${pack.id}/source-units`);
  const unit = units[0];
  const season = await json(page.request, `${org}/seasons`, { name: `PVP live ${randomUUID()}`, yearLabel: "2026", ruleProfileKey: "PBE_STYLE_V1" });
  const range = { bookKey: unit.bookKey, startChapter: unit.chapter, startVerse: unit.verse, endChapter: unit.chapter, endVerse: unit.verse };
  await json(page.request, `${org}/seasons/${season.id}/scope`, { contentPackId: pack.id, includes: [range], excludes: [] });
  const students = await json(page.request, `${org}/students`);
  await json(page.request, `${org}/seasons/${season.id}/assignments`, { studentUserId: students[0].userId, contentPackId: pack.id, type: "RequiredCoverage", range });
  const activation = await json(page.request, `${org}/seasons/${season.id}/activate`, {});
  expect(activation.activated).toBeTruthy();
  await json(page.request, `${path}/questions/import`, { seasonId: season.id, questions: Array.from({ length: 12 }, (_, i) => ({
    contentPackId: pack.id, sourceUnitId: unit.id, prompt: `Synthetic fixture ${i + 1}: name the student in the development passage.`,
    kind: "ShortAnswer", parts: [{ acceptedAnswers: ["Daniel"], points: 1 }], ordered: false, evidence: unit.canonicalText, reference: unit.citation, version: 1,
  })) });
  const bank = await json(page.request, `${path}/bootstrap`);
  for (const q of bank.questions.filter((q: { seasonId: string }) => q.seasonId === season.id)) await json(page.request, `${path}/questions/${q.id}/publish`, {});
  return { org, path, seasonId: season.id };
}
async function newPlayer(browser: Browser, admin: Page, org: string, name: string) {
  const userName = `pvp.${randomUUID().slice(0, 12)}`;
  const player = await json(admin.request, `${org}/students`, { userName, displayName: name, password: process.env.ERUDOZA_E2E_PASSWORD! });
  const context = await browser.newContext({ baseURL: new URL(admin.url()).origin });
  const page = await context.newPage();
  await login(page, userName);
  return { context, page, id: player.userId };
}
async function command(page: Page, path: string, room: { id: string; revision: number }, action: string, payload = {}) {
  return json(page.request, `${path}/rooms/${room.id}/commands`, { commandId: randomUUID(), revision: room.revision, action, ...payload });
}
async function capturePractice(page: Page, info: TestInfo, role: "coach" | "student", stage: string) {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.locator(".practice-page img:visible").evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await assertNoOverflow(page);
    const dock = page.getByRole("navigation", { name: "Mobile navigation" });
    const playing = await page.locator('.practice-room[data-status="Playing"]').count() > 0;
    if (width <= 760 && !playing) {
      await expect(dock).toBeVisible();
      expect(await dock.locator("a span,button span").allTextContents()).toEqual(role === "coach" ? ["Overview", "Seasons", "Students", "More"] : ["HQ", "Study", "Honors", "More"]);
      for (const target of await dock.locator("a,button").all()) {
        const bounds = await target.boundingBox();
        expect(bounds!.height).toBeGreaterThanOrEqual(44);
        expect(bounds!.width).toBeGreaterThanOrEqual(44);
      }
      await expect(page.locator(".command-shortcut-bar")).toBeHidden();
    } else await expect(dock).toBeHidden();
    await page.screenshot({ path: info.outputPath(`${role}-${stage}-${width}.png`), fullPage: true });
  }
}

test("real browsers invite, synchronize and earn server-measured speed points", async ({ page: admin, browser }, info) => {
  test.setTimeout(150000);
  const fixture = await setup(admin);
  const a = await newPlayer(browser, admin, fixture.org, "Practice A");
  const b = await newPlayer(browser, admin, fixture.org, "Practice B");
  try {
    for (const [page, route, role] of [[admin, "/admin/practice", "coach"], [a.page, "/student/practice", "student"]] as const) {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: "Create a room" })).toBeVisible();
      await capturePractice(page, info, role, "hub");
    }
    await a.page.setViewportSize({ width: 1440, height: 1000 });
    await a.page.getByRole("combobox", { name: /^Season/ }).selectOption(fixture.seasonId);
    await a.page.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(a.page).toHaveURL(/\/student\/practice\/[a-f0-9-]+$/);
    await expect(a.page.getByText("Live connection", { exact: true })).toBeVisible();
    const roomId = new URL(a.page.url()).pathname.split("/").pop()!;
    await capturePractice(a.page, info, "student", "lobby");
    await a.page.getByRole("combobox", { name: /^Invite player/ }).selectOption(b.id);
    await a.page.getByRole("combobox", { name: /^Destination/ }).selectOption("2");
    await a.page.getByRole("button", { name: "Send invitation" }).click();
    await b.page.goto("/student/practice");
    await b.page.getByRole("button", { name: "Join Team 2", exact: true }).click();
    await expect(b.page.getByText("Live connection", { exact: true })).toBeVisible();
    await a.page.getByText("Manage Practice A", { exact: true }).click();
    await expect(a.page.getByRole("button", { name: "Move to Team 2" })).toBeDisabled();
    await a.page.getByRole("combobox", { name: /^Swap Practice A with/ }).selectOption(b.id);
    await a.page.getByRole("button", { name: "Swap teams", exact: true }).filter({ visible: true }).first().click();
    await expect.poll(async () => (await json(a.page.request, `${fixture.path}/rooms/${roomId}`)).members.find((member: { userId: string }) => member.userId === a.id).team).toBe(2);
    await a.page.getByRole("button", { name: "I’m ready" }).click();
    await b.page.getByRole("button", { name: "I’m ready" }).click();
    await expect(a.page.getByRole("button", { name: "Start match" })).toBeEnabled();
    await a.page.getByRole("button", { name: "Start match" }).click();
    await expect(a.page.getByRole("button", { name: "Lock final answer" })).toBeEnabled({ timeout: 30000 });
    await expect(b.page.getByRole("button", { name: "Lock final answer" })).toBeEnabled({ timeout: 5000 });
    await a.page.getByLabel("Suggestion", { exact: true }).fill("Private team suggestion");
    await a.page.getByRole("button", { name: "Share with team" }).click();
    await expect(a.page.getByText("Private team suggestion", { exact: false })).toBeVisible();
    expect((await json(b.page.request, `${fixture.path}/rooms/${roomId}`)).messages).toHaveLength(0);
    await a.page.getByLabel("Answer 1", { exact: true }).fill("Daniel");
    await b.page.getByLabel("Answer 1", { exact: true }).fill("Daniel");
    const submitted = a.page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(`/rooms/${roomId}/commands`) && response.request().postDataJSON().action === "submit");
    await a.page.getByRole("button", { name: "Lock final answer" }).click();
    const submitResponse = await submitted;
    expect(submitResponse.ok()).toBeTruthy();
    expect(submitResponse.request().postDataJSON()).not.toHaveProperty("responseTimeMs");
    await b.page.getByRole("button", { name: "Lock final answer" }).click();
    await expect.poll(async () => (await json(a.page.request, `${fixture.path}/rooms/${roomId}`)).results.length, { timeout: 35000 }).toBe(2);
    const room = await json(a.page.request, `${fixture.path}/rooms/${roomId}`);
    for (const result of room.results) { expect(result.accuracyHundredths).toBe(100); expect(result.speedHundredths).toBeGreaterThan(0); expect(result.speedHundredths).toBeLessThanOrEqual(25); expect(result.elapsedMs).toBeGreaterThan(0); }
    const original = room.results.find((result: { team: number }) => result.team === 2);
    await a.page.getByLabel("Reason for review", { exact: true }).fill("Please verify the accepted wording against the source.");
    await a.page.getByRole("button", { name: "Request coach review", exact: true }).click();
    await expect(a.page.getByText("Appeal pending", { exact: true })).toBeVisible();
    await admin.goto(`/admin/practice/${roomId}`);
    await expect(admin.getByRole("button", { name: "Record judgment" })).toHaveCount(1);
    await admin.getByLabel("Reason", { exact: true }).fill("Confirmed the submitted wording is an accepted answer.");
    await admin.getByRole("button", { name: "Record judgment" }).click();
    await expect.poll(async () => (await json(a.page.request, `${fixture.path}/rooms/${roomId}`)).results.find((result: { team: number }) => result.team === 2).resolved).toBe(true);
    const judged = (await json(a.page.request, `${fixture.path}/rooms/${roomId}`)).results.find((result: { team: number }) => result.team === 2);
    expect(judged.elapsedMs).toBe(original.elapsedMs);
    expect(judged.speedHundredths).toBe(original.speedHundredths);
    await capturePractice(a.page, info, "student", "match");
    await capturePractice(admin, info, "coach", "match");
    await command(a.page, fixture.path, room, "abandon");
  } finally { await a.context.close().catch(() => {}); await b.context.close().catch(() => {}); }
});

test("5v5 completes ten scored questions with ten authenticated players, refresh recovery and achievements", async ({ page: admin, browser }, info) => {
  test.setTimeout(600000);
  const fixture = await setup(admin);
  const players: Awaited<ReturnType<typeof newPlayer>>[] = [];
  try {
    for (let i = 0; i < 10; i++) players.push(await newPlayer(browser, admin, fixture.org, `Five-side ${i + 1}`));
    let room = await json(players[0].page.request, `${fixture.path}/rooms`, { seasonId: fixture.seasonId, teamSize: 5, questionCount: 10, coached: false });
    for (let i = 1; i < 10; i++) {
      room = await command(players[0].page, fixture.path, room, "invite", { targetUserId: players[i].id, team: i < 5 ? 1 : 2 });
      const inbox = await json(players[i].page.request, `${fixture.path}/bootstrap`);
      room = await json(players[i].page.request, `${fixture.path}/invitations/${inbox.invitations[0].id}/accept`, { team: i < 5 ? 1 : 2 });
    }
    expect(room.members.filter((m: { team: number }) => m.team === 1)).toHaveLength(5);
    expect(room.members.filter((m: { team: number }) => m.team === 2)).toHaveLength(5);
    for (const player of players) { await player.page.goto(`/student/practice/${room.id}`); await expect(player.page.getByText("Live connection", { exact: true })).toBeVisible(); room = await command(player.page, fixture.path, room, "ready"); }
    room = await command(players[0].page, fixture.path, room, "start");
    expect(room.status).toBe("Playing");
    for (let round = 0; round < 10; round++) {
      await expect(players[0].page.getByRole("heading", { name: `Question ${round + 1} of 10`, exact: true })).toBeVisible({ timeout: 45000 });
      if (round === 2) {
        await players[0].page.reload();
        await expect(players[0].page.getByText("Live connection", { exact: true })).toBeVisible();
        await expect(players[0].page.getByRole("heading", { name: "Question 3 of 10", exact: true })).toBeVisible();
      }
      for (const scribe of [players[0], players[5]]) {
        await expect(scribe.page.getByRole("button", { name: "Lock final answer" })).toBeEnabled({ timeout: 35000 });
        await scribe.page.getByLabel("Answer 1", { exact: true }).fill("Daniel");
        await scribe.page.getByRole("button", { name: "Lock final answer" }).click();
        // The second final answer can reveal the round before the lock notice paints.
        await expect(scribe.page.getByText("Answer locked. Wait for the question review.").or(scribe.page.getByRole("heading", { name: "Round review", exact: true }))).toBeVisible();
      }
      await expect.poll(async () => (await json(players[0].page.request, `${fixture.path}/rooms/${room.id}`)).results.length, { timeout: 35000 }).toBe((round + 1) * 2);
      console.info(`5v5 completed scored question ${round + 1}/10`);
    }
    await expect.poll(async () => (await json(players[0].page.request, `${fixture.path}/rooms/${room.id}`)).status, { timeout: 20000 }).toBe("Completed");
    room = await json(players[0].page.request, `${fixture.path}/rooms/${room.id}`);
    expect(room.results).toHaveLength(20);
    for (const score of room.scores) { expect(score.accuracyHundredths).toBe(1000); expect(score.speedHundredths).toBeGreaterThan(0); expect(score.totalHundredths).toBe(score.accuracyHundredths + score.speedHundredths); }
    await expect(players[0].page.getByText("Finalized result", { exact: true })).toBeVisible();
    await capturePractice(players[0].page, info, "student", "results");
    for (const player of players) {
      const bootstrap = await json(player.page.request, `${fixture.path}/bootstrap`);
      expect(bootstrap.achievements.some((award: { key: string; seasonId: string }) => award.key === "first-fellowship" && award.seasonId === fixture.seasonId)).toBe(true);
      if (player === players[0] || player === players[5]) expect(bootstrap.achievements.some((award: { key: string; seasonId: string }) => award.key === "shared-scribe" && award.seasonId === fixture.seasonId)).toBe(true);
      const profile = await json(player.page.request, "/api/v1/profile/me");
      const earned = profile.honors.filter((honor: { earnedAtUtc: string | null }) => honor.earnedAtUtc).map((honor: { key: string }) => honor.key);
      expect(earned).toEqual(player === players[0] || player === players[5] ? ["team:first-fellowship"] : []);
    }
    await players[0].page.goto("/student/profile");
    await players[0].page.getByRole("button", { name: "Use First Fellowship as profile image", exact: true }).click();
    await expect(players[0].page.locator('[data-profile-honor="team:first-fellowship"]')).toHaveCount(2);
    await players[0].page.reload();
    await expect(players[0].page.locator('[data-profile-honor="team:first-fellowship"]')).toHaveCount(2);
    const locked = await players[1].page.request.put("/api/v1/profile/me/avatar", { data: { honorKey: "team:first-fellowship" } });
    expect(locked.status()).toBe(403);
  } finally { for (const player of players) await player.context.close().catch(() => {}); }
});

test('PBE six-student independent room reads twice, retries a locked final and rotates the served question',async({page:admin,browser},info)=>{
 test.setTimeout(150000);
 const fixture=await setup(admin),players=[] as Awaited<ReturnType<typeof newPlayer>>[];
 const packs=await json(admin.request,`${fixture.org}/content-packs`),pack=packs.find((p:{packKey:string})=>p.packKey==='dev-daniel');
 const units=await json(admin.request,`${fixture.org}/content-packs/${pack.id}/source-units`),source=units[0],answer=source.canonicalText.trim().split(/\s+/)[0];
 const range={bookKey:source.bookKey,startChapter:source.chapter,startVerse:source.verse,endChapter:source.chapter,endVerse:source.verse};
 try{
  for(let n=0;n<6;n++){
   const player=await newPlayer(browser,admin,fixture.org,`Rehearsal ${n+1}`);players.push(player);
   await json(admin.request,`${fixture.org}/seasons/${fixture.seasonId}/assignments`,{studentUserId:player.id,contentPackId:pack.id,type:'PrimarySpecialist',difficulty:'Advanced',range});
  }
  const target=randomUUID(),pbe=`${fixture.path}/pbe/seasons/${fixture.seasonId}`;
  const questions=Array.from({length:12},(_,i)=>({schemaVersion:2,id:randomUUID(),version:1,contentPackId:pack.id,sourceUnitId:source.id,sourceUnitIds:[source.id],sourceKind:'Scripture',reference:source.citation,evidence:source.canonicalText,kind:'ShortAnswer',ordered:false,prompt:`What is the opening word of the approved passage? Rehearsal variant ${i+1}.`,parts:[{targetId:target,acceptedAnswers:[answer],points:1}]}));
  await json(admin.request,pbe+'/questions/import',{targets:[{id:target,sourceUnitIds:[source.id],skill:'FactualRecall',label:'Opening word'}],questions});for(const q of questions)await json(admin.request,`${pbe}/questions/${q.id}/1/publish`,{});await json(admin.request,pbe+'/enabled',{enabled:true});
  await admin.goto('/admin/practice');await admin.getByRole('combobox',{name:'Season',exact:true}).selectOption(fixture.seasonId);await admin.getByRole('combobox',{name:'Practice mode',exact:true}).selectOption('Pbe');await capturePractice(admin,info,'coach','pbe-create');
  await expect(admin.getByText('Team 2',{exact:true})).toHaveCount(0);await admin.getByRole('button',{name:'Create room',exact:true}).click();await expect(admin).toHaveURL(/\/admin\/practice\/[a-f0-9-]+$/);const coachRoom=await json(admin.request,`${fixture.path}/rooms/${new URL(admin.url()).pathname.split('/').pop()}`);expect(coachRoom.coached).toBe(false);expect(coachRoom.members).toHaveLength(0);

  const owner=players[0].page;await owner.addInitScript(()=>Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[],addEventListener(){},removeEventListener(){},cancel(){},speak(){}}}));await owner.emulateMedia({reducedMotion:'reduce'});
  await owner.goto('/student/practice');await owner.getByRole('combobox',{name:'Season',exact:true}).selectOption(fixture.seasonId);await owner.getByRole('combobox',{name:'Practice mode',exact:true}).selectOption('Pbe');expect(await owner.getByRole('combobox',{name:'Team size',exact:true}).inputValue()).toBe('6');expect(await owner.getByRole('combobox',{name:'Active teams',exact:true}).inputValue()).toBe('1');
  const id=coachRoom.id;let room=coachRoom;
  async function fillRoom(current:typeof room,creator=owner){
   for(let n=current.members.some((m:{userId:string})=>m.userId===players[0].id)?1:0;n<players.length;n++){current=await command(creator,fixture.path,current,'invite',{targetUserId:players[n].id,team:1});const inbox=await json(players[n].page.request,fixture.path+'/bootstrap');const invite=inbox.invitations.find((i:{roomId:string})=>i.roomId===current.id);current=await json(players[n].page.request,`${fixture.path}/invitations/${invite.id}/accept`,{team:1});}
   for(const player of players)current=await command(player.page,fixture.path,current,'ready');return current;
  }
  room=await fillRoom(room,admin);await owner.goto(`/student/practice/${id}`);await expect(owner.getByRole('button',{name:'Start match',exact:true})).toBeEnabled();await expect(owner.getByRole('heading',{name:'Team 2',exact:true})).toHaveCount(0);await capturePractice(owner,info,'student','pbe-six-lobby');
  await owner.getByRole('button',{name:'Start match',exact:true}).click();await expect(owner.getByRole('button',{name:'I’m ready to hear the question'})).toBeVisible();room=await json(owner.request,`${fixture.path}/rooms/${id}`);const first=room.question.id;
  await capturePractice(owner,info,'student','pbe-reading');await owner.getByRole('button',{name:'I’m ready to hear the question'}).click();await owner.getByRole('button',{name:'Finished first reading'}).click();await owner.getByRole('button',{name:'Finished second reading'}).click();
  await expect(owner.getByRole('button',{name:'Lock final answer'})).toBeEnabled({timeout:10000});await owner.getByRole('textbox',{name:'Answer 1',exact:true}).fill(answer);await owner.getByRole('button',{name:'Save team draft'}).click();await expect(owner.getByRole('button',{name:'Lock final answer'})).toBeEnabled();
  let lost=false;let originalId='';let retryId='';await owner.route(`**/practice/rooms/${id}/commands`,async route=>{const payload=route.request().postDataJSON();if(payload.action==='submit'){if(!lost){lost=true;originalId=payload.commandId;expect((await route.fetch()).ok()).toBeTruthy();await route.abort();return;}retryId=payload.commandId;}await route.continue();});
  await owner.getByRole('button',{name:'Lock final answer'}).click();await owner.getByRole('button',{name:'Retry original action'}).click();await expect(owner.getByRole('button',{name:'Retry original action'})).toHaveCount(0);expect(retryId).toBe(originalId);
  room=await json(owner.request,`${fixture.path}/rooms/${id}`);expect(room.results[0]).toMatchObject({answers:[answer],accuracyHundredths:100,speedHundredths:0,availableHundredths:100});expect(room.scores).toHaveLength(1);await expect(owner.getByText('1.00 / 1.00 rubric points').first()).toBeVisible();await capturePractice(owner,info,'student','pbe-rubric-review');
  let replay=await json(owner.request,fixture.path+'/rooms',{seasonId:fixture.seasonId,format:'Pbe',teamCount:1,teamSize:6,questionCount:10,coached:false});replay=await fillRoom(replay);replay=await command(owner,fixture.path,replay,'start');expect(replay.question.id).not.toBe(first);await owner.goto(`/student/practice/${replay.id}`);await expect(owner.getByRole('button',{name:'I’m ready to hear the question'})).toBeVisible();
 }finally{for(const player of players)await player.context.close().catch(()=>{});}
});

test('PBE coached presentation waits for two readings and both current student scribes',async({page:admin,browser},info)=>{
 test.setTimeout(120000);
 const fixture=await setup(admin),players=[] as Awaited<ReturnType<typeof newPlayer>>[];
 const packs=await json(admin.request,`${fixture.org}/content-packs`),pack=packs.find((p:{packKey:string})=>p.packKey==='dev-daniel');
 const units=await json(admin.request,`${fixture.org}/content-packs/${pack.id}/source-units`),source=units[0],answer=source.canonicalText.trim().split(/\s+/)[0];
 const range={bookKey:source.bookKey,startChapter:source.chapter,startVerse:source.verse,endChapter:source.chapter,endVerse:source.verse};
 try{
  for(let n=0;n<4;n++){
   const player=await newPlayer(browser,admin,fixture.org,`Coached rehearsal ${n+1}`);players.push(player);
   await json(admin.request,`${fixture.org}/seasons/${fixture.seasonId}/assignments`,{studentUserId:player.id,contentPackId:pack.id,type:'PrimarySpecialist',difficulty:'Advanced',range});
  }
  const target=randomUUID(),pbe=`${fixture.path}/pbe/seasons/${fixture.seasonId}`;
  const questions=Array.from({length:12},(_,i)=>({schemaVersion:2,id:randomUUID(),version:1,contentPackId:pack.id,sourceUnitId:source.id,sourceUnitIds:[source.id],sourceKind:'Scripture',reference:source.citation,evidence:source.canonicalText,kind:'ShortAnswer',ordered:false,prompt:`What is the opening word of the approved passage? Rehearsal variant ${i+1}.`,parts:[{targetId:target,acceptedAnswers:[answer],points:1}]}));
  await json(admin.request,pbe+'/questions/import',{targets:[{id:target,sourceUnitIds:[source.id],skill:'FactualRecall',label:'Opening word'}],questions});for(const q of questions)await json(admin.request,`${pbe}/questions/${q.id}/1/publish`,{});await json(admin.request,pbe+'/enabled',{enabled:true});

  let room=await json(admin.request,fixture.path+'/rooms',{seasonId:fixture.seasonId,format:'Pbe',teamCount:2,teamSize:2,questionCount:10,coached:true});
  for(let n=0;n<4;n++){room=await command(admin,fixture.path,room,'invite',{targetUserId:players[n].id,team:Math.floor(n/2)+1});const inbox=await json(players[n].page.request,fixture.path+'/bootstrap');const invite=inbox.invitations.find((i:{roomId:string})=>i.roomId===room.id);room=await json(players[n].page.request,`${fixture.path}/invitations/${invite.id}/accept`,{team:Math.floor(n/2)+1});}
  for(const player of players)room=await command(player.page,fixture.path,room,'ready');
  await admin.goto(`/admin/practice/${room.id}`);await admin.getByRole('button',{name:'Start match',exact:true}).click();
  await expect(admin.getByRole('button',{name:'Confirm first coach reading'})).toBeVisible();await capturePractice(admin,info,'coach','pbe-coached-reading');
  await admin.getByRole('button',{name:'Confirm first coach reading'}).click();room=await json(admin.request,`${fixture.path}/rooms/${room.id}`);expect(room.phase).toBe('Presentation');expect(room.coachReading).toBeNull();
  await admin.getByRole('button',{name:'Confirm second coach reading'}).click();
  await expect(admin.getByRole('button',{name:'Confirm second coach reading'})).toHaveCount(0);expect((await json(admin.request,`${fixture.path}/rooms/${room.id}`)).phase).toBe('Presentation');
  for(const n of [0,2]){const student=players[n].page;await student.goto(`/student/practice/${room.id}`);await expect(student.getByRole('button',{name:'Ready for coach presentation'})).toBeVisible();if(n===0)await capturePractice(student,info,'student','pbe-coached-ready');await student.getByRole('button',{name:'Ready for coach presentation'}).click();await expect(student.getByRole('button',{name:'Ready for coach presentation'})).toHaveCount(0);if(n===0)expect((await json(admin.request,`${fixture.path}/rooms/${room.id}`)).phase).toBe('Presentation');}
  await expect(admin.getByRole('button',{name:'Lock final answer'})).toHaveCount(0);
  for(const n of [0,2]){const student=players[n].page;await expect(student.getByRole('button',{name:'Lock final answer'})).toBeEnabled({timeout:10000});await student.getByRole('textbox',{name:'Answer 1',exact:true}).fill(answer);await student.getByRole('button',{name:'Lock final answer'}).click();}
  await expect(admin.getByRole('button',{name:'Next question',exact:true})).toBeEnabled();room=await json(admin.request,`${fixture.path}/rooms/${room.id}`);expect(room.phase).toBe('Review');expect(room.results).toHaveLength(2);expect(Object.values(room.presentationDelivery)).toEqual(['Coach','Coach']);await capturePractice(admin,info,'coach','pbe-coached-review');
  await admin.getByRole('button',{name:'Next question',exact:true}).click();await expect(admin.getByRole('button',{name:'Confirm first coach reading'})).toBeVisible();
 }finally{for(const player of players)await player.context.close().catch(()=>{});}
});

test('PBE deferred review lets students finish and replay before a coach corrects the frozen rubric',async({page:admin,browser},info)=>{
 test.setTimeout(300000);const fixture=await setup(admin),players=[] as Awaited<ReturnType<typeof newPlayer>>[];
 const pack=(await json(admin.request,`${fixture.org}/content-packs`)).find((p:{packKey:string})=>p.packKey==='dev-daniel'),source=(await json(admin.request,`${fixture.org}/content-packs/${pack.id}/source-units`))[0],words=source.canonicalText.trim().split(/\s+/).slice(0,2);
 const range={bookKey:source.bookKey,startChapter:source.chapter,startVerse:source.verse,endChapter:source.chapter,endVerse:source.verse};
 try{
  for(let n=0;n<2;n++){const p=await newPlayer(browser,admin,fixture.org,`Deferred review ${n+1}`);players.push(p);await json(admin.request,`${fixture.org}/seasons/${fixture.seasonId}/assignments`,{studentUserId:p.id,contentPackId:pack.id,type:'PrimarySpecialist',difficulty:'Advanced',range});}
  const tids=[randomUUID(),randomUUID()],pbe=`${fixture.path}/pbe/seasons/${fixture.seasonId}`,questions=Array.from({length:11},(_,n)=>({schemaVersion:2,id:randomUUID(),version:1,contentPackId:pack.id,sourceUnitId:source.id,sourceUnitIds:[source.id],sourceKind:'Scripture',reference:source.citation,evidence:source.canonicalText,kind:'List',ordered:false,prompt:`Name the first two words. Deferred review variant ${n+1}.`,parts:tids.map((targetId,i)=>({targetId,acceptedAnswers:[words[i]],points:1}))}));
  await json(admin.request,pbe+'/questions/import',{targets:tids.map((id,i)=>({id,sourceUnitIds:[source.id],skill:'FactualRecall',label:`Opening word ${i+1}`})),questions});for(const q of questions)await json(admin.request,`${pbe}/questions/${q.id}/1/publish`,{});await json(admin.request,pbe+'/enabled',{enabled:true});
  let room=await json(admin.request,fixture.path+'/rooms',{seasonId:fixture.seasonId,format:'Pbe',teamCount:1,teamSize:2,questionCount:10});
  for(const p of players){room=await command(admin,fixture.path,room,'invite',{targetUserId:p.id});await p.page.goto('/student/practice');await expect(p.page.getByRole('button',{name:'Join Team 2',exact:true})).toHaveCount(0);await p.page.getByRole('button',{name:'Join Team 1',exact:true}).click();await expect(p.page).toHaveURL(new RegExp(`/student/practice/${room.id}$`));room=await json(p.page.request,`${fixture.path}/rooms/${room.id}`);}
  for(const p of players)room=await command(p.page,fixture.path,room,'ready');
  const student=players[0].page;await info.attach('available-local-speech-voices.json',{body:JSON.stringify(await student.evaluate(()=>({userAgent:navigator.userAgent,voices:window.speechSynthesis?.getVoices().map(v=>({name:v.name,lang:v.lang,localService:v.localService}))??[]}))),contentType:'application/json'});await admin.emulateMedia({reducedMotion:'reduce'});await student.addInitScript(()=>Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[],addEventListener(){},removeEventListener(){},cancel(){},speak(){}}}));await student.emulateMedia({reducedMotion:'reduce'});await student.goto(`/student/practice/${room.id}`);await expect(student.getByRole('button',{name:'Start match',exact:true})).toBeEnabled({timeout:10000});await student.getByRole('button',{name:'Start match',exact:true}).click();let firstQuestion='';
  for(let n=0;n<10;n++){
   await expect(student.getByRole('button',{name:'I’m ready to hear the question'})).toBeVisible({timeout:20000});room=await json(student.request,`${fixture.path}/rooms/${room.id}`);if(n===0)firstQuestion=room.question.id;
   if(n===1)await student.evaluate(()=>{let readings=0;Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(public text:string){}}});Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[{localService:true,name:'Synthetic browser control voice',lang:'en-US'}],addEventListener(){},removeEventListener(){},cancel(){},speak(utterance:SpeechSynthesisUtterance){document.documentElement.dataset.pbeSyntheticReadings=String(++readings);queueMicrotask(()=>utterance.onend?.(new Event('end') as SpeechSynthesisEvent));}}});});
   await student.getByRole('button',{name:'I’m ready to hear the question'}).press('Enter');if(n!==1){if(n===0){await expect(student.getByText(/does not reproduce an audible event reading/)).toBeVisible();await capturePractice(student,info,'student','deferred-text-presentation');}await student.getByRole('button',{name:'Finished first reading'}).press('Enter');await student.getByRole('button',{name:'Finished second reading'}).press('Enter');}else{await expect(student.locator('html')).toHaveAttribute('data-pbe-synthetic-readings','2');await student.evaluate(()=>Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[],addEventListener(){},removeEventListener(){},cancel(){},speak(){}}}));}await expect(student.getByRole('button',{name:'Lock final answer'})).toBeEnabled({timeout:10000});await student.getByRole('textbox',{name:'Answer 1',exact:true}).fill(words[0]);await student.getByRole('textbox',{name:'Answer 2',exact:true}).fill(n===0?'wrong':words[1]);await student.getByRole('button',{name:'Lock final answer'}).click();
   if(n===0){await student.getByRole('button',{name:'Flag answer',exact:true}).click();await student.getByRole('textbox',{name:'Reason for review',exact:true}).fill('Please check the second frozen rubric part later.');await student.getByRole('button',{name:'Request coach review',exact:true}).press('Enter');await expect(student.getByText('Review pending',{exact:true})).toBeVisible();}
  }
  await expect(student.getByText('Provisional result',{exact:true})).toBeVisible({timeout:20000});await capturePractice(student,info,'student','deferred-pending-complete');
  await student.getByRole('link',{name:'Back to Team Practice',exact:true}).click();await student.getByRole('combobox',{name:'Season',exact:true}).selectOption(fixture.seasonId);await student.getByRole('combobox',{name:'Practice mode',exact:true}).selectOption('Pbe');await student.getByRole('button',{name:'Create room',exact:true}).click();await expect(student).toHaveURL(/\/student\/practice\/[a-f0-9-]+$/);expect(new URL(student.url()).pathname).not.toContain(room.id);
  await admin.goto('/admin/practice/reviews');await expect(admin.getByRole('heading',{name:questions.find(q=>q.id===firstQuestion)!.prompt,exact:true})).toBeVisible();await capturePractice(admin,info,'coach','deferred-queue');await admin.getByLabel(/Part 2 points/).fill('1');await admin.keyboard.press('Tab');await expect(admin.getByRole('textbox',{name:'Reason for the correction',exact:true})).toBeFocused();await admin.getByRole('textbox',{name:'Reason for the correction',exact:true}).fill('Frozen source supports both requested parts.');await admin.getByRole('button',{name:'Save rubric correction',exact:true}).press('Enter');await expect(admin.getByText(/Practice evidence is up to date/)).toBeVisible();
  await student.goto(`/student/practice/${room.id}`);await student.getByRole('button',{name:'Refresh reviewed scores',exact:true}).click();await expect(student.getByText('Finalized result',{exact:true})).toBeVisible();const first=student.locator('details.practice-review').filter({hasText:questions.find(q=>q.id===firstQuestion)!.prompt});await first.locator('summary').click();await expect(first.getByText('Review resolved',{exact:true})).toBeVisible();await capturePractice(student,info,'student','deferred-resolved');
  const saved=await json(student.request,`${fixture.path}/rooms/${room.id}`);expect(saved.results.find((r:{questionId:string})=>r.questionId===firstQuestion)).toMatchObject({answers:[words[0],'wrong'],accuracyHundredths:200,originalAccuracyHundredths:100,dispute:{status:'Resolved',revision:2}});
  const solo=await json(student.request,'/api/v1/study/sessions',{seasonId:fixture.seasonId,format:'Pbe',mode:'Practice'}),card=await json(student.request,`/api/v1/study/sessions/${solo.id}/next`);await json(student.request,`/api/v1/study/sessions/${solo.id}/attempts`,{clientSubmissionId:randomUUID(),challengeCardId:card.id,answers:[words[0],'wrong'],hintsUsed:false});await json(student.request,`/api/v1/study/sessions/${solo.id}/complete`,{});await student.goto(`/student/sessions/${solo.id}/recap`);await student.getByRole('button',{name:'Flag answer',exact:true}).click();await student.getByRole('textbox',{name:'Reason for review',exact:true}).fill('Please check this solo answer later too.');await student.getByRole('button',{name:'Request coach review',exact:true}).click();await expect(student.getByText('Review pending',{exact:true})).toBeVisible();await capturePractice(student,info,'student','solo-pending-recap');
  await json(admin.request,fixture.path+'/enabled',{enabled:false});await admin.goto('/admin/practice');await admin.getByRole('link',{name:'Open PBE answer reviews',exact:true}).click();await admin.getByLabel(/Part 2 points/).fill('1');await admin.getByRole('textbox',{name:'Reason for the correction',exact:true}).fill('This saved solo rubric supports both parts.');await admin.getByRole('button',{name:'Save rubric correction',exact:true}).click();await expect(admin.getByText(/Practice evidence is up to date/)).toBeVisible();await student.getByRole('button',{name:'Refresh reviewed scores',exact:true}).click();await expect(student.getByText('Review resolved',{exact:true})).toBeVisible();await expect(student.getByText('2 / 2 points',{exact:true})).toBeVisible();await expect(student.getByRole('link',{name:'Practice again',exact:true})).toBeVisible();await capturePractice(student,info,'student','solo-corrected-recap');

 }finally{for(const p of players)await p.context.close().catch(()=>{});}
});
