import type { Actor, Env, RequestContext } from "../types";
import { admin, body, HttpError, json, noContent, requiredString } from "../types";
import { sha256 } from "../auth";
import { deliveryBudget, ingressBudget } from "./limits";
import { configured, sendEmail } from "./providers";
import { emailAddress, input, invalidInvitation, randomSecret } from "./shared";
export interface InvitationRow {
  id:string;org_id:string;email:string;role:string;inviter_id:string;token_hash:string;version:string;
  status:"pending"|"accepted"|"revoked";delivered:number;created_at:number;expires_at:number;organization_name?:string;
}
export const ADULT_ROLES=["Owner","Admin","Content Manager"] as const;
export type AdultRole=(typeof ADULT_ROLES)[number];
// Used at token lookup and again inside the final transactional challenge claim.
export const liveInvitation = `i.status='pending' AND i.delivered=1 AND i.expires_at>?
  AND EXISTS(SELECT 1 FROM Users inviter WHERE inviter.id=i.inviter_id AND inviter.org_id=i.org_id
    AND inviter.active=1 AND inviter.kind='Adult' AND inviter.role IN ('Owner','Admin'))`;
const freshActor = `EXISTS(SELECT 1 FROM Users manager WHERE manager.id=? AND manager.org_id=? AND manager.credential_version=? AND manager.active=1 AND manager.kind='Adult' AND manager.role IN ('Owner','Admin'))`;
const actorValues=(actor:Actor)=>[actor.userId,actor.organizationId,actor.credentialVersion];
export function invitationView(row:InvitationRow) {
  return {id:row.id,email:row.email,role:(row.role as AdultRole)??"Admin",createdAt:new Date(row.created_at).toISOString(),expiresAt:new Date(row.expires_at).toISOString(),status:row.status==="pending"&&row.expires_at<=Date.now()?"expired":row.status};
}
export async function findInvitation(env:Env,value:unknown):Promise<InvitationRow> {
  const token=requiredString(value,"Invitation",64);
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw invalidInvitation();
  const row=await env.DB.prepare(`SELECT i.*,o.name AS organization_name FROM CoachInvitations i JOIN Organizations o ON o.id=i.org_id WHERE i.token_hash=? AND ${liveInvitation}`).bind(await sha256(token),Date.now()).first<InvitationRow>();
  if(!row)throw invalidInvitation();return row;
}
/** Owners may choose the invited role; every other inviter always invites an Admin. */
function resolveInviteRole(actor:Actor,requested:unknown):AdultRole {
  if(requested===undefined||requested===null||requested==="")return "Admin";
  if(typeof requested!=="string"||!(ADULT_ROLES as readonly string[]).includes(requested))
    throw new HttpError(400,"Choose Owner, Admin, or Content Manager as the invitation role.");
  if(requested==="Admin")return "Admin";
  if(actor.role!=="Owner")throw new HttpError(403,"Only the Owner can choose an invitation role.");
  return requested as AdultRole;
}
function ownerOnly(actor:Actor,action:string):void {
  if(actor.role!=="Owner")throw new HttpError(403,`Only the Owner (master admin) can ${action}.`);
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
async function findAdult(env:Env,orgId:string,userId:string) {
  return env.DB.prepare("SELECT id,role,active FROM Users WHERE id=? AND org_id=? AND kind='Adult'").bind(userId,orgId).first<{id:string;role:string;active:number}>();
}
/** PATCH /coaches/:userId/role — Owner only. */
async function changeAdultRole(context:RequestContext,targetUserId:string):Promise<AdultRole> {
  const {env,actor,orgId}=context;
  ownerOnly(actor,"change adult roles");
  if(targetUserId===actor.userId)throw new HttpError(403,"You cannot change your own role.");
  const role=requiredString((await body<Record<string,unknown>>(context.request)).role,"Role",50);
  if(!(ADULT_ROLES as readonly string[]).includes(role))throw new HttpError(400,"Choose Owner, Admin, or Content Manager as the role.");
  const target=await findAdult(env,orgId,targetUserId);
  if(!target||!target.active)throw new HttpError(404,"Coach was not found.");
  if(target.role==="Owner"&&role!=="Owner") {
    const owners=await env.DB.prepare("SELECT COUNT(*) AS count FROM Users WHERE org_id=? AND kind='Adult' AND role='Owner' AND active=1").bind(orgId).first<{count:number}>();
    if((owners?.count??0)<=1)throw new HttpError(403,"You cannot demote the last active Owner.");
  }
  // Bump the credential version so the demoted/promoted account re-authenticates with the new role.
  await env.DB.prepare("UPDATE Users SET role=?,credential_version=? WHERE id=? AND org_id=?").bind(role,crypto.randomUUID(),targetUserId,orgId).run();
  return role as AdultRole;
}
/** DELETE /coaches/:userId — Owner only. Deactivates the adult account. */
async function removeAdult(context:RequestContext,targetUserId:string):Promise<void> {
  const {env,actor,orgId}=context;
  ownerOnly(actor,"remove coaches");
  if(targetUserId===actor.userId)throw new HttpError(403,"You cannot remove your own account.");
  const target=await findAdult(env,orgId,targetUserId);
  if(!target||!target.active)throw new HttpError(404,"Coach was not found.");
  if(target.role==="Owner") {
    const owners=await env.DB.prepare("SELECT COUNT(*) AS count FROM Users WHERE org_id=? AND kind='Adult' AND role='Owner' AND active=1").bind(orgId).first<{count:number}>();
    if((owners?.count??0)<=1)throw new HttpError(403,"You cannot remove the last active Owner.");
  }
  await env.DB.prepare("UPDATE Users SET active=0,credential_version=? WHERE id=? AND org_id=?").bind(crypto.randomUUID(),targetUserId,orgId).run();
}
export async function handleCoachManagement(context:RequestContext):Promise<Response|null> {
  const {path,request,env,actor,orgId}=context;
  const match=path.match(/^\/coach-invitations(?:\/([a-f0-9-]{36})(\/resend)?)?$/i);
  const roleMatch=path.match(/^\/coaches\/([a-f0-9-]{36})\/role$/i);
  const coachMatch=path.match(/^\/coaches\/([a-f0-9-]{36})$/i);
  if(path!=="/coaches"&&!match&&!roleMatch&&!coachMatch)return null;
  if(path==="/coaches"&&request.method==="GET") {
    admin(actor);
    const rows=await env.DB.prepare(`SELECT id AS userId,display_name AS displayName,email,role FROM Users WHERE org_id=? AND active=1 AND kind='Adult' AND role IN ('Owner','Admin','Content Manager') AND ${freshActor} ORDER BY display_name LIMIT 100`).bind(orgId,...actorValues(actor)).all();
    return json(rows.results);
  }
  // Invitation management, adult role changes, and adult removal are Owner-only.
  // Only the read-only coach directory stays visible to regular Admins.
  ownerOnly(actor,"manage coach invitations and adult roles");
  if(roleMatch&&request.method==="PATCH") {
    await ingressBudget(request,env,"coach-management");
    return json({userId:roleMatch[1],role:await changeAdultRole(context,roleMatch[1])});
  }
  if(coachMatch&&request.method==="DELETE") {
    await ingressBudget(request,env,"coach-management");
    await removeAdult(context,coachMatch[1]);
    return noContent();
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
  // Staging and other deployments without email still create invitations: the
  // inviter delivers the link manually. inviteUrl is returned ONLY at creation
  // or resend time, never in list views.
  const emailConfigured=configured(env);
  let email:string,requestedRole:unknown;
  if(id) {
    const existing=await env.DB.prepare("SELECT email FROM CoachInvitations WHERE id=? AND org_id=? AND status='pending'").bind(id,orgId).first<{email:string}>();
    if(!existing)throw invalidInvitation();email=existing.email;
  } else {
    const data=await input(request);email=emailAddress(data.email);requestedRole=data.role;
  }
  const role=id?undefined:resolveInviteRole(actor,requestedRole);
  await deliveryBudget(request,env,email,actor);
  const now=Date.now(),secret=randomSecret(),version=crypto.randomUUID(),invitationId=id??crypto.randomUUID(),expiresAt=now+7*86400_000;
  const pendingCap=`(SELECT COUNT(*) FROM CoachInvitations WHERE org_id=? AND status='pending' AND expires_at>?)<10`;
  const coachCap=`(SELECT COUNT(*) FROM Users WHERE org_id=? AND kind='Adult' AND active=1)<20`;
  const delivered=emailConfigured?0:1;
  let row:InvitationRow|null;
  if(id) {
    const results=await env.DB.batch([
      env.DB.prepare(`UPDATE CoachInvitations SET token_hash=?,version=?,expires_at=?,delivered=?,inviter_id=? WHERE id=? AND org_id=? AND status='pending' AND ${freshActor} AND ${coachCap} AND (expires_at>? OR ${pendingCap}) RETURNING *`).bind(await sha256(secret),version,expiresAt,delivered,actor.userId,id,orgId,...actorValues(actor),orgId,now,orgId,now),
      env.DB.prepare("UPDATE AuthChallenges SET consumed_at=? WHERE invitation_id=? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM CoachInvitations WHERE id=? AND version=?)").bind(now,id,id,version)
    ]);
    row=results[0].results[0] as unknown as InvitationRow??null;
  } else {
    row=await env.DB.prepare(`INSERT INTO CoachInvitations(id,org_id,email,role,inviter_id,token_hash,version,status,created_at,expires_at,delivered)
      SELECT ?,?,?,?,?,?,?, 'pending',?,?,? WHERE ${freshActor} AND ${pendingCap} AND ${coachCap}
      AND NOT EXISTS(SELECT 1 FROM CoachInvitations WHERE org_id=? AND email=? AND status='pending' AND expires_at>?) RETURNING *`)
      .bind(invitationId,orgId,email,role,actor.userId,await sha256(secret),version,now,expiresAt,delivered,...actorValues(actor),orgId,now,orgId,orgId,email,now).first<InvitationRow>();
  }
  if(!row)throw new HttpError(409,"An invitation is already pending, or this club has reached its coach invitation limit.");
  if(emailConfigured) {
    await deliverInvitation(env,row,secret,actor);
    return json(invitationView(row),id?200:201);
  }
  return json({...invitationView(row),inviteUrl:`${env.PUBLIC_ORIGIN}/join-coach#${secret}`},id?200:201);
}
