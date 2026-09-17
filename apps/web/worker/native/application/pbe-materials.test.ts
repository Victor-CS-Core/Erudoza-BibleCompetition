// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { pbkdf2Sync } from 'node:crypto';
import { Response as TestServiceResponse } from 'miniflare';
import type { Request as TestRequest, Response as TestResponse } from 'miniflare';
import { createNativeTestApp, TEST_ORG } from '../test-runtime';
import { runScheduledWatch } from './pbe-materials';
import type { Env } from '../types';
import { vi } from 'vitest';

const libraryOrg = '00000000-0000-4000-8000-000000000066';
let app: Awaited<ReturnType<typeof createNativeTestApp>>;
let coachCookie = '', studentCookie = '', adminCookie = '', contentManagerCookie = '';
let wpHandler: (request: TestRequest) => Promise<TestResponse> = async () => { throw new Error('Unexpected outbound request in pbe-materials test'); };

const call = (path: string, data?: unknown, method = data ? 'POST' : 'GET') =>
  app.fetch(`/api/v1/organizations/${TEST_ORG}${path}`, { method, headers: { Cookie: coachCookie, Origin: 'https://erudoza.test' }, ...(data ? { body: JSON.stringify(data) } : {}) });
const callAs = (cookie: string) => (path: string, data?: unknown, method = data ? 'POST' : 'GET') =>
  app.fetch(`/api/v1/organizations/${TEST_ORG}${path}`, { method, headers: { Cookie: cookie, Origin: 'https://erudoza.test' }, ...(data ? { body: JSON.stringify(data) } : {}) });
const asStudent = (path: string, data?: unknown, method = data ? 'POST' : 'GET') => callAs(studentCookie)(path, data, method);
const asAdmin = (path: string, data?: unknown, method = data ? 'POST' : 'GET') => callAs(adminCookie)(path, data, method);
const asContentManager = (path: string, data?: unknown, method = data ? 'POST' : 'GET') => callAs(contentManagerCookie)(path, data, method);

const validRelease = (yearLabel = '2025-26') => ({
  yearLabel,
  material: {
    yearLabel,
    books: [{ bookKey: 'ISA', bookName: 'Isaiah', chapters: [3, 1, 2] }],
    commentary: { bookName: 'Isaiah', title: 'ISAIAH', sections: [{ heading: 'Title and Authorship', body: 'The superscription in Isaiah 1:1 gives the identity of the seer.' }] },
    sourceUrls: { resourcesPage: 'https://nadpbe.org/pbe-resources/', versesPdf: 'https://nadpbe.org/wp-content/uploads/2025/10/isaiah-verses-manual.pdf', commentaryPdf: 'https://nadpbe.org/wp-content/uploads/2025/10/isaiah-commentary-manual.pdf' },
  },
});

const validArticle = () => ({
  title: 'PBE kickoff announced',
  summary: 'The new competition year is underway.',
  sections: [{ heading: 'Details', body: 'Everything you need to know.' }],
  sourceUrl: 'https://nadpbe.org/announcement/',
  sourceLabel: 'nadpbe.org',
});

async function libRow(kind: string, recId: string) {
  return app.db.prepare('SELECT data,revision FROM Records WHERE kind=? AND id=? AND org_id=?').bind(kind, recId, libraryOrg).first<{ data: string; revision: number }>();
}

