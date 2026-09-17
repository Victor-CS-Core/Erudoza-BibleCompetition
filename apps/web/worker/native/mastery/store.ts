import type { D1PreparedStatement } from '@cloudflare/workers-types';
import type { Source } from '../application/model';
import type { RequestContext } from '../types';
import type { Store } from '../store';
import type { Session, Attempt, Mastery } from '../study/routes';
import type { Writes } from '../training/store';
import { write } from '../training/store';
import { honorId, RULE_VERSION } from './catalog';
import type { HonorUnlock } from './catalog';
import { passageId, soloQualifiers, updatePassageProof } from './solo-rules';
import type { PassageProof } from './solo-rules';
import { teamQualifiers } from './team-rules';
import type { Room } from '../practice/state';
export const proofId = (org: string, user: string, season: string, passage: string) => `${org}:${user}:${season}:${passage}:${RULE_VERSION}`;
/** One insert preserves the first qualifying snapshot even across independent season writers. */
export function insertUnlocks(store: Store, orgId: string, awards: HonorUnlock[]): D1PreparedStatement {
  return store.db.prepare("INSERT OR IGNORE INTO Records(kind,id,org_id,season_id,owner_id,data,revision) SELECT 'mastery-honor',json_extract(value,'$.id'),?,json_extract(value,'$.seasonId'),json_extract(value,'$.userId'),value,1 FROM json_each(?)").bind(orgId, JSON.stringify(awards));
}
export async function prepareSoloHonors(ctx: RequestContext, session: Session, attempt: Attempt, sources: Source[], states: Mastery[], mastery: Mastery, dueAtUtc?: string): Promise<{ writes: Writes; newAwards: HonorUnlock[] }> {
  const writes: Writes = { statements: [], guards: [] };
  const ids = [...new Set(sources.map(passageId))].map(p => proofId(ctx.orgId, ctx.actor.userId, session.seasonId, p));
  const stored = await ctx.store.getMany<PassageProof>('mastery-proof', ids, ctx.orgId);
  const currentId = proofId(ctx.orgId, ctx.actor.userId, session.seasonId, attempt.knowledgeUnitId), previous = stored.find(x => x.value.id === currentId) ?? null;
  const proof = updatePassageProof(previous?.value ?? { id: currentId, knowledgeUnitId: attempt.knowledgeUnitId, seasonId: session.seasonId, userId: ctx.actor.userId, firstMasteredAtUtc: null, retainedAtUtc: null, retestAttemptId: null, reviewCertifiedAtUtc: null, reviewAttemptId: null }, session, attempt, mastery, dueAtUtc);
  const proofs = stored.filter(x => x.value.id !== currentId).map(x => x.value);
  proofs.push(proof);
  if ((proof.firstMasteredAtUtc || proof.reviewCertifiedAtUtc) && JSON.stringify(proof) !== JSON.stringify(previous?.value)) write(ctx, writes, 'mastery-proof', currentId, proof, previous, session.seasonId);
  const awards: HonorUnlock[] = soloQualifiers(sources, states, proofs).map(({ key, passageIds }) => ({
    id: honorId(ctx.orgId, ctx.actor.userId, key), userId: ctx.actor.userId, key, ruleVersion: RULE_VERSION, earnedAtUtc: attempt.at, seasonId: session.seasonId,
    evidence: { sessionId: session.id, attemptId: attempt.id, passageIds, skills: states.filter(m => passageIds.includes(m.knowledgeUnitId)).map(m => ({ knowledgeUnitId: m.knowledgeUnitId, sourceUnitId: m.sourceUnitId, algorithmVersion: m.algorithmVersion, exactWording: m.exactWording, reference: m.reference, recognition: m.recognition })), proofs: proofs.filter(p => passageIds.includes(p.knowledgeUnitId)) },
  }));
  if (awards.length) writes.statements.push(insertUnlocks(ctx.store, ctx.orgId, awards));
  // INSERT OR IGNORE keeps the write idempotent; report which awards are new so
  // the caller can award profile-Honor XP exactly once per honor.
  const existing = awards.length ? await ctx.store.getMany<HonorUnlock>('mastery-honor', awards.map(a => a.id), ctx.orgId) : [];
  const newAwards = awards.filter(a => !existing.some(e => e.value.id === a.id));
  return { writes, newAwards };
}
export function prepareTeamHonors(store: Store, orgId: string, rooms: Room[], updated: Room): D1PreparedStatement[] {
  // Restrict newly evaluated people to this changed match. Read-only endpoints never issue awards.
  const awards: HonorUnlock[] = updated.members.flatMap(member => teamQualifiers(rooms, member.userId).map(({ key, evidence }) => ({ id: honorId(orgId, member.userId, key), userId: member.userId, key, ruleVersion: RULE_VERSION, earnedAtUtc: new Date().toISOString(), seasonId: updated.seasonId, evidence: { projectedRoomId: updated.id, projectedRevision: updated.revision, questions: evidence } })));
  return awards.length ? [insertUnlocks(store, orgId, awards)] : [];
}
