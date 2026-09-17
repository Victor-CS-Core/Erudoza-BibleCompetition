import type { Env } from "../types";
import { HttpError, json } from "../types";
import { authenticate, token } from "../auth";
import { configured, requireConfigured } from "./providers";
import { ingressBudget } from "./limits";
import { input } from "./shared";
import type { Purpose } from "./shared";
import { requestCode } from "./challenges";
import { completeCode } from "./complete";
import { acceptDirectInvitation } from "./accept-direct";
import { findInvitation } from "./invitations";
export async function handleOnboarding(request:Request,env:Env):Promise<Response|null> {
  const path=new URL(request.url).pathname;
  if(path==="/api/v1/auth/coach-options"&&request.method==="GET") {
    const available=configured(env);return json({available,turnstileSiteKey:available?env.TURNSTILE_SITE_KEY:null});
  }
  // Direct invitation acceptance only exists where email delivery is not
  // configured (staging). Production keeps the email-verified flow.
  if(path==="/api/v1/auth/invitation/accept-direct"&&request.method==="POST") {
    if(configured(env))throw new HttpError(404,"Route not found.");
    await ingressBudget(request,env,"accept-direct");
    return acceptDirectInvitation(request,env);
  }
  const route=path.match(/^\/api\/v1\/auth\/(signup|password|invitation)\/(code|complete|details)$/);
  if(!route||request.method!=="POST")return null;
  const data=await input(request),purpose=route[1] as Purpose;
  if(route[2]==="details"&&purpose==="invitation") {
    // Invitation details never send email, so the direct-accept flow can show
    // the club name on deployments without email delivery (staging).
    await ingressBudget(request,env,route[2]);
    const invitation=await findInvitation(env,data.token);
    const [local,domain]=invitation.email.split("@");
    return json({organizationName:invitation.organization_name,emailHint:`${local[0]}***@${domain}`,expiresAt:new Date(invitation.expires_at).toISOString()});
  }
  requireConfigured(env);
  await ingressBudget(request,env,route[2]);
  if(route[2]==="code")return requestCode(request,env,purpose,data);
  if(route[2]==="complete") {
    if(purpose!=="password"&&token(request)) {
      let signedIn=false;try {await authenticate(request,env);signedIn=true;} catch(error){if(!(error instanceof HttpError&&error.status===401))throw error;}
      if(signedIn)throw new HttpError(409,"Sign out before joining as a different coach.");
    }
    return completeCode(env,purpose,data);
  }
  throw new HttpError(404,"Route not found.");
}
