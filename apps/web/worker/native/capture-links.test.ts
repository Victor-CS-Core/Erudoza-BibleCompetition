// @vitest-environment node
// Fixture generator for src/features/admin/club-admin-links.test.tsx: builds a
// production-analogous club through the real API (Active PBE season, owner +
// 2 students, assignments for the students AND the owner himself, draft
// material proposals, a live release, news draft + published article, a
// pending coach invitation, non-zero XP) and dumps the real endpoint payloads
// the six club-admin pages consume into the committed fixture JSON.
// A routine run COMPARES the fresh payloads' shape against the checked-in
// fixture and fails on contract drift without writing anything (card 28).
// Regenerate only when an endpoint contract changes, then re-check the diff:
//   UPDATE_FIXTURES=1 npx vitest run worker/native/capture-links.test.ts
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createNativeTestApp, persistCaptureFixture, TEST_ORG, TEST_USER } from './test-runtime';
import { LIBRARY_ORG } from './application/library-access';

let app: Awaited<ReturnType<typeof createNativeTestApp>>, cookie: string;
beforeAll(async () => { app = await createNativeTestApp(); cookie = (await app.login()).headers.get('set-cookie')!.split(';')[0]; }, 30000);
afterAll(async () => { await app?.runtime.dispose(); });

const call = (path: string, method = 'GET', data?: unknown, auth = cookie) =>
  path === '/content-packs/import'
    ? app.importFixture(data, auth)
    : app.fetch(path.startsWith('/api/v1/') && !path.includes('/organizations/') ? path : `/api/v1/organizations/${TEST_ORG}${path}`,
      { method, headers: { Cookie: auth, Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
const raw = (path: string, method = 'GET', data?: unknown) => app.fetch(path,
  { method, headers: { Cookie: cookie, Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });

const passage = { bookKey: 'DAN', startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 3 };
const payload = (packKey: string) => ({ packKey, version: 1, locale: 'en', sourceType: 'Scripture', documents: [{ name: 'Daniel', units: [1, 2, 3].map(n => ({ citation: `Daniel 1:${n}`, bookKey: 'DAN', chapter: 1, verse: n, ordinal: n, text: `This is canonical verse number ${n} for ${packKey}.` })) }] });
const validRelease = (yearLabel: string) => ({
  yearLabel,
  material: {
    yearLabel,
    books: [{ bookKey: 'ISA', bookName: 'Isaiah', chapters: [1, 2, 3] }],
    commentary: { bookName: 'Isaiah', title: 'ISAIAH', sections: [{ heading: 'Title and Authorship', body: 'The superscription in Isaiah 1:1 gives the identity of the seer.' }] },
    sourceUrls: { resourcesPage: 'https://nadpbe.org/pbe-resources/', versesPdf: 'https://nadpbe.org/wp-content/uploads/2025/10/isaiah-verses-manual.pdf', commentaryPdf: 'https://nadpbe.org/wp-content/uploads/2025/10/isaiah-commentary-manual.pdf' },
  },
});
const validArticle = (title: string) => ({
  title, summary: 'The new competition year is underway.',
  sections: [{ heading: 'Details', body: 'Everything you need to know.' }],
  articleType: 'announcement', keyPoints: ['Kickoff date confirmed'],
  linkedMaterials: [{ label: 'PBE resources', href: 'https://nadpbe.org/pbe-resources/' }],
  readMinutes: 2, sourceUrl: 'https://nadpbe.org/announcement/', sourceLabel: 'nadpbe.org',
});

it('captures real payloads for the six club-admin destinations', async () => {
  const out: Record<string, { status: number; body: unknown }> = {};
  const grab = async (key: string, res: Response) => { const text = await res.text(); let body: unknown; try { body = JSON.parse(text); } catch { body = text; } out[key] = { status: res.status, body }; };

  const pack = await (await call('/content-packs/import', 'POST', payload('capture-links'))).json() as { id: string };
  const season = await (await call('/seasons', 'POST', { name: 'Summer 2027', yearLabel: '2027', ruleProfileKey: 'PBE_STYLE_V1' })).json() as { id: string };
  const s1 = await (await call('/students', 'POST', { userName: 'ana', displayName: 'Ana Example', password: 'Testing!123' })).json() as { userId: string };
  const s2 = await (await call('/students', 'POST', { userName: 'ben', displayName: 'Ben Example', password: 'Testing!123' })).json() as { userId: string };
  expect((await call(`/seasons/${season.id}/scope`, 'POST', { contentPackId: pack.id, includes: [passage], excludes: [] })).status).toBe(204);
  for (const studentUserId of [s1.userId, s2.userId]) {
    const r = await call(`/seasons/${season.id}/assignments`, 'POST', { studentUserId, contentPackId: pack.id, type: 'PrimarySpecialist', range: passage });
    expect(r.status).toBe(200);
  }
  // Owner self-assignment (learner parity — production WinterPark has one).
  expect((await call(`/seasons/${season.id}/my-assignments`, 'POST', { type: 'PrimarySpecialist', contentPackId: pack.id, range: passage })).status).toBe(200);
  expect((await call(`/seasons/${season.id}/activate`, 'POST')).status).toBe(200);

  // Non-zero XP for one student (yesterday + today, learner-local day keys).
  const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const xpId = `${TEST_ORG}:${s1.userId}`;
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,data) VALUES('training-xp',?,?,?)").bind(xpId, TEST_ORG,
    JSON.stringify({ id: xpId, totalXp: 65, xpBySeason: {}, attemptXpByDay: {}, xpByDay: { [day(-1)]: 25, [day(0)]: 40 }, xpByDaySeason: {}, updatedAtUtc: new Date().toISOString() })).run();

  // Materials: two draft proposals + one live release (record written in the
  // exact shape reviewProposal's approve path writes, in the library org).
  await app.db.prepare("INSERT OR IGNORE INTO Organizations(id,name,slug) VALUES(?,?,?)").bind(LIBRARY_ORG, 'Erudoza Built-in Scripture Library', 'erudoza-builtin-scripture').run();
  const draft1 = await (await call('/pbe-materials/releases', 'POST', validRelease('2026-27'))).json() as { id: string };
  expect((await call('/pbe-materials/releases', 'POST', validRelease('2027-28'))).status).toBe(201);
  const liveMaterial = validRelease('2025-26').material;
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,data,revision) VALUES('pbe-material','pbe-material-2025-26',?,?,1)").bind(LIBRARY_ORG,
    JSON.stringify({ id: 'pbe-material-2025-26', yearLabel: '2025-26', books: liveMaterial.books, commentary: liveMaterial.commentary, sourceUrls: liveMaterial.sourceUrls, approvedBy: TEST_USER, approvedAtUtc: '2026-09-01T00:00:00.000Z', version: 1 })).run();

  // News: one draft article + one published (publish path flips these fields).
  const article = await (await call('/pbe-news/articles', 'POST', validArticle('PBE kickoff announced'))).json() as { id: string };
  expect((await call('/pbe-news/articles', 'POST', validArticle('Regional finals recap'))).status).toBe(201);
  const stored = await app.db.prepare("SELECT data FROM Records WHERE kind='pbe-news-article' AND id=?").bind(article.id).first<{ data: string }>();
  const flipped = { ...JSON.parse(stored!.data), status: 'published', publishedAtUtc: '2026-11-20T00:00:00.000Z', publishedBy: TEST_USER };
  await app.db.prepare("UPDATE Records SET data=?, revision=revision+1 WHERE kind='pbe-news-article' AND id=?").bind(JSON.stringify(flipped), article.id).run();

  // A pending coach invitation.
  expect((await call('/coach-invitations', 'POST', { email: 'newcoach@example.com', role: 'Admin' })).status).toBe(201);

  await grab('me', await raw('/api/v1/me'));
  await grab('seasons', await call('/seasons'));
  await grab('coverage', await call(`/seasons/${season.id}/coverage`));
  await grab('students', await call('/students'));
  await grab('engagement', await call('/engagement'));
  await grab('coaches', await call('/coaches'));
  await grab('coach-invitations', await call('/coach-invitations'));
  await grab('coach-options', await raw('/api/v1/auth/coach-options'));
  await grab('pbe-releases', await call('/pbe-materials/releases'));
  await grab('pbe-release-detail', await call(`/pbe-materials/releases/${draft1.id}`));
  await grab('pbe-materials', await call('/pbe-materials'));
  await grab('pbe-news-articles', await call('/pbe-news/articles'));
  await grab('disputes', await raw('/api/v1/pbe/disputes?after='));
  await grab('training-today', await raw('/api/v1/progress/me/today'));
  await grab('notifications', await raw('/api/v1/profile/me/notifications'));
  await grab('practice-bootstrap', await call('/practice/bootstrap'));
  await grab('identities', await raw(`/api/v1/profile/identities?userId=${s1.userId}&userId=${s2.userId}&userId=${TEST_USER}`));
  await grab('profile-me', await raw('/api/v1/profile/me'));
  out['meta'] = { status: 0, body: { orgId: TEST_ORG, seasonId: season.id, ownerId: TEST_USER, s1: s1.userId, s2: s2.userId, draftProposalId: draft1.id } };
  persistCaptureFixture(new URL('../../src/features/admin/__fixtures__/club-admin-payloads.json', import.meta.url), JSON.stringify(out, null, 2));
  expect(out.seasons.status).toBe(200);
  expect((out['pbe-releases'].body as unknown[]).length).toBe(2);
  expect((out['pbe-news-articles'].body as unknown[]).length).toBe(2);
  expect((out['coach-invitations'].body as unknown[]).length).toBe(1);
}, 60_000);
