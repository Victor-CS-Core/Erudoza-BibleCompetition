// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { pbkdf2Sync } from 'node:crypto';
import { Response as TestServiceResponse } from 'miniflare';
import type { Request as TestRequest, Response as TestResponse } from 'miniflare';
import { createNativeTestApp, TEST_ORG } from '../test-runtime';

const libraryOrg = '00000000-0000-4000-8000-000000000066';
let app: Awaited<ReturnType<typeof createNativeTestApp>>;
let coachCookie = '', studentCookie = '', adminCookie = '', contentManagerCookie = '';

const callAs = (cookie: string) => (path: string, data?: unknown, method = data ? 'POST' : 'GET', headers: Record<string, string> = {}) =>
  app.fetch(`/api/v1/organizations/${TEST_ORG}${path}`, { method, headers: { Cookie: cookie, Origin: 'https://erudoza.test', 'Content-Type': 'application/json', ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) });
const asOwner = (path: string, data?: unknown, method = data ? 'POST' : 'GET') => callAs(coachCookie)(path, data, method);
const asStudent = (path: string, data?: unknown, method = data ? 'POST' : 'GET') => callAs(studentCookie)(path, data, method);
const asAdmin = (path: string, data?: unknown, method = data ? 'POST' : 'GET') => callAs(adminCookie)(path, data, method);
const asContentManager = (path: string, data?: unknown, method = data ? 'POST' : 'GET') => callAs(contentManagerCookie)(path, data, method);

const ARTICLE_HTML = `<!doctype html><html><head>
<meta property="og:title" content="A very long announcement title that definitely exceeds ninety characters in total length | NAD PBE">
<meta property="og:description" content="NAD has released the 2026-27 book roster with two new books.">
<title>Fallback title - NAD PBE</title></head><body>
<p>This is the first substantive paragraph of the article body, long enough to count as content for extraction.</p>
<p>This is the second substantive paragraph of the article body, also long enough to be picked up by the parser.</p>
<p>Short.</p>
</body></html>`;

const outbound = async (request: TestRequest): Promise<TestResponse> => {
  const url = request.url;
  if (url === 'https://example.com/article') {
    return new TestServiceResponse(ARTICLE_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  if (url === 'https://example.com/file.pdf') {
    return new TestServiceResponse('%PDF-1.4 fake', { status: 200, headers: { 'Content-Type': 'application/pdf' } });
  }
  if (url === 'https://down.example.com/') throw new Error('getaddrinfo ENOTFOUND down.example.com');
  throw new Error(`Unexpected outbound request in pbe-news-feed test: ${url}`);
};

const fullArticle = () => ({
  title: 'Commentary deep-dive: Isaiah 53',
  summary: 'The suffering-servant chapter, unpacked verse by verse from the official commentary.',
  sections: [{ heading: 'Why it matters', body: 'Isaiah 53 appears in finals more than any other single chapter.' }],
  articleType: 'study-material',
  keyPoints: ['Verse-by-verse notes', "The 5 most-asked judges' questions"],
  linkedMaterials: [
    { label: 'Isaiah 53 commentary notes', href: '/student/library?year=2025-26#isaiah-53', hint: 'In-app library' },
    { label: 'Official commentary PDF, p. 42', href: 'https://nadpbe.org/wp-content/uploads/2025/10/isaiah-commentary-manual.pdf' },
  ],
  readMinutes: 6,
  sourceUrl: 'https://nadpbe.org/announcement/isaiah-53/',
  sourceLabel: 'nadpbe.org',
});

beforeAll(async () => {
  app = await createNativeTestApp({ outboundService: outbound });
  await app.db.prepare('INSERT INTO Organizations(id,name,slug) VALUES(?,?,?)').bind(libraryOrg, 'Erudoza Built-in Scripture Library', 'erudoza-builtin-scripture').run();
  const login = await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test' }, body: JSON.stringify({ identifier: 'coach', password: 'Testing!123' }) });
  coachCookie = login.headers.get('set-cookie')!.split(';')[0];
  const created = await asOwner('/students', { userName: 'pbe-news-student', displayName: 'PBE news student', password: 'Testing!123' });
  expect(created.status).toBe(201);
  const studentLogin = await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test' }, body: JSON.stringify({ identifier: 'pbe-news-student', password: 'Testing!123' }) });
  studentCookie = studentLogin.headers.get('set-cookie')!.split(';')[0];
  const adminId = crypto.randomUUID(), salt = Buffer.alloc(16, 7);
  const hash = `pbkdf2:${salt.toString('base64')}:${pbkdf2Sync('Admin!123', salt, 100000, 32, 'sha256').toString('base64')}`;
  await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) VALUES(?,?,?,?,?,?,?,?)")
    .bind(adminId, TEST_ORG, 'pbe-news-admin', 'PBE news admin', 'Adult', 'Admin', hash, 'v1').run();
  const adminLogin = await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test' }, body: JSON.stringify({ identifier: 'pbe-news-admin', password: 'Admin!123' }) });
  adminCookie = adminLogin.headers.get('set-cookie')!.split(';')[0];
  const cmId = crypto.randomUUID();
  await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) VALUES(?,?,?,?,?,?,?,?)")
    .bind(cmId, TEST_ORG, 'pbe-news-cm', 'PBE news content manager', 'Adult', 'Content Manager', hash, 'v1').run();
  const cmLogin = await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test' }, body: JSON.stringify({ identifier: 'pbe-news-cm', password: 'Admin!123' }) });
  contentManagerCookie = cmLogin.headers.get('set-cookie')!.split(';')[0];
}, 60000);
afterAll(async () => { await app?.runtime.dispose(); });

