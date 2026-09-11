import type { Actor, Env, RequestContext } from "../types";
import { admin, HttpError, json, noContent, requiredString } from "../types";
import { sha256 } from "../auth";
import { deliveryBudget, ingressBudget } from "./limits";
import { requireConfigured, sendEmail } from "./providers";
import { emailAddress, input, invalidInvitation, randomSecret } from "./shared";
export interface InvitationRow {
  id:string;org_id:string;email:string;inviter_id:string;token_hash:string;version:string;
  status:"pending"|"accepted"|"revoked";delivered:number;created_at:number;expires_at:number;organization_name?:string;
}
// Used at token lookup and again inside the final transactional challenge claim.
export const liveInvitation = `i.status='pending' AND i.delivered=1 AND i.expires_at>?
  AND EXISTS(SELECT 1 FROM Users inviter WHERE inviter.id=i.inviter_id AND inviter.org_id=i.org_id
    AND inviter.active=1 AND inviter.kind='Adult' AND inviter.role IN ('Owner','Admin'))`;
const freshActor = `EXISTS(SELECT 1 FROM Users manager WHERE manager.id=? AND manager.org_id=? AND manager.credential_version=? AND manager.active=1 AND manager.kind='Adult' AND manager.role IN ('Owner','Admin'))`;
const actorValues=(actor:Actor)=>[actor.userId,actor.organizationId,actor.credentialVersion];
export function invitationView(row:InvitationRow) {
  return {id:row.id,email:row.email,createdAt:new Date(row.created_at).toISOString(),expiresAt:new Date(row.expires_at).toISOString(),status:row.status==="pending"&&row.expires_at<=Date.now()?"expired":row.status};
}
export async function findInvitation(env:Env,value:unknown):Promise<InvitationRow> {
  const token=requiredString(value,"Invitation",64);
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw invalidInvitation();
  const row=await env.DB.prepare(`SELECT i.*,o.name AS organization_name FROM CoachInvitations i JOIN Organizations o ON o.id=i.org_id WHERE i.token_hash=? AND ${liveInvitation}`).bind(await sha256(token),Date.now()).first<InvitationRow>();
  if(!row)throw invalidInvitation();return row;
}
async function deliverInvitation(env:Env,row:InvitationRow,secret:string,actor:Actor):Promise<void> {
  try {
    await sendEmail(env,row.email,"You are invited to coach on Erudoza",`You have been invited to coach ${actor.organizationName} on Erudoza.\n\nOpen this invitation and verify your email to join:\n${env.PUBLIC_ORIGIN}/join-coach#${secret}\n\nThis invitation expires in seven days. If you were not expecting it, you can ignore this email.`, `invitation/${row.id}/${row.version}`);
    const result=await env.DB.prepare(`UPDATE CoachInvitations SET delivered=1 WHERE id=? AND version=? AND status='pending' AND ${freshActor} RETURNING id`).bind(row.id,row.version,...actorValues(actor)).first();
    if(!result)throw invalidInvitation();
  } catch(error) {
    // A timed-out provider may have sent the message. Its secret still cannot be
    // redeemed because delivered remains false (and the pending row is revoked).
    await env.DB.prepare("UPDATE CoachInvitations SET status='revoked' WHERE id=? AND version=? AND status='pending'").bind(row.id,row.version).run();
    throw error;
  }
}
export async function handleCoachManagement(context:RequestContext):Promise<Response|null> {
  const {path,request,env,actor,orgId}=context;
  const match=path.match(/^\/coach-invitations(?:\/([a-f0-9-]{36})(\/resend)?)?$/i);
  if(path!=="/coaches"&&!match)return null;
  admin(actor);
  if(path==="/coaches"&&request.method==="GET") {
    const rows=await env.DB.prepare(`SELECT id AS userId,display_name AS displayName,email,role FROM Users WHERE org_id=? AND active=1 AND kind='Adult' AND role IN ('Owner','Admin') AND ${freshActor} ORDER BY display_name LIMIT 100`).bind(orgId,...actorValues(actor)).all();
    return json(rows.results);
  }
  if(match&&!match[1]&&request.method==="GET") {
    const rows=await env.DB.prepare(`SELECT * FROM CoachInvitations WHERE org_id=? AND ${freshActor} ORDER BY created_at DESC LIMIT 50`).bind(orgId,...actorValues(actor)).all<InvitationRow>();
    return json(rows.results.map(invitationView));
  }
  if(!match)throw new HttpError(404,"Route not found.");
  await ingressBudget(request,env,"coach-management");
  const id=match[1];
  if(id&&!match[2]&&request.method==="DELETE") {
    const results=await env.DB.batch([
      env.DB.prepare(`UPDATE CoachInvitations SET status='revoked',delivered=0 WHERE id=? AND org_id=? AND status='pending' AND ${freshActor} RETURNING id`).bind(id,orgId,...actorValues(actor)),
      env.DB.prepare("UPDATE AuthChallenges SET consumed_at=? WHERE invitation_id=? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM CoachInvitations WHERE id=? AND org_id=? AND status='revoked')").bind(Date.now(),id,id,orgId)
    ]);
    if(!results[0].results.length)throw invalidInvitation();
    return noContent();
  }
  if(request.method!=="POST"||(id&&!match[2]))throw new HttpError(404,"Route not found.");
  requireConfigured(env);
  let email:string;
  if(id) {
    const existing=await env.DB.prepare("SELECT email FROM CoachInvitations WHERE id=? AND org_id=? AND status='pending'").bind(id,orgId).first<{email:string}>();
    if(!existing)throw invalidInvitation();email=existing.email;
  } else email=emailAddress((await input(request)).email);
  await deliveryBudget(request,env,email,actor);
  const now=Date.now(),secret=randomSecret(),version=crypto.randomUUID(),invitationId=id??crypto.randomUUID(),expiresAt=now+7*86400_000;
  const pendingCap=`(SELECT COUNT(*) FROM CoachInvitations WHERE org_id=? AND status='pending' AND expires_at>?)<10`;
  const coachCap=`(SELECT COUNT(*) FROM Users WHERE org_id=? AND kind='Adult' AND active=1)<20`;
  let row:InvitationRow|null;
  if(id) {
    const results=await env.DB.batch([
      env.DB.prepare(`UPDATE CoachInvitations SET token_hash=?,version=?,expires_at=?,delivered=0,inviter_id=? WHERE id=? AND org_id=? AND status='pending' AND ${freshActor} AND ${coachCap} AND (expires_at>? OR ${pendingCap}) RETURNING *`).bind(await sha256(secret),version,expiresAt,actor.userId,id,orgId,...actorValues(actor),orgId,now,orgId,now),
      env.DB.prepare("UPDATE AuthChallenges SET consumed_at=? WHERE invitation_id=? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM CoachInvitations WHERE id=? AND version=?)").bind(now,id,id,version)
    ]);
    row=results[0].results[0] as unknown as InvitationRow??null;
  } else {
    row=await env.DB.prepare(`INSERT INTO CoachInvitations(id,org_id,email,inviter_id,token_hash,version,status,created_at,expires_at)
      SELECT ?,?,?,?,?,?,'pending',?,? WHERE ${freshActor} AND ${pendingCap} AND ${coachCap}
      AND NOT EXISTS(SELECT 1 FROM CoachInvitations WHERE org_id=? AND email=? AND status='pending' AND expires_at>?) RETURNING *`)
      .bind(invitationId,orgId,email,actor.userId,await sha256(secret),version,now,expiresAt,...actorValues(actor),orgId,now,orgId,orgId,email,now).first<InvitationRow>();
  }
  if(!row)throw new HttpError(409,"An invitation is already pending, or this club has reached its coach invitation limit.");
  await deliverInvitation(env,row,secret,actor);
  return json(invitationView(row),id?200:201);
}
