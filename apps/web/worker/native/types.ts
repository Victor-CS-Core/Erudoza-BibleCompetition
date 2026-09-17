import type { D1Database, DurableObjectNamespace } from "@cloudflare/workers-types";
import type { Store } from "./store";
import type { PasswordCrypto } from "./password-crypto";
import type { PerimeterEnv } from "./perimeter";
export interface Env extends PerimeterEnv { DB: D1Database; ASSETS?: { fetch(request: Request): Promise<Response> }; ROOMS?: DurableObjectNamespace; REPORTS?: DurableObjectNamespace; PBE_SOLO?: DurableObjectNamespace; PASSWORD_CRYPTO?: DurableObjectNamespace<PasswordCrypto>; PUBLIC_ORIGIN?: string; RESEND_API_KEY?:string; AUTH_CODE_SECRET?:string; TURNSTILE_SECRET_KEY?:string; TURNSTILE_SITE_KEY?:string; AUTH_EMAIL_FROM?:string }
export interface Actor {
  userId: string; organizationId: string; organizationName: string; displayName: string; userName: string;
  email: string | null; kind: "Adult" | "Student"; role: "Owner" | "Admin" | "Content Manager" | "Student"; credentialVersion: string;
}
export interface RequestContext { request: Request; env: Env; actor: Actor; path: string; orgId: string; store: Store }
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function json(value: unknown, status = 200): Response { return Response.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
export function noContent(): Response { return new Response(null, { status: 204 }); }
export function admin(actor: Actor): void { if (actor.kind !== "Adult" || !["Owner", "Admin"].includes(actor.role)) throw new HttpError(403, "Administrator access denied."); }
export function requiredString(value: unknown, name: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new HttpError(400, `${name} is required and must be at most ${max} characters.`);
  return value.trim();
}
export async function body<T>(request: Request, maxBytes = 1_048_576): Promise<T> {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "A JSON request body is required.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > maxBytes) { await reader.cancel(); throw new HttpError(413, "Request body is too large."); } chunks.push(chunk.value); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as T; } catch { throw new HttpError(400, "Invalid JSON request."); }
}
