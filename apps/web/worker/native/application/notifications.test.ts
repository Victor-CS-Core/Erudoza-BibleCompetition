// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG } from '../test-runtime';
import { notificationCitation, notificationSummary } from './notifications';

let app: Awaited<ReturnType<typeof createNativeTestApp>>, cookie: string;
beforeAll(async () => { app = await createNativeTestApp(); cookie = (await app.login()).headers.get('set-cookie')!.split(';')[0]; }, 30000);
afterAll(async () => { await app?.runtime.dispose(); });
const call = (path: string, method = 'GET', data?: unknown, auth = cookie) => path === '/content-packs/import' ? app.importFixture(data, auth) : app.fetch(`/api/v1/organizations/${TEST_ORG}${path}`, { method, headers: { Cookie: auth, Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
const passage = { bookKey: 'JHN', startChapter: 3, startVerse: 16, endChapter: 3, endVerse: 18 };
const payload = (packKey: string) => ({ packKey, version: 1, locale: 'en', sourceType: 'Scripture', documents: [{ name: 'John', units: [16, 17, 18].map(n => ({ citation: `John 3:${n}`, bookKey: 'JHN', chapter: 3, verse: n, ordinal: n, text: `Verse ${n} text for ${packKey}.` })) }] });

it('formats verse-aware citations and short summaries', () => {
  expect(notificationCitation({ bookKey: 'JHN', startChapter: 3, startVerse: 16, endChapter: 3, endVerse: 16 })).toBe('John 3:16');
  expect(notificationCitation(passage)).toBe('John 3:16–18');
  expect(notificationCitation({ bookKey: 'JHN', startChapter: 3, startVerse: 16, endChapter: 4, endVerse: 3 })).toBe('John 3:16–4:3');
  expect(notificationSummary({ actorDisplayName: 'Coach Maya', action: 'added', citation: 'John 3:16–18' })).toBe('Coach Maya added John 3:16–18');
  expect(notificationSummary({ actorDisplayName: 'Coach Maya', action: 'removed', citation: 'John 3' })).toBe('Coach Maya removed John 3');
  expect(notificationSummary({ actorDisplayName: 'Coach Maya', action: 'updated', citation: 'John 3:16' })).toBe('Coach Maya updated your assignment to John 3:16');
});

async function setup(key: string) {
  const pack = await (await call('/content-packs/import', 'POST', payload(key))).json() as { id: string };
  const season = await (await call('/seasons', 'POST', { name: key, yearLabel: '2026', ruleProfileKey: 'PBE_STYLE_V1' })).json() as { id: string };
  const student = await (await call('/students', 'POST', { userName: key, displayName: `${key} Student`, password: 'Testing!123' })).json() as { userId: string };
  expect((await call(`/seasons/${season.id}/scope`, 'POST', { contentPackId: pack.id, includes: [passage], excludes: [] })).status).toBe(204);
  const studentCookie = (await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: key, password: 'Testing!123' }) })).headers.get('set-cookie')!.split(';')[0];
  return { pack, season, student, studentCookie };
}
const profileCall = (path: string, method = 'GET', data?: unknown, auth?: string) => app.fetch(`/api/v1/profile${path}`, { method, headers: { Cookie: auth ?? cookie, Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });

it('notifies the student when a coach adds, updates, then removes an assignment', async () => {
  const { pack, season, student, studentCookie } = await setup('notify-flow');
  const prefix = `/seasons/${season.id}`;
  const assign = await call(`${prefix}/assignments`, 'POST', { studentUserId: student.userId, contentPackId: pack.id, type: 'PrimarySpecialist', range: passage });
  expect(assign.status).toBe(200);
  const assignment = await assign.json() as { id: string };

  let list = await (await profileCall('/me/notifications', 'GET', undefined, studentCookie)).json() as { notifications: { summary: string; readAtUtc: string | null; citation: string }[]; unreadCount: number };
  expect(list.unreadCount).toBe(1);
  expect(list.notifications[0].summary).toBe('Coach added John 3:16–18');
  expect(list.notifications[0].readAtUtc).toBeNull();

  // The coach sees no notifications of their own.
  const coachList = await (await profileCall('/me/notifications')).json() as { unreadCount: number };
  expect(coachList.unreadCount).toBe(0);

  expect((await call(`${prefix}/assignments/${assignment.id}/passage`, 'PUT', { ...passage, endVerse: 17 })).status).toBe(204);
  list = await (await profileCall('/me/notifications', 'GET', undefined, studentCookie)).json() as typeof list;
  expect(list.unreadCount).toBe(2);
  expect(list.notifications[0].summary).toBe('Coach updated your assignment to John 3:16–17');

  expect((await call(`${prefix}/assignments/${assignment.id}`, 'DELETE')).status).toBe(204);
  list = await (await profileCall('/me/notifications', 'GET', undefined, studentCookie)).json() as typeof list;
  expect(list.unreadCount).toBe(3);
  expect(list.notifications[0].summary).toBe('Coach removed John 3:16–17');

  expect((await profileCall('/me/notifications/read', 'POST', {}, studentCookie)).status).toBe(200);
  list = await (await profileCall('/me/notifications', 'GET', undefined, studentCookie)).json() as typeof list;
  expect(list.unreadCount).toBe(0);
  expect(list.notifications.every(n => n.readAtUtc)).toBe(true);
});

it('does not notify anyone for coach self-assigned passages', async () => {
  const { pack, season } = await setup('notify-self');
  const created = await call(`/seasons/${season.id}/my-assignments`, 'POST', { contentPackId: pack.id, type: 'PrimarySpecialist', range: passage });
  expect(created.status).toBe(200);
  const list = await (await profileCall('/me/notifications')).json() as { notifications: unknown[]; unreadCount: number };
  expect(list.unreadCount).toBe(0);
  expect(list.notifications).toEqual([]);
});
