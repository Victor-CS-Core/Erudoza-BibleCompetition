import { expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { ChapterPage, ContinueChaptersResponse, CooperationSnapshot } from '../src/api/pbeTypes';
import type { PbeIntroduction } from '../src/api/practice';
import type { ContentPack, Me, Student } from '../src/api/types';
import { json, type StoredSource } from './study-source-helpers';

export type ChapterBrowserFixture = {
  organizationId: string;
  orgPath: string;
  seasonId: string;
  primary: Student;
  peer: Student;
  peerUsername: string;
  unassigned: Student;
  unassignedUsername: string;
  sources: StoredSource[];
  introduction: PbeIntroduction;
  emptyIntroduction: PbeIntroduction;
  spanningPrompt: string;
  pbePath: string;
};

export async function createChapterBrowserFixture(api: APIRequestContext, native: boolean): Promise<ChapterBrowserFixture> {
  const me = await json<Me>(api, '/api/v1/me');
  const orgPath = `/api/v1/organizations/${me.organizationId}`;
  const pack = (await json<ContentPack[]>(api, `${orgPath}/content-packs`)).find(item => item.packKey === 'dev-daniel');
  expect(pack, 'Synthetic Daniel fixture pack').toBeTruthy();
  const sources = (await json<StoredSource[]>(api, `${orgPath}/content-packs/${pack!.id}/source-units`))
    .filter(source => source.chapter === 1 && source.verse >= 1 && source.verse <= 8)
    .sort((left, right) => left.ordinal - right.ordinal);
  expect(sources).toHaveLength(8);

  const primaryUsername = native ? 'student.fixture' : 'daniel.student';
  const primary = (await json<Student[]>(api, `${orgPath}/students`)).find(student => student.userName === primaryUsername);
  expect(primary, `Seeded student ${primaryUsername}`).toBeTruthy();
  const peerUsername = `pbe.peer.${randomUUID().slice(0, 8)}`;
  const peer = await json<Student>(api, `${orgPath}/students`, {
    userName: peerUsername,
    displayName: 'PBE Peer Fixture',
    password: process.env.ERUDOZA_E2E_PASSWORD,
  });
  const unassignedUsername = `pbe.unassigned.${randomUUID().slice(0, 8)}`;
  const unassigned = await json<Student>(api, `${orgPath}/students`, {
    userName: unassignedUsername,
    displayName: 'PBE Unassigned Fixture',
    password: process.env.ERUDOZA_E2E_PASSWORD,
  });

  const season = await json<{ id: string }>(api, `${orgPath}/seasons`, {
    name: `PBE chapter map ${randomUUID()}`,
    yearLabel: '2026',
    ruleProfileKey: 'PBE_STYLE_V1',
  });
  const range = { bookKey: sources[0].bookKey, startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 8 };
  const excluded = { bookKey: sources[0].bookKey, startChapter: 1, startVerse: 4, endChapter: 1, endVerse: 4 };
  await json(api, `${orgPath}/seasons/${season.id}/scope`, { contentPackId: pack!.id, includes: [range], excludes: [excluded] });
  await json(api, `${orgPath}/seasons/${season.id}/assignments`, { studentUserId: primary!.userId, contentPackId: pack!.id, type: 'PrimarySpecialist', difficulty: 'Advanced', range });
  await json(api, `${orgPath}/seasons/${season.id}/assignments`, { studentUserId: peer.userId, contentPackId: pack!.id, type: 'PrimarySpecialist', difficulty: 'Standard', range: { ...range, endVerse: 3 } });
  const removedAssignment = await json<{ id: string }>(api, `${orgPath}/seasons/${season.id}/assignments`, { studentUserId: unassigned.userId, contentPackId: pack!.id, type: 'PrimarySpecialist', difficulty: 'Standard', range: { ...range, startVerse: 7 } });
  const removed = await api.delete(`${orgPath}/seasons/${season.id}/assignments/${removedAssignment.id}`);
  expect(removed.status(), await removed.text()).toBe(204);
  await json(api, `${orgPath}/seasons/${season.id}/activate`, {});

  const pbePath = `${orgPath}/practice/pbe/seasons/${season.id}`;
  const createIntroduction = async (title: string, citation: string) => {
    let introduction = await json<PbeIntroduction>(api, `${pbePath}/introductions`, {
      bookKey: sources[0].bookKey,
      sourceEdition: 'Synthetic browser fixture edition',
      title,
      citation,
      licensingStatus: 'approved',
      units: [{ citation, canonicalText: `${title} supports local browser acceptance.` }],
    });
    introduction = await json<PbeIntroduction>(api, `${pbePath}/introductions/${introduction.id}/review`, { revision: introduction.revision, reviewed: true });
    introduction = await json<PbeIntroduction>(api, `${pbePath}/introductions/${introduction.id}/assignments`, { revision: introduction.revision, studentIds: [primary!.userId] });
    return introduction;
  };
  const introduction = await createIntroduction('Daniel browser introduction', 'Browser introduction §1');
  const emptyIntroduction = await createIntroduction('Daniel background notes', 'Browser introduction §2');

  const spanningTarget = randomUUID();
  const introTarget = randomUUID();
  const spanningPrompt = 'Which fixture words span both assigned passage groups?';
  const questions = [0, 1].flatMap(variant => [{
    schemaVersion: 2,
    id: randomUUID(),
    version: 1,
    contentPackId: pack!.id,
    sourceUnitId: sources[1].id,
    sourceUnitIds: [sources[1].id, sources[5].id],
    sourceKind: 'Scripture',
    kind: 'ShortAnswer',
    prompt: `${spanningPrompt} Variant ${variant + 1}.`,
    reference: `${sources[1].citation}; ${sources[5].citation}`,
    evidence: `${sources[1].canonicalText}\n${sources[5].canonicalText}`,
    ordered: false,
    parts: [{ targetId: spanningTarget, acceptedAnswers: ['Daniel studied'], points: 1 }],
  }, {
    schemaVersion: 2,
    id: randomUUID(),
    version: 1,
    contentPackId: introduction.id,
    sourceUnitId: introduction.units[0].id,
    sourceUnitIds: [introduction.units[0].id],
    sourceKind: 'Commentary',
    kind: 'ShortAnswer',
    prompt: `What does the browser introduction support? Variant ${variant + 1}.`,
    reference: introduction.units[0].citation,
    evidence: introduction.units[0].canonicalText,
    ordered: false,
    parts: [{ targetId: introTarget, acceptedAnswers: ['local browser acceptance'], points: 1 }],
  }]);
  const targets = [
    { id: spanningTarget, sourceUnitIds: [sources[1].id, sources[5].id], skill: 'FactualRecall', label: 'Spanning assigned groups' },
    { id: introTarget, sourceUnitIds: [introduction.units[0].id], skill: 'FactualRecall', label: 'Introduction purpose' },
  ];
  await json(api, `${pbePath}/questions/import`, { targets, questions });
  for (const question of questions) await json(api, `${pbePath}/questions/${question.id}/1/publish`, {});
  await json(api, `${pbePath}/enabled`, { enabled: true });
  return { organizationId: me.organizationId, orgPath, seasonId: season.id, primary: primary!, peer, peerUsername, unassigned, unassignedUsername, sources, introduction, emptyIntroduction, spanningPrompt, pbePath };
}

export async function finishChapters(api: APIRequestContext, seasonId: string): Promise<ChapterPage> {
  let page = await json<ChapterPage>(api, `/api/v1/progress/me/chapters?seasonId=${encodeURIComponent(seasonId)}&view=Chapters&limit=32`);
  let bootstrapAfterStale = false;
  for (let step = 0; step < 256; step++) {
    if (page.currentAvailable && page.work.state === 'Complete') return page;
    if (!page.currentAvailable && page.work.state === 'Blocked') return page;
    const body = { seasonId, ...(!bootstrapAfterStale && page.work.id ? { workId: page.work.id } : {}) };
    bootstrapAfterStale = false;
    const response = await api.post('/api/v1/progress/me/chapters/continue', { data: body });
    if (response.status() === 409) {
      expect(await response.text()).toContain('PBE_CHAPTER_WORK_STALE');
      page = await json<ChapterPage>(api, `/api/v1/progress/me/chapters?seasonId=${encodeURIComponent(seasonId)}&view=Chapters&limit=32`);
      bootstrapAfterStale = true;
      continue;
    }
    expect(response.ok(), `/api/v1/progress/me/chapters/continue: HTTP ${response.status()}`).toBeTruthy();
    const next = await response.json() as ContinueChaptersResponse;
    if (next.next === 'None' && next.work.state === 'Blocked')
      return json<ChapterPage>(api, `/api/v1/progress/me/chapters?seasonId=${encodeURIComponent(seasonId)}&view=Chapters&limit=32`);
    if (next.next === 'None') throw new Error(`Chapter fixture stopped: ${next.work.reason ?? next.work.state}`);
    if (next.next === 'Reload') page = await json<ChapterPage>(api, `/api/v1/progress/me/chapters?seasonId=${encodeURIComponent(seasonId)}&view=Chapters&limit=32`);
    else page = { ...page, scopeVersion: next.scopeVersion, work: next.work };
  }
  throw new Error('Chapter fixture continuation exceeded 256 steps.');
}

export async function finishCooperation(api: APIRequestContext, seasonId: string): Promise<CooperationSnapshot> {
  let snapshot = await json<CooperationSnapshot>(api, `/api/v1/progress/me/pbe-cooperation?seasonId=${encodeURIComponent(seasonId)}`);
  let bootstrapAfterStale = false;
  for (let step = 0; step < 256; step++) {
    if ((snapshot.state === 'Snapshot' || snapshot.state === 'Provisional') && snapshot.work.next !== 'Continue') return snapshot;
    const needsBootstrap = bootstrapAfterStale || (snapshot.state === 'Updating' && snapshot.work.next === 'Reload');
    bootstrapAfterStale = false;
    const body = { seasonId, ...(!needsBootstrap && snapshot.work.id ? { workId: snapshot.work.id } : {}) };
    const response = await api.post('/api/v1/progress/me/pbe-cooperation/continue', { data: body });
    if (response.status() === 409) {
      expect(await response.text()).toContain('PBE_COOPERATION_WORK_STALE');
      snapshot = await json<CooperationSnapshot>(api, `/api/v1/progress/me/pbe-cooperation?seasonId=${encodeURIComponent(seasonId)}`);
      bootstrapAfterStale = true;
      continue;
    }
    expect(response.ok(), `/api/v1/progress/me/pbe-cooperation/continue: HTTP ${response.status()}`).toBeTruthy();
    const next = await response.json() as CooperationSnapshot;
    if (next.state === 'Blocked') throw new Error(`Cooperation fixture blocked: ${next.reason}`);
    if (next.work.next === 'Reload') snapshot = await json<CooperationSnapshot>(api, `/api/v1/progress/me/pbe-cooperation?seasonId=${encodeURIComponent(seasonId)}`);
    else snapshot = next;
  }
  throw new Error('Cooperation fixture continuation exceeded 256 steps.');
}

export async function seedSyntheticChapterStamp(api: APIRequestContext, native: boolean, fixture: {
  organizationId: string;
  seasonId: string;
  studentId: string;
  chapterKey: string;
  label: string;
  scopeLabel: string;
  scopeVersion: string;
  earnedAtUtc: string;
}) {
  const runId = native ? process.env.ERUDOZA_NATIVE_RUN_ID : process.env.ERUDOZA_E2E_RUN_ID;
  expect(runId, 'Playwright fixture run identity').toBeTruthy();
  const response = await api.post(native ? 'http://127.0.0.1:8791/seed-pbe-history' : 'http://127.0.0.1:5084/seed-pbe-history', {
    headers: { 'x-erudoza-fixture-run': runId! },
    data: fixture,
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json() as Promise<{ stampId: string; fixture: 'synthetic-history' }>;
}
