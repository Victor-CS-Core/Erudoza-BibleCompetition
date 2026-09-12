import { expect, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { assertNoOverflow, login, logout } from './helpers';
import { json, type StoredSource } from './study-source-helpers';
import type { ChallengeCard, ContentPack, Me, Student } from '../src/api/types';
import type { PbeSessionCard, PbeAttemptResult } from '../src/api/pbeTypes';
import type { SessionRecap, TrainingToday } from '../src/api/trainingTypes';
export async function pbeDailyJourney(page: Page, info: TestInfo) {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await login(page);
    const me = await json<Me>(page.request, '/api/v1/me'), org = `/api/v1/organizations/${me.organizationId}`;
    const pack = (await json<ContentPack[]>(page.request, `${org}/content-packs`)).find(p => p.packKey === 'dev-daniel')!;
    const all = (await json<StoredSource[]>(page.request, `${org}/content-packs/${pack.id}/source-units`)).sort((a, b) => a.ordinal - b.ordinal);
    const firstChapter = all.filter(s => s.chapter === all[0].chapter);
    expect(firstChapter.length).toBeGreaterThanOrEqual(8);
    const username = info.project.name.startsWith('native') ? 'student.fixture' : 'daniel.student', student = (await json<Student[]>(page.request, `${org}/students`)).find(s => s.userName === username)!;
    const scenarios: {
        seasonId: string;
        answers: Map<string, string[]>;
        count: number;
        label: string;
    }[] = [];
    for (const [label, sources] of [['short', firstChapter.slice(0, 1)], ['eight-verse', firstChapter.slice(0, 8)], ['full-chapter', firstChapter]] as const) {
        const season = await json<{
            id: string;
        }>(page.request, `${org}/seasons`, { name: `PBE ${label} ${randomUUID()}`, yearLabel: '2026', ruleProfileKey: 'PBE_STYLE_V1' });
        const range = { bookKey: sources[0].bookKey, startChapter: sources[0].chapter, startVerse: sources[0].verse, endChapter: sources.at(-1)!.chapter, endVerse: sources.at(-1)!.verse };
        await json(page.request, `${org}/seasons/${season.id}/scope`, { contentPackId: pack.id, includes: [range], excludes: [] });
        await json(page.request, `${org}/seasons/${season.id}/assignments`, { studentUserId: student.userId, contentPackId: pack.id, type: 'PrimarySpecialist', difficulty: 'Standard', range });
        await json(page.request, `${org}/seasons/${season.id}/activate`, {});
        const answers = new Map<string, string[]>(), targets: unknown[] = [], questions: Record<string, unknown>[] = [];
        for (const source of sources) {
            const tids = [randomUUID(), randomUUID()], words = source.canonicalText.trim().split(/\s+/).slice(0, 2);
            expect(words).toHaveLength(2);
            targets.push(...tids.map((id, i) => ({ id, sourceUnitIds: [source.id], skill: 'FactualRecall', label: `Fixture word ${i + 1}` })));
            for (let variant = 0; variant < 2; variant++) {
                const id = randomUUID();
                answers.set(id, words);
                questions.push({ schemaVersion: 2, id, version: 1, contentPackId: pack.id, sourceUnitId: source.id, sourceUnitIds: [source.id], sourceKind: 'Scripture', kind: 'List', prompt: `Give the first two words of this fixture passage. Variant ${variant + 1}.`, reference: source.citation, evidence: source.canonicalText, ordered: false, parts: tids.map((targetId, i) => ({ targetId, acceptedAnswers: [words[i]], points: 1 })) });
            }
        }
        const base = `${org}/practice/pbe/seasons/${season.id}`;
        await json(page.request, base + '/questions/import', { targets, questions });
        for (const q of questions)
            await json(page.request, `${base}/questions/${q.id}/1/publish`, {});
        await json(page.request, base + '/enabled', { enabled: true });
        scenarios.push({ seasonId: season.id, answers, count: Math.min(8, questions.length), label });
    }
    await page.goto(`/admin/seasons/${scenarios[0].seasonId}?step=review`);
    for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await assertNoOverflow(page);
        await page.screenshot({ path: info.outputPath(`pbe-daily-coach-${width}.png`), fullPage: true });
    }
    await logout(page);
    await login(page, username);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const memory = await json<{
        id: string;
    }>(page.request, '/api/v1/study/sessions', { seasonId: scenarios[0].seasonId, format: 'Memory', mode: 'Practice' });
    const memoryDrawn = page.waitForResponse(response => response.url().endsWith(`/study/sessions/${memory.id}/next`));
    await page.goto(`/student/study?sessionId=${memory.id}&format=Pbe&seasonId=${scenarios[0].seasonId}`);
    const memoryCard = await (await memoryDrawn).json() as ChallengeCard;
    expect(memoryCard.sessionId).toBe(memory.id);
    expect(memoryCard.activityType).toBe('MissingWords');
    const hidden = memoryCard.tokens.filter(token => token.hidden);
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.every(token => token.display === '____')).toBe(true);
    const memoryPassage = page.getByRole('group', { name: 'Passage with missing words' });
    await expect(memoryPassage).toBeVisible();
    for (const [ordinal] of hidden.entries()) await expect(memoryPassage.getByRole('textbox', { name: `Blank ${ordinal + 1} of ${hidden.length}`, exact: true })).toHaveValue('');
    await expect(page.getByRole('heading', { name: 'PBE practice', exact: true })).toHaveCount(0);
    for (const scenario of scenarios) {
        const seen = new Set<string>();
        const reps = scenario.label === 'short' ? 1 : 2;
        for (let repeat = 0; repeat < reps; repeat++) {
            await page.goto(`/student?seasonId=${scenario.seasonId}`);
            const before = await json<TrainingToday>(page.request, `/api/v1/progress/me/today?seasonId=${scenario.seasonId}`);
            expect(before.format).toBe('Pbe');
            const firstResponse = page.waitForResponse(r => /\/study\/sessions\/[^/]+\/next$/.test(r.url()));
            if (repeat === 0)
                await page.getByTestId('start-todays-deck').click();
            else
                await page.getByRole('link', { name: 'Practice another drill', exact: true }).click();
            let card = await (await firstResponse).json() as PbeSessionCard;
            expect(card.format).toBe('Pbe');
            const sid = card.sessionId, selected = new Set<string>();
            for (let index = 0; index < scenario.count; index++) {
                selected.add(card.question.id);
                seen.add(card.question.id);
                expect(card.total).toBe(scenario.count);
                expect(JSON.stringify(card)).not.toMatch(/acceptedAnswers|sourceEvidence|"evidence"/);
                await expect(page.getByLabel('Answer 1')).toBeVisible();
                if (index === 0) {
                    for (const width of [1440, 390, 320]) {
                        await page.setViewportSize({ width, height: 900 });
                        await assertNoOverflow(page);
                        await page.screenshot({ path: info.outputPath(`pbe-${scenario.label}-${repeat}-question-${width}.png`), fullPage: true });
                    }
                }
                if (index === 1) {
                    await page.getByRole('button', { name: 'Read source with assistance' }).click();
                    await expect(page.getByText('Source assistance is recorded for this card.')).toBeVisible();
                    await page.reload();
                    await expect(page.getByText('Source assistance is recorded for this card.')).toBeVisible();
                }
                const words = scenario.answers.get(card.question.id)!;
                await page.getByLabel('Answer 1', { exact: true }).fill(words[0]);
                await page.getByLabel('Answer 2', { exact: true }).fill(index === 0 ? 'incorrect fixture value' : words[1]);
                const accepted = page.waitForResponse(r => r.url().endsWith(`/study/sessions/${sid}/attempts`) && r.request().method() === 'POST');
                await page.getByTestId('submit-answer').focus();
                await page.keyboard.press('Enter');
                const response = await accepted, input = response.request().postDataJSON(), grade = await response.json() as PbeAttemptResult;
                expect(grade.earnedPoints).toBe(index === 0 ? 1 : 2);
                if (index === 1)
                    expect(grade.unaided).toBe(false);
                await expect(page.getByTestId('challenge-feedback')).toBeVisible();
                if (index === 0) {
                    await page.reload();
                    await expect(page.getByTestId('challenge-feedback')).toBeVisible();
                    expect(await json(page.request, `/api/v1/study/sessions/${sid}/attempts`, input)).toEqual({ ...grade, alreadyProcessed: true });
                    const conflict = await page.request.post(`/api/v1/study/sessions/${sid}/attempts`, { data: { ...input, answers: ['contradictory', 'payload'] } });
                    expect(conflict.status()).toBe(409);
                }
                if (index + 1 < scenario.count) {
                    const response = page.waitForResponse(r => r.url().endsWith(`/study/sessions/${sid}/next`));
                    await page.getByTestId('next-card').click();
                    card = await (await response).json() as PbeSessionCard;
                }
            }
            expect(selected.size).toBe(scenario.count);
            await page.getByTestId('complete-session').click();
            await expect(page.getByRole('heading', { name: 'Session recap', exact: true })).toBeVisible();
            const recap = await json<SessionRecap>(page.request, `/api/v1/study/sessions/${sid}/recap`);
            expect(recap).toMatchObject({ version: 'pbe-daily-v2', attempted: scenario.count, targetCardCount: scenario.count, fullTargetReached: true });
            expect(recap.missionSteps[0].target).toBe(scenario.count);
            const after = await json<TrainingToday>(page.request, `/api/v1/progress/me/today?seasonId=${scenario.seasonId}`);
            expect(after.week.completedDays).toBe(before.week.completedDays + (before.week.days.some(d => d.isToday && d.credited) ? 0 : 1));
            for (const width of [1440, 390, 320]) {
                await page.setViewportSize({ width, height: 900 });
                await assertNoOverflow(page);
                await page.screenshot({ path: info.outputPath(`pbe-${scenario.label}-${repeat}-recap-${width}.png`), fullPage: true });
            }
        }
        if (reps === 2)
            expect(seen.size).toBeGreaterThan(8);
    }
    expect(errors).toEqual([]);
}

