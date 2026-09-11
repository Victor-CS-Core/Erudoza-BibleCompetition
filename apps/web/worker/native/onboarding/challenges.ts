import type { Env } from "../types";
import { json } from "../types";
import { deliveryBudget } from "./limits";
import { sendEmail, verifyTurnstile } from "./providers";
import { codeDigest, emailAddress, invalidInvitation, randomCode } from "./shared";
import type { Purpose } from "./shared";
import { findInvitation } from "./invitations";
export interface ChallengeRow {
  id:string;purpose:Purpose;email:string;code_digest:string;user_id:string|null;credential_version:string|null;
  invitation_id:string|null;invitation_version:string|null;created_at:number;expires_at:number;
  attempts:number;delivered:number;consumed_at:number|null;claim_nonce:string|null;
}
export async function requestCode(request:Request,env:Env,purpose:Purpose,data:Record<string,unknown>):Promise<Response> {
  const email=emailAddress(data.email);
  await verifyTurnstile(request,env,data.turnstileToken,{signup:"coach_signup",password:"coach_recovery",invitation:"coach_invitation"}[purpose]);
  const invitation=purpose==="invitation"?await findInvitation(env,data.token):null;
  if(invitation&&invitation.email!==email)throw invalidInvitation();
  await deliveryBudget(request,env,email,invitation?{userId:invitation.inviter_id,organizationId:invitation.org_id}:undefined);
  const user=purpose==="password"?await env.DB.prepare("SELECT id,credential_version FROM Users WHERE email=? AND kind='Adult' AND role IN ('Owner','Admin') AND active=1").bind(email).first<{id:string;credential_version:string}>():null;
  const id=crypto.randomUUID(),code=randomCode(),now=Date.now(),expiresAt=now+10*60000;
  await env.DB.batch([
    env.DB.prepare("UPDATE AuthChallenges SET consumed_at=? WHERE email=? AND purpose=? AND consumed_at IS NULL").bind(now,email,purpose),
    env.DB.prepare(`INSERT INTO AuthChallenges(id,purpose,email,code_digest,user_id,credential_version,invitation_id,invitation_version,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(id,purpose,email,await codeDigest(env,id,purpose,email,code),user?.id??null,user?.credential_version??null,invitation?.id??null,invitation?.version??null,now,expiresAt)
  ]);
  try {
    // Every syntactically valid identity follows the same delivery path. This code
    // proves inbox access only; account eligibility is checked at consumption.
    await sendEmail(env,email,"Your Erudoza verification code",`Your Erudoza verification code is ${code}.\n\nIt expires in 10 minutes. Enter it only on ${env.PUBLIC_ORIGIN}. This request can proceed only if your account is eligible.\n\nIf you did not request this code, you can ignore this email.`, `code/${id}`);
    await env.DB.prepare("UPDATE AuthChallenges SET delivered=1 WHERE id=? AND consumed_at IS NULL").bind(id).run();
  } catch(error) {
    await env.DB.prepare("UPDATE AuthChallenges SET consumed_at=? WHERE id=?").bind(Date.now(),id).run();throw error;
  }
  return json({challengeId:id,expiresAt:new Date(expiresAt).toISOString(),resendAfterSeconds:60},202);
}
