import type { RequestContext } from '../types';
import { HttpError } from '../types';
import { contains, rangeSql, learner, scopePacks, memberId } from '../application/model';
import { builtInContentSql } from '../application/library-access';
import type { Season, Source, Pack, Scope, Assignment } from '../application/model';
import { guid } from './bank';
import type { BankScope } from './bank';
export interface PbeSource {
    id: string;
    contentPackId: string;
    sourceKind: 'Scripture' | 'Commentary';
    bookKey: string;
    chapter: number | null;
    verse: number | null;
    ordinal: number;
    citation: string;
    canonicalText: string;
}
export interface PbeIntroductionUnit {
    id: string;
    citation: string;
    canonicalText: string;
}
export interface PbeIntroduction {
    id: string;
    organizationId: string;
    seasonId: string;
    bookKey: string;
    sourceEdition: string;
    title: string;
    citation: string;
    licensingStatus: string;
    reviewed: boolean;
    units: PbeIntroductionUnit[];
}
export interface PbeIntroductionAssignment {
    id: string;
    seasonId: string;
    contentPackId: string;
    studentUserId: string;
}
export const introductionLicensed = (status: string) => ['approved', 'public-domain', 'creative-commons'].includes(status);
export type PbeGuard = {
    kind: string;
    id: string;
    revision: number;
};
export async function introductionRows(ctx: RequestContext, seasonId: string, chapterStudentId?:string) {
    if(chapterStudentId){
        const page=await ctx.env.DB.prepare("SELECT data,revision FROM Records WHERE kind='pbe-introduction' AND org_id=? AND season_id=? AND id IN (SELECT json_extract(data,'$.contentPackId') FROM Records WHERE kind='pbe-introduction-assignment' AND org_id=? AND season_id=? AND owner_id=?) LIMIT 10001").bind(ctx.orgId,seasonId,ctx.orgId,seasonId,chapterStudentId).all<{data:string;revision:number}>();
        if(page.results.length>10000)throw new HttpError(413,'PBE_CHAPTER_SCOPE_TOO_LARGE');
        return page.results.map(r=>({value:JSON.parse(r.data) as PbeIntroduction,revision:r.revision}));
    }
    const result = [] as {
        value: PbeIntroduction;
        revision: number;
    }[];
    let after = '';
    for (;;) {
        const page = await ctx.env.DB.prepare("SELECT id,data,revision FROM Records INDEXED BY Records_training_scope WHERE org_id=? AND season_id=? AND owner_id IS NULL AND kind='pbe-introduction' AND id>? ORDER BY id LIMIT 1000").bind(ctx.orgId, seasonId, after).all<{
            id: string;
            data: string;
            revision: number;
        }>();
        result.push(...page.results.map(r => ({ value: JSON.parse(r.data) as PbeIntroduction, revision: r.revision })));
        if (page.results.length < 1000)
            break;
        after = page.results.at(-1)!.id;
    }
    return result;
}
/** Private source view. Request IDs restrict scope and never confer permission. */
export type PbeSourceScope = {
    sources: PbeSource[];
    fingerprint: string;
    eligibility: string;
    guards: PbeGuard[];
    selectedBookKeys: string[];
    seasonId: string;
    studentId?: string;
    assignmentSet: {
        kind: string;
        id: string;
        revision: number;
    }[];
};
export async function resolvePbeSources(ctx: RequestContext, scope: Omit<BankScope, 'sourceUnitIds'>): Promise<PbeSourceScope> { return resolve(ctx, scope, false); }
export async function resolvePbeChapterSources(ctx:RequestContext,seasonId:string){
 const counts=await ctx.env.DB.prepare("SELECT kind,count(*) AS n FROM Records WHERE org_id=? AND season_id=? AND owner_id=? AND kind IN ('assignment','pbe-introduction-assignment') GROUP BY kind").bind(ctx.orgId,seasonId,ctx.actor.userId).all<{kind:string;n:number}>();
 if(counts.results.some(r=>r.n>10000))throw new HttpError(413,'PBE_CHAPTER_SCOPE_TOO_LARGE');
 return resolve(ctx,{organizationId:ctx.orgId,seasonId,studentId:ctx.actor.userId},false,undefined,true);}
