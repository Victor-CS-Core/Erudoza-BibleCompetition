import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const api = await import('./lib/cloudflare-bound-bundle.mjs').catch(() => ({}));
test('archives full compound PBE identities, opaque dictionary keys, raw JSON and exact integer scalars', () => {
    assert.equal(typeof api.archiveRow, 'function', 'bound archive implementation must exist');
    const row = { OrganizationId: 'Org', Kind: 'pbe-target', Id: 'Same', Revision: 9007199254740993n, DataJson: '{ "UpperCASE": "é" }' };
    const a = api.archiveRow('PbeTrainingRecords', ['OrganizationId', 'Kind', 'Id'], row);
    const b = api.archiveRow('PbeTrainingRecords', ['OrganizationId', 'Kind', 'Id'], { ...row, Kind: 'pbe-question' });
    assert.notEqual(a.id, b.id);
    assert.deepEqual(api.reassembleArchive(a), row);
});
test('archives use ordered raw byte chunks and reject changed bytes or order', () => {
    assert.equal(typeof api.archiveRow, 'function');
    const a = api.archiveRow('T', ['id'], { id: 'A', raw: 'é'.repeat(70000) });
    assert.ok(a.chunks.length > 2);
    assert.ok(a.chunks.every(c => c.length <= 65536));
    assert.equal(api.reassembleArchive(a).raw, 'é'.repeat(70000));
    assert.throws(() => api.reassembleArchive({ ...a, chunks: [...a.chunks].reverse() }), /archive/);
    assert.throws(() => api.reassembleArchive({ ...a, chunks: a.chunks.map((c, i) => i ? c : { ...c, data: 'AA==' }) }), /archive/);
});
test('fixed D1 transport preserves bound nulls and refuses unsafe integers, unknown fields and oversized bodies', () => {
    assert.equal(typeof api.rowOperation, 'function');
    const row = { kind: 'pbe-target', id: 'Same', org_id: 'Org', season_id: null, owner_id: null, data: '{"Case":1}', revision: 7 };
    const op = api.rowOperation('Records', row);
    assert.ok(op.params.includes(null));
    assert.ok(op.sql.length < 100000);
    assert.equal(op.params.length, 7);
    assert.throws(() => api.rowOperation('Records', { ...row, revision: 9007199254740992 }), /integer/);
    assert.throws(() => api.rowOperation('Records', { ...row, extra: 1 }), /columns/);
    assert.throws(() => api.rowOperation('Records', { ...row, data: '"' + '\\'.repeat(999999) + '"' }), /row|value|body/);
});
test('preflight refusal never creates a destination for unknown mapping', async () => {
    assert.equal(typeof api.preflightBundle, 'function');
    const dir = await mkdtemp(join(tmpdir(), 'bound-red-'));
    try {
        await writeFile(join(dir, 'manifest.json'), JSON.stringify({ format: 'unknown' }));
        await assert.rejects(api.preflightBundle(dir), /format/);
        await assert.rejects(stat(join(dir, 'target')), { code: 'ENOENT' });
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
import { DatabaseSync } from 'node:sqlite';
import { boundRow, Budget, importSegment } from './lib/cloudflare-maintenance-local.mjs';
const sqliteBinding = db => ({ prepare: sql => { const make = params => ({ bind: (...values) => make(values), first: async () => db.prepare(sql).get(...params) ?? null, all: async () => ({ results: db.prepare(sql).all(...params), success: true, meta: {} }), run: async () => db.prepare(sql).run(...params) }); return make([]); }, batch: async (statements) => {
        db.exec('BEGIN');
        try {
            for (const s of statements)
                await s.run();
            db.exec('COMMIT');
        }
        catch (e) {
            db.exec('ROLLBACK');
            throw e;
        }
    } });
test('actual managed fixed transport preserves populated PBE revisions and rejects same-identity conflicts without overwrite', async () => {
    const db = new DatabaseSync(':memory:');
    try {
        for (const m of (await api.migrations()).list)
            db.exec(m.sql);
        const binding = sqliteBinding(db);
        await boundRow(binding, 'Organizations', { id: 'Org', name: 'Name', slug: 'org' }, new Budget());
        const r = { kind: 'pbe-target', id: 'Same', org_id: 'Org', season_id: null, owner_id: null, data: '{ "UpperCASE": 7 }', revision: 7 };
        await boundRow(binding, 'Records', r, new Budget());
        await boundRow(binding, 'Records', r, new Budget());
        await assert.rejects(boundRow(binding, 'Records', { ...r, data: '{}' }, new Budget()), /conflict/);
        assert.equal(db.prepare('SELECT data FROM Records').get().data, r.data);
        assert.equal(db.prepare('SELECT revision FROM Records').get().revision, 7);
    }
    finally {
        db.close();
    }
});
test('immutable populated native bundle validates every migration, archive and full field data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bound-populated-'));
    try {
        const raw = '{ "id":"Owner:Season", "sourceUnitIds":["OpaqueUpperCASE"], "skill":"FactualRecall", "label":"é" }';
        const sourceRow = { kind: 'pbe-target', id: 'Owner:Season', org_id: 'Org', season_id: 'Season', owner_id: 'Owner', data: raw, revision: 9 };
        const a = api.archiveRow('Records', ['kind', 'id', 'org_id'], sourceRow), rows = [{ table: 'Organizations', row: { id: 'Org', name: 'Name', slug: 'org' } }, { table: 'Records', row: sourceRow }];
        const bundleDir = join(dir, 'bundle');
        await api.writeBundle(bundleDir, { source: { kind: 'native-declared-stopped', exhaustive: true, stopped: true, scope: 'selected-scope', namespaces: [] }, rows, objects: [], archives: [api.archiveRow('Organizations', ['id'], rows[0].row), a] });
        const bundle = await api.preflightBundle(bundleDir);
        assert.equal(bundle.plan.rows[1].row.data, raw);
        const db = new DatabaseSync(':memory:');
        try {
            const local = { database: sqliteBinding(db), identity: { bundleId: bundle.manifest.bundleId, targetId: 'local', buildId: 'build', schemaId: bundle.plan.schemaId, mappingId: bundle.plan.mappingId, ticket: 'ticket' } };
            const result = await importSegment(local, bundle);
            assert.equal(result.complete, true);
            assert.equal(db.prepare('SELECT data FROM Records').get().data, raw);
            assert.equal(db.prepare('SELECT phase FROM MaintenanceReceipt').get().phase, 'verified');
        }
        finally {
            db.close();
        }
        await writeFile(join(bundleDir, 'extra'), 'x');
        await assert.rejects(api.preflightBundle(bundleDir), /unaccounted/);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('consistent SQLite backup includes committed WAL without changing source or losing int64', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bound-wal-'));
    const db = new DatabaseSync(join(dir, 'source'));
    try {
        db.exec('PRAGMA journal_mode=WAL;CREATE TABLE T(id INTEGER PRIMARY KEY,value TEXT);INSERT INTO T VALUES(9007199254740993,\'WAL\')');
        await api.snapshotSqlite(join(dir, 'source'), join(dir, 'snapshot'));
        const copy = new DatabaseSync(join(dir, 'snapshot'));
        try {
            const s = copy.prepare('SELECT * FROM T');
            s.setReadBigInts(true);
            assert.deepEqual({ ...s.get() }, { id: 9007199254740993n, value: 'WAL' });
        }
        finally {
            copy.close();
        }
    }
    finally {
        db.close();
        await rm(dir, { recursive: true, force: true });
    }
});
test('segment budget and durable cursor resume more than 1000 populated rows without overwriting', async () => {
    const db = new DatabaseSync(':memory:');
    try {
        const schema = await api.migrations(), rows = [{ table: 'Organizations', row: { id: 'Org', name: 'Org', slug: 'org' } }, ...Array.from({ length: 1100 }, (_, i) => ({ table: 'Records', row: { kind: 'pbe-target', id: String(i).padStart(5, '0'), org_id: 'Org', season_id: null, owner_id: null, data: '{}', revision: i + 1 } }))];
        const bundle = { manifest: { bundleId: 'bundle' }, plan: { schemaId: schema.id, rows, objects: [] } }, local = { database: sqliteBinding(db), identity: { bundleId: 'bundle', targetId: 'local', buildId: 'build', schemaId: schema.id, mappingId: api.MAPPING, ticket: 'ticket' } };
        let complete = false, segments = 0;
        while (!complete && segments < 12) {
            const result = await importSegment(local, bundle);
            assert.ok(result.budget.rows <= 1000);
            assert.ok(result.budget.transmitted <= 32 * 1024 ** 2);
            complete = result.complete;
            segments++;
        }
        assert.equal(complete, true);
        assert.ok(segments > 1);
        assert.equal(db.prepare('SELECT count(*) n FROM Records').get().n, 1100);
        assert.equal(db.prepare("SELECT revision FROM Records WHERE id='01099'").get().revision, 1100);
    }
    finally {
        db.close();
    }
});
test('lost D1 acknowledgment is resolved by exact row readback', async () => {
    const db = new DatabaseSync(':memory:');
    try {
        for (const m of (await api.migrations()).list)
            db.exec(m.sql);
        const real = sqliteBinding(db);
        let lost = true;
        const binding = { prepare: sql => {
                const original = real.prepare(sql);
                return { ...original, bind: (...args) => {
                        const bound = original.bind(...args);
                        return { ...bound, run: async () => {
                                const r = await bound.run();
                                if (lost && sql.startsWith('INSERT INTO Organizations')) {
                                    lost = false;
                                    const e = new Error('connection reset after commit');
                                    e.code = 'ECONNRESET';
                                    throw e;
                                }
                                return r;
                            } };
                    } };
            } };
        const budget = new Budget();
        await boundRow(binding, 'Organizations', { id: 'Org', name: 'Name', slug: 'org' }, budget);
        assert.equal(db.prepare('SELECT count(*) n FROM Organizations').get().n, 1);
        assert.equal(budget.retries, 1);
    }
    finally {
        db.close();
    }
});
import { convertSnapshot, readSource } from './cloudflare-export.mjs';
test('bound core preserves season enablement and defers populated PBE rows while default literal export still rejects them', { skip: !process.env.ERUDOZA_EXPORT_TEST_SOURCE }, () => {
    const source = process.env.ERUDOZA_EXPORT_TEST_SOURCE;
    const snapshot = readSource(source), season = snapshot.tables.Seasons[0];
    season.PbeEnabled = 1;
    snapshot.tables.PbeTrainingRecords = [{ OrganizationId: season.OrganizationId, Kind: 'pbe-target', Id: 'Opaque', SeasonId: season.Id, OwnerId: null, DataJson: '{"Case":1}', Revision: 7 }];
    assert.throws(() => convertSnapshot(snapshot), /unsupported nonempty table PbeTrainingRecords/);
    const result = convertSnapshot(snapshot, { bound: true });
    assert.equal(result.native.records.find(r => r.kind === 'season' && r.id === season.Id.toLowerCase()).data.pbeEnabled, true);
    assert.equal(result.native.records.some(r => r.kind.startsWith('legacy:')), false);
});
test('exact 32 MiB original archive uses 512 chunks and one byte over rejects', () => {
    const base = api.archiveRow('T', ['id'], { id: 'A', data: '' }).length;
    const a = api.archiveRow('T', ['id'], { id: 'A', data: 'x'.repeat(api.CAPS.archive - base) });
    assert.equal(a.length, 32 * 1024 ** 2);
    assert.equal(a.chunks.length, 512);
    assert.equal(a.chunks.at(-1).length, 65536);
    assert.equal(api.reassembleArchive(a).data.length, api.CAPS.archive - base);
    assert.throws(() => api.archiveRow('T', ['id'], { id: 'A', data: 'x'.repeat(api.CAPS.archive - base + 1) }), /32 MiB/);
});
test('unknown mapping and timed Solo refuse a populated declared bundle before any output directory exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bound-negative-'));
    try {
        for (const [kind, data] of [['unknown-namespace', '{}'], ['pbe-session', '{"mode":"Simulation"}']]) {
            const rows = [{ table: 'Organizations', row: { id: 'Org', name: 'Name', slug: 'org' } }, { table: 'Records', row: { kind, id: 'id', org_id: 'Org', season_id: null, owner_id: null, data, revision: 1 } }];
            const archives = rows.map(e => api.archiveRow(e.table, api.TABLES[e.table].pk, e.row));
            await assert.rejects(api.writeBundle(join(dir, kind), { source: { kind: 'native-declared-stopped', exhaustive: true, stopped: true, scope: 'selected-scope', namespaces: [] }, rows, objects: [], archives }), /unknown|timed/);
            await assert.rejects(stat(join(dir, kind)), { code: 'ENOENT' });
        }
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('D1 transient retries stop after three and immutable conflicts are never retried', async () => {
    const db = new DatabaseSync(':memory:');
    try {
        for (const m of (await api.migrations()).list)
            db.exec(m.sql);
        const real = sqliteBinding(db), budget = new Budget();
        let calls = 0;
        const unavailable = { prepare: () => ({ bind: () => ({ all: async () => { calls++; const e = new Error('timeout'); e.code = 'ETIMEDOUT'; throw e; } }) }) };
        await assert.rejects(boundRow(unavailable, 'Organizations', { id: 'Org', name: 'Name', slug: 'org' }, budget), /timeout/);
        assert.equal(calls, 4);
        assert.equal(budget.retries, 3);
        assert.equal(budget.rows, 4);
        await boundRow(real, 'Organizations', { id: 'Org', name: 'Name', slug: 'org' }, new Budget());
        const conflict = new Budget();
        await assert.rejects(boundRow(real, 'Organizations', { id: 'Org', name: 'Different', slug: 'org' }, conflict), /conflict/);
        assert.equal(conflict.retries, 0);
    }
    finally {
        db.close();
    }
});
test('stopped native SQLite source inventory archives every original row and refuses unknown tables', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bound-native-source-'));
    const source = join(dir, 'source.sqlite');
    const db = new DatabaseSync(source);
    try {
        for (const m of (await api.migrations()).list.filter(m => !m.name.startsWith('0007_')))
            db.exec(m.sql);
        db.prepare('INSERT INTO Organizations VALUES(?,?,?)').run('Org', 'Name', 'org');
        const raw = '{ "id":"Opaque", "sourceUnitIds":["OpaqueUpperCASE"], "skill":"FactualRecall", "label":"é" }';
        db.prepare('INSERT INTO Records VALUES(?,?,?,?,?,?,?)').run('pbe-target', 'Opaque', 'Org', 'Season', 'Source', raw, 9);
        const input = await api.nativeSqliteBundleInput(source, { kind: 'native-declared-stopped', exhaustive: true, stopped: true, scope: 'selected-scope', namespaces: [] }, []);
        assert.equal(input.rows.length, 2);
        assert.equal(input.archives.length, 2);
        assert.equal(input.rows.find(e => e.table === 'Records').row.revision, 9);
        await api.writeBundle(join(dir, 'bundle'), input);
        assert.equal((await api.preflightBundle(join(dir, 'bundle'))).plan.rows.filter(e => e.table === 'Records')[0].row.data, raw);
        db.exec('CREATE TABLE UnknownAuthority(id TEXT PRIMARY KEY,data TEXT)');
        await assert.rejects(api.nativeSqliteBundleInput(source, input.source, []), /unknown native source table/);
    }
    finally {
        db.close();
        await rm(dir, { recursive: true, force: true });
    }
});
test('bound core retains one contiguous multi-chapter assignment and refuses a second scope without output', { skip: !process.env.ERUDOZA_EXPORT_TEST_SOURCE }, async () => {
    const snapshot = readSource(process.env.ERUDOZA_EXPORT_TEST_SOURCE), scope = snapshot.tables.AssignmentScopes[0];
    scope.StartChapter = 1;
    scope.EndChapter = 2;
    const native = convertSnapshot(snapshot, { bound: true }).native, assignment = native.records.find(r => r.kind === 'assignment' && r.id === scope.AssignmentId.toLowerCase());
    assert.equal(assignment.data.startChapter, 1);
    assert.equal(assignment.data.endChapter, 2);
    snapshot.tables.AssignmentScopes.push({ ...scope, Id: '99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa', StartChapter: 3, EndChapter: 4 });
    const dir = await mkdtemp(join(tmpdir(), 'bound-scope-'));
    try {
        assert.throws(() => convertSnapshot(snapshot, { bound: true }), /exactly one scope/);
        await assert.rejects(stat(join(dir, 'target')), { code: 'ENOENT' });
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
import { preflightAdapterObject } from './lib/cloudflare-adapter-preflight.mjs';
test('disposable preflight executes real adapter closure and measures private stored payload without any target runtime', async () => {
    const scope = { kind: 'room', orgId: 'Org', seasonId: 'Season', id: 'Room' }, metadata = { id: 'Room', orgId: 'Org', seasonId: 'Season', format: 'Pbe', revision: 1, status: 'Completed', phaseEndsAt: null, messages: [], drafts: {}, applied: { 'Command': 'Actor' }, members: [] };
    const root = value => { const text = JSON.stringify(value), data = JSON.stringify({ nodeVersion: 1, type: 'leaf', data: text }), hash = api.sha(data); return { row: { table: 'room_components', key: hash, data }, manifest: JSON.stringify({ format: 'erudoza.practice-room/1', id: 'Room', orgId: 'Org', seasonId: 'Season', revision: 1, metadata: { hash, bytes: Buffer.byteLength(text) }, questions: [], reserves: [], submissions: [] }) }; };
    const a = root(metadata), h = root({ ...metadata, applied: {} }), rows = [a.row, h.row].sort((a, b) => a.key < b.key ? -1 : 1), o = { scope, outbox: null, rows, plan: { root: a.manifest, historyRoot: h.manifest, inventory: api.inventory(rows) } };
    const result = await preflightAdapterObject(o, await api.mappingIdentity(), (await api.migrations()).id);
    assert.ok(result.peak >= result.final);
    assert.ok(result.final > Buffer.byteLength(a.manifest));
    assert.ok(result.calls > 4);
    const bad = root({ ...metadata, status: 'Playing' });
    await assert.rejects(preflightAdapterObject({ ...o, plan: { ...o.plan, root: bad.manifest } }, await api.mappingIdentity(), (await api.migrations()).id), /preflight/);
});
test('canonical bound core is deterministic when source users lack credential stamps', { skip: !process.env.ERUDOZA_EXPORT_TEST_SOURCE }, () => {
    const snapshot = readSource(process.env.ERUDOZA_EXPORT_TEST_SOURCE);
    for (const user of snapshot.tables.Users)
        user.SecurityStamp = '';
    assert.deepEqual(convertSnapshot(snapshot, { bound: true }).native.users, convertSnapshot(snapshot, { bound: true }).native.users);
});
test('canonical complete bundle preserves source credentials and fails a two-scope Assignment before any output', { skip: !process.env.ERUDOZA_EXPORT_TEST_SOURCE }, async () => {
    const { exportCanonicalBundle, readCanonicalSnapshot } = await import('./lib/cloudflare-canonical-bundle.mjs');
    const dir = await mkdtemp(join(tmpdir(), 'bound-canonical-source-'));
    try {
        const source = join(dir, 'source.sqlite');
        await api.snapshotSqlite(process.env.ERUDOZA_EXPORT_TEST_SOURCE, source);
        const db = new DatabaseSync(source);
        try {
            db.exec("UPDATE Users SET SecurityStamp=''");
            const scope = db.prepare('SELECT * FROM AssignmentScopes LIMIT 1').get();
            db.prepare('UPDATE AssignmentScopes SET StartChapter=1,EndChapter=2 WHERE Id=?').run(scope.Id);
        }
        finally {
            db.close();
        }
        const original = readCanonicalSnapshot(source), bundleDir = join(dir, 'bundle');
        await exportCanonicalBundle(source, bundleDir);
        const bundle = await api.preflightBundle(bundleDir);
        for (const user of original.tables.Users) {
            const archived = bundle.plan.archives.map(a => ({ a, value: api.reassembleArchive(a) })).find(e => e.a.identity[0] === 'Users' && e.value.Id === user.Id).value;
            assert.equal(archived.SecurityStamp, user.SecurityStamp);
            assert.equal(archived.PasswordHash, user.PasswordHash);
        }
        assert.ok(bundle.plan.rows.some(e => e.table === 'Records' && e.row.kind === 'assignment' && JSON.parse(e.row.data).startChapter === 1 && JSON.parse(e.row.data).endChapter === 2));
        const changed = new DatabaseSync(source);
        try {
            const scope = changed.prepare('SELECT * FROM AssignmentScopes LIMIT 1').get(), extra = { ...scope, Id: '99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa', StartChapter: 3, EndChapter: 4 };
            changed.prepare(`INSERT INTO AssignmentScopes(${Object.keys(extra).join(',')}) VALUES(${Object.keys(extra).map(() => '?').join(',')})`).run(...Object.values(extra));
        }
        finally {
            changed.close();
        }
        const rejectedSource = readCanonicalSnapshot(source);
        await assert.rejects(exportCanonicalBundle(source, join(dir, 'rejected-bundle')), /exactly one scope/);
        await assert.rejects(stat(join(dir, 'rejected-bundle')), { code: 'ENOENT' });
        assert.deepEqual(readCanonicalSnapshot(source), rejectedSource);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('each capture page reserves eight row/node slots before dispatch including importer readback', async () => {
    const { adapterCall, SegmentEnd } = await import('./lib/cloudflare-maintenance-local.mjs');
    let dispatched = 0;
    const local = { identity: {}, runtime: { getDurableObjectNamespace: async () => ({ idFromName: name => name, get: () => ({ fetch: async () => { dispatched++; return new Response(JSON.stringify({ rows: [], cursor: null })); } }) }) } };
    const budget = new Budget();
    budget.rows = 993;
    await assert.rejects(adapterCall(local, { kind: 'reports', orgId: 'Org', seasonId: 'Season' }, 'capture', { table: 'publications', after: null }, budget), SegmentEnd);
    assert.equal(dispatched, 0);
    assert.equal(budget.rows, 993);
});
test('operational row and encoded transport segment boundaries admit exact caps and reject one byte more', () => {
    const row = { id: 'Org', name: '', slug: 'org' }, overhead = api.rowOperation('Organizations', row).payload;
    row.name = 'x'.repeat(api.CAPS.row - overhead);
    assert.equal(api.rowOperation('Organizations', row).payload, api.CAPS.row);
    assert.throws(() => api.rowOperation('Organizations', { ...row, name: row.name + 'x' }), /operational row cap/);
    const response = new Budget();
    response.received('x'.repeat(api.CAPS.d1Body), api.CAPS.d1Body);
    assert.equal(response.largestResponse, 1500000);
    assert.throws(() => response.received('x'.repeat(api.CAPS.d1Body + 1), api.CAPS.d1Body), /response body cap/);
    const segment = new Budget();
    segment.charge('x'.repeat(api.CAPS.segmentBytes), 1000);
    assert.equal(segment.transmitted, 32 * 1024 ** 2);
    assert.equal(segment.rows, 1000);
    assert.throws(() => segment.charge('x'), /Segment checkpoint/);
    assert.throws(() => segment.charge('', 1), /Segment checkpoint/);
    assert.equal(segment.transmitted, 32 * 1024 ** 2);
    assert.equal(segment.rows, 1000);
});
test('whole bundle refuses present frozen evidence mismatch before output and retains original source rows', async () => {
    const evidence = { attemptId: 'attempt', targetId: 'target', questionId: 'question', atMs: 10, earnedPoints: 1, availablePoints: 1, unaided: true, recall: true }, event = { id: 'student:season:attempt', scopeVersion: 'scope', acceptedSequence: 1, questionKind: 'ShortAnswer', evidence: [evidence] }, ref = { id: 'student:season:target:0000000000000002:attempt', eventId: event.id, attemptRecordId: 'attempt', acceptedSequence: 2, questionKind: 'ShortAnswer', evidence };
    const rows = [{ table: 'Organizations', row: { id: 'org', name: 'Org', slug: 'org' } }, ...[['pbe-recall-event', event], ['pbe-evidence-ref', ref]].map(([kind, data]) => ({ table: 'Records', row: { kind, id: data.id, org_id: 'org', season_id: 'season', owner_id: 'student', data: JSON.stringify(data), revision: 1 } }))], input = { source: { kind: 'native-declared-stopped', exhaustive: true, stopped: true, scope: 'selected-scope', namespaces: [] }, rows, objects: [], archives: rows.map(e => api.archiveRow(e.table, api.TABLES[e.table].pk, e.row)) }, before = JSON.stringify(input);
    const dir = await mkdtemp(join(tmpdir(), 'bound-graph-no-output-'));
    try {
        await assert.rejects(api.writeBundle(join(dir, 'bundle'), input), /evidence event correspondence/);
        await assert.rejects(stat(join(dir, 'bundle')), { code: 'ENOENT' });
        assert.equal(JSON.stringify(input), before);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('oversized finalized files refuse before reading plan JSON or creating a destination', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bound-file-cap-'));
    try {
        const { truncate } = await import('node:fs/promises');
        await writeFile(join(dir, 'manifest.json'), JSON.stringify({ format: api.FORMAT, plan: { file: 'plan.json', length: api.CAPS.bundle + 1, hash: '0'.repeat(64) }, bundleId: '0'.repeat(64), metrics: {} }));
        await writeFile(join(dir, 'plan.json'), 'not JSON');
        // Sparse file: exercise the real size probe without allocating or reading 512 MiB.
        await truncate(join(dir, 'plan.json'), api.CAPS.bundle + 1);
        await assert.rejects(api.preflightBundle(dir), /file type\/byte cap/);
        await assert.rejects(stat(join(dir, 'target')), { code: 'ENOENT' });
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('target count cap rejects early and all fixed statements stay within SQL and parameter bounds', async () => {
    const schema = await api.migrations(), source = { kind: 'native-declared-stopped', exhaustive: true, stopped: true, scope: 'selected-scope', namespaces: [] };
    const plan = { format: api.FORMAT, mappingId: await api.mappingIdentity(source.kind), schemaId: schema.id, source, rows: new Array(api.CAPS.rows + 1), objects: [], archives: [] };
    // Deliberate sparse rows prove the count probe precedes row parsing or SQL writes.
    await assert.rejects(api.validatePlan(plan), /target row count cap/);
    for (const [table, spec] of Object.entries(api.TABLES)) {
        const row = Object.fromEntries(spec.columns.map(k => [k, null]));
        for (const read of [false, true]) {
            const operation = api.rowOperation(table, row, read);
            assert.ok(Buffer.byteLength(operation.sql) <= 100000);
            assert.ok(operation.params.length <= 100);
            assert.ok(Buffer.byteLength(operation.body) <= api.CAPS.d1Body);
        }
    }
    // The 4,096-byte allowance already dominates 100,000 rows before any encoded values.
    assert.ok(api.CAPS.rows * 4096 > api.CAPS.d1Payload);
});
test('four complete Reports scopes pass closed preflight and a fifth refuses the whole bundle before output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bound-report-scopes-'));
    try {
        const rows = Array.from({ length: 5 }, (_, i) => ({ table: 'Organizations', row: { id: 'Org' + i, name: 'Org ' + i, slug: 'org-' + i } }));
        const objects = rows.map(({ row }) => ({ scope: { kind: 'reports', orgId: row.id, seasonId: 'Season' }, outbox: null, rows: [], plan: { root: JSON.stringify([row.id, 'Season']), inventory: api.inventory([]) } }));
        const input = n => ({ source: { kind: 'native-declared-stopped', exhaustive: true, stopped: true, scope: 'selected-scope', namespaces: objects.slice(0, n).map(o => o.scope) }, rows: rows.slice(0, n), objects: objects.slice(0, n), archives: rows.slice(0, n).map(e => api.archiveRow(e.table, api.TABLES[e.table].pk, e.row)) });
        const accepted = join(dir, 'four');
        await api.writeBundle(accepted, input(4));
        assert.equal((await api.preflightBundle(accepted)).plan.objects.length, 4);
        await assert.rejects(api.writeBundle(join(dir, 'five'), input(5)), /scope cap/);
        await assert.rejects(stat(join(dir, 'five')), { code: 'ENOENT' });
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('known empty 0007 source tables retain exact schema inventory while nonempty or changed metadata refuses', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bound-native-metadata-')), source = join(dir, 'source.sqlite'), db = new DatabaseSync(source);
    const declaration = { kind: 'native-declared-stopped', exhaustive: true, stopped: true, scope: 'whole-local', namespaces: [] };
    try {
        for (const m of (await api.migrations()).list)
            db.exec(m.sql);
        db.prepare('INSERT INTO Organizations VALUES(?,?,?)').run('Org', 'Name', 'org');
        const input = await api.nativeSqliteBundleInput(source, declaration, []);
        for (const name of ['MaintenanceReceipt', 'MaintenanceArchives']) {
            const table = input.source.schemaInventory.find(t => t.name === name);
            assert.equal(table.rows, 0);
            assert.ok(table.sql.includes('WITHOUT ROWID'));
            assert.ok(table.columns.length > 0);
        }
        assert.equal(input.source.schemaInventory.length, db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n);
        await api.writeBundle(join(dir, 'accepted'), input);
        assert.deepEqual((await api.preflightBundle(join(dir, 'accepted'))).plan.source.schemaInventory, input.source.schemaInventory);
        const changed = structuredClone(input);
        changed.source.schemaInventory.find(t => t.name === 'MaintenanceReceipt').rows = 1;
        await assert.rejects(api.writeBundle(join(dir, 'changed'), changed), /source management schema\/count differs/);
        await assert.rejects(stat(join(dir, 'changed')), { code: 'ENOENT' });
        db.prepare("INSERT INTO MaintenanceReceipt VALUES('global','{}','hash','closed','{}')").run();
        await assert.rejects(api.nativeSqliteBundleInput(source, declaration, []), /nonempty source management table/);
        db.exec('DELETE FROM MaintenanceReceipt');
        db.prepare('INSERT INTO MaintenanceArchives VALUES(?,?,?,?,?,?,?,?)').run('id', 0, 'identity', 1, 'hash', 1, 'hash', 'x');
        await assert.rejects(api.nativeSqliteBundleInput(source, declaration, []), /nonempty source management table/);
        db.exec('DELETE FROM MaintenanceArchives; ALTER TABLE MaintenanceReceipt ADD COLUMN unexpected TEXT');
        await assert.rejects(api.nativeSqliteBundleInput(source, declaration, []), /source management schema differs/);
        await assert.rejects(stat(join(dir, 'target')), { code: 'ENOENT' });
    }
    finally {
        db.close();
        await rm(dir, { recursive: true, force: true });
    }
});
test('known native PBE kind with unsupported question schema fails whole-bundle admission before output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bound-native-version-'));
    const question = { schemaVersion: 3, id: 'question', version: 1, contentPackId: 'pack', sourceUnitId: 'source', sourceUnitIds: ['source'], sourceKind: 'Scripture', reference: 'GEN 1:1', evidence: 'Alpha', kind: 'ShortAnswer', prompt: 'Name it', ordered: false, parts: [{ targetId: 'target', acceptedAnswers: ['Alpha'], points: 1 }] };
    const rows = [{ table: 'Organizations', row: { id: 'Org', name: 'Org', slug: 'org' } }, { table: 'Records', row: { kind: 'pbe-question-head', id: 'question', org_id: 'Org', season_id: 'Season', owner_id: 'source', data: JSON.stringify({ id: 'question', seasonId: 'Season', published: true, sourceFingerprint: 'fingerprint', question }), revision: 1 } }];
    const input = { source: { kind: 'native-declared-stopped', exhaustive: true, stopped: true, scope: 'selected-scope', namespaces: [] }, rows, objects: [], archives: rows.map(e => api.archiveRow(e.table, api.TABLES[e.table].pk, e.row)) }, original = JSON.stringify(input);
    try {
        await assert.rejects(api.writeBundle(join(dir, 'bundle'), input), /schema|version|unsupported/i);
        await assert.rejects(stat(join(dir, 'bundle')), { code: 'ENOENT' });
        assert.equal(JSON.stringify(input), original);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('segment slots include every receipt and ledger row and reserve a durable checkpoint after lost data acknowledgment', async () => {
    const db = new DatabaseSync(':memory:');
    try {
        const real = sqliteBinding(db);
        let observed = 0, lost = false;
        const tracked = { prepare: sql => {
                const wrap = statement => ({ bind: (...args) => wrap(statement.bind(...args)), ...Object.fromEntries(['first', 'all', 'run'].map(method => [method, async () => {
                            if (/^(SELECT|UPDATE|INSERT)/.test(sql) && !sql.startsWith('INSERT INTO Records_without_rowid'))
                                observed++;
                            const result = await statement[method]();
                            if (!lost && method === 'run' && sql.startsWith('INSERT INTO Records (')) {
                                lost = true;
                                const error = new Error('lost data acknowledgement');
                                error.code = 'ECONNRESET';
                                throw error;
                            }
                            return result;
                        }])) });
                return wrap(real.prepare(sql));
            }, batch: real.batch };
        const schema = await api.migrations(), rows = [{ table: 'Organizations', row: { id: 'Org', name: 'Org', slug: 'org' } }, ...Array.from({ length: 350 }, (_, i) => ({ table: 'Records', row: { kind: 'pbe-target', id: String(i), org_id: 'Org', season_id: null, owner_id: null, data: '{}', revision: 1 } }))];
        const bundle = { manifest: { bundleId: 'bundle' }, plan: { schemaId: schema.id, rows, objects: [] } }, local = { database: tracked, identity: { bundleId: 'bundle', targetId: 'local', buildId: 'build', schemaId: schema.id, mappingId: api.MAPPING, ticket: 'ticket' } };
        let complete = false, segments = 0, retries = 0;
        while (!complete && segments < 10) {
            observed = 0;
            const result = await importSegment(local, bundle);
            assert.equal(result.budget.rows, observed);
            assert.ok(result.budget.rows <= 1000);
            retries += result.budget.retries;
            complete = result.complete;
            segments++;
            const receipt = JSON.parse(db.prepare('SELECT cursor FROM MaintenanceReceipt').get().cursor);
            assert.ok(receipt.phase);
        }
        assert.equal(complete, true);
        assert.ok(segments > 1);
        assert.equal(retries, 1);
        assert.equal(lost, true);
        assert.equal(db.prepare('SELECT count(*) n FROM Records').get().n, 350);
    }
    finally {
        db.close();
    }
});
test('checkpoint reservation leaves exact row and byte capacity for durable final bookkeeping', () => {
    const budget = new Budget();
    budget.reserveCheckpoint(3, 1024);
    budget.charge('x'.repeat(api.CAPS.segmentBytes - 1024), api.CAPS.segmentRows - 3);
    assert.throws(() => budget.charge('x'), /Segment checkpoint/);
    assert.throws(() => budget.charge('', 1), /Segment checkpoint/);
    budget.reserveCheckpoint();
    budget.charge('x'.repeat(1024), 3);
    assert.equal(budget.transmitted, api.CAPS.segmentBytes);
    assert.equal(budget.rows, api.CAPS.segmentRows);
    assert.throws(() => budget.charge('x'), /Segment checkpoint/);
    assert.throws(() => budget.reserveCheckpoint(-1, 0), /invalid checkpoint/);
});
test('actual saved chapter rows require retained referenced proofs before native bundle output', { skip: !process.env.D3_CHAPTER_NATIVE_PLAN }, async () => {
    const sourcePath = process.env.D3_CHAPTER_NATIVE_PLAN, sourceBytes = await readFile(sourcePath), plan = JSON.parse(sourceBytes), dir = await mkdtemp(join(tmpdir(), 'bound-chapter-closure-'));
    const rows = plan.rows.filter(e => e.table !== 'MaintenanceArchives'), proof = rows.find(e => e.table === 'Records' && e.row.kind === 'pbe-chapter-stamp-proof');
    assert.ok(proof);
    const input = values => ({ source: { kind: 'native-declared-stopped', exhaustive: true, stopped: true, scope: 'selected-scope', namespaces: [] }, rows: values, objects: [], archives: values.map(e => api.archiveRow(e.table, api.TABLES[e.table].pk, e.row)) });
    try {
        await api.writeBundle(join(dir, 'complete'), input(rows));
        const omitted = rows.filter(e => e !== proof);
        await assert.rejects(api.writeBundle(join(dir, 'omitted'), input(omitted)), /chapter.*proof/);
        await assert.rejects(stat(join(dir, 'omitted')), { code: 'ENOENT' });
        const value = JSON.parse(proof.row.data);
        value.entries[0].witness[0].attemptId = 'different-original-attempt';
        value.hash = api.sha(JSON.stringify(value.entries));
        const changed = rows.map(e => e === proof ? { ...e, row: { ...e.row, data: JSON.stringify(value) } } : e);
        await assert.rejects(api.writeBundle(join(dir, 'changed'), input(changed)), /chapter.*proof/);
        await assert.rejects(stat(join(dir, 'changed')), { code: 'ENOENT' });
        assert.deepEqual(await readFile(sourcePath), sourceBytes);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
async function capRoomInput(count = 1, extraD1 = 0) {
    const { createRequire } = await import('node:module');
    const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
    const code = await require('esbuild').build({ entryPoints: [join(api.ROOT, 'apps/web/worker/native/practice/room-storage.ts')], bundle: true, write: false, format: 'esm', platform: 'node' });
    const { RoomCodec } = await import('data:text/javascript;base64,' + Buffer.from(code.outputFiles[0].text).toString('base64'));
    const rows = [{ table: 'Organizations', row: { id: 'org', name: 'Org', slug: 'org' } }], objects = [];
    for (let n = 0; n < count; n++) {
        const room = { id: 'room-' + n, orgId: 'org', seasonId: 'season', ownerId: 'owner', teamSize: 1, teamCount: 1, questionCount: 0, coached: false, format: 'Pbe', status: n % 2 ? 'Interrupted' : 'Completed', phase: 'Review', revision: 9, questionIndex: 0, epoch: 'original', lastObserved: 100, phaseEndsAt: null, responseStartsAt: null, scheduleId: 'schedule', acknowledged: [], questions: [], reserves: [], members: [], invitations: [], submissions: [], drafts: {}, messages: [], contributions: [], applied: {}, completedAt: '2026-09-12T00:00:00Z', adjustments: [], timingAnomalies: [], rules: { ruleVersion: 'pbe-rehearsal-v1', scoringVersion: 'pbe-accuracy-v1', clock: 'server-event-time', presentationSeconds: 15, reviewSeconds: 10, speedPercent: 0, stepSeconds: 1 } };
        const encoded = await new RoomCodec().encode(room), nodes = [...encoded.nodes].map(([key, data]) => ({ table: 'room_components', key, data }));
        objects.push({ scope: { kind: 'room', orgId: 'org', seasonId: 'season', id: room.id }, outbox: null, rows: nodes, plan: { root: JSON.stringify(encoded.manifest), historyRoot: JSON.stringify(encoded.manifest), inventory: api.inventory(nodes) } });
        rows.push({ table: 'Records', row: { kind: 'match', id: room.id, org_id: 'org', season_id: 'season', owner_id: null, data: JSON.stringify({ format: 'erudoza.practice-room/1', manifest: encoded.manifest, summary: api.summarize(room) }), revision: room.revision } });
        rows.push(...nodes.map(node => ({ table: 'PracticeRoomComponents', row: { org_id: 'org', season_id: 'season', room_id: room.id, hash: node.key, data: node.data } })));
        for (let i = 0; i < extraD1; i++) {
            const data = JSON.stringify({ nodeVersion: 1, type: 'leaf', data: JSON.stringify({ originalSuperseded: i }) });
            rows.push({ table: 'PracticeRoomComponents', row: { org_id: 'org', season_id: 'season', room_id: room.id, hash: api.sha(data), data } });
        }
    }
    objects.push({ scope: { kind: 'reports', orgId: 'org', seasonId: 'season' }, outbox: null, rows: [], plan: { root: JSON.stringify(['org', 'season']), inventory: api.inventory([]) } });
    return { rows, objects, source: { kind: 'native-declared-stopped', exhaustive: true, stopped: true, scope: 'selected-scope', namespaces: objects.map(o => o.scope) }, archives: rows.map(e => api.archiveRow(e.table, api.TABLES[e.table].pk, e.row)) };
}
test('four complete Room scopes pass whole preflight and fifth refuses without output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bound-four-rooms-'));
    try {
        await api.writeBundle(join(dir, 'four'), await capRoomInput(4));
        assert.equal((await api.preflightBundle(join(dir, 'four'))).plan.objects.filter(o => o.scope.kind === 'room').length, 4);
        await assert.rejects(api.writeBundle(join(dir, 'five'), await capRoomInput(5)), /scope cap/);
        await assert.rejects(stat(join(dir, 'five')), { code: 'ENOENT' });
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('scoped D1 retained count is independent of a smaller complete DO inventory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bound-d1-retained-'));
    try {
        const base = await capRoomInput(), initial = base.rows.filter(e => e.table === 'PracticeRoomComponents').length;
        const exact = await capRoomInput(1, api.CAPS.nodes - initial);
        assert.equal(exact.rows.filter(e => e.table === 'PracticeRoomComponents').length, 2048);
        assert.equal(exact.objects[0].rows.length, initial);
        await api.writeBundle(join(dir, 'exact'), exact);
        assert.equal((await api.preflightBundle(join(dir, 'exact'))).plan.objects[0].rows.length, initial);
        await assert.rejects(api.writeBundle(join(dir, 'over'), await capRoomInput(1, api.CAPS.nodes - initial + 1)), /D1 retained component cap/);
        await assert.rejects(stat(join(dir, 'over')), { code: 'ENOENT' });
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('canonical StateJson SQL early probe accepts 16 MiB and refuses one byte more before decoding', async () => {
    const { probeCanonicalRoomSize } = await import('./lib/cloudflare-canonical-bundle.mjs');
    assert.equal(typeof probeCanonicalRoomSize, 'function');
    const db = new DatabaseSync(':memory:');
    try {
        db.exec('CREATE TABLE PracticeRoomRecord(Id TEXT PRIMARY KEY,StateJson TEXT NOT NULL)');
        db.prepare('INSERT INTO PracticeRoomRecord VALUES(?,CAST(zeroblob(?) AS TEXT))').run('original', 16 * 1024 ** 2);
        assert.equal(probeCanonicalRoomSize(db), undefined);
        db.prepare('UPDATE PracticeRoomRecord SET StateJson=CAST(zeroblob(?) AS TEXT)').run(16 * 1024 ** 2 + 1);
        assert.throws(() => probeCanonicalRoomSize(db), /16 MiB early cap/);
    }
    finally {
        db.close();
    }
});
test('scoped D1 retained byte accounting accepts 64 MiB and refuses one byte more without allocating its total', () => {
    assert.equal(typeof api.checkD1RetainedComponents, 'function');
    const shared = 'x'.repeat(65536), entries = Array.from({ length: 1024 }, () => ({ row: { data: shared } }));
    assert.equal(api.checkD1RetainedComponents(entries), undefined);
    entries.push({ row: { data: 'x' } });
    assert.throws(() => api.checkD1RetainedComponents(entries), /D1 retained component cap/);
});
test('aggregate accounting admits exact 128 256 and 512 MiB and rejects plus one before totals change', () => {
    assert.equal(typeof api.checkedPayloadSum, 'function');
    for (const [limit, label] of [[api.CAPS.d1Payload, 'planned D1 payload cap'], [api.CAPS.doPayload, 'aggregate DO payload cap'], [api.CAPS.bundle, 'whole bundle cap']]) {
        const first = limit - 4096;
        assert.equal(api.checkedPayloadSum(limit, label, first, 4096), limit);
        assert.throws(() => api.checkedPayloadSum(limit, label, first, 4097), new RegExp(label));
        assert.throws(() => api.checkedPayloadSum(limit, label, first, -1), /invalid payload/);
    }
    const archive = api.archiveRow('Source', ['id'], { id: 'original', data: 'é'.repeat(65536) });
    const encodedChunks = archive.chunks.map(c => api.rowOperation('MaintenanceArchives', { id: archive.id, ordinal: c.ordinal, identity: JSON.stringify(archive.identity), length: c.length, hash: c.hash, whole_length: archive.length, whole_hash: archive.hash, data: c.data }).payload);
    const original = api.rowOperation('Organizations', { id: 'org', name: 'Org', slug: 'org' }).payload;
    const measured = original + encodedChunks.reduce((a, b) => a + b, 0);
    assert.equal(api.checkedPayloadSum(api.CAPS.d1Payload, 'planned D1 payload cap', api.CAPS.d1Payload - measured, original, ...encodedChunks), api.CAPS.d1Payload);
});
test('importer escaped DO page envelopes retain eight-node and exact serialized byte limits', async () => {
    const transport = await import('./lib/cloudflare-maintenance-local.mjs');
    assert.equal(typeof transport.stagePages, 'function');
    const identity = { bundleId: 'b', targetId: 't', buildId: 'v', schemaId: 's', mappingId: 'm', ticket: 'x' }, scope = { kind: 'room', orgId: 'org', seasonId: 'season', id: 'room' };
    const makeBody = rows => JSON.stringify({ version: 1, identity, scope, rows });
    const row = { table: 'room_components', key: 'f'.repeat(64), data: '' }, overhead = Buffer.byteLength(makeBody([row]));
    const escaped = '\\'.repeat(Math.floor((api.CAPS.doBody - overhead) / 2));
    row.data = escaped + 'x'.repeat(api.CAPS.doBody - Buffer.byteLength(makeBody([{ ...row, data: escaped }])));
    assert.equal(Buffer.byteLength(makeBody([row])), api.CAPS.doBody);
    assert.deepEqual(transport.stagePages({ identity }, { scope, rows: [row, { ...row, key: 'e'.repeat(64) }] }).map(p => p.length), [1, 1]);
    assert.throws(() => transport.stagePages({ identity }, { scope, rows: [{ ...row, data: row.data + 'x' }] }), /DO request body cap/);
    assert.deepEqual(transport.stagePages({ identity }, { scope, rows: Array.from({ length: 9 }, () => ({ table: 'room_uploaded', key: 'f'.repeat(64), data: 1 })) }).map(p => p.length), [8, 1]);
    // Real parseNode-compatible escaped leaves: byte paging stops before eight nodes.
    const leafData = JSON.stringify({ nodeVersion: 1, type: 'leaf', data: '\u0000'.repeat(128 * 1024) });
    const leaf = { table: 'room_components', key: api.sha(leafData), data: leafData };
    assert.ok(Buffer.byteLength(leafData) < api.CAPS.doBody);
    const leafPages = transport.stagePages({ identity }, { scope, rows: [leaf, leaf, leaf] });
    assert.deepEqual(leafPages.map(p => p.length), [1, 1, 1]);
    assert.ok(leafPages.every(p => Buffer.byteLength(makeBody(p)) <= api.CAPS.doBody));
    let calls = 0, raw = '"' + 'x'.repeat(api.CAPS.doBody - 2) + '"';
    const local = { identity, runtime: { getDurableObjectNamespace: async () => ({ idFromName: n => n, get: () => ({ fetch: async (_url, init) => { calls++; assert.equal(Buffer.byteLength(init.body), api.CAPS.doBody); return new Response(raw); } }) }) } };
    const budget = new Budget();
    await transport.adapterCall(local, scope, 'stage', { rows: [row] }, budget, 1);
    assert.equal(budget.largestRequest, api.CAPS.doBody);
    assert.equal(budget.largestResponse, api.CAPS.doBody);
    await assert.rejects(transport.adapterCall(local, scope, 'stage', { rows: [{ ...row, data: row.data + 'x' }] }, new Budget(), 1), /DO request body cap/);
    assert.equal(calls, 1);
    raw = '"' + 'x'.repeat(api.CAPS.doBody - 1) + '"';
    await assert.rejects(transport.adapterCall(local, scope, 'stage', { rows: [row] }, new Budget(), 1), /response body cap/);
});
test('native audit source schemas retain exact original bytes and reject unknown or mismatched metadata before output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bound-native-audit-'));
    const audit = { kind: 'audit', id: 'OriginalCase', org_id: 'Org', season_id: null, owner_id: null, revision: 1, data: '{ "id":"OriginalCase", "actorId":"OriginalActor", "action":"practice.pbe.authorize", "createdAtUtc":"2026-09-12T22:26:22.123Z" }' };
    const input = row => {
        const rows = [{ table: 'Organizations', row: { id: 'Org', name: 'Org', slug: 'org' } }, { table: 'Records', row }];
        return { source: { kind: 'native-declared-stopped', exhaustive: true, stopped: true, scope: 'selected-scope', namespaces: [] }, rows, objects: [], archives: rows.map(e => api.archiveRow(e.table, api.TABLES[e.table].pk, e.row)) };
    };
    try {
        for (const [i, data] of [audit.data, '{}', ...['pbe.scope.accept', 'pbe.chapter.inputs', 'pbe.chapter.witnesses'].map(action => JSON.stringify({ id: audit.id, action }))].entries()) {
            const path = join(dir, 'positive-' + i);
            await api.writeBundle(path, input({ ...audit, data }));
            assert.equal((await api.preflightBundle(path)).plan.rows.find(e => e.table === 'Records').row.data, data);
        }
        const decoded = JSON.parse(audit.data);
        const invalid = [
            { ...audit, data: JSON.stringify({ ...decoded, schemaVersion: 2 }) },
            { ...audit, data: JSON.stringify({ ...decoded, id: 'changed' }) },
            { ...audit, data: JSON.stringify({ ...decoded, createdAtUtc: 'yesterday' }) },
            { ...audit, data: JSON.stringify({ ...decoded, action: { command: 'unknown' } }) },
            { ...audit, data: JSON.stringify({ id: audit.id, action: 'pbe.cooperation.inputs' }) },
            { ...audit, season_id: 'season' }, { ...audit, owner_id: 'actor' }, { ...audit, revision: 2 },
        ];
        for (const [i, row] of invalid.entries()) {
            const path = join(dir, 'invalid-' + i);
            await assert.rejects(api.writeBundle(path, input(row)), /audit|fields/);
            await assert.rejects(stat(path), { code: 'ENOENT' });
        }
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
