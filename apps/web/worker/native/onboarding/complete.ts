import type { Actor, Env } from "../types";
import { HttpError, json, noContent, requiredString } from "../types";
import { COOKIE, hashUserPassword, me, sha256 } from "../auth";
import { budget } from "./limits";
import { codeDigest, identifier, invalidCode, passwordValue, randomSecret } from "./shared";
import type { Purpose } from "./shared";
import type { ChallengeRow } from "./challenges";
import { liveInvitation } from "./invitations";

const noExistingUser=`NOT EXISTS(SELECT 1 FROM Users u WHERE u.email=c.email OR u.user_name=c.email)`;
const recoveryEligible=`EXISTS(SELECT 1 FROM Users u WHERE u.id=c.user_id AND u.email=c.email AND u.credential_version=c.credential_version AND u.active=1 AND u.kind='Adult' AND u.role IN ('Owner','Admin'))`;
const invitationEligible=`EXISTS(SELECT 1 FROM CoachInvitations i WHERE i.id=c.invitation_id AND i.version=c.invitation_version AND i.email=c.email AND ${liveInvitation}
  AND (SELECT COUNT(*) FROM Users u WHERE u.org_id=i.org_id AND u.active=1 AND u.kind='Adult')<20)`;
const claimed=`SELECT 1 FROM AuthChallenges WHERE id=? AND claim_nonce=?`;
export async function completeCode(env:Env,purpose:Purpose,data:Record<string,unknown>):Promise<Response> {
  const id=identifier(data.challengeId),password=passwordValue(data.password);
  if(typeof data.code!=="string"||!/^\d{6}$/.test(data.code))throw invalidCode();
  if(purpose!=="password"&&data.ageConfirmed!==true)throw new HttpError(400,"You must confirm that you are 18 years old or older to create a coach account.");
  const displayName=purpose==="password"?"":requiredString(data.displayName,"Name",100);
  const organizationName=purpose==="signup"?requiredString(data.organizationName,"Club name",100):"";
  const candidate=await env.DB.prepare("SELECT * FROM AuthChallenges WHERE id=? AND purpose=? AND consumed_at IS NULL AND delivered=1 AND expires_at>? AND attempts<5").bind(id,purpose,Date.now()).first<ChallengeRow>();
  if(!candidate)throw invalidCode();
  const digest=await codeDigest(env,id,purpose,candidate.email,data.code);
  if(digest!==candidate.code_digest) {
    await env.DB.prepare("UPDATE AuthChallenges SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL AND attempts<5").bind(id).run();
    throw invalidCode();
  }
  const now=Date.now(),claim=crypto.randomUUID(),userId=purpose==="password"?candidate.user_id??crypto.randomUUID():crypto.randomUUID();
  const invitation=purpose==="invitation"?await env.DB.prepare("SELECT org_id FROM CoachInvitations WHERE id=?").bind(candidate.invitation_id).first<{org_id:string}>():null;
  const recovered=purpose==="password"?await env.DB.prepare("SELECT org_id FROM Users WHERE id=?").bind(candidate.user_id).first<{org_id:string}>():null;
  const orgId=purpose==="signup"?crypto.randomUUID():invitation?.org_id??recovered?.org_id??"";
  const condition=purpose==="password"?recoveryEligible:purpose==="signup"?noExistingUser:`${noExistingUser} AND ${invitationEligible}`;
  // Confirm eligibility before KDF, then repeat the predicate inside the batch.
  const eligible=await env.DB.prepare(`SELECT c.id FROM AuthChallenges c WHERE c.id=? AND ${condition}`).bind(id,...(purpose==="invitation"?[now]:[])).first();
  if(!eligible)throw invalidCode();
  await budget(env,`complete:email:${await sha256(candidate.email)}`,Math.floor(now/3600_000),10,now+2*3600_000);
  if(purpose==="signup")await budget(env,"organizations:day",Math.floor(now/86400_000),10,(Math.floor(now/86400_000)+2)*86400_000);
  const hash=await hashUserPassword(env,orgId,userId,password),credentialVersion=crypto.randomUUID(),session=randomSecret(),sessionHash=await sha256(session);
  const statements=[env.DB.prepare(`UPDATE AuthChallenges AS c SET attempts=attempts+1,consumed_at=?,claim_nonce=?
    WHERE id=? AND purpose=? AND consumed_at IS NULL AND delivered=1 AND expires_at>? AND attempts<5 AND code_digest=? AND ${condition}`)
    .bind(Date.now(),claim,id,purpose,Date.now(),digest,...(purpose==="invitation"?[Date.now()]:[]))];
  if(purpose==="signup")statements.push(env.DB.prepare(`INSERT INTO Organizations(id,name,slug) SELECT ?,?,? WHERE EXISTS(${claimed})`).bind(orgId,organizationName,`club-${orgId}`,id,claim));
  if(purpose==="password") {
    statements.push(
      env.DB.prepare(`UPDATE Users SET password_hash=?,credential_version=? WHERE id=? AND EXISTS(${claimed})`).bind(hash,credentialVersion,userId,id,claim),
      env.DB.prepare(`DELETE FROM Sessions WHERE user_id=? AND EXISTS(${claimed})`).bind(userId,id,claim),
      env.DB.prepare(`UPDATE AuthChallenges SET consumed_at=? WHERE user_id=? AND purpose='password' AND consumed_at IS NULL AND EXISTS(${claimed})`).bind(Date.now(),userId,id,claim)
    );
  } else {
    statements.push(env.DB.prepare(`INSERT INTO Users(id,org_id,user_name,email,display_name,kind,role,password_hash,credential_version)
      SELECT ?,?,?,?,?, 'Adult',?,?,? WHERE EXISTS(${claimed})`).bind(userId,orgId,candidate.email,candidate.email,displayName,purpose==="signup"?"Owner":"Admin",hash,credentialVersion,id,claim));
    statements.push(env.DB.prepare(`INSERT INTO Sessions(token_hash,user_id,credential_version,expires_at) SELECT ?,?,?,? WHERE EXISTS(${claimed})`).bind(sessionHash,userId,credentialVersion,Date.now()+8*3600_000,id,claim));
    if(purpose==="invitation")statements.push(env.DB.prepare(`UPDATE CoachInvitations SET status='accepted',accepted_user_id=? WHERE id=? AND EXISTS(${claimed})`).bind(userId,candidate.invitation_id,id,claim));
  }
  statements.push(env.DB.prepare(`SELECT u.*,o.name AS organization_name FROM Users u JOIN Organizations o ON o.id=u.org_id WHERE u.id=? AND EXISTS(${claimed})`).bind(userId,id,claim));
  const result=await env.DB.batch(statements);
  const row=result.at(-1)!.results[0] as {organization_name:string;user_name:string;display_name:string;email:string;kind:Actor["kind"];role:Actor["role"]}|undefined;
  if(!row)throw invalidCode();
  if(purpose==="password")return noContent();
  const response=json(me({userId,organizationId:orgId,organizationName:row.organization_name,userName:row.user_name,displayName:row.display_name,email:row.email,kind:row.kind,role:row.role,credentialVersion}));
  response.headers.set("Set-Cookie",`${COOKIE}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`);
  return response;
}
