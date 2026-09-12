import type { RequestContext } from '../types';
import { HttpError, requiredString } from '../types';
import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { builtInContentSql, scopeEntriesSql } from './library-access';
import type { LibraryChapter } from './library';
export interface Range {
    bookKey: string;
    startChapter: number;
    startVerse: number;
    endChapter: number;
    endVerse: number;
}
export interface Source {
    id: string;
    contentPackId: string;
    citation: string;
    bookKey: string;
    chapter: number;
    verse: number;
    ordinal: number;
    canonicalText: string;
    isActive: boolean;
    isRetired?: boolean;
    knowledgeUnitId?: string;
}
export interface Pack {
    id: string;
    packKey: string;
    version: number;
    locale: string;
    sourceType: string;
    licensingStatus: string;
    unitCount: number;
    isActive: boolean;
    fingerprint?: string;
    isBuiltIn?: boolean;
    bookKey?: string;
    bookName?: string;
    bookOrdinal?: number;
    chapters?: LibraryChapter[];
}
export interface Season {
    pbeEnabled?: boolean;
    id: string;
    organizationId: string;
    name: string;
    yearLabel: string;
    status: string;
    ruleProfileKey: string;
    ruleProfileVersion: number;
    startDate: string | null;
    targetCompetitionDate: string | null;
    createdAtUtc: string;
}
export interface Scope {
    contentPackId: string | null;
    includes: Range[];
    excludes: Range[];
    packs?: PackScope[];
}
export interface PackScope { contentPackId: string; includes: Range[]; excludes: Range[] }
export function scopePacks(scope: Scope): PackScope[] { return scope.packs ?? (scope.contentPackId ? [{contentPackId:scope.contentPackId,includes:scope.includes,excludes:scope.excludes??[]}] : []); }
export function scopeDto(scope: Scope): Scope { const packs=scopePacks(scope); return {...(packs.length===1?packs[0]:{contentPackId:null,includes:[],excludes:[]}),packs}; }
export interface Assignment extends Range {
    id: string;
    seasonId: string;
    studentUserId: string;
    contentPackId: string;
    type: string;
    createdAtUtc: string;
}
export interface Membership {
    id: string;
    seasonId: string;
    userId: string;
    studentUserId: string;
    difficulty: string;
}
export interface Student {
    userId: string;
    userName: string;
    displayName: string;
    email: string | null;
    isActive: boolean;
}
export const id = () => crypto.randomUUID();
export const memberId = (seasonId: string, userId: string) => `${seasonId}:${userId}`;
export const fail = (message: string): never => { throw new HttpError(400, message); };
export function integer(value: unknown, name: string, max = 100000): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max)
    return fail(`${name} must be a positive integer no greater than ${max}.`); return value; }
export function range(value: unknown): Range { if (!value || typeof value !== 'object')
    return fail('Choose a valid passage range.'); const v = value as Range; const r = { bookKey: requiredString(v.bookKey, 'Book', 20).toUpperCase(), startChapter: integer(v.startChapter, 'Start chapter', 200), startVerse: integer(v.startVerse, 'Start verse', 1000), endChapter: integer(v.endChapter, 'End chapter', 200), endVerse: integer(v.endVerse, 'End verse', 1000) }; if (r.endChapter < r.startChapter || r.endChapter === r.startChapter && r.endVerse < r.startVerse)
    return fail('Choose a valid passage range.'); return r; }
export const contains = (r: Range, s: Source) => r.bookKey.toUpperCase() === s.bookKey.toUpperCase() && (s.chapter > r.startChapter || s.chapter === r.startChapter && s.verse >= r.startVerse) && (s.chapter < r.endChapter || s.chapter === r.endChapter && s.verse <= r.endVerse);
export function editable(s: Season): void { if (['Completed', 'Archived'].includes(s.status))
    fail('This season is closed. Saved passages and student plans are read-only.'); }
export function difficulty(v: unknown): string { if (typeof v !== 'string' || !['Foundation', 'Standard', 'Advanced'].includes(v))
    return fail('Choose Foundation, Standard, or Advanced difficulty.'); return v; }
export async function students(ctx: RequestContext): Promise<Student[]> { const result = await ctx.env.DB.prepare('SELECT id AS userId,user_name AS userName,display_name AS displayName,email,active AS isActive FROM Users WHERE org_id=? AND kind=\'Student\' AND role=\'Student\' ORDER BY display_name').bind(ctx.orgId).all<Student>(); return result.results.map(s => ({ ...s, isActive: !!s.isActive })); }
export async function student(ctx: RequestContext, userId: string): Promise<Student> { const s = await ctx.env.DB.prepare('SELECT id AS userId,user_name AS userName,display_name AS displayName,email,active AS isActive FROM Users WHERE org_id=? AND id=? AND kind=\'Student\' AND role=\'Student\'').bind(ctx.orgId, userId).first<Student>(); if (!s)
    throw new HttpError(404, 'Student was not found in this organization.'); return { ...s, isActive: !!s.isActive }; }
