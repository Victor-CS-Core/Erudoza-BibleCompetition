import type { RequestContext } from '../types';
import { body, HttpError, json } from '../types';
import { honorCatalog, honorId, isHonorKey, RULE_VERSION } from './catalog';
import type { HonorUnlock, ProfileSelection } from './catalog';
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validUnlock(award: HonorUnlock | undefined, orgId: string, userId: string, key: string) {
  return !!award && isHonorKey(key) && award.userId === userId && award.key === key && award.ruleVersion === RULE_VERSION && award.id === honorId(orgId, userId, key) && Number.isFinite(Date.parse(award.earnedAtUtc));
}
export async function selfProfile(ctx: RequestContext) {
  const [records, profile] = await Promise.all([
    ctx.store.getMany<HonorUnlock>('mastery-honor', honorCatalog.map(h => honorId(ctx.orgId, ctx.actor.userId, h.key)), ctx.orgId),
    ctx.store.get<ProfileSelection>('user-profile', ctx.actor.userId, ctx.orgId),
  ]);
  const awards = records.map(r => r.value), selected = profile?.value;
  const selectionValid = selected?.userId === ctx.actor.userId && selected.ruleVersion === RULE_VERSION && selected.honorKey && selected.unlockId === honorId(ctx.orgId, ctx.actor.userId, selected.honorKey) && awards.some(a => validUnlock(a, ctx.orgId, ctx.actor.userId, selected.honorKey!));
  return { userId: ctx.actor.userId, displayName: ctx.actor.displayName, avatarHonorKey: selectionValid ? selected!.honorKey : null, honors: honorCatalog.map(h => ({ ...h, ruleVersion: RULE_VERSION, earnedAtUtc: awards.find(a => validUnlock(a, ctx.orgId, ctx.actor.userId, h.key))?.earnedAtUtc ?? null })) };
}
export async function handleProfile(ctx: RequestContext): Promise<Response | null> {
  if (ctx.path === '/api/v1/profile/me' && ctx.request.method === 'GET') return json(await selfProfile(ctx));
  if (ctx.path === '/api/v1/profile/me/avatar' && ctx.request.method === 'PUT') {
    const input = await body<{ honorKey: unknown }>(ctx.request, 1024);
    if (!input || typeof input !== 'object' || !('honorKey' in input) || input.honorKey !== null && !isHonorKey(input.honorKey)) throw new HttpError(400, 'Choose a recognized Honor or reset to initials.');
    const key = input.honorKey;
    if (key !== null) {
      const award = await ctx.store.get<HonorUnlock>('mastery-honor', honorId(ctx.orgId, ctx.actor.userId, key), ctx.orgId);
      if (!validUnlock(award?.value, ctx.orgId, ctx.actor.userId, key)) throw new HttpError(403, 'Earn this mastery Honor before using it as your profile image.');
    }
    const value: ProfileSelection = { id: ctx.actor.userId, userId: ctx.actor.userId, honorKey: key, unlockId: key === null ? null : honorId(ctx.orgId, ctx.actor.userId, key), ruleVersion: key === null ? null : RULE_VERSION };
    await ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data,revision) VALUES('user-profile',?,?,?,?,1) ON CONFLICT(kind,id,org_id) DO UPDATE SET data=excluded.data,revision=Records.revision+1").bind(value.id, ctx.orgId, ctx.actor.userId, JSON.stringify(value)).run();
    return json(await selfProfile(ctx));
  }
  if (ctx.path === '/api/v1/profile/identities' && ctx.request.method === 'GET') {
    const url = new URL(ctx.request.url), raw = url.searchParams.getAll('userId');
    if (url.search.length > 4000 || raw.some(id => !guid.test(id))) throw new HttpError(400, 'Provide valid user IDs.');
    const ids = [...new Set(raw.map(id => id.toLowerCase()))];
    if (ids.length > 50) throw new HttpError(400, 'Request at most 50 unique identities.');
    if (!ids.length) return json([]);
    // IDs use exact primary-key probes; no profile/award history scan or personal-field expansion.
    const rows = await ctx.env.DB.prepare(`SELECT u.id,p.data AS profile,a.data AS award FROM json_each(?) requested
      JOIN Users u ON u.id=requested.value AND u.org_id=? AND u.active=1
      LEFT JOIN Records p ON p.kind='user-profile' AND p.id=u.id AND p.org_id=u.org_id
      LEFT JOIN Records a ON a.kind='mastery-honor' AND a.id=json_extract(p.data,'$.unlockId') AND a.org_id=u.org_id`).bind(JSON.stringify(ids), ctx.orgId).all<{ id: string; profile: string | null; award: string | null }>();
    const found = new Map(rows.results.map(row => { const p = row.profile ? JSON.parse(row.profile) as ProfileSelection : null, a = row.award ? JSON.parse(row.award) as HonorUnlock : undefined; return [row.id, { userId: row.id, avatarHonorKey: p?.userId === row.id && p.ruleVersion === RULE_VERSION && p.honorKey && p.unlockId === honorId(ctx.orgId, row.id, p.honorKey) && validUnlock(a, ctx.orgId, row.id, p.honorKey) ? p.honorKey : null }]; }));
    return json(ids.flatMap(id => found.has(id) ? [found.get(id)!] : []));
  }
  return null;
}
