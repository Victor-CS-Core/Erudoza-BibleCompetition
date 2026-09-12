import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, sha, archiveRow, writeBundle, preflightBundle, inventory, summarize, TABLES } from './lib/cloudflare-bound-bundle.mjs';
import { importBundle } from './cloudflare-import.mjs';
import { closedBuild, openLocal, adapterCall, Budget, captureObjectSegment, importSegment } from './lib/cloudflare-maintenance-local.mjs';
const require = createRequire(resolve(ROOT, 'apps/web/package.json'));
const enabled = process.env.D3_IMPORT_RUNTIME === '1';
async function codec() { const { build } = require('esbuild'); const b = await build({ entryPoints: [resolve(ROOT, 'apps/web/worker/native/practice/room-storage.ts')], bundle: true, write: false, format: 'esm', platform: 'node' }); return import('data:text/javascript;base64,' + Buffer.from(b.outputFiles[0].text).toString('base64')); }
async function fixture(status = 'Completed', retained = 0, authentication = false, roomId = 'room') {
    const { RoomCodec } = await codec(), scope = { kind: 'room', orgId: 'org', seasonId: 'season', id: roomId }, reports = { kind: 'reports', orgId: 'org', seasonId: 'season' };
    const room = { id: roomId, orgId: 'org', seasonId: 'season', ownerId: 'owner', teamSize: 1, teamCount: 1, questionCount: 0, coached: false, format: 'Pbe', status, phase: 'Review', revision: 9, questionIndex: 0, epoch: 'original', lastObserved: 100, phaseEndsAt: null, responseStartsAt: null, scheduleId: 'schedule', acknowledged: [], questions: [], reserves: [], members: [{ userId: 'owner', displayName: 'Owner', team: 1, ready: true, captain: true, scribe: true }], invitations: [], submissions: [], drafts: {}, messages: [], contributions: [], applied: { 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': 'owner' }, completedAt: '2026-09-12T00:00:00Z', adjustments: [], timingAnomalies: [], rules: { ruleVersion: 'pbe-rehearsal-v1', scoringVersion: 'pbe-accuracy-v1', clock: 'server-event-time', presentationSeconds: 15, reviewSeconds: 10, speedPercent: 0, stepSeconds: 1 } };
    if (authentication)
        room.members.push({ userId: 'other', displayName: 'Other', team: 1, ready: true, captain: false, scribe: false });
    const a = await new RoomCodec().encode(room), h = await new RoomCodec().encode({ ...room, applied: {} }), nodes = new Map([...a.nodes, ...h.nodes]);
    for (let i = 0; i < retained; i++) {
        const data = JSON.stringify({ nodeVersion: 1, type: 'leaf', data: JSON.stringify({ superseded: i, value: 'x'.repeat(1200) }) });
        nodes.set(sha(data), data);
    }
    const nodeRows = [...nodes].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, data]) => ({ table: 'room_components', key, data }));
    const publication = JSON.stringify({ manifest: h.manifest, summary: summarize(room) }), pubHash = sha(publication), reportRows = [{ table: 'publications', key: pubHash, data: publication }];
    const objects = [{ scope, outbox: null, rows: nodeRows, plan: { root: JSON.stringify(a.manifest), historyRoot: JSON.stringify(h.manifest), inventory: inventory(nodeRows) } }, { scope: reports, outbox: null, rows: reportRows, plan: { root: JSON.stringify(['org', 'season']), inventory: inventory(reportRows) } }];
    const rows = [{ table: 'Organizations', row: { id: 'org', name: 'Org', slug: 'org' } }, { table: 'Records', row: { kind: 'match', id: roomId, org_id: 'org', season_id: 'season', owner_id: null, data: JSON.stringify({ format: 'erudoza.practice-room/1', manifest: h.manifest, summary: summarize(room) }), revision: 9 } }, ...nodeRows.map(n => ({ table: 'PracticeRoomComponents', row: { org_id: 'org', season_id: 'season', room_id: roomId, hash: n.key, data: n.data } }))];
    if (authentication) {
        rows.splice(1, 0, ...['owner', 'other'].map(id => ({ table: 'Users', row: { id, org_id: 'org', user_name: id, email: null, display_name: id, kind: 'Student', role: 'Student', password_hash: 'fixture-hash', credential_version: 'fixture-version', active: 1 } })));
        rows.push(...['owner', 'other'].map(id => ({ table: 'Sessions', row: { token_hash: Buffer.from(sha(id + '-token'), 'hex').toString('base64'), user_id: id, credential_version: 'fixture-version', expires_at: 4102444800000 } })), { table: 'Records', row: { kind: 'practice-setting', id: 'org', org_id: 'org', season_id: null, owner_id: null, data: JSON.stringify({ enabled: true }), revision: 1 } });
    }
    const archives = rows.map(e => archiveRow(e.table, TABLES[e.table].pk, e.row));
    return { source: { kind: 'native-declared-stopped', exhaustive: true, stopped: true, scope: 'selected-scope', namespaces: objects.map(o => o.scope) }, objects, rows, archives };
}
test('managed bundle preflight rejects active authority before destination creation', { skip: !enabled }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'managed-reject-'));
    try {
        await assert.rejects(writeBundle(join(dir, 'bundle'), await fixture('Playing')), /active/);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('actual managed importer restores terminal full authority and Reports with closed restart/capture/readback', { skip: !enabled, timeout: 60000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'managed-bound-'));
    try {
        const input = await fixture(), bundleDir = join(dir, 'bundle'), target = join(dir, 'target');
        await writeBundle(bundleDir, input);
        const result = await importBundle(bundleDir, target);
        assert.equal(result.complete, true);
        assert.equal(result.closed, true);
        assert.equal((await importBundle(bundleDir, target)).complete, true);
        const bundle = await preflightBundle(bundleDir), local = await openLocal(target, bundle, await closedBuild());
        try {
            assert.equal((await local.runtime.dispatchFetch('https://internal/__maintenance/v1/inspect')).status, 404);
            const inspection = await adapterCall(local, input.objects[0].scope, 'inspect', {}, new Budget());
            assert.equal(inspection.root, input.objects[0].plan.root);
            const capture = await captureObjectSegment(local, input.objects[0].scope, input.rows[1].row);
            assert.equal(capture.complete, true);
            assert.deepEqual(capture.object, input.objects[0]);
        }
        finally {
            await local.close();
        }
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('actual managed importer resumes a retained inventory over multiple row/node segments', { skip: !enabled, timeout: 60000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'managed-many-'));
    try {
        const input = await fixture('Interrupted', 1050), bundleDir = join(dir, 'bundle'), target = join(dir, 'target');
        await writeBundle(bundleDir, input);
        let complete = false, segments = 0;
        while (!complete && segments < 20) {
            const r = await importBundle(bundleDir, target);
            assert.ok(r.budget.rows <= 1000);
            assert.ok(r.budget.transmitted <= 32 * 1024 ** 2);
            complete = r.complete;
            segments++;
        }
        assert.equal(complete, true);
        assert.ok(segments > 3);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('original terminal command retry precedes any ordinary GET and rejects a different authenticated actor', { skip: !enabled, timeout: 60000 }, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'managed-retry-'));
    let runtime;
    try {
        const input = await fixture('Completed', 0, true), bundleDir = join(dir, 'bundle'), target = join(dir, 'target');
        const manifest = await writeBundle(bundleDir, input), imported = await importBundle(bundleDir, target);
        assert.equal(imported.complete, true);
        t.diagnostic(JSON.stringify({ bundleId: manifest.bundleId, metrics: manifest.metrics, budget: imported.budget }));
        const { build } = require('esbuild'), { Miniflare } = require('miniflare'), normal = await build({ entryPoints: [resolve(ROOT, 'apps/web/worker/native/index.ts')], bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:async_hooks'] });
        runtime = new Miniflare({ modules: true, script: normal.outputFiles[0].text, compatibilityDate: '2026-05-22', compatibilityFlags: ['nodejs_compat'], d1Databases: { DB: 'maintenance-v1' }, d1Persist: join(target, 'd1'), durableObjects: { ROOMS: { className: 'PracticeRoom', useSQLite: true }, REPORTS: { className: 'PracticeReports', useSQLite: true }, PBE_SOLO: { className: 'PbeSoloRound', useSQLite: true }, PASSWORD_CRYPTO: { className: 'PasswordCrypto', useSQLite: true } }, durableObjectsPersist: join(target, 'do'), bindings: { PUBLIC_ORIGIN: 'http://localhost' } });
        const ns = await runtime.getDurableObjectNamespace('ROOMS'), stub = ns.get(ns.idFromName('org:room'));
        const command = async (actor) => stub.fetch('http://localhost/api/v1/organizations/org/practice/rooms/room/commands', { method: 'POST', headers: { origin: 'http://localhost', cookie: '__Host-erudoza.session=' + actor + '-token', 'content-type': 'application/json' }, body: JSON.stringify({ commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 9, action: 'submit', answers: [] }) });
        const retry = await command('owner'), retryText = await retry.text();
        assert.equal(retry.status, 200, retryText);
        const retryBody = JSON.parse(retryText);
        assert.equal(retryBody.revision, 9);
        assert.equal((await command('other')).status, 403);
        await runtime.dispose();
        runtime = null;
        const bundle = await preflightBundle(bundleDir), local = await openLocal(target, bundle, await closedBuild());
        try {
            const inspect = await adapterCall(local, input.objects[0].scope, 'inspect', {}, new Budget());
            assert.equal(inspect.root, input.objects[0].plan.root);
        }
        finally {
            await local.close();
        }
    }
    finally {
        await runtime?.dispose();
        await rm(dir, { recursive: true, force: true });
    }
});
test('managed canonical B4 bundle resumes frozen structured and legacy attempts without changing records', { skip: !enabled, timeout: 60000 }, async (t) => {
    const { readCanonicalSnapshot, exportCanonicalBundle } = await import('./lib/cloudflare-canonical-bundle.mjs');
    const { convertSnapshot } = await import('./cloudflare-export.mjs');
    const source = resolve(process.env.ERUDOZA_EXPORT_TEST_SOURCE ?? resolve(ROOT, '.local/b4-export-source.db'));
    const snapshot = readCanonicalSnapshot(source), original = snapshot.tables.Attempts.find(a => a.AnswerPayloadJson != null);
    assert.ok(original, 'Requires the retained actual canonical HTTP B4 structured/legacy fixture');
    const payload = JSON.parse(original.AnswerPayloadJson), { native } = convertSnapshot(snapshot, { bound: true });
    const converted = native.records.find(r => r.kind === 'attempt' && r.id === original.Id.toLowerCase()).data;
    const legacy = native.records.find(r => r.kind === 'attempt' && !r.data.answerPayload).data;
    assert.deepEqual(converted.answerPayload, payload);
    const dir = await mkdtemp(join(tmpdir(), 'managed-b4-'));
    let runtime;
    try {
        const bundleDir = join(dir, 'bundle'), target = join(dir, 'target');
        const manifest = await exportCanonicalBundle(source, bundleDir), segments = [];
        let result;
        for (let i = 0; i < 20; i++) {
            result = await importBundle(bundleDir, target);
            segments.push(result.budget);
            if (result.complete)
                break;
        }
        assert.equal(result.complete, true);
        assert.equal(result.closed, true);
        t.diagnostic(JSON.stringify({ bundleId: manifest.bundleId, metrics: manifest.metrics, segments }));
        const { build } = require('esbuild'), { Miniflare } = require('miniflare');
        const normal = await build({ entryPoints: [resolve(ROOT, 'apps/web/worker/native/index.ts')], bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:async_hooks'] });
        runtime = new Miniflare({ modules: true, script: normal.outputFiles[0].text, compatibilityDate: '2026-05-22', compatibilityFlags: ['nodejs_compat'], d1Databases: { DB: 'maintenance-v1' }, d1Persist: join(target, 'd1'), durableObjects: { ROOMS: { className: 'PracticeRoom', useSQLite: true }, REPORTS: { className: 'PracticeReports', useSQLite: true }, PBE_SOLO: { className: 'PbeSoloRound', useSQLite: true }, PASSWORD_CRYPTO: { className: 'PasswordCrypto', useSQLite: true } }, durableObjectsPersist: join(target, 'do'), bindings: { PUBLIC_ORIGIN: 'https://migration.test' } });
        const db = await runtime.getD1Database('DB'), user = native.users.find(u => u.id === converted.studentUserId), token = 'synthetic-b4-managed-restore-session';
        // Disposable ordinary-runtime authentication only; no canonical cookies are migrated.
        await db.prepare('INSERT INTO Sessions(token_hash,user_id,credential_version,expires_at) VALUES(?,?,?,?)').bind(Buffer.from(sha(token), 'hex').toString('base64'), user.id, user.credential_version, Date.now() + 300000).run();
        const before = (await db.prepare('SELECT kind,id,data,revision FROM Records ORDER BY kind,id').all()).results;
        const path = `https://migration.test/api/v1/study/sessions/${converted.sessionId}`, headers = { Cookie: `__Host-erudoza.session=${token}`, Origin: 'https://migration.test', 'Content-Type': 'application/json' };
        const resume = await runtime.dispatchFetch(path, { headers });
        assert.equal(resume.status, 200);
        assert.deepEqual((await resume.json()).attempt, { ...converted.result, alreadyProcessed: true });
        const body = { clientSubmissionId: converted.clientSubmissionId, challengeCardId: converted.cardId, missingWordAnswers: [...payload.answers].reverse(), responseTimeMs: converted.responseTimeMs, hintsUsed: converted.hintsUsed };
        const retry = await runtime.dispatchFetch(`${path}/attempts`, { method: 'POST', headers, body: JSON.stringify(body) });
        assert.equal(retry.status, 200);
        assert.deepEqual(await retry.json(), { ...converted.result, alreadyProcessed: true });
        const changed = { ...body, missingWordAnswers: body.missingWordAnswers.map((a, i) => i === 0 ? { ...a, text: a.text + ' ' } : a) };
        assert.equal((await runtime.dispatchFetch(`${path}/attempts`, { method: 'POST', headers, body: JSON.stringify(changed) })).status, 409);
        const legacyResponse = await runtime.dispatchFetch(`https://migration.test/api/v1/study/sessions/${legacy.sessionId}/attempts`, { method: 'POST', headers, body: JSON.stringify({ clientSubmissionId: legacy.clientSubmissionId, challengeCardId: legacy.cardId, submittedAnswer: legacy.submittedAnswer, responseTimeMs: legacy.responseTimeMs, hintsUsed: legacy.hintsUsed }) });
        assert.equal(legacyResponse.status, 200);
        assert.deepEqual(await legacyResponse.json(), { ...legacy.result, alreadyProcessed: true });
        assert.equal(legacy.result.missingWordAnswers, undefined);
        assert.equal(legacy.result.missingWordResults, undefined);
        assert.deepEqual((await db.prepare('SELECT kind,id,data,revision FROM Records ORDER BY kind,id').all()).results, before);
        assert.deepEqual(readCanonicalSnapshot(source), snapshot);
    }
    finally {
        await runtime?.dispose();
        await rm(dir, { recursive: true, force: true });
    }
});
test('two-room managed import resumes an interrupted staged page and a lost committed-root acknowledgement', { skip: !enabled, timeout: 60000 }, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'managed-two-room-'));
    try {
        const a = await fixture('Completed', 0, false, 'room-a'), b = await fixture('Interrupted', 0, false, 'room-b');
        const unique = new Map();
        for (const e of [...a.rows, ...b.rows]) {
            const key = JSON.stringify([e.table, TABLES[e.table].pk.map(k => e.row[k])]);
            if (unique.has(key))
                assert.deepEqual(unique.get(key), e);
            else
                unique.set(key, e);
        }
        const rows = [...unique.values()], reportRows = [...a.objects[1].rows, ...b.objects[1].rows].sort((a, b) => a.key < b.key ? -1 : 1);
        const reports = { ...a.objects[1], rows: reportRows, plan: { ...a.objects[1].plan, inventory: inventory(reportRows) } }, objects = [a.objects[0], b.objects[0], reports];
        const input = { rows, archives: rows.map(e => archiveRow(e.table, TABLES[e.table].pk, e.row)), objects, source: { ...a.source, namespaces: objects.map(o => o.scope) } };
        const bundleDir = join(dir, 'bundle'), target = join(dir, 'target');
        await writeBundle(bundleDir, input);
        const bundle = await preflightBundle(bundleDir), build = await closedBuild();
        let staged = false, lostCommit = false;
        const instrument = (local, phase) => {
            const real = local.runtime;
            local.runtime = { getDurableObjectNamespace: async (name) => {
                    const ns = await real.getDurableObjectNamespace(name);
                    return { idFromName: name => ns.idFromName(name), get: id => {
                            const stub = ns.get(id);
                            return { fetch: async (url, init) => {
                                    const response = await stub.fetch(url, init);
                                    if (response.ok && phase === 'stage' && url.endsWith('/stage') && !staged) {
                                        staged = true;
                                        throw new Error('synthetic interrupted staged acknowledgement');
                                    }
                                    if (response.ok && phase === 'commit' && url.endsWith('/commit') && !lostCommit) {
                                        lostCommit = true;
                                        const error = new Error('synthetic lost committed-root acknowledgement');
                                        error.code = 'ECONNRESET';
                                        throw error;
                                    }
                                    return response;
                                } };
                        } };
                } };
        };
        let local = await openLocal(target, bundle, build);
        try {
            instrument(local, 'stage');
            const budget = new Budget();
            await assert.rejects(importSegment(local, bundle, budget), /synthetic interrupted staged acknowledgement/);
            t.diagnostic(JSON.stringify({ phase: 'interrupted-stage', budget }));
            assert.equal(staged, true);
        }
        finally {
            await local.close();
        }
        local = await openLocal(target, bundle, build);
        try {
            instrument(local, 'commit');
            const result = await importSegment(local, bundle);
            t.diagnostic(JSON.stringify({ bundleId: bundle.manifest.bundleId, metrics: bundle.manifest.metrics, budget: result.budget, staged, lostCommit }));
            assert.equal(result.complete, true);
            assert.equal(result.closed, true);
            assert.equal(lostCommit, true);
            assert.equal(result.budget.retries, 1);
            const inspectionBudget = new Budget();
            for (const object of objects)
                assert.equal((await adapterCall(local, object.scope, 'inspect', {}, inspectionBudget)).root, object.plan.root);
            t.diagnostic(JSON.stringify({ phase: 'closed-root-readback', budget: inspectionBudget }));
        }
        finally {
            await local.close();
        }
        const replay = await importBundle(bundleDir, target);
        assert.equal(replay.complete, true);
        t.diagnostic(JSON.stringify({ phase: 'same-bundle-reopen', budget: replay.budget }));
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
