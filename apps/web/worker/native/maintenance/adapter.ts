import { body, HttpError, json } from '../types';
import { contentHash, manifestRefs, parseNode, validateManifest, utf8Bytes, type RoomManifest, type ComponentRef } from '../practice/room-storage';
import { maintenanceOffline, MAINTENANCE_PREFIX, type MaintenanceScope, type MaintenanceIdentity, type MaintenanceEnvironment } from './protocol';
const MIB = 1048576;
export const MAINTENANCE_CAPS = { pageBytes: MIB, pageRows: 8, keyRows: 100, keyBytes: 65536, nodes: 2048, nodeBytes: 64 * MIB, decodedBytes: 8 * MIB, depth: 16, edges: 8192, reportsRows: 4096, reportsBytes: 16 * MIB } as const;
export interface MaintenanceRow {
    table: 'room_components' | 'room_uploaded' | 'publications' | 'verification';
    key: string;
    data: string | number | null;
}
interface Inventory {
    count: number;
    bytes: number;
    digest: string;
}
export interface MaintenancePlan {
    root: string | null;
    historyRoot?: string;
    inventory: Inventory;
}
interface Input {
    version: 1;
    identity: MaintenanceIdentity;
    scope: MaintenanceScope;
    plan?: MaintenancePlan;
    rows?: MaintenanceRow[];
    table?: MaintenanceRow['table'];
    after?: {
        scope: MaintenanceScope;
        generation: string;
        lastKey: string;
    } | null;
    historyRoot?: string;
}
interface Walk {
    root: number;
    ref: number;
    stack: {
        hash: string;
        path: string[];
    }[];
    pieces: string[];
    bytes: number;
    values: unknown[];
    edges: number;
    seen: string[];
    nodeBytes: number;
}
interface Progress {
    lastTable: string;
    lastKey: string;
    count: number;
    bytes: number;
    digest: string;
    inventoryDone: boolean;
    walk: Walk | null;
    verified: boolean;
    projectionDigest?: string;
}
interface Ticket {
    identity: MaintenanceIdentity;
    scope: MaintenanceScope;
    plan: MaintenancePlan;
}
function fail(message: string, status = 409): never { throw new HttpError(status, message); }
const exact = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function keys(value: unknown, want: string[]): void {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !exact(Object.keys(value).sort(), [...want].sort()))
        fail('Invalid fixed maintenance schema.', 400);
}
function opaque(value: unknown, max: number): void {
    if (typeof value !== 'string' || !value || utf8Bytes(value) > max || value.includes('\u0000'))
        fail('Invalid opaque identity.', 400);
}
function hash(value: unknown): void {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
        fail('Invalid content digest.', 400);
}
function bound(value: unknown, max: number): void {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
        fail('Invalid bounded integer.', 400);
    if (value > max)
        fail('Maintenance cap exceeded.', 413);
}
function validateIdentity(value: MaintenanceIdentity) {
    keys(value, ['bundleId', 'targetId', 'buildId', 'schemaId', 'mappingId', 'ticket']);
    for (const v of Object.values(value))
        opaque(v, 200);
}
function validateScope(value: MaintenanceScope, kind: MaintenanceScope['kind']) {
    keys(value, kind === 'room' ? ['kind', 'orgId', 'seasonId', 'id'] : ['kind', 'orgId', 'seasonId']);
    if (value.kind !== kind)
        fail('Wrong maintenance object kind.');
    opaque(value.orgId, 100);
    opaque(value.seasonId, 100);
    if (value.kind === 'room')
        opaque(value.id, 100);
}
function manifest(data: string, scope: MaintenanceScope): RoomManifest {
    if (typeof data !== 'string' || utf8Bytes(data) > 131072)
        fail('Manifest exceeds cap.', 413);
    const m = JSON.parse(data) as RoomManifest;
    validateManifest(m);
    if (scope.kind !== 'room' || m.id !== scope.id || m.orgId !== scope.orgId || m.seasonId !== scope.seasonId)
        fail('Manifest scope mismatch.');
    const refs = manifestRefs(m);
    if (refs.reduce((n, r) => n + r.bytes, 0) + 46 + [m.questions, m.reserves, m.submissions].reduce((n, group) => n + Math.max(0, group.length - 1), 0) > MAINTENANCE_CAPS.decodedBytes)
        fail('Decoded room preflight cap exceeded.', 413);
    return m;
}
function validatePlan(plan: MaintenancePlan, scope: MaintenanceScope) {
    keys(plan, scope.kind === 'room' ? ['root', 'historyRoot', 'inventory'] : ['root', 'inventory']);
    keys(plan.inventory, ['count', 'bytes', 'digest']);
    bound(plan.inventory.count, scope.kind === 'room' ? 2048 : 4096);
    bound(plan.inventory.bytes, 256 * MIB);
    hash(plan.inventory.digest);
    if (scope.kind === 'room') {
        const a = manifest(plan.root!, scope), h = manifest(plan.historyRoot!, scope);
        if (a.revision !== h.revision)
            fail('History revision mismatch.');
    }
    else if (plan.root !== JSON.stringify([scope.orgId, scope.seasonId]))
        fail('Reports scope mismatch.');
}
class Adapter {
    constructor(private storage: DurableObjectStorage, private scope: MaintenanceScope) { }
    private query<T extends Record<string, SqlStorageValue>>(sql: string, ...params: SqlStorageValue[]): T[] { return this.storage.sql.exec<T>(sql, ...params).toArray(); }
    private exists(table: string) { return this.query('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=?', table).length > 0; }
    private tableNames() { return this.scope.kind === 'room' ? ['room_components', 'room_uploaded'] as const : ['publications', 'verification'] as const; }
    private root() {
        const t = this.scope.kind === 'room' ? 'state' : 'scope';
        if (!this.exists(t))
            return null;
        return this.query<{
            data: string;
        }>(this.scope.kind === 'room' ? 'SELECT data FROM state WHERE id=1' : 'SELECT data FROM scope WHERE id=1')[0]?.data ?? null;
    }
    private drained() {
        if (this.scope.kind === 'room' && this.exists('outbox') && this.query('SELECT 1 FROM outbox LIMIT 1').length)
            fail('Room outbox is not drained.');
    }
    private rows(table: string, after: string, limit = 8): MaintenanceRow[] {
        if (!this.tableNames().includes(table as never))
            fail('Unsupported maintenance table.', 400);
        if (!this.exists(table))
            return [];
        if (table === 'room_components')
            return this.query<{
                key: string;
                data: string;
            }>('SELECT hash AS key,data FROM room_components WHERE hash>? ORDER BY hash LIMIT ?', after, limit).map(r => ({ table, key: r.key, data: r.data }));
        if (table === 'room_uploaded')
            return this.query<{
                key: string;
            }>('SELECT hash AS key FROM room_uploaded WHERE hash>? ORDER BY hash LIMIT ?', after, limit).map(r => ({ table, key: r.key, data: null }));
        if (table === 'publications')
            return this.query<{
                key: string;
                data: string;
            }>('SELECT root AS key,data FROM publications WHERE root>? ORDER BY root LIMIT ?', after, limit).map(r => ({ table, key: r.key, data: r.data }));
        return this.query<{
            key: string;
            data: number;
        }>('SELECT json_array(root,hash) AS key,done AS data FROM verification WHERE json_array(root,hash)>? ORDER BY json_array(root,hash) LIMIT ?', after, limit).map(r => ({ table: 'verification', key: r.key, data: r.data }));
    }
    private stats() {
        const tables: Record<string, {
            count: number;
            bytes: number;
        }> = {};
        for (const table of this.tableNames()) {
            if (!this.exists(table)) {
                tables[table] = { count: 0, bytes: 0 };
                continue;
            }
            const sql = table === 'room_components' ? 'SELECT count(*) AS count,coalesce(sum(length(CAST(data AS BLOB))),0) AS bytes FROM room_components' : table === 'room_uploaded' ? 'SELECT count(*) AS count,coalesce(sum(length(CAST(hash AS BLOB))),0) AS bytes FROM room_uploaded' : table === 'publications' ? 'SELECT count(*) AS count,coalesce(sum(length(CAST(root AS BLOB))+length(CAST(data AS BLOB))),0) AS bytes FROM publications' : 'SELECT count(*) AS count,coalesce(sum(length(CAST(root AS BLOB))+length(CAST(hash AS BLOB))+1),0) AS bytes FROM verification';
            tables[table] = this.query<{
                count: number;
                bytes: number;
            }>(sql)[0];
        }
        return tables;
    }
    private checkStats() {
        const s = this.stats();
        if (this.scope.kind === 'room') {
            bound(s.room_components.count + s.room_uploaded.count, 2048);
            bound(s.room_components.bytes, 64 * MIB);
            bound(s.room_uploaded.count, 2048);
        }
        else {
            bound(s.publications.count + s.verification.count, 4096);
            bound(s.publications.bytes + s.verification.bytes, 16 * MIB);
        }
        return s;
    }
    private ticket(): Ticket | null {
        return this.exists('maintenance_ticket') ? JSON.parse(this.query<{
            data: string;
        }>('SELECT data FROM maintenance_ticket WHERE id=1')[0]?.data ?? 'null') : null;
    }
    private progress(): Progress {
        const raw = JSON.parse(this.query<{
            data: string;
        }>('SELECT data FROM maintenance_progress WHERE id=1')[0].data) as Progress | {
            chunkCount: number;
            bytes: number;
        };
        if (!('chunkCount' in raw))
            return raw;
        const rows = this.query<{
            id: number;
            data: string;
        }>('SELECT id,data FROM maintenance_progress_parts ORDER BY id');
        if (rows.length !== raw.chunkCount || rows.some((r, i) => r.id !== i))
            fail('Incomplete private verification checkpoint.');
        const text = rows.map(r => r.data).join('');
        if (utf8Bytes(text) !== raw.bytes)
            fail('Corrupt private verification checkpoint.');
        return JSON.parse(text) as Progress;
    }
    private saveProgress(p: Progress) {
        // Progress is derived, private bookkeeping. Original component/root bytes are never rewritten.
        const bytes = new TextEncoder().encode(JSON.stringify(p)), decoder = new TextDecoder('utf-8', { fatal: true });
        const chunks: string[] = [];
        for (let offset = 0; offset < bytes.length;) {
            let end = Math.min(offset + 65536, bytes.length);
            while (end < bytes.length && (bytes[end] & 0xc0) === 0x80)
                end--;
            chunks.push(decoder.decode(bytes.subarray(offset, end)));
            offset = end;
        }
        this.storage.transactionSync(() => { for (let id = 0; id < chunks.length; id++) {
            const old = this.query<{
                data: string;
            }>('SELECT data FROM maintenance_progress_parts WHERE id=?', id)[0];
            if (old?.data !== chunks[id])
                this.query('INSERT INTO maintenance_progress_parts(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', id, chunks[id]);
        } this.query('DELETE FROM maintenance_progress_parts WHERE id>=?', chunks.length); this.query('UPDATE maintenance_progress SET data=? WHERE id=1', JSON.stringify({ chunkCount: chunks.length, bytes: bytes.length })); });
    }
    private receipt() {
        return this.exists('maintenance_receipt') ? JSON.parse(this.query<{
            data: string;
        }>('SELECT data FROM maintenance_receipt WHERE id=1')[0]?.data ?? 'null') : null;
    }
    private requireTicket(input: Input) {
        const t = this.ticket();
        if (!t || !exact(t.identity, input.identity) || !exact(t.scope, input.scope))
            fail('Maintenance ticket/scope conflict.');
        return t!;
    }
    private initialize() {
        this.query('CREATE TABLE IF NOT EXISTS maintenance_ticket(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL)');
        this.query('CREATE TABLE IF NOT EXISTS maintenance_progress(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL)');
        this.query('CREATE TABLE IF NOT EXISTS maintenance_progress_parts(id INTEGER PRIMARY KEY,data TEXT NOT NULL)');
        this.query('CREATE TABLE IF NOT EXISTS maintenance_receipt(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL)');
        if (this.scope.kind === 'room') {
            this.query('CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL)');
            this.query('CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL)');
            this.query('CREATE TABLE IF NOT EXISTS room_components(hash TEXT PRIMARY KEY,data TEXT NOT NULL)');
            this.query('CREATE TABLE IF NOT EXISTS room_uploaded(hash TEXT PRIMARY KEY)');
        }
        else {
            this.query('CREATE TABLE IF NOT EXISTS scope(id INTEGER PRIMARY KEY,data TEXT NOT NULL)');
            this.query('CREATE TABLE IF NOT EXISTS publications(root TEXT PRIMARY KEY,data TEXT NOT NULL)');
            this.query('CREATE TABLE IF NOT EXISTS verification(root TEXT,hash TEXT,done INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(root,hash))');
        }
    }
    private privatePayloadBytes() { let bytes = 0; const tables = [['maintenance_ticket', 'SELECT coalesce(sum(length(CAST(data AS BLOB))),0) AS bytes FROM maintenance_ticket'], ['maintenance_progress', 'SELECT coalesce(sum(length(CAST(data AS BLOB))),0) AS bytes FROM maintenance_progress'], ['maintenance_progress_parts', 'SELECT coalesce(sum(length(CAST(data AS BLOB))+length(CAST(id AS TEXT))),0) AS bytes FROM maintenance_progress_parts'], ['maintenance_receipt', 'SELECT coalesce(sum(length(CAST(data AS BLOB))),0) AS bytes FROM maintenance_receipt']] as const; for (const [table, sql] of tables)
        if (this.exists(table)) {
            const size = this.query<{
                bytes: number;
            }>(sql)[0].bytes;
            bytes += size + (table === 'maintenance_progress_parts' || size === 0 ? 0 : 1);
        } return bytes; }
    async inspect() {
        this.drained();
        const root = this.root(), tables = this.checkStats();
        if (root !== null) {
            if (this.scope.kind === 'room')
                manifest(root, this.scope);
            else if (root !== JSON.stringify([this.scope.orgId, this.scope.seasonId]))
                fail('Stored Reports scope mismatch.');
        }
        const privatePayloadBytes = this.privatePayloadBytes(), storedPayloadBytes = privatePayloadBytes + (root === null ? 0 : utf8Bytes(root) + 1) + (this.scope.kind === 'room' ? tables.room_components.count * 64 : 0) + Object.values(tables).reduce((n, t) => n + t.bytes, 0);
        bound(storedPayloadBytes, 256 * MIB);
        return { scope: this.scope, root, tables, privatePayloadBytes, storedPayloadBytes, generation: await contentHash(JSON.stringify({ scope: this.scope, root, tables })), receipt: this.receipt() };
    }
    async captureKeys(input: Input) {
        const snapshot = await this.inspect();
        const table = input.table!;
        if (!this.tableNames().includes(table as never))
            fail('Unsupported maintenance table.', 400);
        if (input.after) {
            keys(input.after, ['scope', 'generation', 'lastKey']);
            if (!exact(input.after.scope, this.scope) || input.after.generation !== snapshot.generation)
                fail('Stale inventory cursor.');
            opaque(input.after.lastKey, 256);
        }
        const after = input.after?.lastKey ?? '';
        let rows: {
            key: string;
            bytes: number;
        }[] = [];
        if (this.exists(table)) {
            const sql = table === 'room_components' ? 'SELECT hash AS key,length(CAST(data AS BLOB)) AS bytes FROM room_components WHERE hash>? ORDER BY hash LIMIT 100' : table === 'room_uploaded' ? 'SELECT hash AS key,0 AS bytes FROM room_uploaded WHERE hash>? ORDER BY hash LIMIT 100' : table === 'publications' ? 'SELECT root AS key,length(CAST(data AS BLOB)) AS bytes FROM publications WHERE root>? ORDER BY root LIMIT 100' : 'SELECT json_array(root,hash) AS key,1 AS bytes FROM verification WHERE json_array(root,hash)>? ORDER BY json_array(root,hash) LIMIT 100';
            rows = this.query<{
                key: string;
                bytes: number;
            }>(sql, after);
        }
        const output = { table, keys: rows, cursor: rows.length ? { scope: this.scope, generation: snapshot.generation, lastKey: rows.at(-1)!.key } : null };
        bound(utf8Bytes(JSON.stringify(output)), 65536);
        return output;
    }
    async capture(input: Input) {
        const snapshot = await this.inspect(), ticket = this.ticket();
        if (ticket)
            this.requireTicket(input);
        const root = snapshot.root ?? ticket?.plan.root ?? null;
        if (ticket && this.scope.kind === 'room' && input.historyRoot !== ticket.plan.historyRoot)
            fail('Pinned history root differs.');
        if (this.scope.kind === 'room') {
            if (!root)
                fail('Missing native authority.');
            const a = manifest(root!, this.scope), h = manifest(input.historyRoot!, this.scope);
            if (a.revision !== h.revision)
                fail('History revision mismatch.');
        }
        else if (root !== JSON.stringify([this.scope.orgId, this.scope.seasonId]))
            fail('Reports source scope mismatch.');
        if (input.after) {
            keys(input.after, ['scope', 'generation', 'lastKey']);
            if (!exact(input.after.scope, this.scope) || input.after.generation !== snapshot.generation)
                fail('Stale capture cursor.');
            opaque(input.after.lastKey, 256);
        }
        const candidates = this.rows(input.table!, input.after?.lastKey ?? '');
        const rows: MaintenanceRow[] = [];
        for (const row of candidates) {
            const response = { rows: [...rows, row], cursor: { scope: this.scope, generation: snapshot.generation, lastKey: row.key } };
            if (utf8Bytes(JSON.stringify(response)) > MIB) {
                if (!rows.length)
                    fail('Capture row exceeds envelope.', 413);
                break;
            }
            rows.push(row);
        }
        const last = rows.at(-1)?.key;
        return { rows, cursor: last ? { scope: this.scope, generation: snapshot.generation, lastKey: last } : null };
    }
    async begin(input: Input) {
        const plan = input.plan!;
        validatePlan(plan, this.scope);
        this.drained();
        const next: Ticket = { identity: input.identity, scope: input.scope, plan }, old = this.ticket();
        if (old) {
            if (!exact(old, next))
                fail('Existing maintenance ticket differs.');
            return { begun: true, receipt: this.receipt() };
        }
        if (this.root() !== null || Object.values(this.stats()).some(s => s.count))
            fail('Destination must be new or same-ticket staged.');
        const progress: Progress = { lastTable: this.tableNames()[0], lastKey: '', count: 0, bytes: 0, digest: await contentHash('erudoza-maintenance-inventory/1'), inventoryDone: false, walk: null, verified: false };
        this.storage.transactionSync(() => { this.initialize(); this.query('INSERT INTO maintenance_ticket(id,data) VALUES(1,?)', JSON.stringify(next)); this.query('INSERT INTO maintenance_progress(id,data) VALUES(1,?)', JSON.stringify(progress)); });
        return { begun: true, receipt: null };
    }
    private async validateRow(row: MaintenanceRow) {
        keys(row, ['table', 'key', 'data']);
        if (!this.tableNames().includes(row.table as never))
            fail('Unsupported maintenance table.', 400);
        if (row.table === 'room_components') {
            hash(row.key);
            if (typeof row.data !== 'string')
                fail('Invalid component payload.', 400);
            await parseNode(row.key, row.data as string);
        }
        else if (row.table === 'room_uploaded') {
            hash(row.key);
            if (row.data !== null)
                fail('Invalid upload identity.', 400);
        }
        else if (row.table === 'publications') {
            hash(row.key);
            if (typeof row.data !== 'string' || await contentHash(row.data) !== row.key)
                fail('Publication bytes/digest mismatch.');
            const p = JSON.parse(row.data as string) as {
                manifest: RoomManifest;
                summary: {
                    id: string;
                    orgId: string;
                    seasonId: string;
                    revision: number;
                    status: string;
                };
            };
            keys(p, ['manifest', 'summary']);
            const m = p.manifest;
            validateManifest(m);
            if ((p.summary as {
                summaryVersion?: number;
            }).summaryVersion !== 1 || m.orgId !== this.scope.orgId || m.seasonId !== this.scope.seasonId || p.summary.id !== m.id || p.summary.orgId !== m.orgId || p.summary.seasonId !== m.seasonId || p.summary.revision !== m.revision || !['Completed', 'Interrupted'].includes(p.summary.status))
                fail('Publication scope/terminal mismatch.');
        }
        else {
            opaque(row.key, 256);
            const pair = JSON.parse(row.key);
            if (!Array.isArray(pair) || pair.length !== 2 || JSON.stringify(pair) !== row.key)
                fail('Invalid verification identity.', 400);
            pair.forEach(hash);
            if (row.data !== 0 && row.data !== 1)
                fail('Invalid verification scalar.', 400);
        }
    }
    private existing(row: MaintenanceRow): MaintenanceRow | undefined { return this.readOne(row.table, row.key); }
    private readOne(table: MaintenanceRow['table'], key: string): MaintenanceRow | undefined {
        let rows: {
            data: string | number | null;
        }[];
        if (table === 'room_components')
            rows = this.query<{
                data: string;
            }>('SELECT data FROM room_components WHERE hash=?', key);
        else if (table === 'room_uploaded')
            rows = this.query<{
                data: null;
            }>('SELECT NULL AS data FROM room_uploaded WHERE hash=?', key);
        else if (table === 'publications')
            rows = this.query<{
                data: string;
            }>('SELECT data FROM publications WHERE root=?', key);
        else {
            const [root, hash] = JSON.parse(key);
            rows = this.query<{
                data: number;
            }>('SELECT done AS data FROM verification WHERE root=? AND hash=?', root, hash);
        }
        return rows[0] ? { table, key, data: rows[0].data } : undefined;
    }
    private insert(row: MaintenanceRow) {
        if (row.table === 'room_components')
            this.query('INSERT INTO room_components(hash,data) VALUES(?,?)', row.key, row.data);
        else if (row.table === 'room_uploaded')
            this.query('INSERT INTO room_uploaded(hash) VALUES(?)', row.key);
        else if (row.table === 'publications')
            this.query('INSERT INTO publications(root,data) VALUES(?,?)', row.key, row.data);
        else {
            const [root, hash] = JSON.parse(row.key);
            this.query('INSERT INTO verification(root,hash,done) VALUES(?,?,?)', root, hash, row.data);
        }
    }
    async stage(input: Input) {
        const t = this.requireTicket(input);
        this.drained();
        if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 8)
            fail('Stage must contain one to eight rows.', 413);
        for (const row of input.rows!)
            await this.validateRow(row);
        this.storage.transactionSync(() => {
            let changed = false;
            for (const row of input.rows!) {
                const old = this.existing(row);
                if (old) {
                    if (!exact(old, row))
                        fail('Immutable stored row conflict.');
                }
                else {
                    if (this.progress().inventoryDone || this.receipt())
                        fail('Verified inventory is sealed.');
                    this.insert(row);
                    changed = true;
                }
            }
            this.checkStats();
            if (changed) {
                const stats = this.stats();
                if (Object.values(stats).reduce((n, s) => n + s.count, 0) > t.plan.inventory.count)
                    fail('Inventory count exceeds pinned plan.');
            }
        });
        return { acknowledged: input.rows!.map(r => ({ table: r.table, key: r.key })) };
    }
    private validateDecoded(m: RoomManifest, values: unknown[], history: boolean) {
        const refs = manifestRefs(m);
        if (values.length !== refs.length)
            fail('Incomplete closure.');
        const metadata = values[0] as Record<string, unknown>;
        if (!metadata || metadata.id !== m.id || metadata.orgId !== m.orgId || metadata.seasonId !== m.seasonId || metadata.revision !== m.revision || metadata.format !== 'Pbe' || !['Completed', 'Interrupted'].includes(String(metadata.status)) || metadata.phaseEndsAt !== null)
            fail('Unsupported active, legacy or timed room authority.');
        if (!Array.isArray(metadata.messages) || !metadata.drafts || typeof metadata.drafts !== 'object' || !metadata.applied || typeof metadata.applied !== 'object')
            fail('Incomplete original authority metadata.');
        if (history && (metadata.messages.length || Object.keys(metadata.drafts).length || Object.keys(metadata.applied).length))
            fail('Invalid terminal projection metadata.');
        let i = 1;
        const questions = m.questions.map(ref => {
            const q = values[i++] as {
                id: string;
                version: number;
            };
            if (q.id !== ref.id || q.version !== ref.version)
                fail('Question reference mismatch.');
            return q;
        }), reserves = m.reserves.map(ref => {
            const q = values[i++] as {
                id: string;
                version: number;
            };
            if (q.id !== ref.id || q.version !== ref.version)
                fail('Reserve reference mismatch.');
            return q;
        }), submissions = m.submissions.map(ref => {
            const s = values[i++] as {
                questionId: string;
                team: number;
                attemptId?: string;
            };
            if (s.questionId !== ref.questionId || s.team !== ref.team || s.attemptId !== ref.attemptId)
                fail('Submission reference mismatch.');
            return s;
        });
        const room = { ...metadata, questions, reserves, submissions };
        bound(utf8Bytes(JSON.stringify(room)), 8 * MIB);
        return room;
    }
    private newWalk(root: number): Walk { return { root, ref: 0, stack: [], pieces: [], bytes: 0, values: [], edges: 0, seen: [], nodeBytes: 0 }; }
    private async walk(p: Progress, t: Ticket) {
        const w = p.walk ?? this.newWalk(0);
        p.walk = w;
        const m = manifest(w.root === 0 ? t.plan.root! : t.plan.historyRoot!, this.scope), refs = manifestRefs(m);
        let visited = 0;
        while (w.ref < refs.length && visited < 8) {
            const ref: ComponentRef = refs[w.ref];
            if (!w.stack.length && !w.pieces.length)
                w.stack.push({ hash: ref.hash, path: [] });
            while (w.stack.length && visited < 8) {
                const task = w.stack.pop()!;
                bound(task.path.length + 1, 16);
                if (task.path.includes(task.hash))
                    fail('Cyclic component closure.');
                bound(++w.edges, 8192);
                const row = this.readOne('room_components', task.hash);
                if (!row)
                    fail('Missing closure component.');
                const node = await parseNode(task.hash, row!.data as string);
                visited++;
                if (!w.seen.includes(task.hash)) {
                    w.seen.push(task.hash);
                    w.nodeBytes += utf8Bytes(row!.data as string);
                    bound(w.seen.length, 2048);
                    bound(w.nodeBytes, 64 * MIB);
                }
                if (node.type === 'leaf') {
                    w.bytes += utf8Bytes(node.data);
                    if (w.bytes > ref.bytes)
                        fail('Component length mismatch.');
                    w.pieces.push(node.data);
                }
                else {
                    const path = [...task.path, task.hash];
                    for (const hash of [...node.children].reverse())
                        w.stack.push({ hash, path });
                    if (w.edges + w.stack.length > 8192)
                        fail('Component traversal cap exceeded.', 413);
                }
            }
            if (!w.stack.length) {
                if (w.bytes !== ref.bytes)
                    fail('Component length mismatch.');
                w.values.push(JSON.parse(w.pieces.join('')));
                w.pieces = [];
                w.bytes = 0;
                w.ref++;
            }
        }
        if (w.ref === refs.length) {
            const decoded = this.validateDecoded(m, w.values, w.root === 1), projection = { ...decoded, messages: [], drafts: {}, applied: {} };
            const digest = await contentHash(JSON.stringify(projection));
            if (w.root === 0) {
                p.projectionDigest = digest;
                p.walk = this.newWalk(1);
            }
            else {
                if (p.projectionDigest !== digest)
                    fail('Authority and terminal history differ.');
                p.walk = null;
                p.verified = true;
            }
        }
    }
    async verify(input: Input) {
        const t = this.requireTicket(input);
        this.drained();
        const p = this.progress();
        if (p.verified)
            return { verified: true };
        if (!p.inventoryDone) {
            let budget = 8;
            const tables = this.tableNames();
            while (budget > 0) {
                const rows = this.rows(p.lastTable, p.lastKey, budget);
                for (const row of rows) {
                    await this.validateRow(row);
                    if (row.table === 'room_uploaded' && !this.readOne('room_components', row.key))
                        fail('Upload identity has no retained component.');
                    if (row.table === 'verification' && !this.readOne('publications', JSON.parse(row.key)[0]))
                        fail('Verification has no retained publication.');
                    p.count++;
                    p.bytes += utf8Bytes(JSON.stringify(row));
                    p.digest = await contentHash(p.digest + '\n' + JSON.stringify(row));
                    p.lastKey = row.key;
                    budget--;
                    if (p.count > t.plan.inventory.count || p.bytes > t.plan.inventory.bytes)
                        fail('Pinned inventory exceeded.');
                }
                if (rows.length === 0) {
                    const at = tables.indexOf(p.lastTable as never);
                    if (at + 1 === tables.length) {
                        if (!exact({ count: p.count, bytes: p.bytes, digest: p.digest }, t.plan.inventory))
                            fail('Complete inventory digest mismatch.');
                        p.inventoryDone = true;
                        break;
                    }
                    p.lastTable = tables[at + 1];
                    p.lastKey = '';
                }
                else
                    break;
            }
        }
        else if (this.scope.kind === 'room')
            await this.walk(p, t);
        else
            p.verified = true;
        this.saveProgress(p);
        return { verified: p.verified, phase: p.inventoryDone ? 'closure' : 'inventory' };
    }
    async commit(input: Input) {
        const t = this.requireTicket(input);
        this.drained();
        const old = this.receipt();
        if (old)
            return { receipt: old };
        if (!this.progress().verified)
            fail('Complete inventory and closures are not verified.');
        const receipt = { version: 1, identity: t.identity, scope: t.scope, rootDigest: await contentHash(t.plan.root!), historyDigest: t.plan.historyRoot ? await contentHash(t.plan.historyRoot) : null, inventory: t.plan.inventory };
        this.storage.transactionSync(() => {
            this.drained();
            if (this.root() !== null)
                fail('Root already exists without matching receipt.');
            if (this.scope.kind === 'room')
                this.query('INSERT INTO state(id,data) VALUES(1,?)', t.plan.root!);
            else
                this.query('INSERT INTO scope(id,data) VALUES(1,?)', t.plan.root!);
            this.query('INSERT INTO maintenance_receipt(id,data) VALUES(1,?)', JSON.stringify(receipt));
        });
        return { receipt };
    }
    async run(op: string, input: Input): Promise<unknown> {
        if (op === 'inspect')
            return input.table ? this.captureKeys(input) : this.inspect();
        if (op === 'capture')
            return this.capture(input);
        if (op === 'begin')
            return this.begin(input);
        if (op === 'stage')
            return this.stage(input);
        if (op === 'verify')
            return this.verify(input);
        if (op === 'commit')
            return this.commit(input);
        if (this.ticket())
            this.requireTicket(input);
        return { receipt: this.receipt() };
    }
}
const queues = new WeakMap<object, Promise<void>>();
export async function handleMaintenance(request: Request, storage: DurableObjectStorage, env: unknown, kind: MaintenanceScope['kind'], objectId: string): Promise<Response> {
    if (!maintenanceOffline(env))
        return new Response(null, { status: 404 });
    const path = new URL(request.url).pathname, op = path.slice(MAINTENANCE_PREFIX.length);
    if (request.method !== 'POST' || !path.startsWith(MAINTENANCE_PREFIX) || !['inspect', 'capture', 'begin', 'stage', 'verify', 'commit', 'receipt'].includes(op))
        return new Response(null, { status: 404 });
    try {
        const input = await body<Input>(request, MIB);
        const allowed = { inspect: ['table', 'after'], capture: ['table', 'after', 'historyRoot'], begin: ['plan'], stage: ['rows'], verify: [], commit: [], receipt: [] }[op]!;
        if (Object.keys(input).some(k => !['version', 'identity', 'scope', ...allowed].includes(k)))
            fail('Unknown maintenance field.', 400);
        if (input.version !== 1)
            fail('Unsupported maintenance version.', 400);
        validateIdentity(input.identity);
        validateScope(input.scope, kind);
        const configured = (env as MaintenanceEnvironment).NATIVE_MAINTENANCE_IDENTITY;
        if (typeof configured !== 'string')
            fail('Closed runtime identity is required.');
        const identity = JSON.parse(configured as string);
        validateIdentity(identity);
        if (!exact(input.identity, identity))
            fail('Closed runtime identity mismatch.');
        const binding = (env as {
            ROOMS?: DurableObjectNamespace;
            REPORTS?: DurableObjectNamespace;
        })[kind === 'room' ? 'ROOMS' : 'REPORTS'];
        const name = input.scope.kind === 'room' ? `${input.scope.orgId}:${input.scope.id}` : `${input.scope.orgId}:${input.scope.seasonId}`;
        if (!binding || binding.idFromName(name).toString() !== objectId)
            fail('Durable Object namespace identity mismatch.');
        const previous = queues.get(storage) ?? Promise.resolve();
        let release!: () => void;
        const pending = new Promise<void>(r => { release = r; });
        queues.set(storage, pending);
        await previous;
        try {
            const output = await new Adapter(storage, input.scope).run(op, input);
            if (utf8Bytes(JSON.stringify(output)) > MIB)
                fail('Response envelope exceeds cap.', 413);
            return json(output);
        }
        finally {
            release();
            if (queues.get(storage) === pending)
                queues.delete(storage);
        }
    }
    catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Maintenance failed.' }, error instanceof HttpError ? error.status : 400);
    }
}
