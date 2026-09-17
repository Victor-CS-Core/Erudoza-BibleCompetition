import type { Actor, Env } from "./types";
import { body, HttpError, json, noContent, requiredString } from "./types";
import { ingressBudget } from "./onboarding/limits";
import { clientIp } from "./onboarding/shared";
export const COOKIE = "__Host-erudoza.session";
const bytesToBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
export async function sha256(text:string):Promise<string> { return bytesToBase64(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)))); }
// Pure helpers remain available for local compatibility tests; requests use the RPC helpers below.
export { hashPassword, verifyPassword } from "./password-kdf";
export async function passwordCrypto(env: Env, identity: string) {
  if (!env.PASSWORD_CRYPTO) throw new HttpError(503, "Password service is not configured.");
  const digest = await sha256(identity);
  return env.PASSWORD_CRYPTO.getByName(`password-v1:${atob(digest).charCodeAt(0) & 63}`);
}
export async function hashUserPassword(env: Env, organizationId: string, userId: string, password: string): Promise<string> {
  if (typeof password !== "string" || password.length < 8 || password.length > 256) throw new HttpError(400, "Password must contain 8 to 256 characters.");
  return (await passwordCrypto(env, `${organizationId}:${userId}`)).hash(password);
}
export function token(request:Request):string|null { return request.headers.get("cookie")?.split(";").map(v=>v.trim()).find(v=>v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1)??null; }
export function me(actor:Actor):Omit<Actor,"credentialVersion"> { const {credentialVersion: _version,...result}=actor; void _version; return result; }
interface UserRow { id:string;org_id:string;organization_name:string;display_name:string;user_name:string;email:string|null;kind:Actor["kind"];role:Actor["role"];credential_version:string;password_hash:string;active:number }
function actor(row:UserRow):Actor { return {userId:row.id,organizationId:row.org_id,organizationName:row.organization_name,displayName:row.display_name,userName:row.user_name,email:row.email,kind:row.kind,role:row.role,credentialVersion:row.credential_version}; }
export async function authenticate(request:Request,env:Env,practiceOrgId?:string):Promise<Actor> {
  const value=token(request); if(!value||value.length>100) throw new HttpError(401,"Sign in to continue.");
  // Room access stays fresh on every request, with the flag in the same D1 roundtrip.
  const practice=practiceOrgId!==undefined;
  const row=await env.DB.prepare(`SELECT u.*,o.name AS organization_name${practice?",p.data AS practice_settings":""} FROM Sessions s JOIN Users u ON u.id=s.user_id JOIN Organizations o ON o.id=u.org_id${practice?" LEFT JOIN Records p ON p.kind='practice-setting' AND p.id=u.org_id AND p.org_id=u.org_id":""} WHERE s.token_hash=? AND s.expires_at>? AND s.credential_version=u.credential_version AND u.active=1`)
    .bind(await sha256(value),Date.now()).first<UserRow&{practice_settings?:string|null}>();
  if(!row) throw new HttpError(401,"Sign in to continue.");
  if(practice){
    if(row.org_id!==practiceOrgId)throw new HttpError(403,"Organization access denied.");
    const settings=JSON.parse(row.practice_settings??"null") as {enabled?:boolean}|null;
    if(settings?.enabled===false)throw new HttpError(403,"Team Practice is not enabled for this organization.");
  }
  return actor(row);
}
export function checkOrigin(request:Request,env:Env):void {
  if(["GET","HEAD","OPTIONS"].includes(request.method)&&!request.headers.has("upgrade")) return;
  const expected=env.PUBLIC_ORIGIN||new URL(request.url).origin;
  if(request.headers.get("origin")!==expected) throw new HttpError(403,"Request origin is not allowed.");
}
export async function handleAuth(request:Request,env:Env):Promise<Response|null> {
  const path=new URL(request.url).pathname;
  if(path==="/api/v1/auth/login"&&request.method==="POST") {
    await ingressBudget(request,env,"login");
    const input=await body<{identifier:unknown;password:unknown}>(request,4096);
    const identifier=requiredString(input.identifier,"Identifier",256).toLowerCase();
    if(typeof input.password!=="string"||input.password.length>256) throw new HttpError(401,"Invalid credentials.");
    const window=Math.floor(Date.now()/60000), ip=clientIp(request);
    for(const key of [`user:${await sha256(identifier)}`,`ip:${await sha256(ip)}`]) {
      const limit=key.startsWith("user:")?10:50;
      const row=await env.DB.prepare("INSERT INTO LoginLimits(key,window,attempts) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window=excluded.window THEN attempts+1 ELSE 1 END,window=excluded.window WHERE LoginLimits.window<excluded.window OR (LoginLimits.window=excluded.window AND LoginLimits.attempts<?) RETURNING attempts").bind(key,window,limit).first<{attempts:number}>();
      if((row?.attempts??limit+1)>limit) throw new HttpError(429,"Too many login attempts. Try again in a minute.");
    }
    const row=await env.DB.prepare("SELECT u.*,o.name AS organization_name FROM Users u JOIN Organizations o ON o.id=u.org_id WHERE u.user_name=? OR u.email=? LIMIT 1").bind(identifier,identifier).first<UserRow>();
    // Use equal-cost work for unknown identities to reduce account enumeration.
    const fallback="pbkdf2:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const valid=await (await passwordCrypto(env,identifier)).verify(row?.password_hash??fallback,input.password);
    if(!row||!valid||row.active!==1) throw new HttpError(401,"Invalid credentials.");
    const value=bytesToBase64(crypto.getRandomValues(new Uint8Array(32))).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM Sessions WHERE token_hash IN (SELECT token_hash FROM Sessions WHERE expires_at<=? ORDER BY expires_at LIMIT 50)").bind(Date.now()),
      env.DB.prepare("DELETE FROM LoginLimits WHERE key IN (SELECT key FROM LoginLimits WHERE window<? ORDER BY window LIMIT 50)").bind(window-10),
      env.DB.prepare("INSERT INTO Sessions(token_hash,user_id,credential_version,expires_at) VALUES(?,?,?,?)").bind(await sha256(value),row.id,row.credential_version,Date.now()+8*3600_000)
    ]);
    const response=json(me(actor(row))); response.headers.set("Set-Cookie",`${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`); return response;
  }
  if(path==="/api/v1/auth/logout"&&request.method==="POST") {
    const value=token(request); if(value) await env.DB.prepare("DELETE FROM Sessions WHERE token_hash=?").bind(await sha256(value)).run();
    const response=noContent(); response.headers.set("Set-Cookie",`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`); return response;
  }
  return null;
}
