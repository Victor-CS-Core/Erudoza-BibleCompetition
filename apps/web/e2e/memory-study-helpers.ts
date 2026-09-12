import { expect, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { assertNoOverflow, login, logout } from './helpers';
import { answerCard, json, type StoredSource } from './study-source-helpers';
import type { ChallengeCard, ContentPack, Me, Student } from '../src/api/types';

export async function memoryStudyJourney(page:Page,info:TestInfo){
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await login(page);
  const me=await json<Me>(page.request,'/api/v1/me'),org=`/api/v1/organizations/${me.organizationId}`;
  const pack=(await json<ContentPack[]>(page.request,`${org}/content-packs`)).find(p=>p.packKey==='builtin-nkjv-dan')!;
  expect(pack).toBeTruthy();
  const source=(await json<StoredSource[]>(page.request,`${org}/content-packs/${pack.id}/source-units`)).find(s=>s.chapter===1&&s.verse===2)!;
  expect(source.canonicalText.split(' ')).toHaveLength(47);
  const username=info.project.name.startsWith('native')?'student.fixture':'daniel.student';
  const student=(await json<Student[]>(page.request,`${org}/students`)).find(s=>s.userName===username)!;
  const season=await json<{id:string}>(page.request,`${org}/seasons`,{name:`Memory input ${randomUUID()}`,yearLabel:'2026',ruleProfileKey:'PBE_STYLE_V1'});
  const range={bookKey:'DAN',startChapter:1,startVerse:2,endChapter:1,endVerse:2};
  await json(page.request,`${org}/seasons/${season.id}/scope`,{contentPackId:pack.id,includes:[range],excludes:[]});
  await json(page.request,`${org}/seasons/${season.id}/assignments`,{studentUserId:student.userId,contentPackId:pack.id,type:'PrimarySpecialist',difficulty:'Advanced',range});
  await json(page.request,`${org}/seasons/${season.id}/activate`,{});
  await json(page.request,`${org}/practice/pbe/seasons/${season.id}/enabled`,{enabled:true});
  await page.goto(`/admin/seasons/${season.id}/students/${student.userId}/progress`);
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});await expect(page.getByText('Coach-set difficulty: Advanced')).toBeVisible();await assertNoOverflow(page);await page.screenshot({path:info.outputPath(`memory-coach-${width}.png`),fullPage:true});}
  await logout(page);await login(page,username);
  await page.goto(`/student/study?seasonId=${season.id}&format=Memory`);
  await expect(page.getByRole('button',{name:'Start Advanced mastery challenge'})).toBeVisible();
  const drawn=page.waitForResponse(r=>/\/study\/sessions\/[^/]+\/next$/.test(r.url()));
  await page.getByRole('button',{name:'Start Memory warmup'}).click();
  const first=await (await drawn).json() as ChallengeCard;
  expect(first.evidenceProfile).toBe('memory-cued-v3');
  await answerCard(page,first,[source]);await page.getByTestId('submit-answer').click();await expect(page.getByTestId('challenge-feedback')).toBeVisible();
  const next=page.waitForResponse(r=>r.url().endsWith(`/study/sessions/${first.sessionId}/next`));await page.getByTestId('next-card').click();
  const builder=await (await next).json() as ChallengeCard;expect(builder.activityType).toBe('VerseBuilder');expect(builder.tokens).toHaveLength(12);
  await expect(page.getByTestId('submit-answer')).toBeDisabled();
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});await assertNoOverflow(page);await page.screenshot({path:info.outputPath(`memory-builder-${width}.png`),fullPage:true});}
  const button=page.getByRole('button',{name:`Add ${builder.tokens[0].display}`,exact:true});
  if(info.project.name==='mobile-chrome')await button.tap();else{await button.focus();await page.keyboard.press('Enter');}
  await page.getByRole('button',{name:'Undo last phrase'}).click();await expect(button).toBeFocused();
  await button.click();await page.getByRole('button',{name:'Clear verse'}).click();await expect(button).toBeFocused();
  await answerCard(page,builder,[source]);
  await expect(page.getByLabel('Your verse')).toHaveText(source.canonicalText);
  await expect(page.getByRole('button',{name:'Undo last phrase'})).toBeFocused();
  const attempts=`**/study/sessions/${first.sessionId}/attempts`;
  await page.route(attempts,route=>route.abort('failed'),{times:1});
  await page.getByTestId('submit-answer').click();await expect(page.getByRole('alert')).toContainText('could not be saved');
  const pending=await page.getByTestId('pending-answer').textContent();
  await page.reload();await expect(page.getByTestId('pending-answer')).toHaveText(pending!);
  await page.getByRole('button',{name:'Retry saved answer'}).click();await expect(page.getByTestId('challenge-feedback')).toContainText('Correct');
  await page.getByText('Optional full-verse recitation').click();await page.getByLabel('Your private recitation practice').fill('Private unscored recitation');
  await page.emulateMedia({reducedMotion:'reduce'});await assertNoOverflow(page);
  await page.goto(`/student/progress?seasonId=${season.id}`);
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});await expect(page.getByText('Coach-set difficulty: Advanced')).toBeVisible();await assertNoOverflow(page);await page.screenshot({path:info.outputPath(`memory-student-progress-${width}.png`),fullPage:true});}
  expect(errors).toEqual([]);
}
