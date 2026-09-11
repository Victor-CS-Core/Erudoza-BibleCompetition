import type { Env } from "../types";
import { HttpError, requiredString } from "../types";
import { clientIp, unavailable } from "./shared";
export function configured(env:Env):boolean {
  try {
    const origin=new URL(env.PUBLIC_ORIGIN??"");
    return origin.protocol==="https:"&&origin.origin===env.PUBLIC_ORIGIN&&!!env.RESEND_API_KEY&&!!env.AUTH_EMAIL_FROM&&!!env.TURNSTILE_SITE_KEY&&!!env.TURNSTILE_SECRET_KEY&&(env.AUTH_CODE_SECRET?.length??0)>=32;
  } catch {return false;}
}
export function requireConfigured(env:Env):void {if(!configured(env))throw unavailable();}
async function providerRequest(url:string,init:RequestInit):Promise<Response> {
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),8000);
  try {
    const response=await fetch(url,{...init,signal:controller.signal});
    // Consume inside the timeout, with a bound on provider response size too.
    const reader=response.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
    if(reader) while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>16384){await reader.cancel();throw unavailable();}chunks.push(chunk.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return new Response(bytes,{status:response.status});
  } catch {throw unavailable();} finally {clearTimeout(timeout);}
}
export async function verifyTurnstile(request:Request,env:Env,value:unknown,action:string):Promise<void> {
  requireConfigured(env);
  const token=requiredString(value,"Bot verification",2048);
  const response=await providerRequest("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY,response:token,remoteip:clientIp(request),idempotency_key:crypto.randomUUID()})});
  if(!response.ok)throw unavailable();
  let result:{success?:boolean;hostname?:string;action?:string};
  try {result=await response.json();} catch {throw unavailable();}
  if(result.success!==true||result.hostname!==new URL(env.PUBLIC_ORIGIN!).hostname||result.action!==action) throw new HttpError(400,"Bot verification failed. Please try again.");
}
const escapeHtml=(text:string)=>text.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
export async function sendEmail(env:Env,email:string,subject:string,text:string,idempotencyKey:string):Promise<void> {
  requireConfigured(env);
  const response=await providerRequest("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json","Idempotency-Key":idempotencyKey},body:JSON.stringify({from:env.AUTH_EMAIL_FROM,to:[email],subject,text,html:`<div>${escapeHtml(text).replaceAll("\n","<br>")}</div>`})});
  if(!response.ok)throw unavailable();
  let result:{id?:unknown};try {result=await response.json();} catch {throw unavailable();}
  if(typeof result.id!=="string"||!result.id)throw unavailable();
}
