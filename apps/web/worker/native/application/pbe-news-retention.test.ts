// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { pbkdf2Sync } from 'node:crypto';
import { Response as TestServiceResponse } from 'miniflare';
import type { Request as TestRequest, Response as TestResponse } from 'miniflare';
import { createNativeTestApp, TEST_ORG } from '../test-runtime';

/**
 * News suggestion retention: watcher drafts expire after 30 days, pending
 * suggestions are capped at the newest 25, dismissing (or expiring) a
 * suggestion retires its source so the watcher never drafts it again, and a
 * coach's own drafts plus every published article are never touched.
 */
const libraryOrg = '00000000-0000-4000-8000-000000000066';
let app: Awaited<ReturnType<typeof createNativeTestApp>>;
let ownerCookie = '', studentCookie = '', contentManagerCookie = '';

const callAs = (cookie: string) => (path: string, data?: unknown, method = data ? 'POST' : 'GET') =>
  app.fetch(`/api/v1/organizations/${TEST_ORG}${path}`, { method, headers: { Cookie: cookie, Origin: 'https://erudoza.test', 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
const asOwner = (path: string, data?: unknown, method = data ? 'POST' : 'GET') => callAs(ownerCookie)(path, data, method);
const asStudent = (path: string, data?: unknown, method = data ? 'POST' : 'GET') => callAs(studentCookie)(path, data, method);
const asContentManager = (path: string, data?: unknown, method = data ? 'POST' : 'GET') => callAs(contentManagerCookie)(path, data, method);

const DISMISSED_URL = 'https://nadpbe.org/dismissed-announcement/';
const EXPIRED_URL = 'https://nadpbe.org/expired-announcement/';

const outbound = async (request: TestRequest): Promise<TestResponse> => {
  const url = request.url;
  if (url.includes('/wp-json/wp/v2/media')) return TestServiceResponse.json([]) as unknown as TestResponse;
  if (url.includes('/wp-json/wp/v2/search')) {
    return TestServiceResponse.json([
      { id: 301, title: 'Dismissed announcement', url: DISMISSED_URL, type: 'post', subtype: 'post' },
      { id: 302, title: 'Expired announcement', url: EXPIRED_URL, type: 'post', subtype: 'post' },
    ]) as unknown as TestResponse;
  }
  throw new Error(`Unexpected outbound request in pbe-news-retention test: ${url}`);
};

const daysAgo = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();

async function seedArticle(overrides: Record<string, unknown>): Promise<string> {
  const article = {
    id: crypto.randomUUID(),
    title: 'Seeded article', summary: 'Seeded summary.',
    sections: [{ heading: 'Details', body: 'Seeded body.' }],
    articleType: 'announcement', keyPoints: [], linkedMaterials: [],
    status: 'draft', createdBy: 'nad-watcher',
    createdAtUtc: daysAgo(1), updatedAtUtc: daysAgo(1),
    ...overrides,
  };
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,data,revision) VALUES('pbe-news-article',?,?,?,1)")
    .bind(article.id, libraryOrg, JSON.stringify(article)).run();
  return article.id as string;
}

async function listArticles() {
  const res = await asOwner('/pbe-news/articles');
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; status: string; createdBy: string; sourceUrl: string | null }[];
}

beforeAll(async () => {
  app = await createNativeTestApp({ outboundService: outbound });
  await app.db.prepare('INSERT INTO Organizations(id,name,slug) VALUES(?,?,?)').bind(libraryOrg, 'Erudoza Built-in Scripture Library', 'erudoza-builtin-scripture').run();
  const login = await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test' }, body: JSON.stringify({ identifier: 'coach', password: 'Testing!123' }) });
  ownerCookie = login.headers.get('set-cookie')!.split(';')[0];
  const created = await asOwner('/students', { userName: 'pbe-retention-student', displayName: 'PBE retention student', password: 'Testing!123' });
  expect(created.status).toBe(201);
  const studentLogin = await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test' }, body: JSON.stringify({ identifier: 'pbe-retention-student', password: 'Testing!123' }) });
  studentCookie = studentLogin.headers.get('set-cookie')!.split(';')[0];
  const cmId = crypto.randomUUID(), salt = Buffer.alloc(16, 7);
  const hash = `pbkdf2:${salt.toString('base64')}:${pbkdf2Sync('Admin!123', salt, 100000, 32, 'sha256').toString('base64')}`;
  await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) VALUES(?,?,?,?,?,?,?,?)")
    .bind(cmId, TEST_ORG, 'pbe-retention-cm', 'PBE retention content manager', 'Adult', 'Content Manager', hash, 'v1').run();
  const cmLogin = await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test' }, body: JSON.stringify({ identifier: 'pbe-retention-cm', password: 'Admin!123' }) });
  contentManagerCookie = cmLogin.headers.get('set-cookie')!.split(';')[0];
}, 60000);
afterAll(async () => { await app?.runtime.dispose(); });

