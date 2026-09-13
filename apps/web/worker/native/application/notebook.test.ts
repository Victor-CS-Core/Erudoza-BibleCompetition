// @vitest-environment node
import type { D1Database } from '@cloudflare/workers-types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG } from '../test-runtime';
import { Store } from '../store';

const libraryOrg = '00000000-0000-4000-8000-000000000066';
const packId = '00000000-0000-5000-8000-000000000010';
const sourceId = '00000000-0000-5000-8000-000000000011';
const otherSourceId = '00000000-0000-5000-8000-000000000012';
const otherOrg = '22222222-2222-4222-8222-222222222222';
const privatePackId = '00000000-0000-5000-8000-000000000020';
const privateSourceId = '00000000-0000-5000-8000-000000000021';
const root = `/api/v1/organizations/${TEST_ORG}/library/notebook`;
const note = (overrides: Record<string, unknown> = {}) => ({
  kind: 'note', contentPackId: packId, chapter: 1, sourceUnitId: sourceId,
  startOffset: 6, endOffset: 8, color: null, note: ' Remember this ', ...overrides,
});
const bookmark = (overrides: Record<string, unknown> = {}) => ({
  kind: 'bookmark', contentPackId: packId, chapter: 1, sourceUnitId: null,
  startOffset: null, endOffset: null, color: null, note: null, ...overrides,
});