beforeAll(async () => {
  app = await createNativeTestApp({ outboundService: async request => wpHandler(request) });
  // The shared-library org row must exist: Records.org_id is a foreign key (mirrors nkjv-library.mjs).
  await app.db.prepare('INSERT INTO Organizations(id,name,slug) VALUES(?,?,?)').bind(libraryOrg, 'Erudoza Built-in Scripture Library', 'erudoza-builtin-scripture').run();
  const login = await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test' }, body: JSON.stringify({ identifier: 'coach', password: 'Testing!123' }) });
  coachCookie = login.headers.get('set-cookie')!.split(';')[0];
  // Student user (via the product API, like library.test.ts).
  const created = await call('/students', { userName: 'pbe-student', displayName: 'PBE student', password: 'Testing!123' });
  expect(created.status).toBe(201);
  const studentLogin = await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test' }, body: JSON.stringify({ identifier: 'pbe-student', password: 'Testing!123' }) });
  studentCookie = studentLogin.headers.get('set-cookie')!.split(';')[0];
  // Admin (non-Owner) adult user, inserted directly.
  const adminId = crypto.randomUUID(), salt = Buffer.alloc(16, 7);
  const hash = `pbkdf2:${salt.toString('base64')}:${pbkdf2Sync('Admin!123', salt, 100000, 32, 'sha256').toString('base64')}`;
  await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) VALUES(?,?,?,?,?,?,?,?)")
    .bind(adminId, TEST_ORG, 'pbe-admin', 'PBE admin', 'Adult', 'Admin', hash, 'v1').run();
  const adminLogin = await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test' }, body: JSON.stringify({ identifier: 'pbe-admin', password: 'Admin!123' }) });
  adminCookie = adminLogin.headers.get('set-cookie')!.split(';')[0];
  // Content Manager adult user, inserted directly.
  const cmId = crypto.randomUUID();
  await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) VALUES(?,?,?,?,?,?,?,?)")
    .bind(cmId, TEST_ORG, 'pbe-content-manager', 'PBE content manager', 'Adult', 'Content Manager', hash, 'v1').run();
  const cmLogin = await app.fetch('/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://erudoza.test' }, body: JSON.stringify({ identifier: 'pbe-content-manager', password: 'Admin!123' }) });
  contentManagerCookie = cmLogin.headers.get('set-cookie')!.split(';')[0];
}, 60000);
afterAll(async () => { await app?.runtime.dispose(); });

it('creates draft proposals with strict validation, and students cannot create them', async () => {
  const created = await call('/pbe-materials/releases', validRelease());
  expect(created.status).toBe(201);
  const proposal = await created.json() as { id: string; status: string; origin: string; material: { books: { chapters: number[] }[] } };
  expect(proposal.status).toBe('draft'); expect(proposal.origin).toBe('manual');
  expect(proposal.material.books[0].chapters).toEqual([1, 2, 3]); // normalized: deduped + sorted
  for (const bad of [
    { ...validRelease(), yearLabel: '2025' },
    { ...validRelease(), material: { ...validRelease().material, books: [] } },
    { ...validRelease(), material: { ...validRelease().material, commentary: { bookName: 'Isaiah', title: 'ISAIAH', sections: [] } } },
    { ...validRelease(), material: { ...validRelease().material, sourceUrls: { versesPdf: 'https://nadpbe.org/v.pdf' } } },
    { ...validRelease(), material: { ...validRelease().material, yearLabel: '2026-27' } },
  ]) expect((await call('/pbe-materials/releases', bad)).status).toBe(400);
  expect((await asStudent('/pbe-materials/releases', validRelease('2030-31'))).status).toBe(403);
});

it('denies students and regular admins every management route; Owner and Content Manager pass', async () => {
  const probe = validRelease('2031-32');
  const created = await call('/pbe-materials/releases', probe);
  const { id } = await created.json() as { id: string };
  for (const asDenied of [asStudent, asAdmin]) {
    expect((await asDenied('/pbe-materials/releases')).status).toBe(403);
    expect((await asDenied(`/pbe-materials/releases/${id}`)).status).toBe(403);
    expect((await asDenied(`/pbe-materials/releases/${id}`, probe, 'PUT')).status).toBe(403);
    expect((await asDenied(`/pbe-materials/releases/${id}/review`, { decision: 'approved' })).status).toBe(403);
    expect((await asDenied('/pbe-materials/watch', {})).status).toBe(403);
    expect((await asDenied('/pbe-news/articles')).status).toBe(403);
    expect((await asDenied('/pbe-news/articles', validArticle())).status).toBe(403);
  }
  expect((await asContentManager('/pbe-materials/releases')).status).toBe(200);
  expect((await asContentManager(`/pbe-materials/releases/${id}`)).status).toBe(200);
});

