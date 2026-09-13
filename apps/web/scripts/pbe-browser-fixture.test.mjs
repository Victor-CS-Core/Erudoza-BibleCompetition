// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { startPbeBrowserFixtureServer } from './pbe-browser-fixture.mjs';

it('keeps synthetic history one-shot per season while allowing both browser projects', async () => {
  const runId = randomUUID();
  const inserted = [];
  const server = await startPbeBrowserFixtureServer({ port: 0, runId, insert: body => inserted.push(body.seasonId) });
  const url = `http://127.0.0.1:${server.address().port}/seed-pbe-history`;
  const body = { organizationId: randomUUID(), seasonId: randomUUID(), studentId: randomUUID(), chapterKey: 'chapter:DAN:1', label: 'Synthetic dated stamp', scopeLabel: 'Earlier fixture scope', scopeVersion: 'earlier', earnedAtUtc: '2026-08-20T12:00:00.000Z' };
  const post = (payload, identity = runId) => globalThis.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-erudoza-fixture-run': identity }, body: JSON.stringify(payload) });
  try {
    expect((await post(body, 'wrong-run')).status).toBe(403);
    expect((await post(body)).status).toBe(201);
    expect((await post(body)).status).toBe(409);
    const second = { ...body, seasonId: randomUUID() };
    expect((await post(second)).status).toBe(201);
    expect(inserted).toEqual([body.seasonId, second.seasonId]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
