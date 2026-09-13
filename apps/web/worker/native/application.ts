import {cooperation,continueCooperation,cooperationStudents} from './pbe/cooperation-progress';
import { coverage } from './application/coverage';
import type { RequestContext } from './types';
import { admin, body, HttpError, json, noContent, requiredString } from './types';
import { hashUserPassword } from './auth';
import { administrationBudget, assertStorageCapacity, storageCapacityGuard } from './admin-limits';
import { content } from './application/content';
import { library } from './application/library';
import { atomic, contains, deletion, difficulty, editable, effectiveSources, fail, id, memberId, range, scopeDto, scopePacks, scopeSources, seasonSummaries, student, students, learner, requireLearner, studentAssignments, validatePackRanges } from './application/model';
import type { Assignment, Membership, Pack, Scope, Season } from './application/model';
export { effectiveSources } from './application/model';
async function mapSeason(ctx: RequestContext, s: Season) { return { ...s, scopeUnitCount: (await effectiveSources(ctx, s.id)).length, assignmentCount: (await studentAssignments(ctx,s.id)).length }; }
export async function handleApplication(ctx: RequestContext): Promise<Response | null> {
    const { request, path, store, orgId } = ctx, method = request.method;
    if (orgId !== ctx.actor.organizationId)
        throw new HttpError(403, 'Organization access denied.');
    if ((path === '' || path === '/') && method === 'GET')
        return json(await ctx.env.DB.prepare('SELECT id,name,slug FROM Organizations WHERE id=?').bind(orgId).first());
    if (path === '/seasons' && method === 'GET')
        return json(await seasonSummaries(ctx));
    const seasonMatch = path.match(/^\/seasons\/([^/]+)(.*)$/);
    if (seasonMatch && (!seasonMatch[2] || seasonMatch[2] === '/assignments') && method === 'GET') {
        const s = await store.require<Season>('season', seasonMatch[1], orgId);
        if (!seasonMatch[2])
            return json(await mapSeason(ctx, s.value));
        const list = await store.list<Assignment>('assignment', orgId, { seasonId: s.value.id, ...(ctx.actor.kind === 'Student' ? { ownerId: ctx.actor.userId } : {}) });
        const usersById = new Map((await students(ctx)).map(u => [u.userId, u]));
        const memberships = new Map((await store.list<Membership>('membership', orgId, { seasonId: s.value.id })).map(m => [m.studentUserId ?? m.userId, m]));
        return json(list.filter(a => usersById.has(a.studentUserId)).map(a => ({ ...a, studentDisplayName: usersById.get(a.studentUserId)?.displayName ?? null, studentUserName: usersById.get(a.studentUserId)?.userName ?? null, difficulty: memberships.get(a.studentUserId)?.difficulty ?? 'Standard' })));
    }
    if (!/^\/(students|seasons|content-packs|scripture-catalog|library)(\/|$)/.test(path))
        return null;
    const libraryResult = await library(ctx);
    if (libraryResult)
        return libraryResult;
    admin(ctx.actor);
    if(seasonMatch&&/^\/pbe-cooperation(?:\/(?:continue|students))?$/.test(seasonMatch[2])){
        const seasonId=seasonMatch[1],suffix=seasonMatch[2];
        if(method==='GET')return json(suffix.endsWith('/students')?await cooperationStudents(ctx,seasonId,new URL(request.url)):await cooperation(ctx,seasonId,'CoachSummary'));
        if(method==='POST'&&suffix.endsWith('/continue')){const input=await body<{seasonId:string;workId?:string}>(request);if(input.seasonId!==seasonId)throw new HttpError(400,'Choose the route season.');return json(await continueCooperation(ctx,input,'CoachContinue'));}
        return null;
    }
    if (path.startsWith('/scripture-catalog') || path === '/content-packs/import' || path === '/content-packs/import-from-catalog')
        throw new HttpError(410, 'Manual imports have been retired. Choose books from the built-in NKJV library.');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
        await administrationBudget(ctx);
    if (path === '/students' && method === 'GET')
        return json(await students(ctx));
    if (path === '/students' && method === 'POST') {
        const input = await body<{
            userName: string;
            displayName: string;
            password: string;
        }>(request, 4096), userName = requiredString(input.userName, 'Username', 100).toLowerCase(), displayName = requiredString(input.displayName, 'Display name', 200);
        if (!/^[a-z0-9][a-z0-9._-]*$/.test(userName))
            return fail('Use letters, numbers, dots, underscores or hyphens for usernames.');
        if (await ctx.env.DB.prepare('SELECT id FROM Users WHERE user_name=? OR email=?').bind(userName, userName).first())
            throw new HttpError(409, 'That username is already in use.');
        if (typeof input.password !== 'string')
            return fail('Password is required.');
        await assertStorageCapacity(ctx, 'students');
        await administrationBudget(ctx, true);
        const userId = id(), password = await hashUserPassword(ctx.env, orgId, userId, input.password);
        await atomic(ctx, 'student.create', [storageCapacityGuard(ctx, 'students'), ctx.env.DB.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) VALUES(?,?,?,?,'Student','Student',?,?)").bind(userId, orgId, userName, displayName, password, id())]);
        return json({ userId, userName, displayName, email: null, isActive: true }, 201);
    }
    const studentMatch = path.match(/^\/students\/([^/]+)\/(password|state)$/);
    if (studentMatch && (studentMatch[2] === 'password' && method === 'POST' || studentMatch[2] === 'state' && method === 'PUT')) {
        await student(ctx, studentMatch[1]);
        const input = await body<{
            password: string;
            isActive: boolean;
        }>(request, 4096);
        if (studentMatch[2] === 'password') {
            if (typeof input.password !== 'string')
                return fail('Password is required.');
            await administrationBudget(ctx, true);
            await atomic(ctx, 'student.password.reset', [ctx.env.DB.prepare("UPDATE Users SET password_hash=?,credential_version=? WHERE id=? AND org_id=? AND kind='Student'").bind(await hashUserPassword(ctx.env, orgId, studentMatch[1], input.password), id(), studentMatch[1], orgId)]);
        }
        else {
            if (typeof input.isActive !== 'boolean')
                return fail('isActive must be a boolean.');
            await atomic(ctx, 'student.state', [ctx.env.DB.prepare("UPDATE Users SET credential_version=CASE WHEN active<>? THEN ? ELSE credential_version END,active=? WHERE id=? AND org_id=? AND kind='Student'").bind(+input.isActive, id(), +input.isActive, studentMatch[1], orgId)]);
        }
        return noContent();
    }
    const contentResult = await content(ctx);
    if (contentResult)
        return contentResult;
    if (path === '/seasons' && method === 'POST') {
        const input = await body<{
            name: string;
            yearLabel: string;
            ruleProfileKey: string;
            startDate?: string;
            targetCompetitionDate?: string;
        }>(request, 4096);
        if (input.ruleProfileKey !== 'PBE_STYLE_V1')
            return fail('Rule profile was not found.');
        const date = (v: unknown) => { if (v == null)
            return null; if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))
            return fail('Use an ISO calendar date.'); return v; };
        const s: Season = { id: id(), organizationId: orgId, name: requiredString(input.name, 'Season name'), yearLabel: requiredString(input.yearLabel, 'Year label', 40), ruleProfileKey: input.ruleProfileKey, ruleProfileVersion: 1, status: 'Draft', startDate: date(input.startDate), targetCompetitionDate: date(input.targetCompetitionDate), createdAtUtc: new Date().toISOString() };
        await assertStorageCapacity(ctx, 'seasons');
        await atomic(ctx, 'season.create', [storageCapacityGuard(ctx, 'seasons'), store.insertion('season', s.id, orgId, s)]);
        return json({ ...s, scopeUnitCount: 0, assignmentCount: 0 }, 201);
    }
    if (!seasonMatch)
        return null;
    const seasonId = seasonMatch[1], suffix = seasonMatch[2], saved = await store.require<Season>('season', seasonId, orgId), s = saved.value, guard = { kind: 'season', id: seasonId, revision: saved.revision };
    const updateSeason = () => store.update('season', seasonId, orgId, s, saved.revision);
    if (suffix === '/scope' && method === 'GET')
        return json(scopeDto((await store.get<Scope>('scope', seasonId, orgId))?.value ?? { contentPackId: null, includes: [], excludes: [] }));
    if (suffix === '/scope' && method === 'POST') {
        editable(s);
        if (s.status === 'Active')
            return fail('Season passages are locked.');
        const input = await body<Scope>(request, 65536);
        if (!input || typeof input !== 'object') return fail('Choose library books and passage ranges.');
        if (input.packs !== undefined && !Array.isArray(input.packs)) return fail('Choose library books.');
        const entries = scopePacks(input);
        if (!entries.length || entries.length > 66 || new Set(entries.map(p => p?.contentPackId)).size !== entries.length)
            return fail('Choose between 1 and 66 distinct books.');
        const packs = entries.map(p => {
            if (!p || typeof p.contentPackId !== 'string' || !Array.isArray(p.includes) || !p.includes.length || !Array.isArray(p.excludes ?? [])) return fail('Each book needs valid passage ranges.');
            return { contentPackId: p.contentPackId, includes: p.includes.map(range), excludes: (p.excludes ?? []).map(range) };
        });
        if (packs.reduce((total,p) => total+p.includes.length+p.excludes.length,0)>100) return fail('Use at most 100 include and exclude ranges.');
        const savedPacks = await store.getMany<Pack>('pack', packs.map(p => p.contentPackId), orgId);
        if (savedPacks.length !== packs.length) throw new HttpError(404, 'A selected book was not found.');
        const previous = await store.get<Scope>('scope', seasonId, orgId);
        const historicalIds=new Set(previous?scopePacks(previous.value).map(p=>p.contentPackId):[]);
        if(input.packs!==undefined&&savedPacks.some(p=>!p.value.isBuiltIn&&!historicalIds.has(p.value.id)))return fail('Choose new books from the built-in NKJV library.');
        await validatePackRanges(ctx, packs);
        const scope: Scope = scopeDto({contentPackId:null,includes:[],excludes:[],packs});
        s.status = (await scopeSources(ctx, scope)).length ? 'ContentReady' : 'Draft';
        await atomic(ctx, 'season.scope', [previous ? store.update('scope', seasonId, orgId, scope, previous.revision) : store.insertion('scope', seasonId, orgId, scope, { seasonId }), updateSeason()], [guard, ...savedPacks.map(p => ({kind:'pack',id:p.value.id,revision:p.revision}))]);
        return noContent();
    }
    if (suffix === '/activate' && method === 'POST') {
        editable(s);
        const problems: string[] = [];
        if (s.ruleProfileKey !== 'PBE_STYLE_V1')
            problems.push('A rule profile version is required.');
        if (!(await effectiveSources(ctx, seasonId)).length)
            problems.push('Competition scope must resolve to at least one source unit.');
        if (problems.length)
            return json({ activated: false, blockingProblems: problems }, 400);
        s.status = 'Active';
        await atomic(ctx, 'season.activate', [updateSeason()], [guard]);
        return json({ activated: true, blockingProblems: [] });
    }
    if (['/close', '/archive'].includes(suffix) && method === 'POST') {
        const next = suffix === '/close' ? 'Completed' : 'Archived';
        if (s.status === next)
            return noContent();
        if (s.status === 'Archived' || next === 'Completed' && s.status !== 'Active')
            return fail('Only active seasons can be closed. Archived seasons cannot be reopened.');
        s.status = next;
        await atomic(ctx, `season.${suffix.slice(1)}`, [updateSeason()], [guard]);
        return noContent();
    }
    const personal = suffix === '/my-assignments';
    if (personal) await requireLearner(ctx);
    if (personal && method === 'GET') {
        const membership = await store.get<Membership>('membership',memberId(seasonId,ctx.actor.userId),orgId);
        return json((await store.list<Assignment>('assignment',orgId,{seasonId,ownerId:ctx.actor.userId})).map(a=>({...a,studentDisplayName:ctx.actor.displayName,difficulty:membership?.value.difficulty??'Standard'})));
    }
    const personalDelete=suffix.match(/^\/my-assignments\/([^/]+)$/);
    if (personalDelete && method === 'DELETE') {
        await requireLearner(ctx); editable(s);
        const a=await store.require<Assignment>('assignment',personalDelete[1],orgId);
        if(a.value.seasonId!==seasonId || a.value.studentUserId!==ctx.actor.userId) throw new HttpError(404,'Assignment was not found.');
        await atomic(ctx,'season.personal-assignment.remove',[deletion(ctx,'assignment',a.value.id)],[guard,{kind:'assignment',id:a.value.id,revision:a.revision},{kind:'@active-learner',id:ctx.actor.userId,revision:0}]);
        return noContent();
    }
    if ((suffix === '/assignments' || personal) && method === 'POST') {
        editable(s);
        const input = await body<{
            studentUserId: string;
            contentPackId: string;
            range: unknown;
            type: string;
            difficulty?: string;
        }>(request, 8192);
        if(personal && input.studentUserId !== undefined) return fail('Personal assignments derive the learner from your account.');
        const user = personal ? await learner(ctx,ctx.actor.userId) : await student(ctx,input.studentUserId);
        if (!user.isActive)
            return fail('Reactivate the student before assigning passages.');
        if (!['PrimarySpecialist', 'RequiredCoverage', 'OptionalReview'].includes(input.type))
            return fail('Assignment type is invalid.');
        const r = range(input.range), p = await store.require<Pack>('pack', input.contentPackId, orgId);
        await validatePackRanges(ctx, [{contentPackId:p.value.id,includes:[r],excludes:[]}]);
        if (!(await effectiveSources(ctx, seasonId)).some(u => u.contentPackId === p.value.id && contains(r, u)))
            return fail('This assignment has no available passages inside the season scope.');
        const mid = memberId(seasonId, user.userId), old = await store.get<Membership>('membership', mid, orgId), d = input.difficulty === undefined ? old?.value.difficulty ?? 'Standard' : difficulty(input.difficulty);
        const membership: Membership = { id: mid, seasonId, userId: user.userId, studentUserId: user.userId, difficulty: d };
        const a: Assignment = { id: id(), seasonId, studentUserId: user.userId, contentPackId: p.value.id, type: input.type, ...r, createdAtUtc: new Date().toISOString() };
        if (!personal && ['Draft', 'ContentReady'].includes(s.status))
            s.status = 'AssignmentsReady';
        await atomic(ctx, 'season.assign', [store.insertion('assignment', a.id, orgId, a, { seasonId, ownerId: user.userId }), old ? store.update('membership', mid, orgId, membership, old.revision) : store.insertion('membership', mid, orgId, membership, { seasonId, ownerId: user.userId }), ...(personal ? [] : [updateSeason()])], [guard, { kind: 'pack', id: p.value.id, revision: p.revision }, { kind: personal ? '@active-learner' : '@active-user', id: user.userId, revision: 0 }]);
        return json({ ...a, difficulty: d });
    }
    const diff = suffix.match(/^\/students\/([^/]+)\/difficulty$/);
    if (diff && method === 'PUT') {
        editable(s);
        await student(ctx, diff[1]);
        const input = await body<{
            difficulty: string;
        }>(request, 4096), d = difficulty(input.difficulty);
        if (!(await store.list<Assignment>('assignment', orgId, { seasonId, ownerId: diff[1] })).length)
            return fail('Assign this student to the season before setting difficulty.');
        const mid = memberId(seasonId, diff[1]), old = await store.get<Membership>('membership', mid, orgId), m: Membership = { id: mid, seasonId, userId: diff[1], studentUserId: diff[1], difficulty: d };
        await atomic(ctx, 'season.student-difficulty', [old ? store.update('membership', mid, orgId, m, old.revision) : store.insertion('membership', mid, orgId, m, { seasonId, ownerId: diff[1] }), updateSeason()], [guard]);
        return json({ difficulty: d });
    }
    const assignmentMatch = suffix.match(/^\/assignments\/([^/]+)(\/passage)?$/);
    if (assignmentMatch && (method === 'DELETE' && !assignmentMatch[2] || method === 'PUT' && assignmentMatch[2])) {
        editable(s);
        const a = await store.require<Assignment>('assignment', assignmentMatch[1], orgId);
        await student(ctx,a.value.studentUserId);
        if (a.value.seasonId !== seasonId)
            throw new HttpError(404, 'Assignment was not found in this season.');
        if (method === 'DELETE') {
            if (s.status === 'AssignmentsReady' && (await studentAssignments(ctx,seasonId)).length === 1)
                s.status = 'ContentReady';
            await atomic(ctx, 'season.assignment.remove', [deletion(ctx, 'assignment', a.value.id), updateSeason()], [guard, { kind: 'assignment', id: a.value.id, revision: a.revision }]);
        }
        else {
            const r = range(await body(request, 4096));
            await validatePackRanges(ctx, [{contentPackId:a.value.contentPackId,includes:[r],excludes:[]}]);
            if (!(await effectiveSources(ctx, seasonId)).some(u => u.contentPackId === a.value.contentPackId && contains(r, u)))
                return fail('This assignment has no available passages inside the season scope.');
            await atomic(ctx, 'season.assignment.correct', [store.update('assignment', a.value.id, orgId, { ...a.value, ...r }, a.revision), updateSeason()], [guard, { kind: 'assignment', id: a.value.id, revision: a.revision }]);
        }
        return noContent();
    }
    if (suffix === '/coverage' && method === 'GET')
        return json(await coverage(ctx, s));
    return null;
}