it('round-trips a full article create -> list -> update', async () => {
  const created = await asContentManager('/pbe-news/articles', fullArticle());
  expect(created.status).toBe(201);
  const article = await created.json() as Record<string, unknown>;
  expect(article.articleType).toBe('study-material');
  expect(article.keyPoints).toEqual(fullArticle().keyPoints);
  expect(article.linkedMaterials).toEqual(fullArticle().linkedMaterials);
  expect(article.readMinutes).toBe(6);
  const articleId = article.id as string;

  const list = await asOwner('/pbe-news/articles');
  expect(list.status).toBe(200);
  const listed = (await list.json() as Record<string, unknown>[]).find(a => a.id === articleId);
  expect(listed?.articleType).toBe('study-material');
  expect(listed?.keyPoints).toEqual(fullArticle().keyPoints);
  expect(listed?.readMinutes).toBe(6);

  const updated = await asContentManager(`/pbe-news/articles/${articleId}`, { ...fullArticle(), articleType: 'competition', keyPoints: ['Only point'], readMinutes: 3 }, 'PUT');
  expect(updated.status).toBe(200);
  const body = await updated.json() as Record<string, unknown>;
  expect(body.articleType).toBe('competition');
  expect(body.keyPoints).toEqual(['Only point']);
  expect(body.readMinutes).toBe(3);
  expect(body.linkedMaterials).toEqual(fullArticle().linkedMaterials); // preserved
});

it('rejects invalid article payloads with 400', async () => {
  const base = fullArticle();
  const cases: [string, unknown][] = [
    ['missing articleType', { ...base, articleType: undefined }],
    ['bad articleType', { ...base, articleType: 'blog' }],
    ['too many keyPoints', { ...base, keyPoints: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }],
    ['oversized keyPoint', { ...base, keyPoints: ['x'.repeat(81)] }],
    ['javascript href', { ...base, linkedMaterials: [{ label: 'evil', href: 'javascript:alert(1)' }] }],
    ['relative href without slash', { ...base, linkedMaterials: [{ label: 'bad', href: 'library/isaiah' }] }],
    ['too many linked materials', { ...base, linkedMaterials: Array.from({ length: 9 }, (_, i) => ({ label: `m${i}`, href: '/x' })) }],
    ['oversized hint', { ...base, linkedMaterials: [{ label: 'm', href: '/x', hint: 'h'.repeat(121) }] }],
    ['readMinutes 0', { ...base, readMinutes: 0 }],
    ['readMinutes 121', { ...base, readMinutes: 121 }],
    ['readMinutes non-integer', { ...base, readMinutes: 2.5 }],
  ];
  for (const [name, payload] of cases) {
    const res = await asContentManager('/pbe-news/articles', payload);
    expect([name, res.status]).toEqual([name, 400]);
  }
});

it('restricts DELETE to the Owner and removes the record', async () => {
  const created = await asContentManager('/pbe-news/articles', fullArticle());
  const articleId = (await created.json() as { id: string }).id;

  expect((await asContentManager(`/pbe-news/articles/${articleId}`, undefined, 'DELETE')).status).toBe(403);
  expect((await asAdmin(`/pbe-news/articles/${articleId}`, undefined, 'DELETE')).status).toBe(403);
  expect((await asStudent(`/pbe-news/articles/${articleId}`, undefined, 'DELETE')).status).toBe(403);

  const deleted = await asOwner(`/pbe-news/articles/${articleId}`, undefined, 'DELETE');
  expect(deleted.status).toBe(200);
  expect(await deleted.json()).toEqual({ ok: true });
  const list = (await (await asOwner('/pbe-news/articles')).json()) as { id: string }[];
  expect(list.some(a => a.id === articleId)).toBe(false);
  expect((await asOwner(`/pbe-news/articles/${articleId}`, undefined, 'DELETE')).status).toBe(404);
});

