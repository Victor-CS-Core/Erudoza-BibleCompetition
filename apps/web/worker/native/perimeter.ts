import type { RateLimit } from "@cloudflare/workers-types";
import { HttpError } from "./types";
import { clientIp } from "./onboarding/shared";

export interface PerimeterEnv {
  PUBLIC_ORIGIN?: string;
  STRICT_PUBLIC_HOST?: string;
  ENFORCE_RATE_LIMITS?: string;
  API_RATE_LIMITER?: RateLimit;
  AUTH_RATE_LIMITER?: RateLimit;
}

/** Cheap ingress protection before database queries or room allocation.
 * Cloudflare's local, approximate counters are a burst filter; durable budgets
 * separately enforce email/account limits. Only Cloudflare ingress supplies IP.
 */
export async function enforcePerimeter(request: Request, env: PerimeterEnv): Promise<void> {
  const url = new URL(request.url);
  if (env.STRICT_PUBLIC_HOST === "true") {
    if (!env.PUBLIC_ORIGIN) throw new HttpError(503, "Service configuration is unavailable.");
    if (url.origin !== new URL(env.PUBLIC_ORIGIN).origin) throw new HttpError(404, "Route not found.");
  }
  if (url.pathname.length + url.search.length > 2048) throw new HttpError(414, "Request URL is too long.");
  if (env.ENFORCE_RATE_LIMITS === "true" && (!env.API_RATE_LIMITER || !env.AUTH_RATE_LIMITER)) {
    throw new HttpError(503, "Request protection is unavailable. Please retry later.");
  }
  // Shared NATs need a generous API burst allowance; never use client-selected
  // identifiers, forwarded headers, paths or query strings to shard this limit.
  const ingressIp = clientIp(request);
  const key = ingressIp.length <= 64 ? ingressIp.toLowerCase() : "unknown-ingress";
  if (env.API_RATE_LIMITER && !(await env.API_RATE_LIMITER.limit({ key: `api:${key}` })).success) {
    throw new HttpError(429, "Too many requests. Please wait a minute and try again.");
  }
  if (url.pathname.startsWith("/api/v1/auth/") && env.AUTH_RATE_LIMITER && !(await env.AUTH_RATE_LIMITER.limit({ key: `auth:${key}` })).success) {
    throw new HttpError(429, "Too many account requests. Please wait a minute and try again.");
  }
}
