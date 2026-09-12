import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { ROOT, CAPS, bytes, block } from './cloudflare-bound-bundle.mjs';
const require = createRequire(resolve(ROOT, 'apps/web/package.json'));
let adapter;
async function implementation() {
    if (!adapter) {
        const { build } = require('esbuild');
        const result = await build({ entryPoints: [resolve(ROOT, 'apps/web/worker/native/maintenance/adapter.ts')], bundle: true, write: false, format: 'esm', platform: 'node', metafile: true });
        if (Object.keys(result.metafile.inputs).some(p => p.includes('test-runtime')))
            block('test runtime in adapter preflight');
        adapter = (await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))).handleMaintenance;
    }
    return adapter;
}
/** Exact released adapter, disposable SQLite only: no namespace/runtime/target initialization. */
export async function preflightAdapterObject(object, mappingId, schemaId) {
    const handle = await implementation(), db = new DatabaseSync(':memory:');
    const identity = { bundleId: '0'.repeat(64), targetId: '0'.repeat(64), buildId: '0'.repeat(64), schemaId, mappingId, ticket: '0'.repeat(64) }, scope = object.scope;
    const storage = { sql: { exec(sql, ...params) { const rows = db.prepare(sql).all(...params); return { toArray: () => rows }; } }, transactionSync(fn) { db.exec('BEGIN'); try {
            const value = fn();
            if (value && typeof value.then === 'function')
                block('asynchronous transaction callback');
            db.exec('COMMIT');
            return value;
        }
        catch (e) {
            db.exec('ROLLBACK');
            throw e;
        } } };
    const binding = { idFromName: name => name }, env = { NATIVE_MAINTENANCE_MODE: 'offline-v1', NATIVE_MAINTENANCE_IDENTITY: JSON.stringify(identity), ROOMS: binding, REPORTS: binding }, name = scope.kind === 'room' ? `${scope.orgId}:${scope.id}` : `${scope.orgId}:${scope.seasonId}`;
    let peak = 0, calls = 0, largestRequest = 0, largestResponse = 0;
    const call = async (op, fields = {}) => { calls++; const body = JSON.stringify({ version: 1, identity, scope, ...fields }); largestRequest = Math.max(largestRequest, bytes(body)); if (bytes(body) > CAPS.doBody)
        block('adapter preflight body cap'); const response = await handle(new Request(`https://internal/__maintenance/v1/${op}`, { method: 'POST', body }), storage, env, scope.kind, name); const raw = await response.text(); largestResponse = Math.max(largestResponse, bytes(raw)); if (bytes(raw) > CAPS.doBody)
        block('adapter preflight response cap'); const data = JSON.parse(raw); if (!response.ok)
        block(`adapter preflight ${op}: ${data.error}`); return data; };
    const measure = async () => { const data = await call('inspect'); peak = Math.max(peak, data.storedPayloadBytes); return data.storedPayloadBytes; };
    try {
        await call('begin', { plan: object.plan });
        await measure();
        let page = [];
        const stage = async () => { if (page.length) {
            await call('stage', { rows: page });
            page = [];
            await measure();
        } };
        for (const row of object.rows) {
            if (page.length === 8 || bytes({ version: 1, identity, scope, rows: [...page, row] }) > CAPS.doBody)
                await stage();
            page.push(row);
        }
        await stage();
        let verified = false;
        while (!verified) {
            if (calls > 10000)
                block('adapter verification did not converge');
            verified = (await call('verify')).verified;
            await measure();
        }
        await call('commit');
        const final = await measure();
        return { peak, final, calls, largestRequest, largestResponse };
    }
    finally {
        db.close();
    }
}