it('approves a release atomically: material live, gate written, proposal marked', async () => {
  // The Content Manager drafts; the Owner (a different user) reviews — proposer and approver stay separate.
  const created = await asContentManager('/pbe-materials/releases', validRelease('2025-26'));
  const { id } = await created.json() as { id: string };
  const reviewed = await call(`/pbe-materials/releases/${id}/review`, { decision: 'approved', note: 'Looks good' });
  expect(reviewed.status).toBe(200);
  const decided = await reviewed.json() as { status: string; decidedBy: string; reviewNote: string };
  expect(decided.status).toBe('approved'); expect(decided.decidedBy).toBeTruthy(); expect(decided.reviewNote).toBe('Looks good');
  const material = await libRow('pbe-material', 'pbe-material-2025-26');
  expect(material).toBeTruthy();
  const value = JSON.parse(material!.data) as { version: number; approvedBy: string; releaseNote: string; books: { bookKey: string }[] };
  expect(value.version).toBe(1); expect(value.approvedBy).toBeTruthy(); expect(value.releaseNote).toBe('Looks good');
  expect(value.books[0].bookKey).toBe('ISA');
  const gate = await libRow('library-version', 'pbe-2025-26');
  expect(gate).toBeTruthy(); expect(JSON.parse(gate!.data)).toEqual({ ready: true });
  // Students can read the live release summary (roster, section headings, source URLs).
  const list = await asStudent('/pbe-materials');
  expect(list.status).toBe(200);
  const releases = await list.json() as { yearLabel: string; sectionHeadings: string[]; sourceUrls: { resourcesPage: string } }[];
  const live = releases.find(r => r.yearLabel === '2025-26');
  expect(live).toBeTruthy();
  expect(live!.sectionHeadings).toEqual(['Title and Authorship']);
  expect(live!.sourceUrls.resourcesPage).toBe('https://nadpbe.org/pbe-resources/');
});

it('re-releases the same year with a bumped version', async () => {
  const first = await libRow('pbe-material', 'pbe-material-2025-26');
  const firstVersion = (JSON.parse(first!.data) as { version: number }).version;
  const payload = validRelease('2025-26');
  payload.material.commentary.sections = [{ heading: 'Title and Authorship', body: 'Revised body text.' }];
  const created = await asContentManager('/pbe-materials/releases', payload);
  const { id } = await created.json() as { id: string };
  expect((await call(`/pbe-materials/releases/${id}/review`, { decision: 'approved' })).status).toBe(200);
  const material = await libRow('pbe-material', 'pbe-material-2025-26');
  expect((JSON.parse(material!.data) as { version: number }).version).toBe(firstVersion + 1);
});

it('computes the proposal diff against the live year (and against nothing for a new year)', async () => {
  const payload = validRelease('2025-26');
  payload.material.books = [{ bookKey: 'ISA', bookName: 'Isaiah', chapters: [1, 2, 3, 4] }, { bookKey: 'JER', bookName: 'Jeremiah', chapters: [1] }];
  payload.material.commentary.sections = [
    { heading: 'Title and Authorship', body: 'Changed body.' },
    { heading: 'Brand new section', body: 'Fresh content.' },
  ];
  const created = await call('/pbe-materials/releases', payload);
  const { id } = await created.json() as { id: string };
  const detail = await call(`/pbe-materials/releases/${id}`);
  expect(detail.status).toBe(200);
  const { proposal, diff, live } = await detail.json() as {
    proposal: { material: { sourceUrls: { resourcesPage: string } } };
    diff: { booksChanged: boolean; rosterChanged: boolean; addedSections: string[]; removedSections: string[]; changedSections: string[] };
    live: { yearLabel: string } | null;
  };
  expect(live?.yearLabel).toBe('2025-26');
  expect(diff.booksChanged).toBe(true); expect(diff.rosterChanged).toBe(true);
  expect(diff.changedSections).toEqual(['Title and Authorship']);
  expect(diff.addedSections).toEqual(['Brand new section']);
  expect(diff.removedSections).toEqual([]);
  expect(proposal.material.sourceUrls.resourcesPage).toBe('https://nadpbe.org/pbe-resources/');
  // A year with no live release diffs against nothing.
  const fresh = await call('/pbe-materials/releases', validRelease('2032-33'));
  const freshId = (await fresh.json() as { id: string }).id;
  const freshDetail = await call(`/pbe-materials/releases/${freshId}`);
  const freshParsed = await freshDetail.json() as { live: null; diff: { addedSections: string[]; booksChanged: boolean } };
  expect(freshParsed.live).toBeNull();
  expect(freshParsed.diff.addedSections).toEqual(['Title and Authorship']);
  expect(freshParsed.diff.booksChanged).toBe(true);
});

