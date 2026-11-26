// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG } from './test-runtime';
import { Store } from './store';
import type { D1Database } from '@cloudflare/workers-types';
let app: Awaited<ReturnType<typeof createNativeTestApp>>, cookie: string;
beforeAll(async () => { app = await createNativeTestApp(); cookie = (await app.login()).headers.get('set-cookie')!.split(';')[0]; }, 30000);
afterAll(async () => { await app?.runtime.dispose(); });
const call = (path: string, method = 'GET', data?: unknown, auth = cookie) => path === '/content-packs/import' ? app.importFixture(data, auth) : app.fetch(`/api/v1/organizations/${TEST_ORG}${path}`, { method, headers: { Cookie: auth, Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
const raw = (path: string, method = 'GET', data?: unknown, auth?: string) => app.fetch(path, { method, headers: { ...(auth ? { Cookie: auth } : {}), Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
const dan = (startVerse: number, endVerse: number) => ({ bookKey: 'DAN', startChapter: 1, startVerse, endChapter: 1, endVerse });

type Row = { studentUserId: string; eligibleUnitCount: number; requiredUnitCount?: number; optionalUnitCount?: number; allAssignedUnitCount?: number; masteredCount: number; optionalMasteredCount?: number; reviewDueCount: number };

it('splits coverage into required vs optional-only and keeps denominators on the required set (cards 43 + 46)', async () => {
  const pack = await (await call('/content-packs/import', 'POST', { packKey: 'role-split', version: 1, locale: 'en', sourceType: 'Scripture', documents: [{ name: 'Daniel', units: [1, 2, 3].map(n => ({ citation: `Daniel 1:${n}`, bookKey: 'DAN', chapter: 1, verse: n, ordinal: n, text: `Canonical Daniel verse ${n} for role split.` })) }] })).json() as { id: string };
  const season = await (await call('/seasons', 'POST', { name: 'role-split', yearLabel: '2026', ruleProfileKey: 'PBE_STYLE_V1' })).json() as { id: string };
  expect((await call(`/seasons/${season.id}/scope`, 'POST', { contentPackId: pack.id, includes: [dan(1, 3)], excludes: [] })).status).toBe(204);
  const mk = async (name: string) => (await (await call('/students', 'POST', { userName: name, displayName: name, password: 'Testing!123' })).json()) as { userId: string };
  const assign = async (studentUserId: string, type: string, range: object) => expect((await call(`/seasons/${season.id}/assignments`, 'POST', { studentUserId, contentPackId: pack.id, type, range })).status).toBe(200);
  const sources = await (await call(`/content-packs/${pack.id}/source-units`)).json() as { id: string; verse: number }[];
  const byVerse = (v: number) => sources.find(s => s.verse === v)!;
  const store = new Store(app.db as unknown as D1Database);
  const mastery = async (studentUserId: string, verse: number, key: string) => store.insert('mastery', `role-${key}`, TEST_ORG, { studentUserId, sourceUnitId: byVerse(verse).id, knowledgeUnitId: byVerse(verse).id, level: 'Mastered', algorithmVersion: 'v2-skill-evidence', exactWording: 95, reference: 90, recognition: 90, reviewDueAt: '2020-01-01T00:00:00Z' }, { seasonId: season.id, ownerId: studentUserId });

  // A: verse 1 optional-only, verses 2-3 required.
  const a = await mk('role-a');
  await assign(a.userId, 'OptionalReview', dan(1, 1));
  await assign(a.userId, 'RequiredCoverage', dan(2, 3));
  await mastery(a.userId, 1, 'a1'); // mastered + due, but optional-only
  await mastery(a.userId, 2, 'a2'); // mastered + due, required

  // B: verse 1 optional-only; verse 2 covered by BOTH Optional and Specialist
  // (strictest role wins -> required); verse 3 specialist.
  const b = await mk('role-b');
  await assign(b.userId, 'OptionalReview', dan(1, 2));
  await assign(b.userId, 'PrimarySpecialist', dan(2, 3));
  await mastery(b.userId, 1, 'b1');
  await mastery(b.userId, 2, 'b2');

  // C: everything optional-only.
  const c = await mk('role-c');
  await assign(c.userId, 'OptionalReview', dan(1, 3));

  const cov = await (await call(`/seasons/${season.id}/coverage`)).json() as { students: Row[] };
  const row = (id: string) => cov.students.find(s => s.studentUserId === id)!;
  expect(row(a.userId)).toMatchObject({ eligibleUnitCount: 2, requiredUnitCount: 2, optionalUnitCount: 1, allAssignedUnitCount: 3, masteredCount: 1, optionalMasteredCount: 1, reviewDueCount: 1 });
  expect(row(b.userId)).toMatchObject({ eligibleUnitCount: 2, requiredUnitCount: 2, optionalUnitCount: 1, allAssignedUnitCount: 3, masteredCount: 1, reviewDueCount: 1 });
  expect(row(c.userId)).toMatchObject({ eligibleUnitCount: 0, requiredUnitCount: 0, optionalUnitCount: 3, allAssignedUnitCount: 3, masteredCount: 0, reviewDueCount: 0 });

  // Progress due count follows the same rule: optional-only due mastery never counts as due.
  const progressB = await (await call(`/seasons/${season.id}/students/${b.userId}/progress`)).json() as { reviewDueCount: number };
  expect(progressB.reviewDueCount).toBe(1);

  // C can still study voluntarily (Practice starts on optional material),
  // but a Review start finds nothing due even though C has due mastery on
  // an optional-only verse.
  await mastery(c.userId, 1, 'c1');
  expect((await call(`/seasons/${season.id}/activate`, 'POST')).status).toBe(200);
  const login = await raw('/api/v1/auth/login', 'POST', { identifier: 'role-c', password: 'Testing!123' });
  expect(login.status).toBe(200);
  const studentCookie = login.headers.get('set-cookie')!.split(';')[0];
  const practice = await raw('/api/v1/study/sessions', 'POST', { seasonId: season.id, mode: 'Practice' }, studentCookie);
  expect(practice.status).toBe(200);
  const review = await raw('/api/v1/study/sessions', 'POST', { seasonId: season.id, mode: 'Review' }, studentCookie);
  expect(review.status).toBe(400);
}, 30000);