export const approvedPack = (p: Pack) => p.isActive && ['development-sample', 'public-domain', 'approved', 'creative-commons'].includes(p.licensingStatus.toLowerCase());
export function rangeSql(rangeAlias: string, sourceAlias='u'): string {
    return `upper(json_extract(${rangeAlias}.value,'$.bookKey'))=upper(json_extract(${sourceAlias}.data,'$.bookKey')) AND (json_extract(${sourceAlias}.data,'$.chapter')>json_extract(${rangeAlias}.value,'$.startChapter') OR (json_extract(${sourceAlias}.data,'$.chapter')=json_extract(${rangeAlias}.value,'$.startChapter') AND json_extract(${sourceAlias}.data,'$.verse')>=json_extract(${rangeAlias}.value,'$.startVerse'))) AND (json_extract(${sourceAlias}.data,'$.chapter')<json_extract(${rangeAlias}.value,'$.endChapter') OR (json_extract(${sourceAlias}.data,'$.chapter')=json_extract(${rangeAlias}.value,'$.endChapter') AND json_extract(${sourceAlias}.data,'$.verse')<=json_extract(${rangeAlias}.value,'$.endVerse')))`;
}
export async function scopeSources(ctx: RequestContext, scope: Scope): Promise<Source[]> {
    const packs=scopePacks(scope); if(!packs.length)return [];
    // Keep selected packs before sources so SQLite probes the owner index instead of scanning the canon.
    const rows=await ctx.env.DB.prepare(`SELECT DISTINCT u.data FROM json_each(?) selected CROSS JOIN Records p ON p.kind='pack' AND p.id=json_extract(selected.value,'$.contentPackId') CROSS JOIN Records u INDEXED BY Records_owner ON u.kind='source' AND u.owner_id=p.id AND u.org_id=p.org_id
     WHERE (p.org_id=? OR ${builtInContentSql('p')}) AND json_extract(p.data,'$.isActive')=1 AND lower(json_extract(p.data,'$.licensingStatus')) IN ('development-sample','public-domain','approved','creative-commons') AND json_extract(u.data,'$.isActive')=1 AND coalesce(json_extract(u.data,'$.isRetired'),0)=0
     AND EXISTS(SELECT 1 FROM json_each(selected.value,'$.includes') inc WHERE ${rangeSql('inc')}) AND NOT EXISTS(SELECT 1 FROM json_each(selected.value,'$.excludes') exc WHERE ${rangeSql('exc')}) LIMIT 5001`).bind(JSON.stringify(packs),ctx.orgId).all<{data:string}>();
    if(rows.results.length>5000)throw new HttpError(413,'Choose at most 5,000 verses for one season scope.');
    return rows.results.map(r=>JSON.parse(r.data) as Source).sort((a,b)=>a.ordinal-b.ordinal||a.id.localeCompare(b.id));
}
export async function validatePackRanges(ctx: RequestContext, entries: PackScope[]): Promise<void> {
    const packs=await ctx.store.getMany<Pack>('pack',entries.map(p=>p.contentPackId),ctx.orgId);
    const chapters=new Map<string,Set<number>>();
    for(const {value:p} of packs)if(p.isBuiltIn&&p.bookKey&&p.chapters)for(const c of p.chapters)chapters.set(`${p.id}:${p.bookKey.toUpperCase()}:${c.number}`,new Set(c.verses));
    const ids=packs.filter(p=>!p.value.isBuiltIn).map(p=>p.value.id);
    if(ids.length){
      const rows=await ctx.env.DB.prepare(`SELECT r.owner_id AS contentPackId,upper(json_extract(r.data,'$.bookKey')) AS bookKey,json_extract(r.data,'$.chapter') AS chapter,json_group_array(json_extract(r.data,'$.verse')) AS verses FROM Records r WHERE r.kind='source' AND r.owner_id IN (SELECT value FROM json_each(?)) AND r.org_id=? GROUP BY r.owner_id,upper(json_extract(r.data,'$.bookKey')),json_extract(r.data,'$.chapter')`).bind(JSON.stringify(ids),ctx.orgId).all<{contentPackId:string;bookKey:string;chapter:number;verses:string}>();
      for(const row of rows.results)chapters.set(`${row.contentPackId}:${row.bookKey}:${row.chapter}`,new Set(JSON.parse(row.verses) as number[]));
    }
    for(const entry of entries) for(const selected of [...entry.includes,...entry.excludes]) {
        const key=`${entry.contentPackId}:${selected.bookKey.toUpperCase()}:`;
        if(!chapters.get(key+selected.startChapter)?.has(selected.startVerse)||!chapters.get(key+selected.endChapter)?.has(selected.endVerse)) fail('Choose chapters and verses that exist in the selected book.');
        for(let chapter=selected.startChapter;chapter<=selected.endChapter;chapter++){
            const verses=chapters.get(key+chapter)??fail('The selected range contains a chapter unavailable in this book.');
            const first=chapter===selected.startChapter?selected.startVerse:1,last=chapter===selected.endChapter?selected.endVerse:Math.max(...verses);
            for(let verse=first;verse<=last;verse++)if(!verses.has(verse))fail('The selected range contains a verse unavailable in this book.');
        }
    }
}
export async function effectiveSources(ctx: RequestContext, seasonId: string, studentId?: string): Promise<Source[]> { await ctx.store.require<Season>('season', seasonId, ctx.orgId); const scope = await ctx.store.get<Scope>('scope', seasonId, ctx.orgId); if (!scope)
    return []; const all = await scopeSources(ctx, scope.value); if (studentId === undefined)
    return all; await student(ctx, studentId); const assignments = await ctx.store.list<Assignment>('assignment', ctx.orgId, { seasonId, ownerId: studentId }); return all.filter(s => assignments.some(a => a.contentPackId === s.contentPackId && contains(a, s))); }
