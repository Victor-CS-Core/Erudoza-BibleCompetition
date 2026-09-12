// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { describe, it, expect, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({ DurableObject: class {
        constructor(protected ctx: unknown, protected env: unknown) { }
    } }));
import { PracticeRoom } from '../practice/room';
import { PracticeReports } from '../practice/reports';
import { PbeSoloRound } from '../pbe/solo-round';
import type { Env } from '../types';
function fixture() { const db = new DatabaseSync(':memory:'); const ctx = { id: { toString: () => 'Org:Room' }, storage: { sql: { exec(query: string, ...params: unknown[]) { const result = db.prepare(query).all(...params as never[]); return { toArray: () => result }; } }, getAlarm() { throw Error('Offline handler touched alarm scheduling'); }, setAlarm() { throw Error('Offline handler scheduled alarm'); } }, getWebSockets() { throw Error('Offline handler enumerated sockets'); } } as unknown as DurableObjectState; const env = { NATIVE_MAINTENANCE_MODE: 'offline-v1', DB: { prepare() { throw Error('Offline handler touched D1'); } } } as unknown as Env; return { db, ctx, env }; }
describe('actual authority offline guards', () => {
    it.each([['Room', PracticeRoom], ['Reports', PracticeReports], ['Solo', PbeSoloRound]] as const)('%s does no normal constructor or fetch work in the closed runtime', async (_name, C) => {
        const { db, ctx, env } = fixture();
        try {
            const obj = new C(ctx, env);
            expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
            const response = await obj.fetch(new Request('https://internal/api/v1/study/sessions/00000000-0000-0000-0000-000000000000/timed'));
            expect(response.status).toBe(404);
        }
        finally {
            db.close();
        }
    });
    it('ignores delivered Room and Solo alarms before storage or D1 work', async () => {
        const { db, ctx, env } = fixture();
        try {
            await new PracticeRoom(ctx, env).alarm();
            await new PbeSoloRound(ctx, env).alarm();
            expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
        }
        finally {
            db.close();
        }
    });
    it('closes delivered sockets without consulting attachments, auth or authority', async () => {
        const { db, ctx, env } = fixture();
        try {
            const obj = new PracticeRoom(ctx, env);
            let closed: number | undefined;
            const socket = { close(code: number) { closed = code; }, deserializeAttachment() { throw Error('Offline socket read attachment'); } } as unknown as WebSocket;
            await obj.webSocketMessage(socket, '{"type":"Ping"}');
            expect(closed).toBe(1001);
            await obj.webSocketClose(socket, 1000, 'closed');
            expect(closed).toBe(1001);
        }
        finally {
            db.close();
        }
    });
});
