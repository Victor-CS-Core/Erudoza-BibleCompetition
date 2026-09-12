// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { expect, it } from 'vitest';
import { contentHash, RoomCodec } from '../practice/room-storage';
import type { Room } from '../practice/state';
const identity = { bundleId: 'bundle', targetId: 'target', buildId: 'build', schemaId: 'schema', mappingId: 'mapping', ticket: 'ticket' }, scope = { kind: 'room', orgId: 'Org', seasonId: 'Season', id: 'Room' };
it('uses the real closed binding, preserves stage and atomic receipt across owned runtime restart, and excludes engine from production', async () => {
    const options = { bundle: true, write: false, format: 'esm' as const, platform: 'neutral' as const, target: 'es2022', external: ['cloudflare:workers', 'node:async_hooks'], metafile: true };
    const closed = await build({ ...options, entryPoints: [new URL('./index.ts', import.meta.url).pathname] }), product = await build({ ...options, entryPoints: [new URL('../index.ts', import.meta.url).pathname] });
    expect(Object.keys(product.metafile!.inputs).some(p => p.endsWith('/maintenance/adapter.ts'))).toBe(false);
    expect(Object.keys(closed.metafile!.inputs).some(p => p.endsWith('/test-runtime.ts'))).toBe(false);
    const persist = await mkdtemp(join(tmpdir(), 'native-maintenance-'));
    let runtime: Miniflare | undefined;
    const config = { modules: true, script: closed.outputFiles[0].text, compatibilityDate: '2026-05-22', compatibilityFlags: ['nodejs_compat'], d1Databases: { DB: 'maintenance-runtime' }, durableObjects: { ROOMS: { className: 'PracticeRoom', useSQLite: true }, REPORTS: { className: 'PracticeReports', useSQLite: true }, PBE_SOLO: { className: 'PbeSoloRound', useSQLite: true }, PASSWORD_CRYPTO: { className: 'PasswordCrypto', useSQLite: true } }, durableObjectsPersist: persist, bindings: { NATIVE_MAINTENANCE_MODE: 'offline-v1', NATIVE_MAINTENANCE_IDENTITY: JSON.stringify(identity) } };
    const call = async (op: string, extra: object = {}) => { const ns = await runtime!.getDurableObjectNamespace('ROOMS'), stub = ns.get(ns.idFromName('Org:Room')), response = await stub.fetch(`https://internal/__maintenance/v1/${op}`, { method: 'POST', body: JSON.stringify({ version: 1, identity, scope, ...extra }) }); return { status: response.status, body: JSON.parse(await response.text() || '{}') }; };
    try {
        runtime = new Miniflare(config);
        expect((await runtime.dispatchFetch('https://internal/__maintenance/v1/inspect')).status).toBe(404);
        expect((await call('inspect')).body.root).toBeNull();
        const room = { id: 'Room', orgId: 'Org', seasonId: 'Season', format: 'Pbe', revision: 1, status: 'Completed', phaseEndsAt: null, questions: [], reserves: [], submissions: [], messages: [], drafts: {}, applied: { 'Original-ID': { actorId: 'Owner', response: { score: 7 } } }, members: [], filler: 'x'.repeat(2200000) } as unknown as Room;
        const a = await new RoomCodec().encode(room), h = await new RoomCodec().encode({ ...room, applied: {} }), rows = [...new Map([...a.nodes, ...h.nodes])].sort(([a], [b]) => a.localeCompare(b)).map(([key, data]) => ({ table: 'room_components', key, data }));
        let digest = await contentHash('erudoza-maintenance-inventory/1');
        for (const row of rows)
            digest = await contentHash(digest + '\n' + JSON.stringify(row));
        const plan = { root: JSON.stringify(a.manifest), historyRoot: JSON.stringify(h.manifest), inventory: { count: rows.length, bytes: rows.reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r)), 0), digest } };
        expect((await call('begin', { plan })).status).toBe(200);
        for (let i = 0; i < rows.length; i += 7)
            expect((await call('stage', { rows: rows.slice(i, i + 7) })).status).toBe(200);
        expect((await call('capture', { table: 'room_components', historyRoot: plan.historyRoot })).body.rows).toEqual(rows);
        await runtime.dispose();
        runtime = new Miniflare(config);
        expect((await call('begin', { plan })).status).toBe(200);
        for (let i = 0; i < rows.length; i += 7)
            expect((await call('stage', { rows: rows.slice(i, i + 7) })).status).toBe(200);
        for (let i = 0; i < 3; i++)
            expect((await call('verify')).status).toBe(200);
        expect((await call('inspect')).body.privatePayloadBytes).toBeGreaterThan(65536);
        await runtime.dispose();
        runtime = new Miniflare(config);
        for (let i = 0; i < 40; i++) {
            const r = await call('verify');
            expect(r.status).toBe(200);
            if (r.body.verified)
                break;
        }
        const commit = await call('commit');
        expect(commit.status).toBe(200);
        await runtime.dispose();
        runtime = new Miniflare(config);
        expect((await call('receipt')).body.receipt).toEqual(commit.body.receipt);
        expect((await call('commit')).body.receipt).toEqual(commit.body.receipt);
        expect((await call('inspect')).body.root).toBe(plan.root);
        const reports = await runtime.getDurableObjectNamespace('REPORTS');
        expect((await reports.get(reports.idFromName('Org:Season')).fetch('https://internal/project', { method: 'POST', body: '{}' })).status).toBe(404);
        await runtime.dispose();
        runtime = new Miniflare({ ...config, script: product.outputFiles[0].text, bindings: {} });
        expect((await call('inspect')).status).toBe(404);
        const productReports = await runtime.getDurableObjectNamespace('REPORTS');
        expect((await productReports.get(productReports.idFromName('Org:Season')).fetch('https://internal/__maintenance/v1/inspect', { method: 'POST', body: '{}' })).status).toBe(404);
        expect((await runtime.dispatchFetch('https://internal/__maintenance/v1/inspect')).status).toBe(404);
    }
    finally {
        await runtime?.dispose();
        await rm(persist, { recursive: true, force: true });
    }
}, 60000);
