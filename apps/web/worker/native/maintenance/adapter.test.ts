// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { describe, it, expect } from 'vitest';
import { handleMaintenance } from './adapter';
import { contentHash, RoomCodec } from '../practice/room-storage';
import type { Room } from '../practice/state';
const identity = { bundleId: 'bundle', targetId: 'target', buildId: 'build', schemaId: 'schema', mappingId: 'mapping', ticket: 'ticket' };
const scope = { kind: 'room' as const, orgId: 'Org', seasonId: 'Season', id: 'Room' };
function fixture() {
    const db = new DatabaseSync(':memory:');
    const storage = { sql: { exec(query: string, ...params: unknown[]) { const result = db.prepare(query).all(...params as never[]); return { toArray: () => result }; } }, transactionSync<T>(fn: () => T) {
            db.exec('BEGIN');
            try {
                const out = fn();
                db.exec('COMMIT');
                return out;
            }
            catch (e) {
                db.exec('ROLLBACK');
                throw e;
            }
        } } as unknown as DurableObjectStorage;
    return { db, storage };
}
async function call(storage: DurableObjectStorage, op: string, extra: object = {}, overrides: object = {}) { const response = await handleMaintenance(new Request(`https://internal/__maintenance/v1/${op}`, { method: 'POST', body: JSON.stringify({ version: 1, identity, scope, ...extra, ...overrides }) }), storage, { NATIVE_MAINTENANCE_MODE: 'offline-v1', NATIVE_MAINTENANCE_IDENTITY: JSON.stringify(identity), ROOMS: { idFromName: (name: string) => name } }, scope.kind, 'Org:Room'); return { status: response.status, body: JSON.parse(await response.text() || '{}') as Record<string, unknown> }; }
async function plan(changes: object = {}, historyChanges: object = {}) {
    const room = { id: 'Room', orgId: 'Org', seasonId: 'Season', format: 'Pbe', revision: 2, status: 'Completed', phaseEndsAt: null, questions: [], reserves: [], submissions: [], messages: [], drafts: {}, applied: { 'Exact-ID': { actorId: 'Owner', response: { score: 7 } } }, members: [], ...changes } as unknown as Room;
    const authority = await new RoomCodec().encode(room), history = await new RoomCodec().encode({ ...room, applied: {}, ...historyChanges }), nodes = new Map([...authority.nodes, ...history.nodes]);
    const rows = [...nodes].sort(([a], [b]) => a.localeCompare(b)).map(([key, data]) => ({ table: 'room_components', key, data }));
    let digest = await contentHash('erudoza-maintenance-inventory/1');
    for (const row of rows)
        digest = await contentHash(digest + '\n' + JSON.stringify(row));
    return { plan: { root: JSON.stringify(authority.manifest), historyRoot: JSON.stringify(history.manifest), inventory: { count: rows.length, bytes: rows.reduce((n, r) => n + new TextEncoder().encode(JSON.stringify(r)).length, 0), digest } }, rows };
}
describe('closed native maintenance storage', () => {
    it('restores exact root only after immutable inventory and closure verification, with replayable lost acknowledgements', async () => {
        const { db, storage } = fixture();
        try {
            const input = await plan();
            expect((await call(storage, 'begin', { plan: input.plan })).status).toBe(200);
            expect((await call(storage, 'commit')).status).toBe(409);
            expect((await call(storage, 'stage', { rows: input.rows })).status).toBe(200);
            expect((await call(storage, 'stage', { rows: input.rows })).status).toBe(200);
            let result;
            for (let i = 0; i < 20; i++) {
                result = await call(storage, 'verify');
                expect(result.status).toBe(200);
                if (result.body.verified)
                    break;
            }
            expect(result!.body.verified).toBe(true);
            expect((await call(storage, 'commit')).status).toBe(200);
            expect((await call(storage, 'commit')).status).toBe(200);
            expect(db.prepare('SELECT data FROM state').get()).toEqual({ data: input.plan.root });
            expect(db.prepare('SELECT count(*) n FROM outbox').get()).toEqual({ n: 0 });
            expect((await call(storage, 'receipt')).body.receipt).toMatchObject({ identity, scope });
        }
        finally {
            db.close();
        }
    });
    it('rejects wrong identity before creating any target table', async () => {
        const { db, storage } = fixture();
        try {
            expect((await call(storage, 'begin', { plan: (await plan()).plan }, { identity: { ...identity, ticket: 'other' } })).status).toBe(409);
            expect(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get()).toEqual({ n: 0 });
        }
        finally {
            db.close();
        }
    });
});
async function verified(storage: DurableObjectStorage, input: Awaited<ReturnType<typeof plan>>) {
    const start = await call(storage, 'begin', { plan: input.plan });
    if (start.status !== 200)
        return start;
    for (let i = 0; i < input.rows.length; i += 8) {
        const stage = await call(storage, 'stage', { rows: input.rows.slice(i, i + 8) });
        if (stage.status !== 200)
            return stage;
    }
    let result;
    for (let i = 0; i < 2000; i++) {
        result = await call(storage, 'verify');
        if (result.status !== 200 || result.body.verified)
            return result;
    }
    throw Error('Unbounded verification');
}
describe('admission, source closure and restart conflicts', () => {
    it('rejects differing terminal history even when both roots have the same scope and revision', async () => {
        const { db, storage } = fixture();
        try {
            const input = await plan({ ownerId: 'Original' }, { ownerId: 'Changed' });
            expect((await verified(storage, input)).status).toBe(409);
            expect(db.prepare('SELECT count(*) n FROM state').get()).toEqual({ n: 0 });
        }
        finally {
            db.close();
        }
    });
    it.each(['Playing', 'Lobby', 'Abandoned'])('refuses %s authority without publishing a root', async (status) => {
        const { db, storage } = fixture();
        try {
            expect((await verified(storage, await plan({ status }))).status).toBe(409);
            expect(db.prepare('SELECT count(*) n FROM state').get()).toEqual({ n: 0 });
        }
        finally {
            db.close();
        }
    });
    it('refuses an active deadline despite terminal status', async () => {
        const { db, storage } = fixture();
        try {
            expect((await verified(storage, await plan({ phaseEndsAt: 100 })))).toMatchObject({ status: 409 });
        }
        finally {
            db.close();
        }
    });
    it('inspects an empty source without initializing tables', async () => {
        const { db, storage } = fixture();
        try {
            expect((await call(storage, 'inspect')).body).toMatchObject({ root: null, receipt: null });
            expect(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get()).toEqual({ n: 0 });
        }
        finally {
            db.close();
        }
    });
    it('rejects absent and mismatched history roots before destination initialization', async () => {
        const { db, storage } = fixture();
        try {
            const input = await plan();
            expect((await call(storage, 'begin', { plan: { ...input.plan, historyRoot: undefined } })).status).toBe(400);
            const h = JSON.parse(input.plan.historyRoot);
            h.orgId = 'other';
            expect((await call(storage, 'begin', { plan: { ...input.plan, historyRoot: JSON.stringify(h) } })).status).toBe(409);
            expect(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get()).toEqual({ n: 0 });
        }
        finally {
            db.close();
        }
    });
    it('never replaces a different pinned plan or immutable row', async () => {
        const { db, storage } = fixture();
        try {
            const input = await plan();
            await call(storage, 'begin', { plan: input.plan });
            expect((await call(storage, 'begin', { plan: { ...input.plan, root: input.plan.historyRoot } })).status).toBe(409);
            await call(storage, 'stage', { rows: input.rows });
            const row = input.rows[0];
            db.prepare('UPDATE room_components SET data=? WHERE hash=?').run('different', row.key);
            expect((await call(storage, 'stage', { rows: [row] })).status).toBe(409);
            expect(db.prepare('SELECT data FROM room_components WHERE hash=?').get(row.key)).toEqual({ data: 'different' });
        }
        finally {
            db.close();
        }
    });
    it('detects omitted retained nodes, not only reachable root nodes', async () => {
        const { db, storage } = fixture();
        try {
            const input = await plan();
            await call(storage, 'begin', { plan: input.plan });
            await call(storage, 'stage', { rows: input.rows.slice(1) });
            let result;
            for (let i = 0; i < 4; i++) {
                result = await call(storage, 'verify');
                if (result.status !== 200)
                    break;
            }
            expect(result!.status).toBe(409);
        }
        finally {
            db.close();
        }
    });
    it('requires outbox absence and preserves it on refusal', async () => {
        const { db, storage } = fixture();
        try {
            db.exec('CREATE TABLE outbox(id INTEGER PRIMARY KEY,data TEXT)');
            db.prepare('INSERT INTO outbox VALUES(1,?)').run('original');
            expect((await call(storage, 'inspect')).status).toBe(409);
            expect((await call(storage, 'begin', { plan: (await plan()).plan })).status).toBe(409);
            expect(db.prepare('SELECT data FROM outbox').get()).toEqual({ data: 'original' });
        }
        finally {
            db.close();
        }
    });
    it('caps requested stage pages by both count and actual escaped wire bytes', async () => {
        const { db, storage } = fixture();
        try {
            const input = await plan();
            await call(storage, 'begin', { plan: input.plan });
            expect((await call(storage, 'stage', { rows: Array.from({ length: 9 }, () => input.rows[0]) })).status).toBe(413);
            expect((await call(storage, 'stage', { rows: [{ ...input.rows[0], data: '"'.repeat(524288) }] })).status).toBe(413);
            expect(db.prepare('SELECT count(*) n FROM room_components').get()).toEqual({ n: 0 });
        }
        finally {
            db.close();
        }
    });
    it('caps manifest logical expansion before target writes', async () => {
        const { db, storage } = fixture();
        try {
            const input = await plan(), root = JSON.parse(input.plan.root);
            root.metadata.bytes = 8388608;
            expect((await call(storage, 'begin', { plan: { ...input.plan, root: JSON.stringify(root) } })).status).toBe(413);
            expect(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get()).toEqual({ n: 0 });
        }
        finally {
            db.close();
        }
    });
    it('returns bounded exact retained pages and rejects a cursor from another generation', async () => {
        const { db, storage } = fixture();
        try {
            const input = await plan();
            await verified(storage, input);
            await call(storage, 'commit');
            const page = await call(storage, 'capture', { table: 'room_components', historyRoot: input.plan.historyRoot, after: null });
            expect(page.status).toBe(200);
            expect(page.body.rows).toEqual(input.rows);
            expect((await call(storage, 'capture', { table: 'room_components', historyRoot: input.plan.historyRoot, after: { ...(page.body.cursor as object), generation: 'wrong' } })).status).toBe(409);
        }
        finally {
            db.close();
        }
    });
});
async function inventory(rows: {
    table: string;
    key: string;
    data: unknown;
}[]) {
    let digest = await contentHash('erudoza-maintenance-inventory/1');
    for (const row of rows)
        digest = await contentHash(digest + '\n' + JSON.stringify(row));
    return { count: rows.length, bytes: rows.reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r)), 0), digest };
}
async function chainPlan(depth: number) {
    const input = await plan({ applied: {} }), m = JSON.parse(input.plan.root), rows = [...input.rows];
    let key = m.metadata.hash;
    for (let i = 1; i < depth; i++) {
        const data = JSON.stringify({ nodeVersion: 1, type: 'branch', children: [key] });
        key = await contentHash(data);
        rows.push({ table: 'room_components', key, data });
    }
    m.metadata.hash = key;
    rows.sort((a, b) => a.key.localeCompare(b.key));
    return { plan: { root: JSON.stringify(m), historyRoot: JSON.stringify(m), inventory: await inventory(rows) }, rows };
}
describe('closure traversal and retained inventory bounds', () => {
    it.each([{ depth: 16, status: 200 }, { depth: 17, status: 413 }])('enforces depth $depth at the actual closure traversal', async ({ depth, status }) => {
        const { db, storage } = fixture();
        try {
            expect((await verified(storage, await chainPlan(depth))).status).toBe(status);
        }
        finally {
            db.close();
        }
    });
    it('rejects a malformed cyclic graph by its invalid content identity', async () => {
        const { db, storage } = fixture();
        try {
            const input = await plan();
            await call(storage, 'begin', { plan: input.plan });
            const key = 'a'.repeat(64), data = JSON.stringify({ nodeVersion: 1, type: 'branch', children: [key] });
            expect((await call(storage, 'stage', { rows: [{ table: 'room_components', key, data }] })).status).toBe(400);
            expect(db.prepare('SELECT count(*) n FROM room_components').get()).toEqual({ n: 0 });
        }
        finally {
            db.close();
        }
    });
    it.each([{ count: 2048, status: 200 }, { count: 2049, status: 413 }])('counts all $count retained nodes even without a current root', async ({ count, status }) => {
        const { db, storage } = fixture();
        try {
            db.exec('CREATE TABLE room_components(hash TEXT PRIMARY KEY,data TEXT)');
            const stmt = db.prepare('INSERT INTO room_components VALUES(?,?)');
            for (let i = 0; i < count; i++)
                stmt.run(i.toString(16).padStart(64, '0'), 'payload');
            expect((await call(storage, 'inspect')).status).toBe(status);
        }
        finally {
            db.close();
        }
    });
    it('returns no more than 100 key identities and resumes using generation and last key', async () => {
        const { db, storage } = fixture();
        try {
            db.exec('CREATE TABLE room_components(hash TEXT PRIMARY KEY,data TEXT)');
            const stmt = db.prepare('INSERT INTO room_components VALUES(?,?)');
            for (let i = 0; i < 205; i++)
                stmt.run(i.toString(16).padStart(64, '0'), 'payload');
            const a = await call(storage, 'inspect', { table: 'room_components' }), b = await call(storage, 'inspect', { table: 'room_components', after: a.body.cursor }), c = await call(storage, 'inspect', { table: 'room_components', after: b.body.cursor });
            expect((a.body.keys as unknown[]).length).toBe(100);
            expect((b.body.keys as unknown[]).length).toBe(100);
            expect((c.body.keys as unknown[]).length).toBe(5);
            expect(Buffer.byteLength(JSON.stringify(a.body))).toBeLessThanOrEqual(65536);
        }
        finally {
            db.close();
        }
    });
    it('keeps every changed scope away from an existing authority', async () => {
        const { db, storage } = fixture();
        try {
            const input = await plan();
            await verified(storage, input);
            await call(storage, 'commit');
            expect((await call(storage, 'inspect', {}, { scope: { ...scope, seasonId: 'Other' } })).status).toBe(409);
            expect((await call(storage, 'begin', { plan: input.plan }, { scope: { ...scope, id: 'Other' } })).status).toBe(409);
        }
        finally {
            db.close();
        }
    });
});
async function reportsCall(storage: DurableObjectStorage, op: string, extra: object = {}) { const reportsScope = { kind: 'reports', orgId: 'Org', seasonId: 'Season' }, response = await handleMaintenance(new Request(`https://internal/__maintenance/v1/${op}`, { method: 'POST', body: JSON.stringify({ version: 1, identity, scope: reportsScope, ...extra }) }), storage, { NATIVE_MAINTENANCE_MODE: 'offline-v1', NATIVE_MAINTENANCE_IDENTITY: JSON.stringify(identity), REPORTS: { idFromName: (name: string) => name } }, 'reports', 'Org:Season'); return { status: response.status, body: JSON.parse(await response.text() || '{}') }; }
describe('exact scoped Reports bookkeeping', () => {
    it('preserves publication bytes and original done scalars without republishing', async () => {
        const { db, storage } = fixture();
        try {
            const p = await plan(), manifest = JSON.parse(p.plan.historyRoot), data = JSON.stringify({ manifest, summary: { summaryVersion: 1, id: 'Room', orgId: 'Org', seasonId: 'Season', revision: 2, status: 'Completed' } }), key = await contentHash(data), rows = [{ table: 'publications', key, data }, { table: 'verification', key: JSON.stringify([key, manifest.metadata.hash]), data: 0 }];
            const begin = { root: JSON.stringify(['Org', 'Season']), inventory: await inventory(rows) };
            expect((await reportsCall(storage, 'begin', { plan: begin })).status).toBe(200);
            expect((await reportsCall(storage, 'stage', { rows })).status).toBe(200);
            for (let i = 0; i < 10; i++) {
                const v = await reportsCall(storage, 'verify');
                expect(v.status).toBe(200);
                if (v.body.verified)
                    break;
            }
            expect((await reportsCall(storage, 'commit')).status).toBe(200);
            expect(db.prepare('SELECT data FROM publications').get()).toEqual({ data });
            expect(db.prepare('SELECT done FROM verification').get()).toEqual({ done: 0 });
            expect((await reportsCall(storage, 'capture', { table: 'publications' })).body.rows).toEqual([rows[0]]);
            expect((await reportsCall(storage, 'stage', { rows: [{ ...rows[1], data: 1 }] })).status).toBe(409);
        }
        finally {
            db.close();
        }
    });
    it.each([{ count: 4096, status: 200 }, { count: 4097, status: 413 }])('enforces $count aggregate bookkeeping rows', async ({ count, status }) => {
        const { db, storage } = fixture();
        try {
            db.exec('CREATE TABLE verification(root TEXT,hash TEXT,done INTEGER,PRIMARY KEY(root,hash))');
            const stmt = db.prepare('INSERT INTO verification VALUES(?,?,0)');
            for (let i = 0; i < count; i++)
                stmt.run('a'.repeat(64), i.toString(16).padStart(64, '0'));
            expect((await reportsCall(storage, 'inspect')).status).toBe(status);
        }
        finally {
            db.close();
        }
    });
    it('rejects verification rows without the exact scoped publication', async () => {
        const { db, storage } = fixture();
        try {
            const row = { table: 'verification', key: JSON.stringify(['a'.repeat(64), 'b'.repeat(64)]), data: 1 };
            await reportsCall(storage, 'begin', { plan: { root: JSON.stringify(['Org', 'Season']), inventory: await inventory([row]) } });
            await reportsCall(storage, 'stage', { rows: [row] });
            expect((await reportsCall(storage, 'verify')).status).toBe(409);
        }
        finally {
            db.close();
        }
    });
});
async function repeatedDagPlan(leaves: number) {
    const base = await plan({ applied: {}, filler: '@' }), m = JSON.parse(base.plan.root), metadata = JSON.parse(base.rows.find(r => r.key === m.metadata.hash)!.data).data as string, marker = metadata.indexOf('@'), nodes = new Map<string, string>();
    const add = async (node: object) => { const data = JSON.stringify(node), key = await contentHash(data); nodes.set(key, data); return key; };
    const prefix = await add({ nodeVersion: 1, type: 'leaf', data: metadata.slice(0, marker) }), x = await add({ nodeVersion: 1, type: 'leaf', data: 'x' }), suffix = await add({ nodeVersion: 1, type: 'leaf', data: metadata.slice(marker + 1) }), groups: string[] = [];
    for (let n = 0; n < leaves; n += 256)
        groups.push(await add({ nodeVersion: 1, type: 'branch', children: Array.from({ length: Math.min(256, leaves - n) }, () => x) }));
    m.metadata = { hash: await add({ nodeVersion: 1, type: 'branch', children: [prefix, ...groups, suffix] }), bytes: Buffer.byteLength(metadata) - 1 + leaves };
    const rows = [...nodes].sort(([a], [b]) => a.localeCompare(b)).map(([key, data]) => ({ table: 'room_components', key, data }));
    return { plan: { root: JSON.stringify(m), historyRoot: JSON.stringify(m), inventory: await inventory(rows) }, rows };
}
it.each([{ leaves: 8157, status: 200 }, { leaves: 8158, status: 413 }])('bounds repeated shared-DAG expansion at 8192 edges ($leaves leaves)', async ({ leaves, status }) => {
    const { db, storage } = fixture();
    try {
        const input = await repeatedDagPlan(leaves);
        await call(storage, 'begin', { plan: input.plan });
        await call(storage, 'stage', { rows: input.rows });
        let result;
        for (let i = 0; i < 5000; i++) {
            result = await call(storage, 'verify');
            if (result.status !== 200 || result.body.verified)
                break;
        }
        expect(result!.status).toBe(status);
        if (status === 200)
            expect(result!.body.verified).toBe(true);
    }
    finally {
        db.close();
    }
}, 15000);
it.each([{ bytes: 131072, status: 200 }, { bytes: 131073, status: 400 }])('checks the existing leaf byte boundary ($bytes)', async ({ bytes, status }) => {
    const { db, storage } = fixture();
    try {
        const input = await plan(), data = JSON.stringify({ nodeVersion: 1, type: 'leaf', data: 'x'.repeat(bytes) }), key = await contentHash(data);
        await call(storage, 'begin', { plan: { ...input.plan, inventory: { ...input.plan.inventory, count: 2048, bytes: 67108864 } } });
        expect((await call(storage, 'stage', { rows: [{ table: 'room_components', key, data }] })).status).toBe(status);
    }
    finally {
        db.close();
    }
});
it('keeps resumable decoded progress in bounded storage values for a multi-megabyte root', async () => { const { db, storage } = fixture(); try {
    let maxProgressValue = 0;
    const exec = storage.sql.exec.bind(storage.sql);
    storage.sql.exec = ((query: string, ...args: SqlStorageValue[]) => { if (query.includes('maintenance_progress'))
        for (const arg of args)
            if (typeof arg === 'string')
                maxProgressValue = Math.max(maxProgressValue, Buffer.byteLength(arg)); return exec(query, ...args); }) as typeof storage.sql.exec;
    const input = await plan({ applied: {}, filler: 'x'.repeat(2200000) });
    await call(storage, 'begin', { plan: input.plan });
    for (let i = 0; i < input.rows.length; i += 7)
        expect((await call(storage, 'stage', { rows: input.rows.slice(i, i + 7) })).status).toBe(200);
    let result;
    for (let i = 0; i < 40; i++) {
        result = await call(storage, 'verify');
        expect(result.status).toBe(200);
        if (result.body.verified)
            break;
    }
    expect(result!.body.verified).toBe(true);
    expect(maxProgressValue).toBeLessThanOrEqual(65536);
}
finally {
    db.close();
} }, 10000);
it.each([{ bytes: 8388562, status: 200 }, { bytes: 8388563, status: 413 }])('prechecks the exact 8 MiB reconstructed root boundary ($bytes metadata bytes)', async ({ bytes, status }) => { const { db, storage } = fixture(); try {
    const input = await plan(), root = JSON.parse(input.plan.root);
    root.metadata.bytes = bytes;
    expect((await call(storage, 'begin', { plan: { ...input.plan, root: JSON.stringify(root) } })).status).toBe(status);
}
finally {
    db.close();
} });
it('reads a missing receipt without claiming or initializing an empty destination', async () => { const { db, storage } = fixture(); try {
    expect(await call(storage, 'receipt')).toMatchObject({ status: 200, body: { receipt: null } });
    expect(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get()).toEqual({ n: 0 });
}
finally {
    db.close();
} });
it('enforces the full retained 64 MiB payload boundary including superseded rows', async () => { const { db, storage } = fixture(); try {
    db.exec('CREATE TABLE room_components(hash TEXT PRIMARY KEY,data TEXT)');
    db.exec("WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<1023) INSERT INTO room_components SELECT printf('%064x',x),hex(zeroblob(32768)) FROM n");
    expect((await call(storage, 'inspect')).status).toBe(200);
    db.prepare('UPDATE room_components SET data=data||? WHERE hash=?').run('x', '0'.repeat(64));
    expect((await call(storage, 'inspect')).status).toBe(413);
}
finally {
    db.close();
} }, 15000);
it('enforces the aggregate 16 MiB Reports payload boundary', async () => { const { db, storage } = fixture(); try {
    db.exec('CREATE TABLE publications(root TEXT PRIMARY KEY,data TEXT)');
    db.prepare('INSERT INTO publications VALUES(?,CAST(zeroblob(?) AS TEXT))').run('a'.repeat(64), 16777216 - 64);
    expect((await reportsCall(storage, 'inspect')).status).toBe(200);
    db.exec("UPDATE publications SET data=data||'x'");
    expect((await reportsCall(storage, 'inspect')).status).toBe(413);
}
finally {
    db.close();
} }, 15000);
it('counts uploaded bookkeeping identities in the same 2048-row Room inventory', async () => { const { db, storage } = fixture(); try {
    db.exec('CREATE TABLE room_components(hash TEXT PRIMARY KEY,data TEXT); CREATE TABLE room_uploaded(hash TEXT PRIMARY KEY)');
    const node = db.prepare('INSERT INTO room_components VALUES(?,?)'), uploaded = db.prepare('INSERT INTO room_uploaded VALUES(?)');
    for (let i = 0; i < 1024; i++) {
        const hash = i.toString(16).padStart(64, '0');
        node.run(hash, 'payload');
        uploaded.run(hash);
    }
    expect((await call(storage, 'inspect')).status).toBe(200);
    node.run('f'.repeat(64), 'payload');
    expect((await call(storage, 'inspect')).status).toBe(413);
}
finally {
    db.close();
} });
it('reads exact staged bytes after a lost stage acknowledgement before root publication', async () => { const { db, storage } = fixture(); try {
    const input = await plan();
    await call(storage, 'begin', { plan: input.plan });
    await call(storage, 'stage', { rows: input.rows });
    expect(await call(storage, 'capture', { table: 'room_components', historyRoot: input.plan.historyRoot })).toMatchObject({ status: 200, body: { rows: input.rows } });
    expect(db.prepare('SELECT count(*) n FROM state').get()).toEqual({ n: 0 });
}
finally {
    db.close();
} });
