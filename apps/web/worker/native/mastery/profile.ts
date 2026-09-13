import type { RequestContext } from '../types';
import { body, HttpError, json } from '../types';
import { honorCatalog, honorId, isHonorKey, ruleVersionFor } from './catalog';
import type { HonorUnlock, ProfileSelection } from './catalog';
import { characterFields, defaultCharacter, defaultShareOptions, portraitIdentity, validateCharacterSave } from './character';
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validUnlock(award: HonorUnlock | undefined, orgId: string, userId: string, key: string, eligible=false) {
  return !!award && isHonorKey(key) && award.userId === userId && award.key === key && award.ruleVersion === ruleVersionFor(key) && (!key.startsWith('simulation:') || eligible) && award.id === honorId(orgId, userId, key) && Number.isFinite(Date.parse(award.earnedAtUtc));
}
const eligibilitySql=(award:string)=>`EXISTS(SELECT 1 FROM Records e INDEXED BY Records_owner WHERE e.org_id=${award}.org_id AND e.kind='simulation-eligibility' AND e.owner_id=${award}.owner_id AND json_extract(e.data,'$.unlockId')=${award}.id AND json_extract(e.data,'$.userId')=${award}.owner_id AND json_extract(e.data,'$.ruleVersion')='simulation-v1' AND json_extract(e.data,'$.eligible')=1)`;
async function profileAwards(ctx:RequestContext){const rows=await ctx.env.DB.prepare(`SELECT a.data,${eligibilitySql('a')} AS eligible FROM json_each(?) ids JOIN Records a ON a.kind='mastery-honor' AND a.id=ids.value AND a.org_id=?`).bind(JSON.stringify(honorCatalog.map(h=>honorId(ctx.orgId,ctx.actor.userId,h.key))),ctx.orgId).all<{data:string;eligible:number}>();return rows.results.map(r=>({value:JSON.parse(r.data) as HonorUnlock,eligible:!!r.eligible}));}
export async function selfProfile(ctx: RequestContext) {
  const [records, profiles] = await Promise.all([
    profileAwards(ctx),
    ctx.env.DB.prepare("SELECT kind,data,revision FROM Records WHERE kind IN ('user-profile','profile-character') AND id=? AND org_id=? AND owner_id=?").bind(ctx.actor.userId, ctx.orgId, ctx.actor.userId).all<{ kind: string; data: string; revision: number }>(),
  ]);
  const awards = records.map(r => r.value), selectedRow = profiles.results.find(p => p.kind === 'user-profile');
  const selected = selectedRow ? JSON.parse(selectedRow.data) as ProfileSelection : null;
  const selectionValid = selected?.userId === ctx.actor.userId && selected.ruleVersion === ruleVersionFor(selected.honorKey??'') && selected.honorKey && selected.unlockId === honorId(ctx.orgId, ctx.actor.userId, selected.honorKey) && awards.some(a => validUnlock(a, ctx.orgId, ctx.actor.userId, selected.honorKey!,records.find(r=>r.value.id===a.id)?.eligible));
  const avatarHonorKey = selectionValid ? selected!.honorKey : null;
  const honors = honorCatalog.map(h => ({ ...h, ruleVersion: ruleVersionFor(h.key), earnedAtUtc: awards.find(a => validUnlock(a, ctx.orgId, ctx.actor.userId, h.key,records.find(r=>r.value.id===a.id)?.eligible))?.earnedAtUtc ?? null }));
  const saved = profiles.results.find(p => p.kind === 'profile-character');
  return { userId: ctx.actor.userId, displayName: ctx.actor.displayName, avatarHonorKey, honors,
    ...characterFields(saved ? JSON.parse(saved.data) : null, saved?.revision ?? 0, ctx.actor.userId, avatarHonorKey, new Set(honors.filter(h => h.earnedAtUtc).map(h => h.key)), ctx.actor.kind === 'Adult' && ['Owner', 'Admin'].includes(ctx.actor.role)) };
}
function selection(ctx: RequestContext, key: ProfileSelection['honorKey']): ProfileSelection {
  return { id: ctx.actor.userId, userId: ctx.actor.userId, honorKey: key, unlockId: key === null ? null : honorId(ctx.orgId, ctx.actor.userId, key), ruleVersion: key === null ? null : ruleVersionFor(key) };
}

