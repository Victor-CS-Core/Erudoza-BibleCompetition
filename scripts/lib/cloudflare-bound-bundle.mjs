import { isDeepStrictEqual } from 'node:util';
import { validatePbeGraph, validatePbeRoomGraph } from './cloudflare-pbe-graph.mjs';
import { validateNativePbeRecords } from './cloudflare-native-pbe-validation.mjs';
import { createHash } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CAPS = Object.freeze({ bundle: 512 * 1024 ** 2, d1Payload: 128 * 1024 ** 2, doPayload: 256 * 1024 ** 2, rows: 100000, row: 1000000, d1Body: 1500000, archive: 32 * 1024 ** 2, chunk: 65536, chunks: 512, doBody: 1024 ** 2, room: 8 * 1024 ** 2, nodes: 2048, nodeBytes: 64 * 1024 ** 2, reports: 4096, reportsBytes: 16 * 1024 ** 2, segmentRows: 1000, segmentBytes: 32 * 1024 ** 2 });
export const FORMAT = 'erudoza.bound-bundle/1';
export const MAPPING = 'native-byte-exact/1';
export async function mappingIdentity(kind = 'native-declared-stopped') {
    const names = ['scripts/cloudflare-export.mjs', 'scripts/lib/cloudflare-bound-bundle.mjs', 'scripts/lib/cloudflare-maintenance-local.mjs', 'scripts/lib/cloudflare-adapter-preflight.mjs', 'scripts/lib/cloudflare-pbe-graph.mjs', 'scripts/lib/cloudflare-native-pbe-validation.mjs'];
    if (kind === 'canonical-offline-sqlite')
        names.push('scripts/lib/cloudflare-canonical-bundle.mjs', 'scripts/lib/cloudflare-pbe-mapping.mjs', 'scripts/lib/cloudflare-pbe-chapter-mapping.mjs');
    const hashes = [];
    for (const name of names)
        hashes.push([name, sha(await readFile(resolve(ROOT, name)))]);
    return (kind === 'canonical-offline-sqlite' ? 'canonical-to-native/1' : MAPPING) + ':' + sha(JSON.stringify(hashes));
}
export const sha = value => createHash('sha256').update(value).digest('hex');
export const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));
export const block = message => { throw new Error(`Restore blocked: ${message}`); };
// Size-only seam shared by real admission paths; callers supply measured serialized bytes.
export function checkedPayloadSum(limit, message, ...sizes) {
    let total = 0;
    for (const size of sizes) {
        if (!Number.isSafeInteger(size) || size < 0)
            block('invalid payload accounting');
        if (size > limit - total)
            block(message);
        total += size;
    }
    return total;
}
export function checkD1RetainedComponents(components) {
    if (components.length > CAPS.nodes)
        block('D1 retained component cap');
    checkedPayloadSum(CAPS.nodeBytes, 'D1 retained component cap', ...components.map(e => bytes(e.row.data)));
}
const exactKeys = (o, keys) => {
    if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).sort().join('\0') !== [...keys].sort().join('\0'))
        block('unexpected columns/fields');
};
const scalar = value => {
    if (value === null)
        return ['null'];
    if (typeof value === 'string')
        return ['text', value];
    if (typeof value === 'bigint')
        return ['integer', value.toString()];
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (Number.isInteger(value) && !Number.isSafeInteger(value))
            block('unsafe source integer');
        return [Number.isInteger(value) ? 'integer' : 'real', String(value)];
    }
    if (value instanceof Uint8Array)
        return ['blob', Buffer.from(value).toString('base64')];
    block('unsupported source scalar');
};
const unscalar = ([type, value]) => {
    if (type === 'null')
        return null;
    if (type === 'text')
        return value;
    if (type === 'integer') {
        const n = BigInt(value);
        return n <= BigInt(Number.MAX_SAFE_INTEGER) && n >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(n) : n;
    }
    if (type === 'real')
        return Number(value);
    if (type === 'blob')
        return Buffer.from(value, 'base64');
    block('archive scalar type');
};
export function archiveRow(table, primaryKey, row) {
    if (typeof table !== 'string' || !primaryKey.length || primaryKey.some(k => !Object.hasOwn(row, k)))
        block('archive primary key');
    const identity = [table, primaryKey.map(k => [k, scalar(row[k])])];
    const raw = Buffer.from(JSON.stringify(Object.entries(row).map(([key, value]) => [key, scalar(value)])));
    if (raw.length > CAPS.archive)
        block('archive exceeds 32 MiB');
    const chunks = [];
    for (let offset = 0; offset < raw.length; offset += CAPS.chunk) {
        const chunk = raw.subarray(offset, offset + CAPS.chunk);
        chunks.push({ ordinal: chunks.length, length: chunk.length, hash: sha(chunk), data: chunk.toString('base64') });
    }
    if (chunks.length > CAPS.chunks)
        block('archive chunk count');
    return { id: sha(JSON.stringify(identity)), identity, length: raw.length, hash: sha(raw), chunks };
}
export function reassembleArchive(archive) {
    if (!Number.isSafeInteger(archive.length) || archive.length < 0 || archive.length > CAPS.archive || !Array.isArray(archive.chunks) || archive.chunks.length > CAPS.chunks)
        block('archive bounds');
    const pieces = archive.chunks.map((c, i) => {
        const data = Buffer.from(c.data, 'base64');
        if (c.ordinal !== i || data.length !== c.length || data.length > CAPS.chunk || sha(data) !== c.hash || data.toString('base64') !== c.data)
            block('archive chunk mismatch');
        return data;
    });
    const raw = Buffer.concat(pieces);
    if (raw.length !== archive.length || sha(raw) !== archive.hash || sha(JSON.stringify(archive.identity)) !== archive.id)
        block('archive hash/identity mismatch');
    const row = Object.fromEntries(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)).map(([k, v]) => [k, unscalar(v)]));
    if (JSON.stringify(archive.identity[1]) !== JSON.stringify(archive.identity[1].map(([k]) => [k, scalar(row[k])])))
        block('archive primary key differs');
    return row;
}
// This allowlist is the complete native schema through migration 0007. No caller SQL or column names become executable code.
export const TABLES = Object.freeze({
    Organizations: { columns: 'id name slug', pk: 'id' },
    Users: { columns: 'id org_id user_name email display_name kind role password_hash credential_version active', pk: 'id' },
    Sessions: { columns: 'token_hash user_id credential_version expires_at', pk: 'token_hash' },
    LoginLimits: { columns: 'key window attempts', pk: 'key' },
    Records: { columns: 'kind id org_id season_id owner_id data revision', pk: 'kind id org_id' },
    AuthBudgets: { columns: 'key window attempts expires_at', pk: 'key' },
    CoachInvitations: { columns: 'id org_id email inviter_id token_hash version status delivered created_at expires_at accepted_user_id', pk: 'id' },
    AuthChallenges: { columns: 'id purpose email code_digest user_id credential_version invitation_id invitation_version created_at expires_at attempts delivered consumed_at claim_nonce', pk: 'id' },
    PracticeRoomComponents: { columns: 'org_id season_id room_id hash data', pk: 'org_id season_id room_id hash' },
    MaintenanceArchives: { columns: 'id ordinal identity length hash whole_length whole_hash data', pk: 'id ordinal' },
});
for (const spec of Object.values(TABLES)) {
    spec.columns = spec.columns.split(' ');
    spec.pk = spec.pk.split(' ');
    Object.freeze(spec.columns);
    Object.freeze(spec.pk);
    Object.freeze(spec);
}
export function rowOperation(table, row, read = false) {
    const spec = TABLES[table];
    if (!spec)
        block('unknown target table');
    exactKeys(row, spec.columns);
    const params = spec.columns.map(k => {
        const v = row[k];
        if (typeof v === 'number' && !Number.isSafeInteger(v))
            block('non-lossless integer binding');
        if (v !== null && typeof v !== 'string' && typeof v !== 'number')
            block('unsupported bound scalar');
        if (Buffer.byteLength(JSON.stringify(v)) > CAPS.row)
            block('operational value cap');
        return v;
    });
    const payload = params.reduce((n, v) => n + Buffer.byteLength(JSON.stringify(v)), 4096);
    if (payload > CAPS.row)
        block('operational row cap');
    const sql = read ? `SELECT ${spec.columns.join(',')} FROM ${table} WHERE ${spec.pk.map(k => `${k}=?`).join(' AND ')}` : `INSERT INTO ${table} (${spec.columns.join(',')}) VALUES (${spec.columns.map(() => '?').join(',')}) ON CONFLICT (${spec.pk.join(',')}) DO NOTHING`;
    const bindings = read ? spec.pk.map(k => row[k]) : params;
    const body = JSON.stringify({ sql, params: bindings });
    if (bytes(sql) > 100000 || bindings.length > 100 || bytes(body) > CAPS.d1Body)
        block('D1 statement/parameter/body cap');
    return { sql, params: bindings, body, payload };
}
export async function migrations() {
    const dir = resolve(ROOT, 'apps/web/migrations'), names = (await readdir(dir)).filter(n => /^\d{4}_.*\.sql$/.test(n)).sort();
    const list = [];
    for (const name of names) {
        const sql = await readFile(resolve(dir, name), 'utf8');
        list.push({ name, sql, hash: sha(sql) });
    }
    return { list, id: sha(JSON.stringify(list.map(({ name, hash }) => [name, hash]))) };
}
export function inventory(rows) {
    let digest = sha('erudoza-maintenance-inventory/1'), total = 0;
    let last = null;
    for (const row of rows) {
        exactKeys(row, ['table', 'key', 'data']);
        const key = Buffer.from(row.table + '\0' + row.key);
        if (last && Buffer.compare(last, key) >= 0)
            block('inventory order/duplicate');
        last = key;
        const json = JSON.stringify(row);
        total += bytes(json);
        digest = sha(digest + '\n' + json);
    }
    return { count: rows.length, bytes: total, digest };
}
export function checkScope(scope) {
    exactKeys(scope, scope?.kind === 'room' ? ['kind', 'orgId', 'seasonId', 'id'] : ['kind', 'orgId', 'seasonId']);
    if (!['room', 'reports'].includes(scope.kind) || Object.entries(scope).some(([k, v]) => k !== 'kind' && (typeof v !== 'string' || !v || v.includes('\u0000') || bytes(v) > 100)))
        block('unknown namespace/scope');
}
function archiveTargetRows(a) { return a.chunks.map(c => ({ table: 'MaintenanceArchives', row: { id: a.id, ordinal: c.ordinal, identity: JSON.stringify(a.identity), length: c.length, hash: c.hash, whole_length: a.length, whole_hash: a.hash, data: c.data } })); }
export async function verifyRoomRoot(root, scope, rows) {
    if (typeof root !== 'string' || bytes(root) > 128 * 1024)
        block('room manifest cap');
    const m = JSON.parse(root), refs = [m.metadata, ...(m.questions ?? []), ...(m.reserves ?? []), ...(m.submissions ?? [])];
    if (m.format !== 'erudoza.practice-room/1' || m.id !== scope.id || m.orgId !== scope.orgId || m.seasonId !== scope.seasonId || !Number.isSafeInteger(m.revision) || m.revision < 0 || !Array.isArray(m.questions) || m.questions.length > 90 || !Array.isArray(m.reserves) || m.reserves.length > 1 || !Array.isArray(m.submissions) || m.submissions.length > 180)
        block('room manifest identity');
    if (new Set(m.questions.map(q => q.id)).size !== m.questions.length || m.submissions.some(s => !m.questions.some(q => q.id === s.questionId)) || new Set(m.submissions.map(s => JSON.stringify([s.questionId, s.team]))).size !== m.submissions.length)
        block('manifest duplicate/missing question');
    if (refs.some(r => !r || !Number.isSafeInteger(r.bytes) || r.bytes < 0) || refs.reduce((n, r) => n + r.bytes, 0) + 46 + [m.questions, m.reserves, m.submissions].reduce((n, g) => n + Math.max(0, g.length - 1), 0) > CAPS.room)
        block('decoded room precheck');
    const nodes = new Map(rows.filter(r => r.table === 'room_components').map(r => [r.key, r.data]));
    let edges = 0, total = 0;
    const unique = new Set();
    const read = ref => {
        const pieces = [];
        let length = 0;
        const active = new Set();
        const visit = (hash, depth) => {
            if (depth > 16 || ++edges > 8192 || active.has(hash))
                block('room closure depth/edges/cycle');
            const data = nodes.get(hash);
            if (typeof data !== 'string' || sha(data) !== hash || bytes(data) >= CAPS.doBody)
                block('room node hash/size');
            if (!unique.has(hash)) {
                unique.add(hash);
                total += bytes(data);
                if (unique.size > CAPS.nodes || total > CAPS.nodeBytes)
                    block('room closure cap');
            }
            active.add(hash);
            const n = JSON.parse(data);
            if (n.nodeVersion !== 1)
                block('room node version');
            if (n.type === 'leaf') {
                if (typeof n.data !== 'string' || bytes(n.data) > 128 * 1024)
                    block('room leaf cap');
                length += bytes(n.data);
                if (length > ref.bytes)
                    block('room ref length');
                pieces.push(n.data);
            }
            else if (n.type === 'branch' && Array.isArray(n.children) && n.children.length && n.children.length <= 256) {
                for (const child of n.children)
                    visit(child, depth + 1);
            }
            else
                block('room node shape');
            active.delete(hash);
        };
        visit(ref.hash, 0);
        if (length !== ref.bytes)
            block('room ref length');
        return JSON.parse(pieces.join(''));
    };
    const metadata = read(m.metadata), questions = m.questions.map(read), reserves = m.reserves.map(read), submissions = m.submissions.map(read), r = { ...metadata, questions, reserves, submissions };
    for (const [refs, values] of [[m.questions, questions], [m.reserves, reserves]])
        for (let i = 0; i < refs.length; i++)
            if (refs[i].id !== values[i].id || refs[i].version !== values[i].version)
                block('question identity');
    for (let i = 0; i < m.submissions.length; i++)
        if (['questionId', 'team', 'attemptId'].some(k => m.submissions[i][k] !== submissions[i][k]))
            block('submission identity');
    if (!Array.isArray(r.messages) || !r.drafts || typeof r.drafts !== 'object' || !r.applied || typeof r.applied !== 'object')
        block('incomplete authority metadata');
    if (r.id !== scope.id || r.orgId !== scope.orgId || r.seasonId !== scope.seasonId || r.revision !== m.revision || r.format !== 'Pbe' || !['Completed', 'Interrupted'].includes(r.status) || r.phaseEndsAt !== null)
        block('unsupported active/legacy room authority');
    if (bytes(r) > CAPS.room)
        block('decoded room cap');
    return r;
}
async function validateObjects(objects, d1, mappingId, schemaId) {
    if (!Array.isArray(objects) || objects.filter(o => o.scope.kind === 'room').length > 4 || objects.filter(o => o.scope.kind === 'reports').length > 4)
        block('room/reports scope cap');
    for (const e of d1.filter(e => e.table === 'PracticeRoomComponents'))
        if (!objects.some(o => o.scope.kind === 'room' && o.scope.orgId === e.row.org_id && o.scope.seasonId === e.row.season_id && o.scope.id === e.row.room_id))
            block('D1 retained node has no declared Room authority');
    for (const e of d1.filter(e => e.table === 'Records' && e.row.kind === 'match')) {
        if (!objects.some(o => o.scope.kind === 'room' && o.scope.orgId === e.row.org_id && o.scope.id === e.row.id))
            block('match has no full authority inventory');
    }
    for (const o of objects.filter(o => o.scope.kind === 'room'))
        if (!objects.some(r => r.scope.kind === 'reports' && r.scope.orgId === o.scope.orgId && r.scope.seasonId === o.scope.seasonId))
            block('missing Reports scope inventory');
    const seen = new Set();
    let payload = 0, peak = 0;
    for (const o of objects) {
        checkScope(o.scope);
        const key = JSON.stringify(o.scope);
        if (seen.has(key))
            block('duplicate namespace');
        seen.add(key);
        if (o.outbox !== null)
            block('undrained outbox');
        if (JSON.stringify(inventory(o.rows)) !== JSON.stringify(o.plan.inventory))
            block('inventory seal');
        const room = o.scope.kind === 'room';
        exactKeys(o, ['scope', 'outbox', 'rows', 'plan']);
        exactKeys(o.plan, room ? ['root', 'historyRoot', 'inventory'] : ['root', 'inventory']);
        if (o.rows.length > (room ? CAPS.nodes : CAPS.reports))
            block('retained count cap');
        let raw = 0;
        for (const row of o.rows) {
            if (row.table !== 'verification' && !/^[0-9a-f]{64}$/.test(row.key))
                block('invalid node identity');
            if (row.table === 'room_uploaded' && row.data !== null)
                block('invalid uploaded scalar');
            if (row.table === 'room_components') {
                const n = JSON.parse(row.data);
                if (bytes(row.data) >= CAPS.doBody || n.nodeVersion !== 1 || !(n.type === 'leaf' && typeof n.data === 'string' && bytes(n.data) <= 128 * 1024 || n.type === 'branch' && Array.isArray(n.children) && n.children.length > 0 && n.children.length <= 256 && n.children.every(k => /^[0-9a-f]{64}$/.test(k))))
                    block('invalid retained node');
            }
            if (!(room ? ['room_components', 'room_uploaded'] : ['publications', 'verification']).includes(row.table))
                block('unknown inventory table');
            raw += row.table === 'room_components' ? bytes(row.data) : row.table === 'room_uploaded' ? 0 : row.table === 'publications' ? bytes(row.key) + bytes(row.data) : JSON.parse(row.key).reduce((n, k) => n + bytes(k), 1);
            if (bytes({ version: 1, identity: { bundleId: '0'.repeat(64), targetId: '0'.repeat(64), buildId: '0'.repeat(64), schemaId, mappingId, ticket: '0'.repeat(64) }, scope: o.scope, rows: [row] }) > CAPS.doBody)
                block('node capture/stage body cap');
            if (row.table === 'room_components' || row.table === 'publications') {
                if (typeof row.data !== 'string' || sha(row.data) !== row.key)
                    block('node/publication digest');
            }
        }
        if (raw > (room ? CAPS.nodeBytes : CAPS.reportsBytes))
            block('retained payload cap');
        if (room) {
            let authority = await verifyRoomRoot(o.plan.root, o.scope, o.rows);
            validatePbeRoomGraph(authority, d1);
            const authoritySummary = summarize(authority), authorityRevision = authority.revision, historyExpected = sha(JSON.stringify({ ...authority, messages: [], drafts: {}, applied: {} }));
            authority = null;
            let history = await verifyRoomRoot(o.plan.historyRoot, o.scope, o.rows);
            if (historyExpected !== sha(JSON.stringify(history)))
                block('history differs from full authority');
            history = null;
            const match = d1.find(e => e.table === 'Records' && e.row.kind === 'match' && e.row.id === o.scope.id && e.row.org_id === o.scope.orgId);
            if (!match)
                block('missing original match envelope');
            const envelope = JSON.parse(match.row.data);
            if (JSON.stringify(envelope.manifest) !== o.plan.historyRoot || match.row.revision !== authorityRevision || match.row.season_id !== o.scope.seasonId)
                block('original match history root differs');
            const summary = authoritySummary;
            if (!isDeepStrictEqual(envelope.summary, summary))
                block('original match summary differs');
            const components = d1.filter(e => e.table === 'PracticeRoomComponents' && e.row.org_id === o.scope.orgId && e.row.season_id === o.scope.seasonId && e.row.room_id === o.scope.id);
            checkD1RetainedComponents(components);
            await verifyRoomRoot(o.plan.historyRoot, o.scope, components.map(e => ({ table: 'room_components', key: e.row.hash, data: e.row.data })));
            for (const uploaded of o.rows.filter(r => r.table === 'room_uploaded'))
                if (!components.some(e => e.row.hash === uploaded.key && e.row.data === o.rows.find(r => r.table === 'room_components' && r.key === uploaded.key)?.data))
                    block('uploaded flag lacks exact D1 readback');
        }
        else {
            if (o.plan.root !== JSON.stringify([o.scope.orgId, o.scope.seasonId]))
                block('Reports scope root');
            for (const publication of o.rows.filter(r => r.table === 'publications')) {
                const p = JSON.parse(publication.data);
                exactKeys(p, ['manifest', 'summary']);
                const scope = { kind: 'room', orgId: o.scope.orgId, seasonId: o.scope.seasonId, id: p.manifest.id };
                const components = d1.filter(e => e.table === 'PracticeRoomComponents' && e.row.org_id === scope.orgId && e.row.season_id === scope.seasonId && e.row.room_id === scope.id).map(e => ({ table: 'room_components', key: e.row.hash, data: e.row.data }));
                const history = await verifyRoomRoot(JSON.stringify(p.manifest), scope, components);
                if (!isDeepStrictEqual(p.summary, summarize(history)))
                    block('Reports publication summary differs');
            }
            for (const verification of o.rows.filter(r => r.table === 'verification')) {
                const pair = JSON.parse(verification.key);
                if (!Array.isArray(pair) || pair.length !== 2 || JSON.stringify(pair) !== verification.key || pair.some(k => typeof k !== 'string' || !/^[0-9a-f]{64}$/.test(k)))
                    block('invalid verification identity');
                const [root, hash] = pair;
                if (![0, 1].includes(verification.data) || !o.rows.some(r => r.table === 'publications' && r.key === root) || !d1.some(e => e.table === 'PracticeRoomComponents' && e.row.org_id === o.scope.orgId && e.row.season_id === o.scope.seasonId && e.row.hash === hash))
                    block('Reports flag lacks original publication/node');
            }
        }
    }
    for (const o of objects) {
        const { preflightAdapterObject } = await import('./cloudflare-adapter-preflight.mjs');
        const measured = await preflightAdapterObject(o, mappingId, schemaId);
        peak = Math.max(peak, checkedPayloadSum(CAPS.doPayload, 'aggregate DO payload cap', payload, measured.peak));
        payload = checkedPayloadSum(CAPS.doPayload, 'aggregate DO payload cap', payload, measured.final);
    }
    return peak;
}
const RECORD_KINDS = new Set(('audit pack source season scope assignment membership session card attempt mastery review practice-setting question room match award practice-projection-guard library-version training-preferences training-day training-week daily-mission daily-mission-head training-season-progress solo-badge-award mastery-honor mastery-proof user-profile pbe-attempt pbe-attempt-review pbe-chapter-manifest pbe-chapter-projection pbe-chapter-stamp pbe-chapter-stamp-proof pbe-chapter-work pbe-daily-mission pbe-daily-mission-head pbe-dispute pbe-dispute-correction pbe-dispute-pending pbe-evidence-dirty pbe-evidence-index pbe-evidence-ref pbe-evidence-replay pbe-grade-adjustment pbe-introduction pbe-introduction-assignment pbe-question pbe-question-head pbe-question-service pbe-recall-event pbe-recall-sequence pbe-result-overlay pbe-service-event pbe-room-service-event pbe-session pbe-session-start pbe-solo-interruption pbe-target pbe-target-review pbe-target-service').split(' '));
const checkRecord = row => {
    if (!RECORD_KINDS.has(row.kind))
        block('unknown native record mapping ' + row.kind);
    const data = JSON.parse(row.data);
    if (row.kind === 'audit') {
        if (row.season_id !== null || row.owner_id !== null || row.revision !== 1 || !data || typeof data !== 'object' || Array.isArray(data))
            block('native audit envelope');
        const keys = Object.keys(data);
        if (keys.length) {
            if (keys.length === 2) {
                exactKeys(data, ['id', 'action']);
                if (!['pbe.scope.accept', 'pbe.chapter.inputs', 'pbe.chapter.witnesses'].includes(data.action))
                    block('unknown native audit guard action');
            }
            else {
                exactKeys(data, ['id', 'actorId', 'action', 'createdAtUtc']);
                if (typeof data.actorId !== 'string' || !data.actorId || typeof data.action !== 'string' || !data.action || typeof data.createdAtUtc !== 'string' || !Number.isFinite(Date.parse(data.createdAtUtc)) || new Date(data.createdAtUtc).toISOString() !== data.createdAtUtc)
                    block('native audit event fields');
            }
            if (data.id !== row.id)
                block('native audit identity');
        }
    }
    if (row.kind === 'pbe-timed-authority' || row.kind === 'pbe-session' && data.mode === 'Simulation')
        block('unsupported timed Solo authority');
    if (row.kind.startsWith('pbe-cooperation-'))
        block('D2 mapping release required');
};
export async function validatePlan(plan) {
    if (plan.format !== FORMAT || plan.mappingId !== await mappingIdentity(plan.source?.kind))
        block('unknown bundle format/mapping');
    const canonical = plan.source?.kind === 'canonical-offline-sqlite';
    if (!canonical) {
        if (plan.source?.kind !== 'native-declared-stopped' || plan.source.exhaustive !== true || plan.source.stopped !== true || !['selected-scope', 'whole-local'].includes(plan.source.scope) || !Array.isArray(plan.source.namespaces))
            block('incomplete native namespace inventory');
        if (JSON.stringify(plan.source.namespaces) !== JSON.stringify(plan.objects.map(o => o.scope)))
            block('declared namespace inventory differs');
    }
    const schemas = await migrations();
    if (plan.schemaId !== schemas.id)
        block('schema digest changed');
    if (plan.rows.length > CAPS.rows)
        block('target row count cap');
    let payload = 0;
    const ids = new Set();
    const db = new DatabaseSync(':memory:');
    try {
        for (const m of schemas.list)
            db.exec(m.sql);
        for (const { table, row } of plan.rows) {
            const op = rowOperation(table, row);
            payload = checkedPayloadSum(CAPS.d1Payload, 'planned D1 payload cap', payload, op.payload);
            const id = JSON.stringify([table, TABLES[table].pk.map(k => row[k])]);
            if (ids.has(id))
                block('duplicate target identity');
            ids.add(id);
            if (table === 'Records') {
                if (!Number.isSafeInteger(row.revision) || row.revision < 1)
                    block('record revision');
                checkRecord(row);
            }
            db.prepare(op.sql).run(...op.params);
        }
        if (db.prepare('PRAGMA foreign_key_check').all().length)
            block('foreign key violation');
        if (!canonical && plan.source.schemaInventory !== undefined) {
            if (!Array.isArray(plan.source.schemaInventory))
                block('native source schema inventory');
            const tables = new Set();
            for (const table of plan.source.schemaInventory) {
                exactKeys(table, ['name', 'sql', 'columns', 'rows']);
                if (tables.has(table.name) || (!TABLES[table.name] && table.name !== 'MaintenanceReceipt'))
                    block('native source schema inventory table');
                tables.add(table.name);
                if (typeof table.sql !== 'string' || !Array.isArray(table.columns) || !Number.isSafeInteger(table.rows) || table.rows < 0)
                    block('native source schema inventory fields');
                if (table.name === 'MaintenanceReceipt' || table.name === 'MaintenanceArchives') {
                    const expectedSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table.name).sql;
                    const columns = db.prepare(`PRAGMA table_info(${table.name})`).all().map(row => ({ ...row }));
                    if (table.rows !== 0 || table.sql !== expectedSql || !isDeepStrictEqual(table.columns, columns))
                        block('source management schema/count differs');
                }
                if (plan.archives.filter(a => a.identity[0] === table.name).length !== table.rows)
                    block('source schema archive row count differs');
            }
            if (plan.archives.some(a => !tables.has(a.identity[0])))
                block('source archive table absent from schema inventory');
            for (const table of ['Organizations', 'Users', 'Records', 'PracticeRoomComponents'])
                if (!tables.has(table))
                    block('incomplete source schema inventory');
        }
    }
    finally {
        db.close();
    }
    if (payload > CAPS.d1Payload)
        block('planned D1 payload cap');
    const original = new Map();
    for (const a of plan.archives) {
        const row = reassembleArchive(a);
        if (original.has(a.id))
            block('duplicate archive identity');
        original.set(a.id, { table: a.identity[0], row });
    }
    if (canonical) {
        const { mapCanonicalPlan } = await import('./cloudflare-canonical-bundle.mjs');
        const mapped = await mapCanonicalPlan(plan.source, plan.archives);
        if (!isDeepStrictEqual(mapped.rows, plan.rows.filter(e => e.table !== 'MaintenanceArchives')) || !isDeepStrictEqual(mapped.objects, plan.objects))
            block('canonical operational mapping differs from original archives');
    }
    else {
        for (const e of plan.rows.filter(e => e.table !== 'MaintenanceArchives')) {
            const id = archiveRow(e.table, TABLES[e.table].pk, e.row).id, a = original.get(id);
            if (!a || !isDeepStrictEqual(a.row, e.row))
                block('missing or differing original operational archive');
            original.delete(id);
        }
        if (original.size)
            block('source archive omitted from operational mapping');
    }
    const expected = plan.archives.flatMap(archiveTargetRows), actual = plan.rows.filter(r => r.table === 'MaintenanceArchives');
    if (JSON.stringify(expected) !== JSON.stringify(actual))
        block('archive target rows differ');
    validateNativePbeRecords(plan.rows.filter(e => e.table === 'Records').map(e => e.row));
    validatePbeGraph(plan.rows);
    const doPayload = await validateObjects(plan.objects, plan.rows, plan.mappingId, plan.schemaId);
    return { rows: plan.rows.length, d1Payload: payload, doPayload };
}
export async function writeBundle(directory, { source, rows, objects, archives }) {
    const schemas = await migrations();
    const plan = { format: FORMAT, mappingId: await mappingIdentity(source.kind), schemaId: schemas.id, source, rows: [...rows, ...archives.flatMap(archiveTargetRows)], objects, archives };
    const metrics = await validatePlan(plan);
    const data = JSON.stringify(plan);
    checkedPayloadSum(CAPS.bundle, 'bundle file cap', bytes(data));
    const manifest = { format: FORMAT, plan: { file: 'plan.json', length: bytes(data), hash: sha(data) }, bundleId: sha(data), metrics };
    const manifestText = JSON.stringify(manifest);
    checkedPayloadSum(CAPS.bundle, 'bundle file cap', bytes(data), bytes(manifestText));
    await mkdir(directory, { mode: 0o700 });
    await writeFile(resolve(directory, 'plan.json'), data, { flag: 'wx', mode: 0o600 });
    await writeFile(resolve(directory, 'manifest.json'), manifestText, { flag: 'wx', mode: 0o600 });
    return manifest;
}
async function checkedFile(path, limit) {
    const s = await lstat(path);
    if (!s.isFile() || s.isSymbolicLink() || s.size > limit)
        block('file type/byte cap');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path))
        hash.update(chunk);
    return { size: s.size, hash: hash.digest('hex') };
}
export async function preflightBundle(directory) {
    const dir = resolve(directory);
    await checkedFile(resolve(dir, 'manifest.json'), 65536);
    const manifest = JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8'));
    if (manifest.format !== FORMAT)
        block('unknown bundle format');
    exactKeys(manifest, ['format', 'plan', 'bundleId', 'metrics']);
    if (manifest.plan.file !== 'plan.json')
        block('unexpected plan filename');
    const names = (await readdir(dir)).sort();
    if (JSON.stringify(names) !== JSON.stringify(['manifest.json', 'plan.json']))
        block('unaccounted bundle file');
    const file = await checkedFile(resolve(dir, 'plan.json'), CAPS.bundle);
    if (file.size !== manifest.plan.length || file.hash !== manifest.plan.hash || file.hash !== manifest.bundleId)
        block('bundle file hash/length');
    checkedPayloadSum(CAPS.bundle, 'whole bundle cap', file.size, (await lstat(resolve(dir, 'manifest.json'))).size);
    const planText = await readFile(resolve(dir, 'plan.json'), 'utf8');
    if (sha(planText) !== manifest.bundleId)
        block('bundle changed while reading');
    const plan = JSON.parse(planText);
    const metrics = await validatePlan(plan);
    if (JSON.stringify(metrics) !== JSON.stringify(manifest.metrics))
        block('bundle metric mismatch');
    return { manifest, plan };
}
/** SQLite online backup API includes committed WAL pages. No filesystem copy or source checkpoint mutation. */
export async function snapshotSqlite(source, destination) {
    const db = new DatabaseSync(resolve(source), { readOnly: true });
    try {
        await backup(db, resolve(destination));
    }
    finally {
        db.close();
    }
}
/** Reads a stopped native SQLite snapshot, never a Miniflare backing database. Caller supplies its authoritative namespace declaration. */
export async function nativeSqliteBundleInput(sourcePath, source, objects) {
    const db = new DatabaseSync(resolve(sourcePath), { readOnly: true }), reference = new DatabaseSync(':memory:'), rows = [], archives = [], schemaInventory = [];
    const management = new Set(['MaintenanceReceipt', 'MaintenanceArchives']);
    try {
        for (const migration of (await migrations()).list)
            reference.exec(migration.sql);
        db.exec('BEGIN');
        if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length)
            block('source SQLite integrity');
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(t => t.name);
        for (const name of tables) {
            if (!TABLES[name] && !management.has(name))
                block(`unknown native source table ${name}`);
            const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name).sql;
            const columns = db.prepare(`PRAGMA table_info(${name})`).all().map(row => ({ ...row }));
            const count = db.prepare(`SELECT count(*) n FROM ${name}`).get().n;
            schemaInventory.push({ name, sql, columns, rows: count });
            if (management.has(name)) {
                const expectedSql = reference.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name).sql;
                const expectedColumns = reference.prepare(`PRAGMA table_info(${name})`).all().map(row => ({ ...row }));
                if (sql !== expectedSql || !isDeepStrictEqual(columns, expectedColumns))
                    block(`source management schema differs ${name}`);
                if (count !== 0)
                    block(`nonempty source management table ${name}`);
            }
        }
        for (const name of ['Organizations', 'Users', 'Records', 'PracticeRoomComponents'])
            if (!tables.includes(name))
                block(`incomplete source table inventory ${name}`);
        // Follow dependency order; row iteration materializes one original row at a time.
        for (const [table, spec] of Object.entries(TABLES)) {
            if (!tables.includes(table) || management.has(table))
                continue;
            const columns = db.prepare(`PRAGMA table_info(${table})`).all();
            if (columns.map(c => c.name).sort().join('\0') !== [...spec.columns].sort().join('\0'))
                block(`unknown native columns ${table}`);
            const actualPk = columns.filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name);
            if (JSON.stringify(actualPk) !== JSON.stringify(spec.pk))
                block(`native primary key differs ${table}`);
            const count = db.prepare(`SELECT count(*) n FROM ${table}`).get().n;
            if (rows.length + count > CAPS.rows)
                block('source row count early probe');
            const lowerBound = spec.columns.map(c => `coalesce(length(CAST(${c} AS BLOB)),0)`).join('+');
            if (db.prepare(`SELECT 1 excessive FROM ${table} WHERE ${lowerBound}>? LIMIT 1`).get(CAPS.archive))
                block('source row archive early byte probe');
            const statement = db.prepare(`SELECT ${spec.columns.join(',')} FROM ${table} ORDER BY ${spec.pk.join(',')}`);
            statement.setReadBigInts(true);
            for (const original of statement.iterate()) {
                const a = archiveRow(table, spec.pk, original), row = Object.fromEntries(Object.entries(original).map(([k, v]) => {
                    if (typeof v === 'bigint') {
                        if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER))
                            block('operational integer cannot round-trip');
                        return [k, Number(v)];
                    }
                    return [k, v];
                }));
                rowOperation(table, row);
                rows.push({ table, row });
                archives.push(a);
            }
        }
        db.exec('COMMIT');
        return { source: { ...source, schemaInventory }, rows, objects, archives };
    }
    finally {
        db.close();
        reference.close();
    }
}
export function summarize(r) { const fields = 'id orgId seasonId revision format status teamCount teamSize questionCount coached bookKey rules completedAt members contributions'.split(' '); return { summaryVersion: 1, ...Object.fromEntries(fields.filter(k => r[k] !== undefined).map(k => [k, r[k]])), questions: r.questions.map(q => ({ id: q.id, version: q.version, sourceUnitId: q.sourceUnitId, parts: q.parts.map(p => ({ points: p.points })) })), submissions: r.submissions.map(({ answers, ...s }) => ({ ...s, unanswered: answers.every(a => !a.trim()) })) }; }