it('resolves the current material by the season yearLabel, and returns null when unreleased', async () => {
  const seasonRes = await call('/seasons', { name: 'PBE season', yearLabel: '2025-26', ruleProfileKey: 'PBE_STYLE_V1' });
  expect(seasonRes.status).toBe(201);
  const season = await seasonRes.json() as { id: string };
  const current = await asStudent(`/pbe-materials/current?seasonId=${season.id}`);
  expect(current.status).toBe(200);
  const parsed = await current.json() as { material: { yearLabel: string; books: { bookKey: string }[] } | null };
  expect(parsed.material?.yearLabel).toBe('2025-26');
  expect(parsed.material?.books[0].bookKey).toBe('ISA');
  const futureRes = await call('/seasons', { name: 'Future season', yearLabel: '2030-31', ruleProfileKey: 'PBE_STYLE_V1' });
  const future = await futureRes.json() as { id: string };
  const unreleased = await asStudent(`/pbe-materials/current?seasonId=${future.id}`);
  expect(unreleased.status).toBe(200);
  expect((await unreleased.json() as { material: null }).material).toBeNull();
  expect((await asStudent('/pbe-materials/current')).status).toBe(400);
  expect((await asStudent('/pbe-materials/current?seasonId=00000000-0000-4000-8000-000000000000')).status).toBe(404);
});

it('rejects a proposal without publishing anything', async () => {
  const created = await asContentManager('/pbe-materials/releases', validRelease('2026-27'));
  const { id } = await created.json() as { id: string };
  const rejected = await call(`/pbe-materials/releases/${id}/review`, { decision: 'rejected', note: 'Needs work' });
  expect(rejected.status).toBe(200);
  const decided = await rejected.json() as { status: string; reviewNote: string };
  expect(decided.status).toBe('rejected'); expect(decided.reviewNote).toBe('Needs work');
  expect(await libRow('pbe-material', 'pbe-material-2026-27')).toBeNull();
  expect(await libRow('library-version', 'pbe-2026-27')).toBeNull();
  expect((await call(`/pbe-materials/releases/${id}/review`, { decision: 'approved' })).status).toBe(400);
});

it('keeps proposer and approver separate: the Owner cannot review their own proposal', async () => {
  const created = await call('/pbe-materials/releases', validRelease('2035-36'));
  const { id } = await created.json() as { id: string };
  const selfReview = await call(`/pbe-materials/releases/${id}/review`, { decision: 'approved', note: 'self-approval' });
  expect(selfReview.status).toBe(403);
  const stored = await libRow('pbe-material-proposal', id);
  expect((JSON.parse(stored!.data) as { status: string }).status).toBe('draft');
  expect(await libRow('pbe-material', 'pbe-material-2035-36')).toBeNull();
});

it('restricts review to the Owner: Admin and Student both get 403', async () => {
  // Drafted by the Content Manager so the Owner can still review it (proposer/approver separation).
  const created = await asContentManager('/pbe-materials/releases', validRelease('2033-34'));
  const { id } = await created.json() as { id: string };
  expect((await asAdmin(`/pbe-materials/releases/${id}/review`, { decision: 'approved' })).status).toBe(403);
  expect((await asStudent(`/pbe-materials/releases/${id}/review`, { decision: 'approved' })).status).toBe(403);
  expect((await call(`/pbe-materials/releases/${id}/review`, { decision: 'maybe' })).status).toBe(400);
  const stored = await libRow('pbe-material-proposal', id);
  expect((JSON.parse(stored!.data) as { status: string }).status).toBe('draft');
  expect(await libRow('pbe-material', 'pbe-material-2033-34')).toBeNull();
});

