import type { Env } from "../types";
import { HttpError } from "../types";
import { sha256 } from "../auth";
import { clientIp } from "./shared";
export async function budget(env:Env,key:string,window:number,limit:number,expiresAt:number):Promise<number> {
  // A denied UPSERT does not write. Each counter is atomic across Worker isolates;
  // earlier reservations remain charged if a later budget or provider rejects.
  const result=await env.DB.prepare(`INSERT INTO AuthBudgets(key,window,attempts,expires_at) VALUES(?,?,1,?)
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN AuthBudgets.window=excluded.window THEN AuthBudgets.attempts+1 ELSE 1 END,
    window=excluded.window,expires_at=excluded.expires_at
    WHERE AuthBudgets.window<excluded.window OR (AuthBudgets.window=excluded.window AND AuthBudgets.attempts<?) RETURNING attempts`).bind(key,window,expiresAt,limit).first<{attempts:number}>();
  if(!result)throw new HttpError(429,"Too many attempts. Please try again later.");
  return result.attempts;
}
export async function ingressBudget(request:Request,env:Env,kind:string):Promise<void> {
  const now=Date.now(),hour=Math.floor(now/3600_000),day=Math.floor(now/86400_000);
  const group=kind==="login"?"login":kind==="coach-management"?"management":"onboarding";
  const ipKey=`ingress:${group}:ip:${await sha256(clientIp(request))}`,ipLimit=group==="login"?100:120;
  // Avoid charging fixed global budgets for a repeatedly rejected known client.
  // The perimeter limits this indexed read before requests reach D1. Global
  // reservations still precede creation of arbitrary new persistent IP keys.
  const existing=await env.DB.prepare("SELECT window,attempts FROM AuthBudgets WHERE key=?").bind(ipKey).first<{window:number;attempts:number}>();
  if(existing&&(existing.window>hour||(existing.window===hour&&existing.attempts>=ipLimit)))throw new HttpError(429,"Too many attempts. Please try again later.");
  // Public onboarding cannot consume existing-account login or revocation access.
  const attempt=await budget(env,`ingress:${group}:day`,day,group==="management"?600:1200,(day+2)*86400_000);
  // Fifty old rows per sixteen admitted calls outpaces the two legacy login
  // keys one new client/identity can create, without unbounded delete scans.
  if(attempt%16===1)await boundedCleanup(env,now);
  await budget(env,`ingress:${group}:hour`,hour,group==="management"?300:600,(hour+2)*3600_000);
  await budget(env,ipKey,hour,ipLimit,(hour+2)*3600_000);
}
export async function deliveryBudget(request:Request,env:Env,email:string,actor?:{userId:string;organizationId:string}):Promise<void> {
  const now=Date.now(),day=Math.floor(now/86400_000),month=new Date(now).getUTCFullYear()*12+new Date(now).getUTCMonth();
  // Cooldown uses a moving deadline, avoiding a double send across minute boundaries.
  const key=`email-cooldown:${await sha256(email)}`;
  const cooldown=await env.DB.prepare(`INSERT INTO AuthBudgets(key,window,attempts,expires_at) VALUES(?,?,1,?)
    ON CONFLICT(key) DO UPDATE SET window=excluded.window,attempts=1,expires_at=excluded.expires_at
    WHERE AuthBudgets.expires_at<=? RETURNING key`).bind(key,now,now+60_000,now).first();
  if(!cooldown)throw new HttpError(429,"Please wait one minute before requesting another email.");
  await budget(env,`delivery:ip:${await sha256(clientIp(request))}`,day,30,(day+2)*86400_000);
  await budget(env,`delivery:email:${await sha256(email)}`,day,6,(day+2)*86400_000);
  if(actor){
    await budget(env,`delivery:actor:${actor.userId}`,day,6,(day+2)*86400_000);
    await budget(env,`delivery:org:${actor.organizationId}`,day,20,(day+2)*86400_000);
  }
  await budget(env,"delivery:day",day,80,(day+2)*86400_000);
  await budget(env,"delivery:month",month,2400,Date.UTC(new Date(now).getUTCFullYear(),new Date(now).getUTCMonth()+2,1));
  await boundedCleanup(env,now);
}
export async function boundedCleanup(env:Env,now=Date.now()):Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM AuthBudgets WHERE key IN (SELECT key FROM AuthBudgets WHERE expires_at<? ORDER BY expires_at LIMIT 50)").bind(now),
    env.DB.prepare("DELETE FROM AuthChallenges WHERE id IN (SELECT id FROM AuthChallenges WHERE expires_at<? ORDER BY expires_at LIMIT 50)").bind(now-86400_000),
    env.DB.prepare("DELETE FROM Sessions WHERE token_hash IN (SELECT token_hash FROM Sessions WHERE expires_at<=? ORDER BY expires_at LIMIT 50)").bind(now),
    env.DB.prepare("DELETE FROM LoginLimits WHERE key IN (SELECT key FROM LoginLimits WHERE window<? ORDER BY window LIMIT 50)").bind(Math.floor(now/60000)-10),
    env.DB.prepare("DELETE FROM CoachInvitations WHERE id IN (SELECT i.id FROM CoachInvitations i WHERE i.expires_at<? AND NOT EXISTS(SELECT 1 FROM AuthChallenges c WHERE c.invitation_id=i.id) ORDER BY i.expires_at LIMIT 50)").bind(now-90*86400_000)
  ]);
}
