import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, sha, preflightBundle } from './lib/cloudflare-bound-bundle.mjs';
import { exportCanonicalBundle } from './lib/cloudflare-canonical-bundle.mjs';
import { importBundle } from './cloudflare-import.mjs';
import { closedBuild, openLocal, adapterCall, Budget } from './lib/cloudflare-maintenance-local.mjs';
const require = createRequire(resolve(ROOT, 'apps/web/package.json'));
const enabled = process.env.D3_IMPORT_RUNTIME === '1', origin = 'http://localhost';
async function normal(target) {
    const { build } = require('esbuild'), { Miniflare } = require('miniflare'), output = await build({ entryPoints: [resolve(ROOT, 'apps/web/worker/native/index.ts')], bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:workers', 'node:async_hooks'] });
    return new Miniflare({ modules: true, script: output.outputFiles[0].text, compatibilityDate: '2026-05-22', compatibilityFlags: ['nodejs_compat'], d1Databases: { DB: 'maintenance-v1' }, d1Persist: join(target, 'd1'), durableObjects: { ROOMS: { className: 'PracticeRoom', useSQLite: true }, REPORTS: { className: 'PracticeReports', useSQLite: true }, PBE_SOLO: { className: 'PbeSoloRound', useSQLite: true }, PASSWORD_CRYPTO: { className: 'PasswordCrypto', useSQLite: true } }, durableObjectsPersist: join(target, 'do'), bindings: { PUBLIC_ORIGIN: origin } });
}
async function sourceInput(path) {
    const source = resolve(path), manifest = JSON.parse(await readFile(source.replace(/\.db$/, '.manifest.json'), 'utf8'));
    assert.equal(sha(await readFile(source)), manifest.sha256);
    return { source, manifest };
}
async function restored(source, dir, t) {
    const target = join(dir, 'target'), bundleDir = join(dir, 'bundle'), manifest = await exportCanonicalBundle(source, bundleDir), segments = [];
    let done = false;
    for (let i = 0; i < 100 && !done; i++) {
        const result = await importBundle(bundleDir, target);
        assert.equal(result.closed, true);
        assert.ok(result.budget.rows <= 1000 && result.budget.transmitted <= 32 * 1024 ** 2);
        segments.push(result.budget);
        done = result.complete;
    }
    assert.equal(done, true);
    t.diagnostic(JSON.stringify({ bundleId: manifest.bundleId, metrics: manifest.metrics, planBytes: manifest.plan.length, segments }));
    return { target, bundle: await preflightBundle(bundleDir) };
}
async function login(runtime, credentials) {
    const response = await runtime.dispatchFetch(origin + '/api/v1/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) }), text = await response.text();
    assert.equal(response.status, 200, text);
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    return cookie;
}
async function request(runtime, cookie, path, body) {
    return runtime.dispatchFetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function okay(response) { const raw = await response.text(); assert.ok(response.ok, `${response.status} ${raw}`); return JSON.parse(raw); }
function privateAbsent(value) {
    if (!value || typeof value !== 'object')
        return;
    assert.equal(Object.hasOwn(value, 'canonicalProvenance'), false);
    for (const child of Object.values(value))
        privateAbsent(child);
}
test('actual canonical full Rooms restore original UUID retry before GET, private provenance and Team correction idempotency', { skip: !enabled || !process.env.D3_CANONICAL_ROOM_SOURCE, timeout: 300000 }, async (t) => {
    const { source, manifest } = await sourceInput(process.env.D3_CANONICAL_ROOM_SOURCE), expected = manifest.expected, dir = await mkdtemp(join(tmpdir(), 'canonical-room-'));
    let runtime;
    try {
        const { target, bundle } = await restored(source, dir, t);
        runtime = await normal(target);
        const owner = await login(runtime, expected.authentication[0]), other = await login(runtime, expected.authentication[1]), coach = await login(runtime, manifest.authentication[0]);
        const saved = expected.commands.filter(c => c.roomId === expected.completedId && c.actorId === expected.ids[0] && c.body.action === 'submit').at(-1);
        assert.ok(saved);
        const roomPath = `/api/v1/organizations/${expected.org}/practice/rooms/${expected.completedId}`;
        // First ordinary Room request; login touches authentication only.
        const retry = await okay(await request(runtime, owner, roomPath + '/commands', saved.body));
        privateAbsent(retry);
        const original = expected.rooms.find(r => r.id === expected.completedId).state;
        assert.equal(retry.revision, original.revision);
        assert.equal(retry.status, 'Completed');
        assert.equal((await request(runtime, other, roomPath + '/commands', saved.body)).status, 403);
        await runtime.dispose();
        runtime = null;
        const local = await openLocal(target, bundle, await closedBuild());
        try {
            for (const object of bundle.plan.objects.filter(o => o.scope.kind === 'room'))
                assert.equal((await adapterCall(local, object.scope, 'inspect', {}, new Budget())).root, object.plan.root);
        }
        finally {
            await local.close();
        }
        runtime = await normal(target);
        const db = await runtime.getD1Database('DB');
        const originalMatches = (await db.prepare("SELECT id,data,revision FROM Records WHERE kind='match' ORDER BY id").all()).results;
        const existing = (await db.prepare("SELECT id,data FROM Records WHERE kind='pbe-grade-adjustment' ORDER BY id").all()).results;
        const pending = expected.pending, resolveBody = { expectedRevision: pending.revision, pointsByPart: pending.partPoints, reason: 'Native restored frozen rubric ruling.' }, resolvePath = '/api/v1/pbe/disputes/' + encodeURIComponent(pending.id) + '/resolve';
        const resolution = await okay(await request(runtime, coach, resolvePath, resolveBody));
        assert.equal(resolution.status, 'Resolved');
        assert.deepEqual(await okay(await request(runtime, coach, resolvePath, resolveBody)), resolution);
        const adjustments = (await db.prepare("SELECT id,data FROM Records WHERE kind='pbe-grade-adjustment' ORDER BY id").all()).results;
        assert.equal(adjustments.length, existing.length + 1);
        for (const old of existing)
            assert.ok(adjustments.some(a => a.id === old.id && a.data === old.data));
        assert.deepEqual((await db.prepare("SELECT id,data,revision FROM Records WHERE kind='match' ORDER BY id").all()).results, originalMatches);
        privateAbsent(await okay(await request(runtime, owner, roomPath)));
        assert.equal(sha(await readFile(source)), manifest.sha256);
    }
    finally {
        await runtime?.dispose();
        await rm(dir, { recursive: true, force: true });
    }
});
test('actual canonical non-timed Solo restores raw retry and finishes original correction without duplicate adjustment', { skip: !enabled || !process.env.D3_CANONICAL_SOLO_SOURCE, timeout: 300000 }, async (t) => {
    const { source, manifest } = await sourceInput(process.env.D3_CANONICAL_SOLO_SOURCE), expected = manifest.expected, dir = await mkdtemp(join(tmpdir(), 'canonical-solo-'));
    let runtime;
    try {
        const { target } = await restored(source, dir, t);
        runtime = await normal(target);
        const student = await login(runtime, manifest.authentication[1]), coach = await login(runtime, manifest.authentication[0]), db = await runtime.getD1Database('DB');
        const before = (await db.prepare("SELECT kind,id,data,revision FROM Records WHERE kind IN ('pbe-session','pbe-attempt','pbe-recall-event','pbe-evidence-ref','pbe-grade-adjustment') ORDER BY kind,id").all()).results;
        const path = '/api/v1/study/sessions/' + expected.sessionId;
        for (const accepted of expected.accepted) {
            const retry = await okay(await request(runtime, student, path + '/attempts', accepted.body));
            assert.deepEqual(retry, { ...accepted.result, alreadyProcessed: true });
            privateAbsent(retry);
        }
        const recap = await okay(await request(runtime, student, path + '/recap'));
        privateAbsent(recap);
        const replayPath = '/api/v1/pbe/disputes/' + encodeURIComponent(expected.resolved.id) + '/replay';
        let result;
        for (let i = 0; i < 150; i++) {
            result = await okay(await request(runtime, coach, replayPath, {}));
            if (result.status === 'Ready')
                break;
        }
        assert.equal(result.status, 'Ready');
        assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM Records WHERE kind='pbe-dispute-correction' AND id=?").bind(expected.resolved.id).first()).n, 0);
        assert.deepEqual((await db.prepare("SELECT kind,id,data,revision FROM Records WHERE kind IN ('pbe-session','pbe-attempt','pbe-recall-event','pbe-evidence-ref','pbe-grade-adjustment') ORDER BY kind,id").all()).results, before);
        const resolvedPath = '/api/v1/pbe/disputes/' + encodeURIComponent(expected.resolved.id) + '/resolve';
        assert.equal((await okay(await request(runtime, coach, resolvedPath, expected.resolve))).revision, expected.resolved.revision);
        assert.equal(sha(await readFile(source)), manifest.sha256);
    }
    finally {
        await runtime?.dispose();
        await rm(dir, { recursive: true, force: true });
    }
});
async function chapterRows(db, kinds) {
    return (await db.prepare(`SELECT kind,id,data,revision FROM Records WHERE kind IN (${kinds.map(() => '?').join(',')}) ORDER BY kind,id`).bind(...kinds).all()).results;
}
function expectedRows(bundle, kinds) {
    return bundle.plan.rows.filter(e => e.table === 'Records' && kinds.includes(e.row.kind)).map(({ row }) => ({ kind: row.kind, id: row.id, data: row.data, revision: row.revision })).sort((a, b) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function preserveRows(actual, original) {
    for (const row of original)
        assert.deepEqual(actual.find(r => r.kind === row.kind && r.id === row.id), row);
}
async function finishChapter(runtime, student, seasonId, workId) {
    let result;
    for (let i = 0; i < 150; i++) {
        result = await okay(await request(runtime, student, '/api/v1/progress/me/chapters/continue', { seasonId, ...(workId ? { workId } : {}) }));
        if (workId)
            assert.equal(result.work.id, workId);
        else
            workId = result.work.id;
        assert.notEqual(result.work.state, 'Blocked');
        if (result.next === 'Reload')
            break;
    }
    assert.equal(result.next, 'Reload');
    return okay(await request(runtime, student, '/api/v1/progress/me/chapters?seasonId=' + seasonId));
}
function compareChapterFacts(page, original) {
    assert.equal(page.scopeVersion, original.scopeVersion);
    assert.deepEqual(page.items.map(i => ({ key: i.key, kind: i.kind, counts: i.counts, readiness: i.currentReadiness, whole: i.wholeChapterAssigned, actions: i.actions, stampId: i.stamp?.stampId })), original.items.map(i => ({ key: i.key, kind: i.kind, counts: i.counts, readiness: i.currentReadiness, whole: i.wholeChapterAssigned, actions: i.actions, stampId: i.stamp?.stampId })));
    privateAbsent(page);
}
test('actual canonical partial chapter proof resumes original generation and historical witness bytes', { skip: !enabled || !process.env.D3_CANONICAL_AGGREGATE_SOURCE || !process.env.D3_CANONICAL_COMPLETE_SOURCE, timeout: 300000 }, async (t) => {
    const { source, manifest } = await sourceInput(process.env.D3_CANONICAL_AGGREGATE_SOURCE), complete = await sourceInput(process.env.D3_CANONICAL_COMPLETE_SOURCE), expected = manifest.expected, dir = await mkdtemp(join(tmpdir(), 'canonical-aggregate-'));
    let runtime;
    try {
        const { target, bundle } = await restored(source, dir, t);
        runtime = await normal(target);
        const student = await login(runtime, manifest.authentication[1]), db = await runtime.getD1Database('DB');
        const immutableKinds = ['pbe-chapter-stamp-proof', 'pbe-chapter-stamp', 'pbe-recall-event', 'pbe-evidence-ref'];
        const original = expectedRows(bundle, immutableKinds);
        assert.deepEqual(await chapterRows(db, immutableKinds), original);
        assert.equal(original.filter(r => r.kind === 'pbe-chapter-stamp-proof').length, 1);
        assert.equal(original.filter(r => r.kind === 'pbe-chapter-stamp').length, 0);
        const beforeWork = JSON.parse((await chapterRows(db, ['pbe-chapter-work']))[0].data);
        assert.equal(beforeWork.workId, expected.work.id);
        assert.equal(beforeWork.proofOffset, expected.work.proofOffset);
        assert.equal(beforeWork.aggregate.targetAfter, expected.work.aggregate.targetAfter);
        const start = Date.now(), page = await finishChapter(runtime, student, expected.season, expected.work.id), finish = Date.now();
        assert.equal(page.snapshotId, expected.work.id);
        assert.equal(page.asOfUtc, expected.work.asOfUtc);
        assert.equal(page.dueRefreshAtUtc, expected.work.dueRefreshAtUtc);
        compareChapterFacts(page, complete.manifest.expected.page);
        const after = await chapterRows(db, immutableKinds);
        preserveRows(after, original);
        const stamps = after.filter(r => r.kind === 'pbe-chapter-stamp');
        assert.equal(stamps.length, 2);
        for (const row of stamps) {
            const earned = Date.parse(JSON.parse(row.data).summary.earnedAtUtc);
            assert.ok(earned >= start && earned <= finish);
        }
        // Exact new publication receipts are now immutable even when the saved snapshot is due.
        const due = Date.parse(page.dueRefreshAtUtc), retry = await request(runtime, student, '/api/v1/progress/me/chapters/continue', { seasonId: expected.season, workId: expected.work.id });
        if (due <= finish)
            assert.equal(retry.status, 409);
        else if (retry.status === 409)
            assert.ok(Date.now() >= due);
        else
            assert.equal((await okay(retry)).next, 'Reload');
        assert.deepEqual(await chapterRows(db, immutableKinds), after);
        assert.equal(sha(await readFile(source)), manifest.sha256);
        assert.equal(sha(await readFile(complete.source)), complete.manifest.sha256);
    }
    finally {
        await runtime?.dispose();
        await rm(dir, { recursive: true, force: true });
    }
});
test('actual canonical Complete chapter keeps exact earned stamps and witnesses across due refresh', { skip: !enabled || !process.env.D3_CANONICAL_COMPLETE_SOURCE, timeout: 300000 }, async (t) => {
    const { source, manifest } = await sourceInput(process.env.D3_CANONICAL_COMPLETE_SOURCE), expected = manifest.expected, dir = await mkdtemp(join(tmpdir(), 'canonical-complete-'));
    let runtime;
    try {
        const { target, bundle } = await restored(source, dir, t);
        runtime = await normal(target);
        const student = await login(runtime, manifest.authentication[1]), db = await runtime.getD1Database('DB'), kinds = ['pbe-chapter-stamp', 'pbe-chapter-stamp-proof'];
        const original = expectedRows(bundle, kinds);
        assert.deepEqual(await chapterRows(db, kinds), original);
        assert.equal(original.filter(r => r.kind === 'pbe-chapter-stamp').length, 2);
        assert.equal(original.filter(r => r.kind === 'pbe-chapter-stamp-proof').length, 2);
        const page = await okay(await request(runtime, student, '/api/v1/progress/me/chapters?seasonId=' + expected.season));
        assert.deepEqual(page, expected.page);
        privateAbsent(page);
        const history = await okay(await request(runtime, student, '/api/v1/progress/me/chapters?seasonId=' + expected.season + '&view=Stamps'));
        assert.deepEqual(history.items.map(i => [i.stampId, i.earnedAtUtc]).sort(), expected.page.items.map(i => [i.stamp.stampId, i.stamp.earnedAtUtc]).sort());
        const due = Date.parse(expected.page.dueRefreshAtUtc), before = Date.now(), retry = await request(runtime, student, '/api/v1/progress/me/chapters/continue', { seasonId: expected.season, workId: expected.workId });
        if (due <= before)
            assert.equal(retry.status, 409);
        else if (retry.status === 409)
            assert.ok(Date.now() >= due);
        else
            assert.equal((await okay(retry)).next, 'Reload');
        assert.deepEqual(await chapterRows(db, kinds), original);
        if (Date.now() >= due) {
            const refreshed = await finishChapter(runtime, student, expected.season);
            assert.notEqual(refreshed.snapshotId, expected.workId);
            compareChapterFacts(refreshed, expected.page);
            assert.deepEqual((await chapterRows(db, kinds)).filter(r => r.kind === 'pbe-chapter-stamp'), original.filter(r => r.kind === 'pbe-chapter-stamp'));
            preserveRows(await chapterRows(db, kinds), original);
        }
        assert.equal(sha(await readFile(source)), manifest.sha256);
    }
    finally {
        await runtime?.dispose();
        await rm(dir, { recursive: true, force: true });
    }
});