it('lets content managers draft and edit, but never review releases or publish news', async () => {
  // Draft-level operations pass the content gate.
  const draft = await asContentManager('/pbe-materials/releases', validRelease('2035-36'));
  expect(draft.status).toBe(201);
  const { id: proposalId } = await draft.json() as { id: string };
  const updated = await asContentManager(`/pbe-materials/releases/${proposalId}`, validRelease('2035-36'), 'PUT');
  expect(updated.status).toBe(200);
  expect((await asContentManager('/pbe-materials/releases')).status).toBe(200);
  const article = await asContentManager('/pbe-news/articles', validArticle());
  expect(article.status).toBe(201);
  const { id: articleId } = await article.json() as { id: string };
  const edited = await asContentManager(`/pbe-news/articles/${articleId}`, { ...validArticle(), title: 'CM edited title' }, 'PUT');
  expect(edited.status).toBe(200);
  // Review and publish stay Owner-only: Content Manager and Admin both get 403.
  expect((await asContentManager(`/pbe-materials/releases/${proposalId}/review`, { decision: 'approved' })).status).toBe(403);
  expect((await asAdmin(`/pbe-materials/releases/${proposalId}/review`, { decision: 'approved' })).status).toBe(403);
  expect((await asContentManager(`/pbe-news/articles/${articleId}/publish`, {})).status).toBe(403);
  expect((await asContentManager(`/pbe-news/articles/${articleId}/unpublish`, {})).status).toBe(403);
  const stored = await libRow('pbe-material-proposal', proposalId);
  expect((JSON.parse(stored!.data) as { status: string }).status).toBe('draft');
});

it('updates a draft proposal payload (completing watcher-style drafts); non-drafts 404', async () => {
  const created = await call('/pbe-materials/releases', validRelease('2034-35'));
  const { id } = await created.json() as { id: string };
  const updated = await call(`/pbe-materials/releases/${id}`, validRelease('2034-35'), 'PUT');
  expect(updated.status).toBe(200);
  const updatedBody = await updated.json() as { yearLabel: string; material: { commentary: { title: string } }; status: string };
  expect(updatedBody.yearLabel).toBe('2034-35'); expect(updatedBody.material.commentary.title).toBe('ISAIAH'); expect(updatedBody.status).toBe('draft');
  // Non-draft proposals (approved above, or unknown ids) cannot be updated.
  const releases = await (await call('/pbe-materials/releases')).json() as { id: string; status: string }[];
  const approvedId = releases.find(p => p.status === 'approved')!.id;
  expect((await call(`/pbe-materials/releases/${approvedId}`, validRelease('2025-26'), 'PUT')).status).toBe(404);
  expect((await call('/pbe-materials/releases/00000000-0000-4000-8000-000000000000', validRelease('2025-26'), 'PUT')).status).toBe(404);
});

it('runs news article CRUD with Owner-only publish state changes', async () => {
  const created = await asContentManager('/pbe-news/articles', validArticle());
  expect(created.status).toBe(201);
  const article = await created.json() as { id: string; status: string; createdBy: string };
  expect(article.status).toBe('draft'); expect(article.createdBy).toBeTruthy();
  for (const bad of [{ ...validArticle(), title: ' ' }, { ...validArticle(), sections: [] }]) expect((await asContentManager('/pbe-news/articles', bad)).status).toBe(400);
  // Drafts are invisible to learners.
  const emptyFeed = await asStudent('/pbe-news');
  expect(emptyFeed.status).toBe(200);
  expect(await emptyFeed.json()).toEqual([]);
  expect((await asStudent(`/pbe-news/${article.id}`)).status).toBe(404);
  // Content Managers can list and edit drafts, but only the Owner changes publish state.
  const listed = await asContentManager('/pbe-news/articles');
  expect((await listed.json() as { status: string }[]).some(a => a.status === 'draft')).toBe(true);
  expect((await asContentManager(`/pbe-news/articles/${article.id}/publish`, {})).status).toBe(403);
  expect((await asStudent(`/pbe-news/articles/${article.id}/publish`, {})).status).toBe(403);
  const edited = await asContentManager(`/pbe-news/articles/${article.id}`, { ...validArticle(), title: 'Updated title' }, 'PUT');
  expect(edited.status).toBe(200);
  const editedBody = await edited.json() as { title: string; status: string };
  expect(editedBody.title).toBe('Updated title');
  expect(editedBody.status).toBe('draft');
  const published = await call(`/pbe-news/articles/${article.id}/publish`, {});
  expect(published.status).toBe(200);
  const pubBody = await published.json() as { status: string; publishedBy: string; publishedAtUtc: string };
  expect(pubBody.status).toBe('published'); expect(pubBody.publishedBy).toBeTruthy(); expect(pubBody.publishedAtUtc).toBeTruthy();
  // Learners now see the feed card and the full article.
  const feed = await asStudent('/pbe-news');
  const cards = await feed.json() as { id: string; title: string; summary: string; sourceUrl: string; sourceLabel: string }[];
  expect(cards.some(c => c.id === article.id && c.sourceLabel === 'nadpbe.org')).toBe(true);
  const reader = await asStudent(`/pbe-news/${article.id}`);
  expect(reader.status).toBe(200);
  expect((await reader.json() as { sections: unknown[] }).sections).toHaveLength(1);
  // Unpublish hides it again (history kept).
  const unpublished = await call(`/pbe-news/articles/${article.id}/unpublish`, {});
  expect(unpublished.status).toBe(200);
  const unpubBody = await unpublished.json() as { status: string; publishedAtUtc: string };
  expect(unpubBody.status).toBe('draft'); expect(unpubBody.publishedAtUtc).toBeTruthy();
  expect((await asStudent(`/pbe-news/${article.id}`)).status).toBe(404);
  expect((await asStudent('/pbe-news')).status).toBe(200);
});

