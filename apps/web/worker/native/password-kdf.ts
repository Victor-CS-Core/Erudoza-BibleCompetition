import { HttpError } from "./types";
const bytesToBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
async function derive(password:string,salt:Uint8Array):Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",salt:salt as Uint8Array<ArrayBuffer>,iterations:100_000,hash:"SHA-256"},key,256));
}
export async function hashPassword(password:string):Promise<string> {
  if (password.length < 8 || password.length > 256) throw new HttpError(400,"Password must contain 8 to 256 characters.");
  const salt=crypto.getRandomValues(new Uint8Array(16)); return `pbkdf2:${bytesToBase64(salt)}:${bytesToBase64(await derive(password,salt))}`;
}
export async function verifyPassword(encoded:string,password:string):Promise<boolean> {
  try { const [type,salt64,expected64,...rest]=encoded.split(":"); if(type!=="pbkdf2"||rest.length) return false;
    const salt=Uint8Array.from(atob(salt64),c=>c.charCodeAt(0)), expected=Uint8Array.from(atob(expected64),c=>c.charCodeAt(0));
    if(salt.length!==16||expected.length!==32||password.length>256) return false;
    const actual=await derive(password,salt); let difference=0; for(let i=0;i<32;i++) difference|=actual[i]^expected[i]; return difference===0;
  } catch { return false; }
}