describe.sequential('private Scripture notebook', () => {
  let app: Awaited<ReturnType<typeof createNativeTestApp>>;
  let coachCookie: string;
  let studentCookie: string;
  const call = (path = root, init: RequestInit = {}, cookie = coachCookie) => app.fetch(path, {
    ...init,
    headers: { Cookie: cookie, Origin: 'https://erudoza.test', ...init.headers },
  });
  const put = (entryId: string, version: number, entry: unknown, cookie = coachCookie) => call(`${root}/entries/${entryId}`, {
    method: 'PUT', body: JSON.stringify({ version, entry }),
  }, cookie);

  beforeAll(async () => {
    app = await createNativeTestApp();
    coachCookie = (await app.login()).headers.get('set-cookie')!.split(';')[0];
    const store = new Store(app.db as unknown as D1Database);
    await app.db.prepare('INSERT INTO Organizations(id,name,slug) VALUES(?,?,?)').bind(libraryOrg, 'Immutable Scripture Library', 'scripture-library').run();
    await store.insert('pack', packId, libraryOrg, {
      id: packId, packKey: 'builtin-nkjv-eph', version: 1, locale: 'en', sourceType: 'Scripture', licensingStatus: 'approved',
      isActive: true, isBuiltIn: true, bookKey: 'EPH', bookName: 'Ephesians', unitCount: 2,
      chapters: [{ number: 1, verses: [1, 2] }],
    });
    await store.insert('source', sourceId, libraryOrg, {
      id: sourceId, contentPackId: packId, citation: 'Ephesians 1:1', bookKey: 'EPH', chapter: 1, verse: 1,
      ordinal: 1, canonicalText: 'Alpha 😀 beta gamma.', isActive: true,
    }, { ownerId: packId });
    await store.insert('source', otherSourceId, libraryOrg, {
      id: otherSourceId, contentPackId: packId, citation: 'Ephesians 1:2', bookKey: 'EPH', chapter: 1, verse: 2,
      ordinal: 2, canonicalText: 'Another active verse.', isActive: true,
    }, { ownerId: packId });
    await app.db.prepare('INSERT INTO Organizations(id,name,slug) VALUES(?,?,?)').bind(otherOrg, 'Other club', 'other-club').run();
    await store.insert('pack', privatePackId, otherOrg, { id: privatePackId, isActive: true, isBuiltIn: false, bookKey: 'EPH', bookName: 'Private' });
    await store.insert('source', privateSourceId, otherOrg, {
      id: privateSourceId, contentPackId: privatePackId, citation: 'Private 1:1', bookKey: 'EPH', chapter: 1, verse: 1,
      ordinal: 1, canonicalText: 'Private text.', isActive: true,
    }, { ownerId: privatePackId });
    const created = await call(`/api/v1/organizations/${TEST_ORG}/students`, {
      method: 'POST', body: JSON.stringify({ userName: 'notebook-student', displayName: 'Notebook student', password: 'Testing!123' }),
    });
    expect(created.status).toBe(201);
    const login = await app.fetch('/api/v1/auth/login', {
      method: 'POST', headers: { Origin: 'https://erudoza.test' }, body: JSON.stringify({ identifier: 'notebook-student', password: 'Testing!123' }),
    });
    studentCookie = login.headers.get('set-cookie')!.split(';')[0];
  }, 30000);

  beforeEach(async () => {
    await app.db.prepare("DELETE FROM Records WHERE kind='scripture-notebook'").run();
  });

  afterAll(async () => { await app?.runtime.dispose(); });

  it('reads an empty private notebook without writing and enforces authentication and organization identity', async () => {
    const before = await app.db.prepare("SELECT count(*) AS n FROM Records WHERE kind='scripture-notebook'").first<number>('n');
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 0, entries: [] });
    expect(await app.db.prepare("SELECT count(*) AS n FROM Records WHERE kind='scripture-notebook'").first<number>('n')).toBe(before);
    expect((await app.fetch(root)).status).toBe(401);
    expect((await call(`/api/v1/organizations/${otherOrg}/library/notebook`)).status).toBe(403);
  });

  it('creates, updates, reloads and deletes an entry using exact UTF-16 anchored canonical text', async () => {
    const entryId = '00000000-0000-7000-8000-000000000001';
    let response = await put(entryId, 0, note());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      version: 1,
      entries: [{ id: entryId, kind: 'note', contentPackId: packId, chapter: 1, sourceUnitId: sourceId,
        startOffset: 6, endOffset: 8, color: null, note: 'Remember this', bookName: 'Ephesians',
        citation: 'Ephesians 1:1', quote: '😀', updatedAtUtc: expect.any(String) }],
    });
    response = await call();
    expect((await response.json() as { version: number; entries: unknown[] })).toMatchObject({ version: 1, entries: [{ id: entryId, quote: '😀' }] });
    response = await put(entryId, 1, note({ note: 'Edited thought' }));
    expect(response.status).toBe(200);
    expect((await response.json() as { version: number; entries: { note: string }[] })).toMatchObject({ version: 2, entries: [{ note: 'Edited thought' }] });
    response = await call(`${root}/entries/${entryId}?version=2`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 3, entries: [] });
    expect(await (await call()).json()).toEqual({ version: 3, entries: [] });
  });

  it('rejects forged, mismatched, unavailable and invalid anchors plus invalid note and highlight fields', async () => {
    const cases: unknown[] = [
      null,
      note({ kind: 'unknown' }),
      note({ kind: 'Note' }),
      note({ contentPackId: privatePackId, sourceUnitId: privateSourceId }),
      note({ contentPackId: crypto.randomUUID() }),
      note({ sourceUnitId: crypto.randomUUID() }),
      note({ chapter: 2 }),
      note({ startOffset: -1 }),
      note({ startOffset: 8, endOffset: 6 }),
      note({ endOffset: 999 }),
      note({ startOffset: 5, endOffset: 6 }),
      note({ note: '   ' }),
      note({ note: 'x'.repeat(2001) }),
      note({ color: 'Promises' }),
      note({ kind: 'highlight', color: 'Unknown', note: null }),
      note({ kind: 'highlight', color: null, note: null }),
      bookmark({ sourceUnitId: sourceId }),
      bookmark({ color: 'Review' }),
    ];
    for (const entry of cases) expect((await put(crypto.randomUUID(), 0, entry)).status).toBe(400);
    expect((await put('not-a-uuid', 0, note())).status).toBe(400);
    expect((await put(crypto.randomUUID(), -1, note())).status).toBe(400);
    expect((await call(`${root}/entries/${crypto.randomUUID()}`, { method: 'PUT', body: JSON.stringify({ version: 0, entry: note({ note: 'x'.repeat(17000) }) }) })).status).toBe(413);
    await app.db.prepare("UPDATE Records SET data=json_set(data,'$.isActive',json('false')) WHERE kind='source' AND owner_id=?").bind(packId).run();
    try {
      expect((await put(crypto.randomUUID(), 0, bookmark())).status).toBe(400);
    } finally {
      await app.db.prepare("UPDATE Records SET data=json_set(data,'$.isActive',json('true')) WHERE kind='source' AND owner_id=?").bind(packId).run();
    }
    expect(await (await call()).json()).toEqual({ version: 0, entries: [] });
  });

  it('rejects stale and competing initial writes without changing training records or leaking between users', async () => {
    const trainingCount = () => app.db.prepare("SELECT count(*) AS n FROM Records WHERE kind IN ('assignment','membership','mastery','session','attempt')").first<number>('n');
    const before = await trainingCount();
    const firstId = crypto.randomUUID();
    expect((await put(firstId, 0, note())).status).toBe(200);
    expect((await put(crypto.randomUUID(), 0, note({ sourceUnitId: otherSourceId, startOffset: 0, endOffset: 7 }))).status).toBe(409);
    expect(await (await call(root, {}, studentCookie)).json()).toEqual({ version: 0, entries: [] });
    expect(await trainingCount()).toBe(before);

    await app.db.prepare("DELETE FROM Records WHERE kind='scripture-notebook'").run();
    const responses = await Promise.all([
      put(crypto.randomUUID(), 0, note()),
      put(crypto.randomUUID(), 0, note({ sourceUnitId: otherSourceId, startOffset: 0, endOffset: 7 })),
    ]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const saved = await (await call()).json() as { version: number; entries: unknown[] };
    expect(saved.version).toBe(1);
    expect(saved.entries).toHaveLength(1);
  });

  it('upserts semantic highlight and bookmark duplicates and enforces the 200-entry capacity while allowing edits', async () => {
    const firstHighlight = crypto.randomUUID(), replacementHighlight = crypto.randomUUID();
    expect((await put(firstHighlight, 0, note({ kind: 'highlight', color: 'Promises', note: null }))).status).toBe(200);
    let response = await put(replacementHighlight, 1, note({ kind: 'highlight', color: 'People', note: null }));
    let notebook = await response.json() as { version: number; entries: { id: string; kind: string; color: string | null }[] };
    expect(notebook.entries).toEqual([expect.objectContaining({ id: replacementHighlight, kind: 'highlight', color: 'People' })]);
    const firstBookmark = crypto.randomUUID(), replacementBookmark = crypto.randomUUID();
    expect((await put(firstBookmark, 2, bookmark())).status).toBe(200);
    response = await put(replacementBookmark, 3, bookmark());
    notebook = await response.json() as typeof notebook;
    expect(notebook.entries.filter(entry => entry.kind === 'bookmark')).toEqual([expect.objectContaining({ id: replacementBookmark })]);

    const entries = Array.from({ length: 200 }, (_, index) => ({
      id: crypto.randomUUID(), ...note({ note: `Capacity ${index}` }), bookName: 'Ephesians', citation: 'Ephesians 1:1', quote: '😀', updatedAtUtc: '2026-09-13T00:00:00.000Z',
    }));
    await app.db.prepare("UPDATE Records SET data=?,revision=200 WHERE kind='scripture-notebook'").bind(JSON.stringify({ entries })).run();
    expect((await put(crypto.randomUUID(), 200, note({ note: 'Over capacity' }))).status).toBe(409);
    expect((await put(entries[0].id, 200, note({ note: 'Allowed edit' }))).status).toBe(200);
  });
});
