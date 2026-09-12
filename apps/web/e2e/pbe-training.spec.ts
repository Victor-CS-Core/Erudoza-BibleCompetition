import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login, logout, assertNoOverflow } from './helpers';
import { answerCard, json, type StoredSource } from './study-source-helpers';
import type { AttemptResult, ChallengeCard, ContentPack, Me, Student, SubmitAttemptBody } from '../src/api/types';

test('B4 inline MissingWords preserve positions, exact recovery and frozen feedback at desktop and mobile widths',async({page},info)=>{
  test.setTimeout(180000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await login(page);
  const me=await json<Me>(page.request,'/api/v1/me'),org=`/api/v1/organizations/${me.organizationId}`;
  const pack=(await json<ContentPack[]>(page.request,`${org}/content-packs`)).find(p=>p.packKey==='builtin-nkjv-dan')!;
  const source=(await json<StoredSource[]>(page.request,`${org}/content-packs/${pack.id}/source-units`)).find(s=>s.chapter===1&&s.verse===2)!;
  const username=info.project.name.startsWith('native')?'student.fixture':'daniel.student';
  const student=(await json<Student[]>(page.request,`${org}/students`)).find(s=>s.userName===username)!;
  const season=await json<{id:string}>(page.request,`${org}/seasons`,{name:`B4 slots ${randomUUID()}`,yearLabel:'2026',ruleProfileKey:'PBE_STYLE_V1'});
  const range={bookKey:'DAN',startChapter:1,startVerse:2,endChapter:1,endVerse:2};
  await json(page.request,`${org}/seasons/${season.id}/scope`,{contentPackId:pack.id,includes:[range],excludes:[]});
  await json(page.request,`${org}/seasons/${season.id}/assignments`,{studentUserId:student.userId,contentPackId:pack.id,type:'PrimarySpecialist',difficulty:'Advanced',range});
  await json(page.request,`${org}/seasons/${season.id}/activate`,{});
  await json(page.request,`${org}/practice/pbe/seasons/${season.id}/enabled`,{enabled:true});
  await page.goto(`/admin/seasons/${season.id}/students/${student.userId}/progress`);
  for(const width of [1440,390,320]) {await page.setViewportSize({width,height:900});await expect(page.getByText('Coach-set difficulty: Advanced')).toBeVisible();await assertNoOverflow(page);await page.screenshot({path:info.outputPath(`b4-coach-${width}.png`),fullPage:true});}
  await logout(page);await login(page,username);
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const purpose of ['Warmup','Advanced'] as const){
    await page.goto(`/student/study?seasonId=${season.id}&format=Memory`);
    const drawn=page.waitForResponse(r=>/\/study\/sessions\/[^/]+\/next$/.test(r.url()));
    await page.getByRole('button',{name:purpose==='Warmup'?'Start Memory warmup':'Start Advanced mastery challenge'}).click();
    const card=await (await drawn).json() as ChallengeCard;
    expect(card.activityType).toBe('MissingWords');
    const hidden=card.tokens.filter(t=>t.hidden);
    expect(hidden.some((t,i)=>i>0&&t.index===hidden[i-1].index+1)).toBe(true);
    expect(hidden.some((t,i)=>i>0&&t.index>hidden[i-1].index+1)).toBe(true);
    const blanks=page.getByRole('textbox',{name:/^Blank \d+ of \d+$/});
    await expect(blanks).toHaveCount(hidden.length);
    await expect(page.getByLabel('Type the missing phrase')).toHaveCount(0);
    await expect(page.getByTestId('challenge-prompt')).toHaveCount(0);
    await expect(page.getByText(/Blank 1: Correct|Expected:/)).toHaveCount(0);
    await expect(page.getByTestId('submit-answer')).toBeEnabled();
    const first=blanks.nth(0),second=blanks.nth(1);
    await first.focus();await page.keyboard.press('Tab');await expect(second).toBeFocused();
    await page.keyboard.press('Shift+Tab');await expect(first).toBeFocused();
    await first.dispatchEvent('compositionstart');
    await first.dispatchEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true});
    await expect(first).toBeFocused();await expect(page.getByTestId('challenge-feedback')).toHaveCount(0);
    await first.dispatchEvent('compositionend',{data:'word'});
    await page.keyboard.press('Enter');await expect(second).toBeFocused();
    await blanks.last().focus();await page.keyboard.press('Enter');await expect(blanks.last()).not.toBeFocused();
    await first.fill('long-entry-with-no-breaks'.repeat(12));
    for(const width of [1440,390,320]) {await page.setViewportSize({width,height:900});await assertNoOverflow(page);expect(await first.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);expect(await second.evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(44);await page.screenshot({path:info.outputPath(`b4-${purpose}-entry-${width}.png`),fullPage:true});}
    await answerCard(page,card,[source]);
    if(purpose==='Advanced') {await first.fill(source.canonicalText.split(' ')[hidden[0].index]+' '+source.canonicalText.split(' ')[hidden[1].index]+' '+ 'long-entry-with-no-breaks'.repeat(12));await second.fill('');}
    const endpoint=`**/study/sessions/${card.sessionId}/attempts`;
    await page.route(endpoint,route=>route.abort('failed'),{times:1});
    await page.getByTestId('submit-answer').click();await expect(page.getByRole('alert')).toContainText('could not be saved');
    const pending=await page.evaluate(id=>JSON.parse(sessionStorage.getItem('erudoza:attempt:'+id)!),card.sessionId) as SubmitAttemptBody;
    expect(pending).not.toHaveProperty('submittedAnswer');expect(pending.missingWordAnswers?.map(a=>a.index)).toEqual(hidden.map(t=>t.index));
    if(purpose==='Advanced')expect(pending.missingWordAnswers?.[1].text).toBe('');
    await page.reload();await expect(page.getByTestId('pending-answer')).toBeVisible();
    for(const [i,slot] of pending.missingWordAnswers!.entries()){await expect(blanks.nth(i)).toHaveValue(slot.text);await expect(blanks.nth(i)).toBeDisabled();}
    for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});await assertNoOverflow(page);await page.screenshot({path:info.outputPath(`b4-${purpose}-pending-${width}.png`),fullPage:true});}
    let accepted:AttemptResult|undefined;
    await page.route(endpoint,async route=>{expect(route.request().postDataJSON()).toEqual(pending);const response=await route.fetch();expect(response.status()).toBe(200);accepted=await response.json() as AttemptResult;await route.abort('failed');},{times:1});
    await page.getByRole('button',{name:'Retry saved answer'}).click();await expect(page.getByRole('alert')).toContainText('could not be saved');
    expect(accepted?.isCorrect).toBe(purpose==='Warmup');expect(accepted?.missingWordResults).toHaveLength(hidden.length);
    await page.getByRole('button',{name:'Retry saved answer'}).click();await expect(page.getByTestId('challenge-feedback')).toBeVisible();
    const retry=await json<AttemptResult>(page.request,`/api/v1/study/sessions/${card.sessionId}/attempts`,pending);
    expect(retry).toEqual({...accepted,alreadyProcessed:true});
    await page.reload();await expect(page.getByTestId('challenge-feedback')).toBeVisible();
    for(const [i,slot] of pending.missingWordAnswers!.entries())await expect(blanks.nth(i)).toHaveValue(slot.text);
    await expect(page.getByText(purpose==='Warmup'?'Blank 1: Correct':`Blank 1: Review the source. Expected: ${source.canonicalText.split(' ')[hidden[0].index]}`,{exact:true})).toBeVisible();
    for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});await assertNoOverflow(page);await page.screenshot({path:info.outputPath(`b4-${purpose}-feedback-${width}.png`),fullPage:true});}
  }
  expect(errors).toEqual([]);
});