/* ---------------- watcher tests (mocked NAD WordPress API) ---------------- */

const nadMediaItems = [
  { id: 101, date: '2025-10-15T10:00:00', slug: 'isaiah-commentary-2026', mime_type: 'application/pdf', source_url: 'https://nadpbe.org/wp-content/uploads/2025/10/isaiah-commentary.pdf', title: { rendered: 'Isaiah Commentary 2026' }, caption: { rendered: '' } },
  { id: 102, date: '2025-10-16T10:00:00', slug: 'isaiah-verses', mime_type: 'application/pdf', source_url: 'https://nadpbe.org/wp-content/uploads/2025/10/isaiah-verses.pdf', title: { rendered: 'Isaiah Verses 1-33' }, caption: { rendered: '' } },
  { id: 103, date: '2025-10-16T10:00:00', slug: 'team-photo', mime_type: 'image/jpeg', source_url: 'https://nadpbe.org/wp-content/uploads/2025/10/team.jpg', title: { rendered: 'Team photo' }, caption: { rendered: '' } },
];
const nadSearchItems = [
  { id: 201, title: '<b>New PBE</b> resources page', url: 'https://nadpbe.org/pbe-resources-update/', type: 'post', subtype: 'post' },
  { id: 202, title: 'Unrelated', url: '', type: 'post', subtype: 'post' },
];

