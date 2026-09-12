import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ROOT, CAPS, sha, bytes, block, archiveRow, reassembleArchive, inventory, writeBundle } from './cloudflare-bound-bundle.mjs';
import { convertSnapshot } from '../cloudflare-export.mjs';
const require = createRequire(resolve(ROOT, 'apps/web/package.json'));
const quote = value => '"' + value.replaceAll('"', '""') + '"';
export function probeCanonicalRoomSize(db) {
    if (db.prepare('SELECT 1 excessive FROM PracticeRoomRecord WHERE length(CAST(StateJson AS BLOB))>? LIMIT 1').get(16 * 1024 ** 2))
        block('canonical StateJson 16 MiB early cap');
}
export function readCanonicalSnapshot(path) {
    const db = new DatabaseSync(resolve(path), { readOnly: true }), tables = {}, primaryKeys = {};
    let encoded = 0;
    try {
        db.exec('BEGIN');
        if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length)
            block('canonical source integrity');
        const definitions = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
        for (const { name } of definitions) {
            const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all(), pk = columns.filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name);
            if (!pk.length)
                block(`canonical archive requires full primary key ${name}`);
            primaryKeys[name] = pk;
            const lower = columns.map(c => `coalesce(length(CAST(${quote(c.name)} AS BLOB)),0)`).join('+');
            if (db.prepare(`SELECT 1 excessive FROM ${quote(name)} WHERE ${lower}>? LIMIT 1`).get(CAPS.archive))
                block('canonical source archive early byte probe');
            if (name === 'PracticeRoomRecord')
                probeCanonicalRoomSize(db);
            const statement = db.prepare(`SELECT * FROM ${quote(name)} ORDER BY ${pk.map(quote).join(',')}`);
            statement.setReadBigInts(true);
            tables[name] = [];
            for (const raw of statement.iterate()) {
                const row = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'bigint' && v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(v) : v]));
                const a = archiveRow(name, pk, row);
                encoded += a.length;
                if (encoded > CAPS.bundle)
                    block('canonical original source total cap');
                tables[name].push(row);
            }
        }
        db.exec('COMMIT');
        return { tables, definitions, primaryKeys };
    }
    finally {
        db.close();
    }
}
let codecs;
async function productCodecs() {
    if (!codecs) {
        const { build } = require('esbuild');
        const output = await build({ stdin: { contents: "export {RoomCodec} from './room-storage';export {summarizeRoom} from './room-history';export {calculateAwards} from './awards';export {overlayRoom} from '../pbe/result-overlays';", resolveDir: resolve(ROOT, 'apps/web/worker/native/practice'), sourcefile: 'restore-codecs.ts', loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', metafile: true });
        if (Object.keys(output.metafile.inputs).some(p => /test-runtime|maintenance|practice\/room\.ts/.test(p)))
            block('unexpected canonical codec dependency');
        codecs = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
    }
    return codecs;
}
export function canonicalArchives(snapshot) { return Object.entries(snapshot.tables).flatMap(([table, rows]) => rows.map(row => archiveRow(table, snapshot.primaryKeys[table], row))); }
function sourceSnapshot(source, archives) {
    if (source.kind !== 'canonical-offline-sqlite' || source.exhaustive !== true || !Array.isArray(source.definitions) || !source.primaryKeys || !source.counts)
        block('canonical source inventory');
    const tables = Object.fromEntries(source.definitions.map(d => [d.name, []]));
    for (const a of archives) {
        const table = a.identity[0];
        if (!Object.hasOwn(tables, table) || JSON.stringify(a.identity[1].map(p => p[0])) !== JSON.stringify(source.primaryKeys[table]))
            block('canonical archive schema/identity');
        tables[table].push(reassembleArchive(a));
    }
    if (Object.keys(tables).length !== Object.keys(source.counts).length || Object.entries(tables).some(([t, rows]) => source.counts[t] !== rows.length))
        block('canonical source count mismatch');
    const sourceHash = sha(JSON.stringify([source.definitions, source.primaryKeys, archives.map(a => [a.id, a.hash])]));
    if (sourceHash !== source.sourceHash)
        block('canonical source digest');
    return { tables, definitions: source.definitions };
}
export async function mapCanonicalPlan(source, archives) {
    const snapshot = sourceSnapshot(source, archives), nativeCore = convertSnapshot(snapshot, { bound: true }).native;
    const { mapCanonicalPbe } = await import('./cloudflare-pbe-mapping.mjs');
    const mapped = await mapCanonicalPbe({ snapshot, nativeCore });
    if (!mapped || !Array.isArray(mapped.records) || !Array.isArray(mapped.rooms) || !Array.isArray(mapped.consumedTables) || typeof mapped.mappingId !== 'string')
        block('canonical mapping result schema');
    for (const table of ['PbeTrainingRecords', 'PracticeRoomRecord', 'PracticeAwardRecord'])
        if (snapshot.tables[table]?.length && !mapped.consumedTables.includes(table))
            block('canonical mapping omitted authority table');
    const rows = [...nativeCore.organizations.map(row => ({ table: 'Organizations', row })), ...nativeCore.users.map(row => ({ table: 'Users', row })), ...nativeCore.records.map(row => ({ table: 'Records', row: { ...row, data: JSON.stringify(row.data), revision: row.revision ?? 1 } })), ...mapped.records.map(row => ({ table: 'Records', row }))];
    const { RoomCodec, summarizeRoom, calculateAwards, overlayRoom } = await productCodecs(), objects = [], summaries = [];
    if (mapped.rooms.length > 4)
        block('canonical room count cap');
    for (const { scope, room } of mapped.rooms) {
        if (room.id !== scope.id || room.orgId !== scope.orgId || room.seasonId !== scope.seasonId || room.format !== 'Pbe' || !['Completed', 'Interrupted'].includes(room.status) || room.phaseEndsAt !== null)
            block('canonical unsupported terminal authority');
        if (bytes(room) > CAPS.room)
            block('canonical mapped decoded room cap');
        const authority = await new RoomCodec().encode(room), history = await new RoomCodec().encode({ ...room, messages: [], drafts: {}, applied: {} }), nodes = [...new Map([...authority.nodes, ...history.nodes])].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0), componentRows = nodes.map(([key, data]) => ({ table: 'room_components', key, data }));
        const summary = summarizeRoom(room);
        summaries.push(summary);
        rows.push(...nodes.map(([hash, data]) => ({ table: 'PracticeRoomComponents', row: { org_id: scope.orgId, season_id: scope.seasonId, room_id: scope.id, hash, data } })), { table: 'Records', row: { kind: 'match', id: scope.id, org_id: scope.orgId, season_id: scope.seasonId, owner_id: null, data: JSON.stringify({ format: 'erudoza.practice-room/1', manifest: history.manifest, summary }), revision: room.revision } });
        objects.push({ scope, outbox: null, rows: componentRows, plan: { root: JSON.stringify(authority.manifest), historyRoot: JSON.stringify(history.manifest), inventory: inventory(componentRows) } });
    }
    // Empty native Reports bookkeeping is admissible only after original operational history and award verification.
    const scopes = [...new Map(summaries.map(s => [JSON.stringify([s.orgId, s.seasonId]), s])).values()];
    for (const s of scopes) {
        const histories = summaries.filter(h => h.orgId === s.orgId && h.seasonId === s.seasonId), overlays = rows.filter(e => e.table === 'Records' && e.row.kind === 'pbe-result-overlay' && e.row.org_id === s.orgId).map(e => JSON.parse(e.row.data));
        const expected = calculateAwards(histories.map(h => overlayRoom(h, overlays.find(o => o.id === `Team:${h.id}`)))).filter(a => a.key.startsWith('pbe-team-v1:'));
        const actual = rows.filter(e => e.table === 'Records' && e.row.kind === 'award' && e.row.org_id === s.orgId && e.row.season_id === s.seasonId).map(e => JSON.parse(e.row.data)).filter(a => a.key.startsWith('pbe-team-v1:'));
        const sort = list => list.sort((a, b) => JSON.stringify([a.key, a.userId]).localeCompare(JSON.stringify([b.key, b.userId])));
        if (!isDeepStrictEqual(sort(actual), sort(expected)))
            block('canonical original PBE awards differ from verified history');
        const scope = { kind: 'reports', orgId: s.orgId, seasonId: s.seasonId };
        objects.push({ scope, outbox: null, rows: [], plan: { root: JSON.stringify([s.orgId, s.seasonId]), inventory: inventory([]) } });
    }
    return { rows, objects, mappingId: mapped.mappingId };
}
export async function exportCanonicalBundle(sourcePath, outputDirectory) {
    const snapshot = readCanonicalSnapshot(sourcePath), archives = canonicalArchives(snapshot), source = { kind: 'canonical-offline-sqlite', exhaustive: true, definitions: snapshot.definitions, primaryKeys: snapshot.primaryKeys, counts: Object.fromEntries(Object.entries(snapshot.tables).map(([t, rows]) => [t, rows.length])) };
    source.sourceHash = sha(JSON.stringify([source.definitions, source.primaryKeys, archives.map(a => [a.id, a.hash])]));
    const { rows, objects } = await mapCanonicalPlan(source, archives);
    return writeBundle(outputDirectory, { source, rows, objects, archives });
}