it('extracts a draft suggestion from an article URL without saving it', async () => {
  const res = await asContentManager('/pbe-news/extract', { url: 'https://example.com/article' });
  expect(res.status).toBe(200);
  const draft = await res.json() as Record<string, unknown>;
  // og:title wins over <title>; the long site suffix is stripped.
  expect(draft.title).toBe('A very long announcement title that definitely exceeds ninety characters in total length');
  expect(draft.summary).toBe('NAD has released the 2026-27 book roster with two new books.');
  expect(draft.sections).toEqual([{ heading: 'Extracted content', body: expect.stringContaining('first substantive paragraph') }]);
  expect(draft.articleType).toBe('announcement');
  expect(draft.keyPoints).toEqual([]);
  expect(draft.sourceUrl).toBe('https://example.com/article');
  expect(draft.sourceLabel).toBe('example.com');

  // Not persisted as a draft.
  const list = (await (await asOwner('/pbe-news/articles')).json()) as { sourceUrl: string | null }[];
  expect(list.some(a => a.sourceUrl === 'https://example.com/article')).toBe(false);
});

it('gates and fails the extract endpoint safely', async () => {
  expect((await asAdmin('/pbe-news/extract', { url: 'https://example.com/article' })).status).toBe(403);
  expect((await asStudent('/pbe-news/extract', { url: 'https://example.com/article' })).status).toBe(403);
  // Invalid URL field -> 400 validation.
  expect((await asContentManager('/pbe-news/extract', { url: 'not-a-url' })).status).toBe(400);
  expect((await asContentManager('/pbe-news/extract', {})).status).toBe(400);
  // Non-HTML content -> 422.
  expect((await asContentManager('/pbe-news/extract', { url: 'https://example.com/file.pdf' })).status).toBe(422);
  // Unreachable host -> 422, never a raw exception.
  const down = await asContentManager('/pbe-news/extract', { url: 'https://down.example.com/' });
  expect(down.status).toBe(422);
  expect(await down.text()).toContain('could not be fetched');
});

it('backfills defaults for legacy article rows on every read path', async () => {
  const legacy = {
    id: 'legacy-article-1', title: 'Old announcement', summary: 'Legacy summary.',
    sections: [{ heading: 'Details', body: 'Old body.' }],
    status: 'published', createdBy: 'nad-watcher',
    createdAtUtc: '2026-01-01T00:00:00.000Z', updatedAtUtc: '2026-01-01T00:00:00.000Z',
    publishedAtUtc: '2026-01-02T00:00:00.000Z',
  };
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,data,revision) VALUES('pbe-news-article',?,?,?,1)")
    .bind(legacy.id, libraryOrg, JSON.stringify(legacy)).run();

  // Management list.
  const list = (await (await asOwner('/pbe-news/articles')).json()) as Record<string, unknown>[];
  const listed = list.find(a => a.id === legacy.id)!;
  expect(listed.articleType).toBe('announcement');
  expect(listed.keyPoints).toEqual([]);
  expect(listed.linkedMaterials).toEqual([]);
  expect(listed.readMinutes).toBeNull();

  // Student feed list.
  const feed = (await (await asStudent('/pbe-news')).json()) as Record<string, unknown>[];
  const card = feed.find(a => a.id === legacy.id)!;
  expect(card.articleType).toBe('announcement');
  expect(card.keyPoints).toEqual([]);
  expect(card.linkedMaterials).toEqual([]);

  // Student detail.
  const detail = await (await asStudent(`/pbe-news/${legacy.id}`)).json() as Record<string, unknown>;
  expect(detail.articleType).toBe('announcement');
  expect(detail.keyPoints).toEqual([]);
  expect(detail.linkedMaterials).toEqual([]);
});

it('publishes an article and the student feed shows the new fields', async () => {
  const created = await asContentManager('/pbe-news/articles', fullArticle());
  const articleId = (await created.json() as { id: string }).id;
  expect((await asContentManager(`/pbe-news/articles/${articleId}/publish`, {})).status).toBe(403);
  const published = await asOwner(`/pbe-news/articles/${articleId}/publish`, {});
  expect(published.status).toBe(200);

  const feed = (await (await asStudent('/pbe-news')).json()) as Record<string, unknown>[];
  const card = feed.find(a => a.id === articleId)!;
  expect(card.articleType).toBe('study-material');
  expect(card.keyPoints).toEqual(fullArticle().keyPoints);
  expect(card.linkedMaterials).toEqual(fullArticle().linkedMaterials);
  expect(card.readMinutes).toBe(6);

  const detail = await (await asStudent(`/pbe-news/${articleId}`)).json() as Record<string, unknown>;
  expect(detail.sections).toHaveLength(1);
  expect(detail.articleType).toBe('study-material');
});
