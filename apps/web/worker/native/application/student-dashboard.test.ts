// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG } from '../test-runtime';
import type { StudentDashboard } from '../../../src/api/types';

let app: Awaited<ReturnType<typeof createNativeTestApp>>, cookie: string;
beforeAll(async () => { app = await createNativeTestApp(); cookie = (await app.login()).headers.get('set-cookie')!.split(';')[0]; }, 30000);
afterAll(async () => { await app?.runtime.dispose(); });
const call = (path: string, method = 'GET', data?: unknown, auth = cookie) => path === '/content-packs/import' ? app.importFixture(data, auth) : app.fetch(`/api/v1/organizations/${TEST_ORG}${path}`, { method, headers: { ...(auth ? { Cookie: auth } : {}), Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
const passage = { bookKey: 'DAN', startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 2 };
const payload = (packKey: string) => ({ packKey, version: 1, locale: 'en', sourceType: 'Scripture', documents: [{ name: 'Daniel', units: [1, 2, 3].map(n => ({ citation: `Daniel 1:${n}`, bookKey: 'DAN', chapter: 1, verse: n, ordinal: n, text: `This is canonical verse number ${n} for ${packKey}.` })) }] });

async function setup(key: string) {
  const pack = await (await call('/content-packs/import', 'POST', payload(key))).json() as { id: string };
  const season = await (await call('/seasons', 'POST', { name: key, yearLabel: '2026', ruleProfileKey: 'PBE_STYLE_V1' })).json() as { id: string };
  const student = await (await call('/students', 'POST', { userName: key, displayName: `${key} Student`, password: 'Testing!123' })).json() as { userId: string };
  expect((await call(`/seasons/${season.id}/scope`, 'POST', { contentPackId: pack.id, includes: [passage], excludes: [{ ...passage, startVerse: 2 }] })).status).toBe(204);
  expect((await call(`/seasons/${season.id}/assignments`, 'POST', { studentUserId: student.userId, contentPackId: pack.id, type: 'PrimarySpecialist', range: passage })).status).toBe(200);
  expect((await call(`/seasons/${season.id}/activate`, 'POST')).status).toBe(200);
  const studentCookie = (await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: key, password: 'Testing!123' }) })).headers.get('set-cookie')!.split(';')[0];
  return { season, student, studentCookie };
}

it('returns the full dashboard for a coach reading their own-org student', async () => {
  const { season, student } = await setup('dashboard-coach');
  const response = await call(`/students/${student.userId}/dashboard`);
  expect(response.status).toBe(200);
  const dashboard = await response.json() as StudentDashboard;
  expect(dashboard.student).toMatchObject({ userId: student.userId, displayName: 'dashboard-coach Student', isActive: true });
  expect(dashboard.season).toMatchObject({ id: season.id, status: 'Active' });
  expect(dashboard.effort.weeklyTarget).toBeGreaterThanOrEqual(3);
  expect(dashboard.effort.days).toHaveLength(7);
  expect(dashboard.progress.eligibleCount).toBe(1);
  expect(dashboard.progress.chapters).toHaveLength(1);
  expect(dashboard.progress.chapters[0]).toMatchObject({ bookKey: 'DAN', chapter: 1, eligibleCount: 1 });
  expect(dashboard.mastery.badges).toEqual([]);
  expect(dashboard.assignments).toHaveLength(1);
  expect(dashboard.assignments[0]).toMatchObject({ studentUserId: student.userId, type: 'PrimarySpecialist' });
  expect(dashboard.recentActivity).toEqual([]);
});

it('returns 404 for a student id outside the organization', async () => {
  await setup('dashboard-foreign');
  expect((await call('/students/99999999-9999-4999-8999-999999999999/dashboard')).status).toBe(404);
});

it('forbids students from reading another student dashboard', async () => {
  const { student, studentCookie } = await setup('dashboard-student-403');
  expect((await call(`/students/${student.userId}/dashboard`, 'GET', undefined, studentCookie)).status).toBe(403);
});

it('requires authentication', async () => {
  const { student } = await setup('dashboard-anon');
  expect((await call(`/students/${student.userId}/dashboard`, 'GET', undefined, '')).status).toBe(401);
});

it('counts only completed current-season rooms for team practice sessions', async () => {
  const { season, student } = await setup('dashboard-rooms');
  const otherId = '99999999-9999-4999-8999-999999999999';
  const member = (userId: string) => ({ userId, displayName: 'Room Student', team: 1, ready: true, captain: false, scribe: true });
  const insert = (id: string, seasonId: string, status: string, members: unknown[]) =>
    app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,data,revision) VALUES('match',?,?,?,?,1)")
      .bind(id, TEST_ORG, seasonId, JSON.stringify({ id, status, format: 'Arcade', completedAt: '2026-09-16T12:00:00Z', members, submissions: [] })).run();
  await insert('drm-1', season.id, 'Completed', [member(student.userId)]); // counted
  await insert('drm-2', season.id, 'Completed', [member(student.userId)]); // counted
  await insert('drm-3', 'other-season', 'Completed', [member(student.userId)]); // other season
  await insert('drm-4', season.id, 'Playing', [member(student.userId)]); // not completed
  await insert('drm-5', season.id, 'Completed', [member(otherId)]); // student not a member
  const response = await call(`/students/${student.userId}/dashboard`);
  expect(response.status).toBe(200);
  const dashboard = await response.json() as StudentDashboard;
  expect(dashboard.social.teamPracticeSessions).toBe(2);
});

it('surfaces team honors and room awards in the drill-down mastery section', async () => {
  const { season, student } = await setup('dashboard-awards');
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) VALUES('mastery-honor',?,?,?,?,?,1)")
    .bind(`${TEST_ORG}:${student.userId}:mastery-v1:team:first-fellowship`, TEST_ORG, season.id, student.userId,
      JSON.stringify({ id: 'h1', userId: student.userId, key: 'team:first-fellowship', ruleVersion: 'mastery-v1', earnedAtUtc: '2026-09-16T12:00:00Z', seasonId: season.id, evidence: null })).run();
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) VALUES('award',?,?,?,?,?,1)")
    .bind(`pbe-team-v1:team-steady:${student.userId}:${season.id}`, TEST_ORG, season.id, student.userId,
      JSON.stringify({ key: 'pbe-team-v1:team-steady', title: 'Team Steady', seasonId: season.id, userId: student.userId })).run();
  const response = await call(`/students/${student.userId}/dashboard`);
  expect(response.status).toBe(200);
  const dashboard = await response.json() as StudentDashboard;
  expect(dashboard.mastery.teamAwards).toHaveLength(2);
  expect(dashboard.mastery.teamAwards[0]).toMatchObject({
    key: 'team:first-fellowship', title: 'First Fellowship', source: 'honor',
    seasonName: 'dashboard-awards', earnedAtUtc: '2026-09-16T12:00:00Z',
  });
  expect(dashboard.mastery.teamAwards[1]).toMatchObject({
    key: 'pbe-team-v1:team-steady', title: 'Team Steady', source: 'award',
    seasonName: 'dashboard-awards', earnedAtUtc: null,
  });
});