it('drafts material proposals and news suggestions for new NAD PDFs, skips duplicates and non-PDFs', async () => {
  wpHandler = async request => {
    if (request.url.includes('/wp-json/wp/v2/search')) return TestServiceResponse.json(nadSearchItems) as unknown as TestResponse;
    if (request.url.includes('/wp-json/wp/v2/media')) return TestServiceResponse.json(nadMediaItems) as unknown as TestResponse;
    throw new Error(`Unexpected NAD URL: ${request.url}`);
  };
  const first = await call('/pbe-materials/watch', {});
  expect(first.status).toBe(200);
  const result = await first.json() as {
    checkedAt: string; mediaChecked: number;
    drafted: { proposalId: string; yearLabel: string; title: string; sourceUrl: string }[];
    newsDrafted: { articleId: string; title: string; sourceUrl: string }[];
  };
  expect(result.checkedAt).toBeTruthy();
  // Two PDFs examined across three search queries; the JPEG never counts.
  expect(result.mediaChecked).toBe(6);
  expect(result.drafted).toHaveLength(2);
  const commentary = result.drafted.find(d => d.sourceUrl.endsWith('isaiah-commentary.pdf'))!;
  expect(commentary.yearLabel).toBe('2026-27'); // guessed from "2026" in the title
  expect(commentary.title).toBe('Isaiah Commentary 2026');
  const verses = result.drafted.find(d => d.sourceUrl.endsWith('isaiah-verses.pdf'))!;
  expect(verses.yearLabel).toBe('2025-26'); // guessed from the October 2025 upload date
  for (const d of result.drafted) {
    const stored = await libRow('pbe-material-proposal', d.proposalId);
    const proposal = JSON.parse(stored!.data) as { origin: string; proposedBy: string; status: string; material: { books: unknown[]; commentary: { sections: unknown[] }; sourceUrls: { resourcesPage: string; commentaryPdf?: string; versesPdf?: string } }; reviewNote?: string };
    expect(proposal.origin).toBe('watcher'); expect(proposal.proposedBy).toBe('nad-watcher'); expect(proposal.status).toBe('draft');
    expect(proposal.material.books).toEqual([]); expect(proposal.material.commentary.sections).toEqual([]);
    expect(proposal.material.sourceUrls.resourcesPage).toBe('https://nadpbe.org/pbe-resources/');
    expect(proposal.reviewNote).toBeTruthy();
  }
  const commentaryProposal = JSON.parse((await libRow('pbe-material-proposal', commentary.proposalId))!.data) as { material: { sourceUrls: { commentaryPdf?: string; versesPdf?: string } } };
  expect(commentaryProposal.material.sourceUrls.commentaryPdf).toContain('isaiah-commentary.pdf');
  // One news suggestion per new PDF plus one for the new search-result page.
  expect(result.newsDrafted).toHaveLength(3);
  const pdfNews = result.newsDrafted.filter(n => n.sourceUrl.endsWith('.pdf'));
  expect(pdfNews).toHaveLength(2);
  for (const n of result.newsDrafted) {
    const stored = await libRow('pbe-news-article', n.articleId);
    const article = JSON.parse(stored!.data) as { status: string; createdBy: string; sourceUrl: string; sourceLabel: string; title: string };
    expect(article.status).toBe('draft'); expect(article.createdBy).toBe('nad-watcher');
    expect(article.sourceUrl).toBe(n.sourceUrl); expect(article.sourceLabel).toBe('nadpbe.org');
  }
  const searchNews = result.newsDrafted.find(n => n.sourceUrl === 'https://nadpbe.org/pbe-resources-update/');
  expect(searchNews).toBeTruthy();
  expect(searchNews!.title).toBe('New PBE resources page');
  // Second run drafts nothing new: everything is already referenced.
  const second = await call('/pbe-materials/watch', {});
  expect(second.status).toBe(200);
  const again = await second.json() as { mediaChecked: number; drafted: unknown[]; newsDrafted: unknown[] };
  expect(again.mediaChecked).toBe(6); expect(again.drafted).toEqual([]); expect(again.newsDrafted).toEqual([]);
  // Watcher drafts stay drafts: students still cannot see the news suggestions.
  const feed = await asStudent('/pbe-news');
  expect(await feed.json()).toEqual([]);
});

it('returns 502 with a clear message when nadpbe.org is unreachable', async () => {
  wpHandler = async () => { throw new Error('network down'); };
  const failed = await call('/pbe-materials/watch', {});
  expect(failed.status).toBe(502);
  const message = await failed.text();
  expect(message).toContain('nadpbe.org');
});