it('clears stale watcher suggestions on read; coach drafts and published articles survive', async () => {
  const stale = await seedArticle({ title: 'Stale suggestion', createdAtUtc: daysAgo(40), updatedAtUtc: daysAgo(40), sourceUrl: 'https://nadpbe.org/stale-post/' });
  const fresh = await seedArticle({ title: 'Fresh suggestion', createdAtUtc: daysAgo(2), updatedAtUtc: daysAgo(2), sourceUrl: 'https://nadpbe.org/fresh-post/' });
  const coachDraft = await seedArticle({ title: 'Coach draft', createdBy: 'coach-user', createdAtUtc: daysAgo(60), updatedAtUtc: daysAgo(60) });
  const published = await seedArticle({ title: 'Published watcher piece', status: 'published', createdAtUtc: daysAgo(90), updatedAtUtc: daysAgo(90), publishedAtUtc: daysAgo(89), publishedBy: 'owner-user' });

  const list = await listArticles();
  const ids = list.map(a => a.id);
  expect(ids).not.toContain(stale);
  expect(ids).toContain(fresh);
  expect(ids).toContain(coachDraft);
  expect(ids).toContain(published);

  // The published article is untouched in the student feed too.
  const feed = (await (await asStudent('/pbe-news')).json()) as { id: string }[];
  expect(feed.map(a => a.id)).toContain(published);
});

it('caps pending watcher suggestions at the newest 25', async () => {
  const seeded: string[] = [];
  for (let i = 0; i < 28; i++) {
    seeded.push(await seedArticle({
      title: `Burst suggestion ${i}`,
      createdAtUtc: new Date(Date.now() - (28 - i) * 60_000).toISOString(),
      updatedAtUtc: new Date(Date.now() - (28 - i) * 60_000).toISOString(),
      sourceUrl: `https://nadpbe.org/burst-${i}/`,
    }));
  }
  const list = await listArticles();
  const pending = list.filter(a => a.status === 'draft' && a.createdBy === 'nad-watcher');
  expect(pending).toHaveLength(25);
  const kept = new Set(pending.map(a => a.id));
  // The three oldest burst suggestions are the ones that go.
  expect(kept.has(seeded[0])).toBe(false);
  expect(kept.has(seeded[1])).toBe(false);
  expect(kept.has(seeded[2])).toBe(false);
  expect(kept.has(seeded[27])).toBe(true);
});

it('lets any content role dismiss a watcher suggestion, and only suggestions', async () => {
  const suggestion = await seedArticle({ title: 'Dismiss me', sourceUrl: DISMISSED_URL });
  const manual = await seedArticle({ title: 'Coach wrote this', createdBy: 'coach-user' });
  const published = await seedArticle({ title: 'Already live', status: 'published', publishedAtUtc: daysAgo(1), publishedBy: 'owner-user' });

  expect((await asStudent(`/pbe-news/articles/${suggestion}/dismiss`, {})).status).toBe(403);

  const dismissed = await asContentManager(`/pbe-news/articles/${suggestion}/dismiss`, {});
  expect(dismissed.status).toBe(200);
  expect(await dismissed.json()).toEqual({ ok: true });

  expect((await asContentManager(`/pbe-news/articles/${manual}/dismiss`, {})).status).toBe(400);
  expect((await asOwner(`/pbe-news/articles/${published}/dismiss`, {})).status).toBe(400);
  expect((await asOwner(`/pbe-news/articles/${crypto.randomUUID()}/dismiss`, {})).status).toBe(404);

  const ids = (await listArticles()).map(a => a.id);
  expect(ids).not.toContain(suggestion);
  expect(ids).toContain(manual);
  expect(ids).toContain(published);
});

it('never re-drafts a dismissed or expired source on the next watcher run', async () => {
  // An expired suggestion for EXPIRED_URL: the read sweep clears it and
  // retires the source before the watcher ever runs.
  const expired = await seedArticle({ title: 'Long stale', createdAtUtc: daysAgo(45), updatedAtUtc: daysAgo(45), sourceUrl: EXPIRED_URL });
  const before = await listArticles();
  expect(before.map(a => a.id)).not.toContain(expired);

  const watch = await asOwner('/pbe-materials/watch', {});
  expect(watch.status).toBe(200);
  const result = await watch.json() as { newsDrafted: { sourceUrl: string }[] };
  expect(result.newsDrafted.map(n => n.sourceUrl)).not.toContain(DISMISSED_URL);
  expect(result.newsDrafted.map(n => n.sourceUrl)).not.toContain(EXPIRED_URL);

  const after = await listArticles();
  expect(after.some(a => a.sourceUrl === DISMISSED_URL)).toBe(false);
  expect(after.some(a => a.sourceUrl === EXPIRED_URL)).toBe(false);
});