/** Continuation is granted only after proving a persisted session belongs to this actor. */
export async function resolvePbeSessionSources(ctx: RequestContext, sessionId: string): Promise<PbeSourceScope> {
    const saved = await ctx.store.require<{
        format: string;
        studentUserId: string;
        seasonId: string;
    }>('pbe-session', guid(sessionId), ctx.orgId);
    if (saved.value.format !== 'Pbe' || saved.value.studentUserId !== ctx.actor.userId)
        throw new HttpError(404, 'Study session was not found.');
    return resolve(ctx, { organizationId: ctx.orgId, seasonId: saved.value.seasonId, studentId: ctx.actor.userId }, true);
}
/** Server-only room boundary: callers supply the authoritative DO snapshot, never request scope flags. */
export async function resolvePbeRoomSources(ctx:RequestContext,room:import('../practice/state').Room,continuation:boolean):Promise<PbeSourceScope>{
 if(room.format!=='Pbe'||room.orgId!==ctx.orgId||(![room.ownerId,room.coachId,...room.members.map(m=>m.userId)].includes(ctx.actor.userId)&&!(ctx.actor.kind==='Adult'&&['Owner','Admin'].includes(ctx.actor.role)&&room.submissions.some(s=>s.appealed))))throw new HttpError(403,'Room access denied.');
 const ids=room.members.map(m=>m.userId);
 const roster=await ctx.env.DB.prepare("SELECT u.id,m.id AS membershipId,m.revision FROM Users u JOIN Records m ON m.kind='membership' AND m.org_id=u.org_id AND m.season_id=? AND m.owner_id=u.id WHERE u.org_id=? AND u.active=1 AND u.kind='Student' AND u.role='Student' AND u.id IN (SELECT value FROM json_each(?))").bind(room.seasonId,ctx.orgId,JSON.stringify(ids)).all<{id:string;membershipId:string;revision:number}>();
 if(roster.results.length!==ids.length||new Set(ids).size!==ids.length)throw new HttpError(403,'Every room participant must retain active season membership.');
 const resolved=await resolve(ctx,{organizationId:ctx.orgId,seasonId:room.seasonId},continuation,room);
 resolved.guards.push(...roster.results.flatMap(r=>[{kind:'membership',id:r.membershipId,revision:r.revision},{kind:'@active-user',id:r.id,revision:0}]));
 return resolved;
}
async function resolve(ctx: RequestContext, scope: Omit<BankScope, 'sourceUnitIds'>, continuation: boolean, room?: import('../practice/state').Room, chapter=false): Promise<PbeSourceScope> {
    const organizationId = guid(scope.organizationId), seasonId = guid(scope.seasonId), studentId = scope.studentId === undefined ? undefined : guid(scope.studentId);
    if (organizationId !== ctx.orgId || ctx.actor.organizationId !== ctx.orgId)
        throw new HttpError(403, 'Organization access denied.');
    const actor = await ctx.env.DB.prepare('SELECT active,kind,role FROM Users WHERE id=? AND org_id=?').bind(ctx.actor.userId, organizationId).first<{
        active: number;
        kind: string;
        role: string;
    }>();
    if (!actor?.active)
        throw new HttpError(403, 'Active membership required.');
    if (actor.kind === 'Student' && (actor.role !== 'Student' || studentId !== ctx.actor.userId && !room))
        throw new HttpError(403, 'Only your own assigned bank is available.');
    if (actor.kind !== 'Student' && (actor.kind !== 'Adult' || !['Owner', 'Admin'].includes(actor.role)))
        throw new HttpError(403, 'Access denied.');
    const season = await ctx.store.require<Season>('season', seasonId, organizationId);
    if (season.value.organizationId !== organizationId || season.value.status !== 'Active')
        throw new HttpError(400, 'Choose an active season.');
    if(room&&!continuation&&!season.value.pbeEnabled)throw new HttpError(403,'PBE training is not enabled for this season.');
    if (studentId) {
        if (!continuation && !season.value.pbeEnabled)
            throw new HttpError(403, 'PBE training is not enabled for this season.');
        // Learner surface parity: chapter scopes admit active learners (students and
        // Owner/Admin coaches on their own learner view), not just strict students.
        if (!(await learner(ctx, studentId)).isActive)
            throw new HttpError(403, 'Active learner required.');
    }
    // Capture the assignment set once and use those exact rows to filter the material.
    // A later insertion must never contribute an unguarded source to this snapshot.
    const revisions = await ctx.env.DB.prepare("SELECT kind,id,revision,data FROM Records INDEXED BY Records_scope WHERE org_id=? AND kind='scope' AND id=? UNION ALL SELECT kind,id,revision,data FROM Records INDEXED BY Records_training_scope WHERE org_id=? AND season_id=? AND owner_id=? AND kind IN ('assignment','pbe-introduction-assignment') ORDER BY kind,id").bind(organizationId, seasonId, organizationId, seasonId, studentId ?? '').all<{
        kind: string;
        id: string;
        revision: number;
        data: string;
    }>();
    if(chapter&&['assignment','pbe-introduction-assignment'].some(kind=>revisions.results.filter(r=>r.kind===kind).length>10000))throw new HttpError(413,'PBE_CHAPTER_SCOPE_TOO_LARGE');
    const savedScope = revisions.results.find(r => r.kind === 'scope');
    const entries = savedScope ? scopePacks(JSON.parse(savedScope.data) as Scope) : [];
    // Source text, licensing and their revisions come from the same SQL snapshot.
    const selected = await ctx.env.DB.prepare(`SELECT DISTINCT u.data,u.revision,p.data AS pack,p.revision AS packRevision FROM json_each(?) selected CROSS JOIN Records p ON p.kind='pack' AND p.id=json_extract(selected.value,'$.contentPackId') CROSS JOIN Records u INDEXED BY Records_owner ON u.kind='source' AND u.owner_id=p.id AND u.org_id=p.org_id
 WHERE (p.org_id=? OR ${builtInContentSql('p')}) AND json_extract(p.data,'$.isActive')=1 AND lower(json_extract(p.data,'$.licensingStatus')) IN ('development-sample','public-domain','approved','creative-commons') AND json_extract(u.data,'$.isActive')=1 AND coalesce(json_extract(u.data,'$.isRetired'),0)=0
 AND EXISTS(SELECT 1 FROM json_each(selected.value,'$.includes') inc WHERE ${rangeSql('inc')}) AND NOT EXISTS(SELECT 1 FROM json_each(selected.value,'$.excludes') exc WHERE ${rangeSql('exc')}) LIMIT 5001`).bind(JSON.stringify(entries), organizationId).all<{
        data: string;
        revision: number;
        pack: string;
        packRevision: number;
    }>();
    if (selected.results.length > 5000)
        throw new HttpError(413, 'Choose at most 5,000 verses for one season scope.');
    const assignments = revisions.results.filter(r => r.kind === 'assignment').map(r => JSON.parse(r.data) as Assignment);
    const allowedRows = selected.results.filter(r => { const s = JSON.parse(r.data) as Source; return !studentId || assignments.some(a => a.contentPackId === s.contentPackId && contains(a, s)); });
    const sourceRecords = allowedRows.map(r => ({ value: JSON.parse(r.data) as Source, revision: r.revision }));
    const packs = [...new Map(allowedRows.map(r => { const p = JSON.parse(r.pack) as Pack; return [p.id, { value: p, revision: r.packRevision }] as const; })).values()];
    const legacy = sourceRecords.map(r => r.value);
    const intros = await introductionRows(ctx, seasonId,chapter?studentId:undefined), storedScope = revisions.results.find(r => r.kind === 'scope');
    const books = new Set(storedScope ? scopePacks(JSON.parse(storedScope.data) as Scope).flatMap(p => p.includes.map(r => r.bookKey.toUpperCase())) : []);
    const membership = studentId ? await ctx.store.get('membership', memberId(seasonId, studentId), organizationId) : null;
    const assigned = new Set(revisions.results.filter(r => r.kind === 'pbe-introduction-assignment').map(r => (JSON.parse(r.data) as PbeIntroductionAssignment).contentPackId));
    const sources: PbeSource[] = legacy.map(s => ({ id: s.id, contentPackId: s.contentPackId, bookKey: s.bookKey, chapter: s.chapter, verse: s.verse, ordinal: s.ordinal, citation: s.citation, canonicalText: s.canonicalText, sourceKind: packs.find(p => p.value.id === s.contentPackId)?.value.sourceType === 'Scripture' ? 'Scripture' : 'Commentary' }));
    for (const { value: p } of intros)
        if (p.organizationId === organizationId && p.seasonId === seasonId && p.reviewed && introductionLicensed(p.licensingStatus) && books.has(p.bookKey) && (!studentId || membership && assigned.has(p.id)))
            sources.push(...p.units.map((u, i) => ({ ...u, contentPackId: p.id, sourceKind: 'Commentary' as const, bookKey: p.bookKey, chapter: null, verse: null, ordinal: i + 1 })));
    if(chapter&&sources.length>10000)throw new HttpError(413,'PBE_CHAPTER_SCOPE_TOO_LARGE');
    const guards = [{ kind: 'season', id: seasonId, revision: season.revision }, ...revisions.results.map(({ kind, id, revision }) => ({ kind, id, revision })), ...packs.map(p => ({ kind: 'pack', id: p.value.id, revision: p.revision })), ...sourceRecords.map(s => ({ kind: 'source', id: s.value.id, revision: s.revision })), ...intros.map(p => ({ kind: 'pbe-introduction', id: p.value.id, revision: p.revision })), ...(membership ? [{ kind: 'membership', id: memberId(seasonId, studentId!), revision: membership.revision }] : []), { kind: actor.kind === 'Student' ? '@active-user' : '@active-admin', id: ctx.actor.userId, revision: 0 }, ...(studentId ? [{ kind: '@active-user', id: studentId, revision: 0 }] : [])];
    const material = JSON.stringify([seasonId, studentId, sources.slice().sort((a, b) => a.id.localeCompare(b.id)).map(s => [s.id, s.contentPackId, s.sourceKind, s.bookKey, s.chapter, s.verse, s.ordinal, s.citation, s.canonicalText])]);
    const eligibility = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material)))].map(b => b.toString(16).padStart(2, '0')).join('');
    return { sources, guards, eligibility, seasonId, studentId, assignmentSet: revisions.results.filter(r => r.kind !== 'scope').map(({ kind, id, revision }) => ({ kind, id, revision })), selectedBookKeys: [...books].sort(), fingerprint: JSON.stringify([season, actor, sources, packs, revisions.results, intros, [...books].sort(), membership, guards]) };
}
/** Exact row-set proof joins B2's same acceptance transaction, including phantom assignments. */
export function pbeAssignmentSetGuard(ctx: RequestContext, scope: PbeSourceScope) {
    const eventId = crypto.randomUUID();
    return ctx.env.DB.prepare(`INSERT INTO Records(kind,id,org_id,data) SELECT 'audit',?,?,CASE WHEN
 (SELECT count(*) FROM Records WHERE org_id=? AND season_id=? AND owner_id=? AND kind IN ('assignment','pbe-introduction-assignment'))=json_array_length(?)
 AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM Records r WHERE r.org_id=? AND r.season_id=? AND r.owner_id=? AND r.kind=json_extract(expected.value,'$.kind') AND r.id=json_extract(expected.value,'$.id') AND r.revision=json_extract(expected.value,'$.revision')))
 THEN ? ELSE 'invalid-json' END`).bind(eventId, ctx.orgId, ctx.orgId, scope.seasonId, scope.studentId ?? '', JSON.stringify(scope.assignmentSet), JSON.stringify(scope.assignmentSet), ctx.orgId, scope.seasonId, scope.studentId ?? '', JSON.stringify({ id: eventId, action: 'pbe.scope.accept' }));
}
