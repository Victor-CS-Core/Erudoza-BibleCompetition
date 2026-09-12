import { pbeSummary, type PbeSession } from '../pbe/sessions';
import type { RequestContext } from '../types';
import { body, HttpError, json } from '../types';
import { atomic } from '../application/model';
import type { Session } from '../study/routes';
import { validateZone, resolveTrainingCalendar } from './calendar';
import { preference, resolvePreference, write, makeRecap } from './store';
import type { Writes } from './store';
import { today, honors, journey } from './query';
export async function handleTraining(ctx: RequestContext): Promise<Response | null> {
    const { path, request } = ctx, method = request.method;
    const recap = path.match(/^\/api\/v1\/study\/sessions\/([^/]+)\/recap$/);
    if (!recap && !/^\/api\/v1\/progress\/me\/(today|honors|journey|preferences)$/.test(path))
        return null;
    if (ctx.actor.kind !== 'Student' || ctx.actor.role !== 'Student' || ctx.orgId !== ctx.actor.organizationId)
        throw new HttpError(403, 'Student access is required.');
    const url = new URL(request.url), seasonId = url.searchParams.get('seasonId');
    if (recap && method === 'GET') {
        const pbe=await ctx.store.get<PbeSession>('pbe-session',recap[1],ctx.orgId);
        if(pbe){if(pbe.value.studentUserId!==ctx.actor.userId)throw new HttpError(404,'Study session was not found.');const interruption=await ctx.store.get('pbe-solo-interruption',pbe.value.id,ctx.orgId);if(pbe.value.status!=='Completed'&&!interruption)throw new HttpError(409,'Complete your session to save its recap.');return json(pbeSummary(pbe.value,!!interruption).recap);}
        const s = (await ctx.store.require<Session>('session', recap[1], ctx.orgId)).value;
        if (s.studentUserId !== ctx.actor.userId)
            throw new HttpError(404, 'Study session was not found.');
        if (s.status !== 'Completed')
            throw new HttpError(409, `Resume /student/study?sessionId=${s.id} before viewing the recap.`);
        return json(s.recap ?? await makeRecap(ctx, s));
    }
    if (method === 'GET') {
        if (path.endsWith('/today'))
            return json(await today(ctx, seasonId));
        if (path.endsWith('/honors'))
            return json(await honors(ctx, seasonId));
        if (path.endsWith('/journey'))
            return json(await journey(ctx, seasonId, url.searchParams.get('after')));
    }
    if (method === 'PUT' && path.endsWith('/preferences')) {
        const input = await body<{
            weeklyTarget: 3 | 4 | 5;
            timeZone: string;
        }>(request);
        if (![3, 4, 5].includes(input.weeklyTarget))
            throw new HttpError(400, 'Choose 3, 4, or 5 practice days.');
        validateZone(input.timeZone);
        for (let i = 0;; i++) {
            try {
                const old = await preference(ctx), now = new Date().toISOString(), p = resolvePreference(ctx, old, now, input.timeZone);
                if (!old) {
                    p.weeklyTarget = input.weeklyTarget;
                }
                else if (p.timeZone === input.timeZone && p.weeklyTarget === input.weeklyTarget)
                    p.pending = null;
                else
                    p.pending = { ...input, effectiveAtUtc: resolveTrainingCalendar(now, p).nextWeekAtUtc };
                const w: Writes = { statements: [], guards: [] };
                write(ctx, w, 'training-preferences', p.id, p, old);
                await atomic(ctx, 'training.preferences', w.statements, w.guards);
                return json({ timeZone: p.timeZone, weeklyTarget: p.weeklyTarget, pending: p.pending });
            }
            catch (e) {
                if (i >= 4 || !(e instanceof HttpError && e.status === 409 || String(e).includes('UNIQUE constraint failed')))
                    throw e;
            }
        }
    }
    return null;
}