export async function handleProfile(ctx: RequestContext): Promise<Response | null> {
  if (ctx.path === '/api/v1/profile/me' && ctx.request.method === 'GET') return json(await selfProfile(ctx));
  if (ctx.path === '/api/v1/profile/me/character' && ctx.request.method === 'PUT') {
    const raw = await body<unknown>(ctx.request, 16384), current = await selfProfile(ctx);
    const input = validateCharacterSave(raw, new Set(current.honors.filter(h => h.earnedAtUtc).map(h => h.key)), current.canUseMasterGuide);
    const operationId = crypto.randomUUID();
    const value = JSON.stringify({ userId: ctx.actor.userId, character: input.character, avatarKind: input.avatarKind, shareOptions: input.shareOptions, sharePatches: input.sharePatches, operationId });
    const write = input.version === 0
      ? ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data,revision) VALUES('profile-character',?,?,?,?,1) ON CONFLICT(kind,id,org_id) DO NOTHING").bind(ctx.actor.userId, ctx.orgId, ctx.actor.userId, value)
      : ctx.env.DB.prepare("UPDATE Records SET data=?,revision=revision+1 WHERE kind='profile-character' AND id=? AND org_id=? AND owner_id=? AND revision=?").bind(value, ctx.actor.userId, ctx.orgId, ctx.actor.userId, input.version);
    // The unique operation marker gates the legacy selection in the same transaction: a stale
    // character write cannot change it, even when another request saves identical settings.
    const results = await ctx.env.DB.batch([write, ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data,revision) SELECT 'user-profile',id,org_id,owner_id,?,1 FROM Records WHERE kind='profile-character' AND id=? AND org_id=? AND owner_id=? AND json_extract(data,'$.operationId')=? ON CONFLICT(kind,id,org_id) DO UPDATE SET data=excluded.data,owner_id=excluded.owner_id,revision=Records.revision+1").bind(JSON.stringify(selection(ctx, input.avatarHonorKey as ProfileSelection['honorKey'])), ctx.actor.userId, ctx.orgId, ctx.actor.userId, operationId)]);
    if (results[0].meta.changes !== 1) throw new HttpError(409, 'Your profile changed elsewhere. Reload it before saving again.');
    return json(await selfProfile(ctx));
  }
  if (ctx.path === '/api/v1/profile/me/avatar' && ctx.request.method === 'PUT') {
    const input = await body<{ honorKey: unknown }>(ctx.request, 1024);
    if (!input || typeof input !== 'object' || !('honorKey' in input) || input.honorKey !== null && !isHonorKey(input.honorKey)) throw new HttpError(400, 'Choose a recognized Honor or reset to initials.');
    const key = input.honorKey;
    if (key !== null) {
      const award = (await profileAwards(ctx)).find(r=>r.value.key===key);
      if (!validUnlock(award?.value, ctx.orgId, ctx.actor.userId, key,award?.eligible)) throw new HttpError(403, 'Earn this mastery Honor before using it as your profile image.');
    }
    const value = selection(ctx, key), avatarKind = key ? 'honor' : 'initials', operationId = crypto.randomUUID();
    const defaults = { userId: ctx.actor.userId, avatarKind, character: defaultCharacter(), shareOptions: defaultShareOptions(), sharePatches: [], operationId };
    const results = await ctx.env.DB.batch([
      ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data,revision) VALUES('profile-character',?,?,?,?,1) ON CONFLICT(kind,id,org_id) DO UPDATE SET data=json_set(Records.data,'$.avatarKind',json_extract(excluded.data,'$.avatarKind'),'$.operationId',json_extract(excluded.data,'$.operationId')),revision=Records.revision+1 WHERE Records.owner_id=excluded.owner_id").bind(ctx.actor.userId, ctx.orgId, ctx.actor.userId, JSON.stringify(defaults)),
      ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data,revision) SELECT 'user-profile',id,org_id,owner_id,?,1 FROM Records WHERE kind='profile-character' AND id=? AND org_id=? AND owner_id=? AND json_extract(data,'$.operationId')=? ON CONFLICT(kind,id,org_id) DO UPDATE SET data=excluded.data,owner_id=excluded.owner_id,revision=Records.revision+1").bind(JSON.stringify(value), ctx.actor.userId, ctx.orgId, ctx.actor.userId, operationId),
    ]);
    if (results[0].meta.changes !== 1) throw new HttpError(409, 'Your profile changed elsewhere. Reload it before saving again.');
    return json(await selfProfile(ctx));
  }
  if (ctx.path === '/api/v1/profile/identities' && ctx.request.method === 'GET') {
    const url = new URL(ctx.request.url), raw = url.searchParams.getAll('userId');
    if (url.search.length > 4000 || raw.some(id => !guid.test(id))) throw new HttpError(400, 'Provide valid user IDs.');
    const ids = [...new Set(raw.map(id => id.toLowerCase()))];
    if (ids.length > 50) throw new HttpError(400, 'Request at most 50 unique identities.');
    if (!ids.length) return json([]);
    // IDs use exact primary-key probes; no profile/award history scan or personal-field expansion.
    const rows = await ctx.env.DB.prepare(`SELECT u.id,p.data AS profile,c.data AS character,a.data AS award,${eligibilitySql('a')} AS eligible FROM json_each(?) requested
      JOIN Users u ON u.id=requested.value AND u.org_id=? AND u.active=1
      LEFT JOIN Records p ON p.kind='user-profile' AND p.id=u.id AND p.org_id=u.org_id AND p.owner_id=u.id
      LEFT JOIN Records c ON c.kind='profile-character' AND c.id=u.id AND c.org_id=u.org_id AND c.owner_id=u.id
      LEFT JOIN Records a ON a.kind='mastery-honor' AND a.id=json_extract(p.data,'$.unlockId') AND a.org_id=u.org_id`).bind(JSON.stringify(ids), ctx.orgId).all<{ id: string; profile: string | null; character: string | null; award: string | null; eligible:number }>();
    const found = new Map(rows.results.map(row => {
      const p = row.profile ? JSON.parse(row.profile) as ProfileSelection : null, a = row.award ? JSON.parse(row.award) as HonorUnlock : undefined;
      const avatarHonorKey = p?.userId === row.id && p.ruleVersion === ruleVersionFor(p.honorKey??'') && p.honorKey && p.unlockId === honorId(ctx.orgId, row.id, p.honorKey) && validUnlock(a, ctx.orgId, row.id, p.honorKey,!!row.eligible) ? p.honorKey : null;
      return [row.id, { userId: row.id, avatarHonorKey, ...portraitIdentity(row.character ? JSON.parse(row.character) : null, row.id, avatarHonorKey) }];
    }));
    return json(ids.flatMap(id => found.has(id) ? [found.get(id)!] : []));
  }
  return null;
}