export async function pbeSimulationJourney(page: Page, info: TestInfo) {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [], addEventListener() {}, removeEventListener() {}, cancel() {}, speak() {} } }));
    await login(page); const me = await json<Me>(page.request, '/api/v1/me'), org = `/api/v1/organizations/${me.organizationId}`;
    const pack = (await json<ContentPack[]>(page.request, `${org}/content-packs`)).find(p => p.packKey === 'dev-daniel')!;
    const source = (await json<StoredSource[]>(page.request, `${org}/content-packs/${pack.id}/source-units`)).sort((a, b) => a.ordinal - b.ordinal)[0];
    const username = info.project.name.startsWith('native') ? 'student.fixture' : 'daniel.student';
    const student = (await json<Student[]>(page.request, `${org}/students`)).find(s => s.userName === username)!;
    const season = await json<{id:string}>(page.request, `${org}/seasons`, {name:`Timed PBE ${randomUUID()}`,yearLabel:'2026',ruleProfileKey:'PBE_STYLE_V1'});
    const range={bookKey:source.bookKey,startChapter:source.chapter,startVerse:source.verse,endChapter:source.chapter,endVerse:source.verse};
    await json(page.request,`${org}/seasons/${season.id}/scope`,{contentPackId:pack.id,includes:[range],excludes:[]});
    await json(page.request,`${org}/seasons/${season.id}/assignments`,{studentUserId:student.userId,contentPackId:pack.id,type:'PrimarySpecialist',difficulty:'Standard',range});
    await json(page.request,`${org}/seasons/${season.id}/activate`,{});
    const words=source.canonicalText.trim().split(/\s+/).slice(0,2), tids=[randomUUID(),randomUUID()], base=`${org}/practice/pbe/seasons/${season.id}`;
    const targets=tids.map((id,i)=>({id,sourceUnitIds:[source.id],skill:'FactualRecall',label:`Timed fixture ${i+1}`}));
    const questions=[0,1].map(variant=>({schemaVersion:2,id:randomUUID(),version:1,contentPackId:pack.id,sourceUnitId:source.id,sourceUnitIds:[source.id],sourceKind:'Scripture',kind:'List',prompt:`Give the first two words. Variant ${variant+1}.`,reference:source.citation,evidence:source.canonicalText,ordered:false,parts:tids.map((targetId,i)=>({targetId,acceptedAnswers:[words[i]],points:1}))}));
    await json(page.request,base+'/questions/import',{targets,questions}); for(const q of questions)await json(page.request,`${base}/questions/${q.id}/1/publish`,{}); await json(page.request,base+'/enabled',{enabled:true});
    await logout(page); await login(page,username); await page.emulateMedia({reducedMotion:'reduce'}); await page.goto(`/student?seasonId=${season.id}`);
    const startResponse=page.waitForResponse(r=>/\/study\/sessions$/.test(r.url())&&r.request().method()==='POST'),firstNext=page.waitForResponse(r=>/\/study\/sessions\/[^/]+\/next$/.test(r.url())); await page.getByTestId('start-simulation').click();expect((await startResponse).status()).toBe(200);
    let card=await (await firstNext).json() as PbeSessionCard; const sid=card.sessionId;
    for(let index=0;index<card.total;index++){
        await expect(page.getByRole('button',{name:'I’m ready to hear the question'})).toBeVisible();
        if(index===0)for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});await assertNoOverflow(page);await page.screenshot({path:info.outputPath(`pbe-simulation-${width}.png`),fullPage:true});}
        await page.getByRole('button',{name:'I’m ready to hear the question'}).click(); await expect(page.getByRole('button',{name:'Finished first reading'})).toBeVisible(); await page.getByRole('button',{name:'Finished first reading'}).click(); await page.getByRole('button',{name:'Finished second reading'}).click();
        await expect(page.getByTestId('challenge-card')).toBeVisible(); await page.getByLabel('Answer 1',{exact:true}).fill(words[0]); await page.getByLabel('Answer 2',{exact:true}).fill(words[1]);
        await expect(page.getByTestId('submit-answer')).toBeEnabled({timeout:7000}); const accepted=page.waitForResponse(r=>r.url().endsWith(`/study/sessions/${sid}/timed`)&&r.request().postDataJSON()?.action==='submit');
        const next=index+1<card.total?page.waitForResponse(r=>r.url().endsWith(`/study/sessions/${sid}/next`)):null; await page.getByTestId('submit-answer').click(); const response=await accepted,input=response.request().postDataJSON(),receipt=await response.json(); expect(receipt).toMatchObject({feedbackDeferred:true}); expect(JSON.stringify(receipt)).not.toMatch(/earnedPoints|expectedParts/);
        expect(await json(page.request,`/api/v1/study/sessions/${sid}/timed?questionId=${card.id}`)).toMatchObject({attemptId:receipt.attemptId,questionId:card.id,alreadyProcessed:true});
        expect(await json(page.request,`/api/v1/study/sessions/${sid}/timed`,input)).toMatchObject({alreadyProcessed:true}); const changed=await page.request.post(`/api/v1/study/sessions/${sid}/timed`,{data:{...input,answers:['changed','answer']}});expect(changed.status()).toBe(409);
        if(next)card=await (await next).json() as PbeSessionCard;
    }
    await expect(page.getByRole('heading',{name:'Session recap',exact:true})).toBeVisible(); const resumed=await json<{summary:{results:unknown[]}}>(page.request,`/api/v1/study/sessions/${sid}`);expect(resumed.summary.results).toHaveLength(card.total);
    await page.reload(); await expect(page.getByRole('heading',{name:'Session recap',exact:true})).toBeVisible(); await page.goto(`/student?seasonId=${season.id}`); const replay=page.waitForResponse(r=>/\/study\/sessions$/.test(r.url())&&r.request().method()==='POST');await page.getByTestId('start-simulation').click();expect((await replay).status()).toBe(200);
    expect(errors).toEqual([]);
}
