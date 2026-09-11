import { mkdir, writeFile } from 'node:fs/promises';
// @vitest-environment node
import { expect, it } from 'vitest';
import { createNativeTestApp, TEST_ORG, TEST_USER } from '../test-runtime';
import { Store } from '../store';
import type { RequestContext, Env } from '../types';
import { today } from './query';
import { handleStudy } from '../study/routes';
// @ts-expect-error Node fixture loader.
import { loadLibrary, seedStatements, stableId } from '../../../scripts/nkjv-library.mjs';
it('Today reads no attempt history and has identical reads at 100 and 10000 historical attempts with full canon', async () => {
    const app = await createNativeTestApp();
    try {
        const seed = seedStatements(await loadLibrary());
        for (let i = 0; i < seed.length; i += 20)
            await app.db.batch(seed.slice(i, i + 20).map((sql: string) => app.db.prepare(sql)));
        await app.db.prepare("UPDATE Users SET kind='Student',role='Student' WHERE id=?").bind(TEST_USER).run();
        const season = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', pack = stableId('book:EPH'), store = new Store(app.db as unknown as Env['DB']), range = { bookKey: 'EPH', startChapter: 6, startVerse: 1, endChapter: 6, endVerse: 3 };
        await store.insert('season', season, TEST_ORG, { id: season, name: 'Read budget', status: 'Active' });
        await store.insert('scope', season, TEST_ORG, { contentPackId: pack, includes: [range], excludes: [] });
        await store.insert('assignment', 'assigned', TEST_ORG, { id: 'assigned', seasonId: season, studentUserId: TEST_USER, contentPackId: pack, type: 'PrimarySpecialist', ...range }, { seasonId: season, ownerId: TEST_USER });
        const ctx: RequestContext = { env: { DB: app.db } as unknown as Env, store, orgId: TEST_ORG, actor: { userId: TEST_USER, organizationId: TEST_ORG, displayName: 'Student', userName: 'student', email: null, kind: 'Student', role: 'Student', credentialVersion: 'v1' }, path: '/api/v1/study/sessions', request: new Request('https://erudoza.test/api/v1/study/sessions', { method: 'POST', body: JSON.stringify({ seasonId: season, mode: 'Practice', training: { clientStartId: 'budget', step: 'Practice' } }) }) };
        expect((await handleStudy(ctx))?.status).toBe(200);
        let measured: {
            sql: string;
            rows: number;
            writes: number;
        }[] = [];
        const wrap = (sql: string, statement: ReturnType<typeof app.db.prepare>) => ({ bind(...v: unknown[]) { return wrap(sql, statement.bind(...v)); }, async all() { const r = await statement.all(); measured.push({ sql, rows: r.meta.rows_read, writes: r.meta.rows_written }); return r; }, async first(column?: string) { const r = await statement.all(); measured.push({ sql, rows: r.meta.rows_read, writes: r.meta.rows_written }); const row = r.results[0] as Record<string, unknown> | undefined; return column ? row?.[column] ?? null : row ?? null; } });
        const db = { prepare: (sql: string) => wrap(sql, app.db.prepare(sql)) } as unknown as Env['DB'];
        const measuredCtx = { ...ctx, env: { ...ctx.env, DB: db }, store: new Store(db) };
        const snapshots = [];
        for (const target of [100, 10000]) {
            await app.db.prepare("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<?) INSERT OR IGNORE INTO Records(kind,id,org_id,season_id,owner_id,data) SELECT 'attempt','history-'||x,?,?,?,'{}' FROM n").bind(target, TEST_ORG, season, TEST_USER).run();
            measured = [];
            await today(measuredCtx, season);
            expect(measured.every(q => !q.sql.includes("kind='attempt'") && !q.sql.includes("'$.attempts'"))).toBe(true);
            expect(measured.reduce((n, q) => n + q.writes, 0)).toBe(0);
            snapshots.push({ queries: measured.length, rows: measured.reduce((n, q) => n + q.rows, 0), shape: measured.map(q => q.sql) });
        }
        expect(snapshots[1]).toEqual(snapshots[0]);
        expect(snapshots[0].rows).toBeLessThan(2500);
        await mkdir(new URL('../../../../../.local/', import.meta.url), { recursive: true });
        await writeFile(new URL('../../../../../.local/training-native-read-budget.json', import.meta.url), JSON.stringify(snapshots.map(({ queries, rows }) => ({ queries, rows, writes: 0 })), null, 2));
        console.log('Training Today read budget', JSON.stringify(snapshots.map(({ queries, rows }) => ({ queries, rows, writes: 0 }))));
    }
    finally {
        await app.runtime.dispose();
    }
}, 60000);