/** Guard checks execute inside the same D1 transaction as every mutation. Invalid JSON
 * deliberately violates Records' CHECK constraint to roll back a stale multi-record write. */
export async function atomic(ctx: RequestContext, action: string, statements: D1PreparedStatement[], guards: {
    kind: string;
    id: string;
    revision: number;
}[] = []): Promise<void> {
    const auditId = id(), query = `NOT EXISTS(SELECT 1 FROM json_each(?) g WHERE CASE WHEN json_extract(g.value,'$.kind')='@active-user'
      THEN NOT EXISTS(SELECT 1 FROM Users u WHERE u.id=json_extract(g.value,'$.id') AND u.org_id=? AND u.active=1 AND u.kind='Student' AND u.role='Student')
      ELSE NOT EXISTS(SELECT 1 FROM Records r WHERE r.kind=json_extract(g.value,'$.kind') AND r.id=json_extract(g.value,'$.id') AND (r.org_id=? OR ${builtInContentSql('r')}) AND r.revision=json_extract(g.value,'$.revision')) END)`;
    const args = [JSON.stringify(guards), ctx.orgId, ctx.orgId];
    const audit = JSON.stringify({ id: auditId, actorId: ctx.actor.userId, action, createdAtUtc: new Date().toISOString() });
    const guard = ctx.env.DB.prepare(`INSERT INTO Records(kind,id,org_id,data) VALUES('audit',?,?,CASE WHEN ${query} THEN ? ELSE 'invalid-json' END)`).bind(auditId, ctx.orgId, ...args, audit);
    try {
        await ctx.env.DB.batch([guard, ...statements]);
    }
    catch (error) {
        if (String(error).includes('CHECK constraint failed'))
            throw new HttpError(409, 'The record changed. Refresh and retry.');
        throw error;
    }
}
export const deletion = (ctx: RequestContext, kind: string, recordId: string) => ctx.env.DB.prepare('DELETE FROM Records WHERE kind=? AND id=? AND org_id=?').bind(kind, recordId, ctx.orgId);
export async function seasonSummaries(ctx: RequestContext): Promise<unknown[]> {
    const result = await ctx.env.DB.prepare(`SELECT s.data,
 (SELECT count(*) FROM Records a WHERE a.kind='assignment' AND a.org_id=s.org_id AND a.season_id=s.id) AS assignmentCount,
 (SELECT count(DISTINCT u.id) FROM Records sc CROSS JOIN json_each(${scopeEntriesSql('sc')}) selected CROSS JOIN Records p ON p.kind='pack' AND (p.org_id=sc.org_id OR ${builtInContentSql('p')}) AND p.id=json_extract(selected.value,'$.contentPackId') CROSS JOIN Records u INDEXED BY Records_owner ON u.kind='source' AND u.org_id=p.org_id AND u.owner_id=p.id
 WHERE sc.kind='scope' AND sc.id=s.id AND sc.org_id=s.org_id AND json_extract(p.data,'$.isActive')=1 AND lower(json_extract(p.data,'$.licensingStatus')) IN ('development-sample','public-domain','approved','creative-commons') AND json_extract(u.data,'$.isActive')=1 AND coalesce(json_extract(u.data,'$.isRetired'),0)=0
 AND EXISTS(SELECT 1 FROM json_each(selected.value,'$.includes') inc WHERE ${rangeSql('inc')}) AND NOT EXISTS(SELECT 1 FROM json_each(selected.value,'$.excludes') exc WHERE ${rangeSql('exc')})) AS scopeUnitCount
 FROM Records s WHERE s.kind='season' AND s.org_id=? ORDER BY json_extract(s.data,'$.createdAtUtc') DESC`).bind(ctx.orgId).all<{
        data: string;
        assignmentCount: number;
        scopeUnitCount: number;
    }>();
    return result.results.map(r => ({ ...JSON.parse(r.data), assignmentCount: r.assignmentCount, scopeUnitCount: r.scopeUnitCount }));
}
