import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, CAPS, sha, bytes, block, rowOperation, migrations, TABLES } from './cloudflare-bound-bundle.mjs';
const require = createRequire(resolve(ROOT, 'apps/web/package.json'));
export class SegmentEnd extends Error {
    constructor() { super('Segment checkpoint reached; rerun the identical command to resume.'); }
}
export class Budget {
    #reservedRows = 0;
    #reservedBytes = 0;
    reserveCheckpoint(rows = 0, payloadBytes = 0) {
        if (!Number.isSafeInteger(rows) || rows < 0 || rows > CAPS.segmentRows || !Number.isSafeInteger(payloadBytes) || payloadBytes < 0 || payloadBytes > CAPS.segmentBytes)
            block('invalid checkpoint reservation');
        this.#reservedRows = rows;
        this.#reservedBytes = payloadBytes;
    }
    constructor() { this.rows = 0; this.transmitted = 0; this.calls = 0; this.retries = 0; this.largestRequest = 0; this.largestResponse = 0; this.returned = 0; }
    charge(body, rows = 0) {
        const size = bytes(body);
        if (this.rows + rows + this.#reservedRows > CAPS.segmentRows || this.transmitted + size + this.#reservedBytes > CAPS.segmentBytes)
            throw new SegmentEnd();
        this.rows += rows;
        this.transmitted += size;
        this.calls++;
        this.largestRequest = Math.max(this.largestRequest, size);
    }
    received(value, limit) {
        const size = bytes(value);
        if (size > limit)
            block('transport response body cap');
        this.returned += size;
        this.largestResponse = Math.max(this.largestResponse, size);
    }
}
const transient = error => ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'UND_ERR_SOCKET'].includes(error?.code ?? error?.cause?.code);
export async function boundRow(database, table, row, budget) {
    const read = rowOperation(table, row, true), write = rowOperation(table, row);
    for (let retry = 0;; retry++)
        try {
            const existing = async () => {
                budget.charge(read.body, 1);
                const result = await database.prepare(read.sql).bind(...read.params).all();
                budget.received(result, CAPS.d1Body);
                if (result.results.length > 1)
                    block('D1 identity read returned multiple rows');
                return result.results[0] ?? null;
            };
            let old = await existing();
            if (!old) {
                budget.charge(write.body, 1);
                await database.prepare(write.sql).bind(...write.params).run();
                old = await existing();
            }
            if (!old || TABLES[table].columns.some(k => old[k] !== row[k]))
                block('D1 immutable conflict/readback mismatch');
            return old;
        }
        catch (error) {
            if (!transient(error) || retry === 3)
                throw error;
            budget.retries++;
        }
}
async function lock(path) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const child = spawn('flock', ['-n', path, 'sh', '-c', 'printf READY; cat >/dev/null'], { stdio: ['pipe', 'pipe', 'pipe'] });
    await new Promise((accept, reject) => { child.once('error', reject); child.once('exit', code => reject(new Error(`Exclusive local maintenance lock unavailable (${code})`))); child.stdout.once('data', data => data.toString() === 'READY' ? accept() : reject(new Error('Local lock handshake failed'))); });
    return () => new Promise(resolve => { child.once('exit', resolve); child.stdin.end(); });
}
export async function closedBuild() {
    const { build } = require('esbuild');
    const result = await build({ entryPoints: [resolve(ROOT, 'apps/web/worker/native/maintenance/index.ts')], bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022', external: ['cloudflare:workers', 'node:async_hooks'], metafile: true });
    if (Object.keys(result.metafile.inputs).some(p => p.endsWith('test-runtime.ts')))
        block('test runtime in closed build');
    return { script: result.outputFiles[0].text, id: sha(result.outputFiles[0].text) };
}
export async function openLocal(target, bundle, build) {
    const path = resolve(target), targetId = sha(path), identity = { bundleId: bundle.manifest.bundleId, targetId, buildId: build.id, schemaId: bundle.plan.schemaId, mappingId: bundle.plan.mappingId, ticket: sha(JSON.stringify([bundle.manifest.bundleId, targetId, build.id])) };
    const release = await lock(path + '.maintenance.lock');
    let runtime;
    try {
        await mkdir(path, { recursive: true, mode: 0o700 });
        const marker = resolve(path, 'managed-closed.json');
        let saved;
        try {
            saved = await readFile(marker, 'utf8');
        }
        catch (e) {
            if (e.code !== 'ENOENT')
                throw e;
            const files = await readdir(path);
            if (files.length)
                block('target is not empty or managed');
            await writeFile(marker, JSON.stringify(identity), { flag: 'wx', mode: 0o600 });
            saved = JSON.stringify(identity);
        }
        if (saved !== JSON.stringify(identity))
            block('target/build/schema/mapping/bundle pin differs');
        const { Miniflare } = require('miniflare');
        runtime = new Miniflare({ modules: true, script: build.script, compatibilityDate: '2026-05-22', compatibilityFlags: ['nodejs_compat'], d1Databases: { DB: 'maintenance-v1' }, d1Persist: resolve(path, 'd1'), durableObjects: { ROOMS: { className: 'PracticeRoom', useSQLite: true }, REPORTS: { className: 'PracticeReports', useSQLite: true }, PBE_SOLO: { className: 'PbeSoloRound', useSQLite: true }, PASSWORD_CRYPTO: { className: 'PasswordCrypto', useSQLite: true } }, durableObjectsPersist: resolve(path, 'do'), bindings: { NATIVE_MAINTENANCE_MODE: 'offline-v1', NATIVE_MAINTENANCE_IDENTITY: JSON.stringify(identity) } });
        const database = await runtime.getD1Database('DB');
        return { identity, database, runtime, close: async () => {
                try {
                    await runtime.dispose();
                }
                finally {
                    await release();
                }
            } };
    }
    catch (e) {
        try {
            await runtime?.dispose();
        }
        finally {
            await release();
        }
        throw e;
    }
}
const receiptSelect = "SELECT id,identity,plan_hash,phase,cursor FROM MaintenanceReceipt WHERE id='global'";
export async function initialize(local, bundle, budget) {
    const schema = await migrations();
    if (schema.id !== local.identity.schemaId)
        block('schema changed since preflight');
    const base = ["CREATE TABLE IF NOT EXISTS MaintenanceMigrations(name TEXT PRIMARY KEY,hash TEXT NOT NULL) WITHOUT ROWID", "CREATE TABLE IF NOT EXISTS MaintenanceReceipt(id TEXT PRIMARY KEY CHECK(id='global'),identity TEXT NOT NULL,plan_hash TEXT NOT NULL,phase TEXT NOT NULL CHECK(phase IN ('closed','verified')),cursor TEXT NOT NULL) WITHOUT ROWID"];
    for (const sql of base) {
        budget.charge(JSON.stringify({ sql, params: [] }));
        await local.database.prepare(sql).run();
    }
    const identity = JSON.stringify(local.identity), pinSql = "INSERT INTO MaintenanceReceipt(id,identity,plan_hash,phase,cursor) VALUES('global',?,?,'closed','{}') ON CONFLICT(id) DO NOTHING";
    budget.charge(JSON.stringify({ sql: pinSql, params: [identity, bundle.manifest.bundleId] }), 1);
    await local.database.prepare(pinSql).bind(identity, bundle.manifest.bundleId).run();
    budget.charge(JSON.stringify({ sql: receiptSelect, params: [] }), 1);
    const receipt = await local.database.prepare(receiptSelect).first();
    if (receipt.identity !== identity || receipt.plan_hash !== bundle.manifest.bundleId)
        block('global receipt identity conflict');
    for (const m of schema.list) {
        const sql = 'SELECT hash FROM MaintenanceMigrations WHERE name=?';
        budget.charge(JSON.stringify({ sql, params: [m.name] }), 1);
        const old = await local.database.prepare(sql).bind(m.name).first();
        if (old) {
            if (old.hash !== m.hash)
                block('migration hash conflict');
            continue;
        }
        const statements = m.sql.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean).filter(s => !/^PRAGMA foreign_keys/i.test(s));
        const end = 'INSERT INTO MaintenanceMigrations(name,hash) VALUES(?,?)';
        const body = JSON.stringify([...statements.map(sql => ({ sql, params: [] })), { sql: end, params: [m.name, m.hash] }]);
        if (bytes(body) > CAPS.d1Body || statements.some(sql => bytes(sql) > 100000))
            block('migration statement/body cap');
        budget.charge(body, 1);
        await local.database.batch([...statements.map(sql => local.database.prepare(sql)), local.database.prepare(end).bind(m.name, m.hash)]);
    }
    return receipt;
}
export async function adapterCall(local, scope, op, fields, budget, rows = 0) {
    if (op === 'capture' || op === 'verify')
        rows = Math.max(rows, 8);
    const body = JSON.stringify({ version: 1, identity: local.identity, scope, ...fields });
    if (bytes(body) > CAPS.doBody)
        block('DO request body cap');
    const ns = await local.runtime.getDurableObjectNamespace(scope.kind === 'room' ? 'ROOMS' : 'REPORTS');
    const stub = ns.get(ns.idFromName(scope.kind === 'room' ? `${scope.orgId}:${scope.id}` : `${scope.orgId}:${scope.seasonId}`));
    for (let retry = 0;; retry++) {
        budget.charge(body, rows);
        let response;
        try {
            response = await stub.fetch(`https://internal/__maintenance/v1/${op}`, { method: 'POST', body });
        }
        catch (error) {
            if (!transient(error) || retry === 3)
                throw error;
            budget.retries++;
            continue;
        }
        if ([502, 503, 504].includes(response.status) && retry < 3) {
            budget.retries++;
            continue;
        }
        const raw = await response.text();
        budget.received(raw, CAPS.doBody);
        if (!response.ok)
            block(`adapter ${op} failed (${response.status})`);
        return JSON.parse(raw);
    }
}
export function stagePages(local, o) {
    const pages = [];
    let page = [];
    for (const row of o.rows) {
        if (bytes({ version: 1, identity: local.identity, scope: o.scope, rows: [row] }) > CAPS.doBody)
            block('DO request body cap');
        const next = [...page, row];
        if (next.length > 8 || bytes({ version: 1, identity: local.identity, scope: o.scope, rows: next }) > CAPS.doBody) {
            pages.push(page);
            page = [];
        }
        page.push(row);
    }
    if (page.length)
        pages.push(page);
    return pages;
}
/** Executes exactly one bounded segment. A verified return keeps the closed marker and never starts application code. */
export async function importSegment(local, bundle, budget = new Budget()) {
    const receipt = await initialize(local, bundle, budget);
    let cursor = JSON.parse(receipt.cursor);
    const cursorSql = "UPDATE MaintenanceReceipt SET cursor=? WHERE id='global' AND identity=? AND plan_hash=?";
    const finalSql = "UPDATE MaintenanceReceipt SET phase='verified' WHERE id='global' AND identity=? AND plan_hash=?";
    const finalParams = [JSON.stringify(local.identity), bundle.manifest.bundleId];
    const cursorBody = value => JSON.stringify({ sql: cursorSql, params: [JSON.stringify(value), ...finalParams] });
    // Capture cursors contain only a checked scope, generation digest and at most a two-hash key.
    // Reserve the largest encoded next cursor plus both final receipt operations before data fills a segment.
    const scopes = bundle.plan.objects.map(o => o.scope);
    const maximumCursorBytes = Math.max(bytes(cursorBody({ phase: 'readback', index: CAPS.rows })), ...scopes.map(scope => bytes(cursorBody({ phase: 'readback', index: CAPS.rows, step: 'capture', page: CAPS.nodes, table: 2, offset: CAPS.reports, after: { scope, generation: 'f'.repeat(64), lastKey: JSON.stringify(['f'.repeat(64), 'f'.repeat(64)]) } }))));
    const reservedBytes = maximumCursorBytes + bytes(JSON.stringify({ sql: finalSql, params: finalParams })) + bytes(JSON.stringify({ sql: receiptSelect, params: [] }));
    budget.reserveCheckpoint(3, reservedBytes);
    const save = async () => {
        const body = cursorBody(cursor);
        if (bytes(body) > maximumCursorBytes)
            block('cursor exceeds bounded checkpoint reservation');
        budget.reserveCheckpoint();
        try {
            budget.charge(body, 1);
            await local.database.prepare(cursorSql).bind(JSON.stringify(cursor), ...finalParams).run();
        }
        finally {
            budget.reserveCheckpoint(3, reservedBytes);
        }
    };
    try {
        if (!cursor.phase)
            cursor = { phase: 'rows', index: 0 };
        if (cursor.phase === 'rows')
            for (let i = cursor.index; i < bundle.plan.rows.length; i++) {
                const e = bundle.plan.rows[i];
                await boundRow(local.database, e.table, e.row, budget);
                cursor.index = i + 1;
                await save();
            }
        if (cursor.phase === 'rows') {
            cursor = { phase: 'objects', index: 0 };
            await save();
        }
        if (cursor.phase === 'objects')
            for (let i = cursor.index; i < bundle.plan.objects.length; i++) {
                const o = bundle.plan.objects[i];
                if (!cursor.step) {
                    await adapterCall(local, o.scope, 'begin', { plan: o.plan }, budget);
                    cursor.step = 'stage';
                    cursor.page = 0;
                    await save();
                }
                const pages = stagePages(local, o);
                if (cursor.step === 'stage')
                    for (let page = cursor.page; page < pages.length; page++) {
                        await adapterCall(local, o.scope, 'stage', { rows: pages[page] }, budget, pages[page].length);
                        cursor.page = page + 1;
                        await save();
                    }
                if (cursor.step === 'stage') {
                    cursor.step = 'verify';
                    await save();
                }
                if (cursor.step === 'verify') {
                    let verified = false;
                    while (!verified) {
                        const result = await adapterCall(local, o.scope, 'verify', {}, budget, 8);
                        verified = result.verified;
                    }
                    cursor.step = 'commit';
                    await save();
                }
                if (cursor.step === 'commit') {
                    const result = await adapterCall(local, o.scope, 'commit', {}, budget);
                    const expected = { version: 1, identity: local.identity, scope: o.scope, rootDigest: sha(o.plan.root), historyDigest: o.plan.historyRoot ? sha(o.plan.historyRoot) : null, inventory: o.plan.inventory };
                    if (JSON.stringify(result.receipt) !== JSON.stringify(expected))
                        block('DO receipt differs');
                    cursor.step = 'capture';
                    cursor.table = 0;
                    cursor.offset = 0;
                    cursor.after = null;
                    await save();
                }
                const tables = [...new Set(o.rows.map(r => r.table))];
                if (cursor.step === 'capture')
                    for (let t = cursor.table; t < tables.length; t++) {
                        const table = tables[t], expected = o.rows.filter(r => r.table === table);
                        let more = true;
                        while (more) {
                            const captured = await adapterCall(local, o.scope, 'capture', { table, after: cursor.after, ...(o.scope.kind === 'room' ? { historyRoot: o.plan.historyRoot } : {}) }, budget);
                            if (JSON.stringify(captured.rows) !== JSON.stringify(expected.slice(cursor.offset, cursor.offset + captured.rows.length)))
                                block('DO exact readback differs');
                            cursor.offset += captured.rows.length;
                            cursor.after = captured.cursor;
                            more = !!captured.cursor;
                            if (!more) {
                                if (cursor.offset !== expected.length)
                                    block('DO incomplete final inventory');
                                cursor.table = t + 1;
                                cursor.offset = 0;
                                cursor.after = null;
                            }
                            await save();
                        }
                        cursor.table = t + 1;
                        cursor.offset = 0;
                        cursor.after = null;
                        await save();
                    }
                const inspect = await adapterCall(local, o.scope, 'inspect', {}, budget);
                if (inspect.root !== o.plan.root)
                    block('DO original root differs');
                cursor = { phase: 'objects', index: i + 1 };
                await save();
            }
        if (cursor.phase === 'objects') {
            cursor = { phase: 'readback', index: 0 };
            await save();
        }
        if (cursor.phase === 'readback')
            for (let i = cursor.index; i < bundle.plan.rows.length; i++) {
                const e = bundle.plan.rows[i], op = rowOperation(e.table, e.row, true);
                budget.charge(op.body, 1);
                const response = await local.database.prepare(op.sql).bind(...op.params).all();
                budget.received(response, CAPS.d1Body);
                if (response.results.length > 1)
                    block('D1 identity read returned multiple rows');
                const actual = response.results[0] ?? null;
                if (!actual || bytes(actual) > CAPS.d1Body || TABLES[e.table].columns.some(k => actual[k] !== e.row[k]))
                    block('final D1 readback conflict');
                cursor.index = i + 1;
                await save();
            }
        budget.reserveCheckpoint();
        budget.charge(JSON.stringify({ sql: finalSql, params: finalParams }), 1);
        await local.database.prepare(finalSql).bind(...finalParams).run();
        budget.charge(JSON.stringify({ sql: receiptSelect, params: [] }), 1);
        const final = await local.database.prepare(receiptSelect).first();
        if (final.phase !== 'verified')
            block('global verification receipt missing');
        return { complete: true, closed: true, budget };
    }
    catch (error) {
        if (error instanceof SegmentEnd)
            return { complete: false, closed: true, budget };
        throw error;
    }
}
/** Bounded capture continuation over a stopped, explicitly inventoried source opened only in this closed runtime. */
export async function captureObjectSegment(local, scope, historyRow, state = null, budget = new Budget()) {
    const historyRoot = scope.kind === 'room' ? JSON.stringify(JSON.parse(historyRow.data).manifest) : undefined;
    const fields = scope.kind === 'room' ? { historyRoot } : {};
    if (!state) {
        const first = await adapterCall(local, scope, 'inspect', {}, budget);
        if (first.root === null)
            block('declared source authority is absent');
        state = { scope, first, table: 0, after: null, rows: [] };
    }
    if (JSON.stringify(state.scope) !== JSON.stringify(scope))
        block('capture resume scope changed');
    const tables = scope.kind === 'room' ? ['room_components', 'room_uploaded'] : ['publications', 'verification'];
    try {
        for (let t = state.table; t < tables.length; t++) {
            const table = tables[t];
            let more = true;
            while (more) {
                const page = await adapterCall(local, scope, 'capture', { table, after: state.after, ...fields }, budget, 8);
                state.rows.push(...page.rows);
                state.after = page.cursor;
                more = !!page.cursor;
                if (!more) {
                    state.table = t + 1;
                    state.after = null;
                }
            }
        }
        const last = await adapterCall(local, scope, 'inspect', {}, budget);
        if (JSON.stringify(last) !== JSON.stringify(state.first))
            block('source root/inventory changed during capture');
        if (scope.kind === 'room') {
            const op = rowOperation('Records', historyRow, true);
            budget.charge(op.body, 1);
            const response = await local.database.prepare(op.sql).bind(...op.params).all();
            budget.received(response, CAPS.d1Body);
            if (response.results.length > 1)
                block('D1 identity read returned multiple rows');
            const actual = response.results[0] ?? null;
            if (!actual || TABLES.Records.columns.some(k => actual[k] !== historyRow[k]))
                block('source D1 history changed during capture');
        }
        // inspect and capture both enforce drained outboxes before source bytes are admitted.
        const { inventory } = await import('./cloudflare-bound-bundle.mjs');
        return { complete: true, state, object: { scope, outbox: null, rows: state.rows, plan: { root: state.first.root, ...fields, inventory: inventory(state.rows) } }, budget };
    }
    catch (error) {
        if (error instanceof SegmentEnd)
            return { complete: false, state, budget };
        throw error;
    }
}
