import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { HttpError } from "./types";
import { builtInContentSql } from "./application/library-access";
export interface Stored<T> { value: T; revision: number }
export interface Scope { seasonId?: string; ownerId?: string; limit?: number; after?: string }
export class Store {
  constructor(public db: D1Database) {}
  async get<T>(kind: string, id: string, org: string): Promise<Stored<T> | null> {
    const shared = kind === 'pack' || kind === 'source' ? ` OR ${builtInContentSql('r')}` : '';
    const row = await this.db.prepare(`SELECT r.data,r.revision FROM Records r WHERE r.kind=? AND r.id=? AND (r.org_id=?${shared})`).bind(kind,id,org).first<{data:string;revision:number}>();
    return row ? { value: JSON.parse(row.data) as T, revision: row.revision } : null;
  }
  async require<T>(kind: string, id: string, org: string): Promise<Stored<T>> { const item = await this.get<T>(kind,id,org); if (!item) throw new HttpError(404,"Record not found."); return item; }
  async getMany<T>(kind: string, ids: string[], org: string): Promise<Stored<T>[]> {
    const shared = kind === 'pack' || kind === 'source' ? ` OR ${builtInContentSql('r')}` : '';
    const rows = await this.db.prepare(`SELECT r.data,r.revision FROM Records r WHERE r.kind=? AND r.id IN (SELECT value FROM json_each(?)) AND (r.org_id=?${shared})`).bind(kind,JSON.stringify(ids),org).all<{data:string;revision:number}>();
    return rows.results.map(row => ({value:JSON.parse(row.data) as T,revision:row.revision}));
  }
  async list<T>(kind: string, org: string, scope: Scope = {}): Promise<T[]> {
    const shared = kind === 'pack' || kind === 'source' ? ` OR ${builtInContentSql('r')}` : '';
    // The shared-library OR otherwise favors a scan of every source primary key.
    const index = kind === 'source' && scope.ownerId !== undefined ? ' INDEXED BY Records_owner' : '';
    let sql = `SELECT r.data FROM Records r${index} WHERE (r.org_id=?${shared}) AND r.kind=?`; const args: (string|number)[] = [org,kind];
    if (scope.seasonId !== undefined) { sql += " AND season_id=?"; args.push(scope.seasonId); }
    if (scope.ownerId !== undefined) { sql += " AND owner_id=?"; args.push(scope.ownerId); }
    if (scope.after) { sql += " AND id>?"; args.push(scope.after); }
    sql += " ORDER BY id LIMIT ?"; args.push(scope.limit === undefined ? 5001 : Math.min(scope.limit,5000));
    const rows = await this.db.prepare(sql).bind(...args).all<{data:string}>();
    if(scope.limit===undefined&&rows.results.length>5000)throw new HttpError(413,"This collection exceeds the pilot query limit. Use a narrower scope or paginated export.");
    return rows.results.map(row => JSON.parse(row.data) as T);
  }
  insertion(kind: string, id: string, org: string, value: unknown, scope: Scope = {}): D1PreparedStatement {
    return this.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) VALUES(?,?,?,?,?,?,1)").bind(kind,id,org,scope.seasonId??null,scope.ownerId??null,JSON.stringify(value));
  }
  async insert(kind: string,id: string,org: string,value: unknown,scope: Scope = {}): Promise<void> { await this.insertion(kind,id,org,value,scope).run(); }
  update(kind:string,id:string,org:string,value:unknown,revision:number):D1PreparedStatement {
    return this.db.prepare("UPDATE Records SET data=?,revision=revision+1 WHERE kind=? AND id=? AND org_id=? AND revision=?").bind(JSON.stringify(value),kind,id,org,revision);
  }
  async put(kind:string,id:string,org:string,value:unknown,revision:number):Promise<void> {
    const result = await this.update(kind,id,org,value,revision).run(); if (result.meta.changes !== 1) throw new HttpError(409,"The record changed. Refresh and retry.");
  }
  async remove(kind:string,id:string,org:string):Promise<void> { await this.db.prepare("DELETE FROM Records WHERE kind=? AND id=? AND org_id=?").bind(kind,id,org).run(); }
}
