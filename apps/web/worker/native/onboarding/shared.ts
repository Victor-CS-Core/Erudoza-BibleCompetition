import type { Env } from "../types";
import { body, HttpError, requiredString } from "../types";
export type Purpose = "signup" | "password" | "invitation";
export const invalidCode = () => new HttpError(400, "This code is invalid or expired. Request a new code.");
export const invalidInvitation = () => new HttpError(400, "This invitation is unavailable. Ask your coach for a new invitation.");
export const unavailable = () => new HttpError(503, "Coach onboarding is temporarily unavailable. Please try again later.");
export async function input(request:Request):Promise<Record<string,unknown>> {
  const value=await body<unknown>(request,8192);
  if(!value||typeof value!=="object"||Array.isArray(value)) throw new HttpError(400,"A JSON object is required.");
  return value as Record<string,unknown>;
}
export function emailAddress(value:unknown):string {
  const email=requiredString(value,"Email",254).toLowerCase();
  if(!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email)||email.split("@")[0].length>64) throw new HttpError(400,"Enter a valid email address.");
  return email;
}
export function identifier(value:unknown):string {
  const id=requiredString(value,"Challenge",36);
  if(!/^[a-f0-9-]{36}$/i.test(id)) throw invalidCode();
  return id;
}
export function passwordValue(value:unknown):string {
  if(typeof value!=="string"||value.length<12||value.length>128) throw new HttpError(400,"Password must contain 12 to 128 characters.");
  return value;
}
export function randomSecret():string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
}
export function randomCode():string {
  let value:number;
  do {value=crypto.getRandomValues(new Uint32Array(1))[0];} while(value>=4_294_000_000);
  return (value%1_000_000).toString().padStart(6,"0");
}
export async function keyedDigest(env:Env,value:string):Promise<string> {
  if(!env.AUTH_CODE_SECRET||env.AUTH_CODE_SECRET.length<32) throw unavailable();
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(env.AUTH_CODE_SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value)))));
}
export const codeDigest=(env:Env,id:string,purpose:Purpose,email:string,code:string)=>keyedDigest(env,JSON.stringify([id,purpose,email,code]));
// The header is trusted only when Cloudflare supplies request metadata. Direct/local
// callers share one bucket; X-Forwarded-For and user-supplied alternatives are ignored.
export function clientIp(request:Request):string {
  return (request as Request&{cf?:unknown}).cf ? request.headers.get("CF-Connecting-IP")??"unknown-ingress" : "untrusted-ingress";
}