it('runs the NAD watch from the scheduled trigger without HTTP auth and records the run', async () => {
  // Distinct fixture URLs so this test is independent of the manual-watch test above (dedupe by source URL).
  const scheduledMedia = [
    { id: 111, date: '2026-08-20T10:00:00', slug: 'mark-commentary-2027', mime_type: 'application/pdf', source_url: 'https://nadpbe.org/wp-content/uploads/2026/08/mark-commentary.pdf', title: { rendered: 'Mark Commentary 2027' }, caption: { rendered: '' } },
  ];
  const scheduledSearch = [
    { id: 211, title: 'PBE 2027 books announced', url: 'https://nadpbe.org/pbe-2027-books/', type: 'post', subtype: 'post' },
  ];
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('/wp-json/wp/v2/search')) return Response.json(scheduledSearch);
    if (u.includes('/wp-json/wp/v2/media')) return Response.json(scheduledMedia);
    throw new Error(`Unexpected NAD URL: ${u}`);
  });
  try {
    const result = await runScheduledWatch({ DB: app.db } as unknown as Env);
    expect(result.mediaChecked).toBe(3); // one PDF examined across three search queries
    expect(result.drafted).toHaveLength(1);
    expect(result.drafted[0].sourceUrl).toContain('mark-commentary.pdf');
    expect(result.drafted[0].yearLabel).toBe('2027-28'); // guessed from "2027" in the title
    expect(result.newsDrafted).toHaveLength(2); // one per new PDF + one new announcement
    // The proposal is a draft from the watcher identity, exactly like the manual run.
    const stored = await libRow('pbe-material-proposal', result.drafted[0].proposalId);
    const proposal = JSON.parse(stored!.data) as { origin: string; proposedBy: string; status: string };
    expect(proposal.origin).toBe('watcher'); expect(proposal.proposedBy).toBe('nad-watcher'); expect(proposal.status).toBe('draft');
    // The run itself is recorded for the audit trail.
    const runs = await app.db.prepare("SELECT data FROM Records WHERE kind='pbe-watcher-run' AND org_id=? ORDER BY id").bind(libraryOrg).all<{ data: string }>();
    const recorded = runs.results.map(r => JSON.parse(r.data) as { trigger: string; mediaChecked: number; drafted: number; newsDrafted: number; checkedAt: string });
    const scheduled = recorded.filter(r => r.trigger === 'scheduled');
    expect(scheduled.length).toBeGreaterThan(0);
    const last = scheduled[scheduled.length - 1];
    expect(last.checkedAt).toBe(result.checkedAt);
    expect(last.mediaChecked).toBe(result.mediaChecked);
    expect(last.drafted).toBe(result.drafted.length);
    expect(last.newsDrafted).toBe(result.newsDrafted.length);
    // A second scheduled run drafts nothing new (dedupe), but still records the run.
    const rerun = await runScheduledWatch({ DB: app.db } as unknown as Env);
    expect(rerun.drafted).toEqual([]); expect(rerun.newsDrafted).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('completes a watcher draft via PUT and approves it strictly', async () => {
  wpHandler = async request => {
    if (request.url.includes('/wp-json/wp/v2/search')) return TestServiceResponse.json([]) as unknown as TestResponse;
    if (request.url.includes('/wp-json/wp/v2/media')) return TestServiceResponse.json([
      { id: 301, date: '2026-11-01T10:00:00', slug: 'ezekiel-commentary', mime_type: 'application/pdf', source_url: 'https://nadpbe.org/wp-content/uploads/2026/11/ezekiel-commentary.pdf', title: { rendered: 'Ezekiel Commentary' }, caption: { rendered: '' } },
    ]) as unknown as TestResponse;
    throw new Error(`Unexpected NAD URL: ${request.url}`);
  };
  const watched = await call('/pbe-materials/watch', {});
  const { drafted } = await watched.json() as { drafted: { proposalId: string; yearLabel: string }[] };
  expect(drafted).toHaveLength(1);
  const proposalId = drafted[0].proposalId;
  // Approving an incomplete watcher draft fails validation; completing it via PUT then approves.
  expect((await call(`/pbe-materials/releases/${proposalId}/review`, { decision: 'approved' })).status).toBe(400);
  const completed = {
    yearLabel: drafted[0].yearLabel,
    material: {
      yearLabel: drafted[0].yearLabel,
      books: [{ bookKey: 'EZK', bookName: 'Ezekiel', chapters: [1, 2] }],
      commentary: { bookName: 'Ezekiel', title: 'EZEKIEL', sections: [{ heading: 'Intro', body: 'Completed by the master admin.' }] },
      sourceUrls: { resourcesPage: 'https://nadpbe.org/pbe-resources/', commentaryPdf: 'https://nadpbe.org/wp-content/uploads/2026/11/ezekiel-commentary.pdf' },
    },
  };
  expect((await call(`/pbe-materials/releases/${proposalId}`, completed, 'PUT')).status).toBe(200);
  expect((await call(`/pbe-materials/releases/${proposalId}/review`, { decision: 'approved', note: 'Completed' })).status).toBe(200);
  const material = await libRow('pbe-material', `pbe-material-${drafted[0].yearLabel}`);
  expect(material).toBeTruthy();
  expect((JSON.parse(material!.data) as { commentary: { title: string } }).commentary.title).toBe('EZEKIEL');
});
