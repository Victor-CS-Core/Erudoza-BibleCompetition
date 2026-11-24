import type { Env } from "./types";

/** Durable 5xx log (ErrorEvents, migration 0009). Before this table the
 *  worker's failures existed only as console.error lines in the deploy log,
 *  so a defect class like the onboarding 503s could run for weeks unseen.
 *  The fetch handler's catch path records one row per server error; rows
 *  roll off after 30 days, pruned on write so no extra cron is needed. */
const ROLL_AFTER_MS = 30 * 86_400_000;

export function routeArea(pathname: string): string {
  // Onboarding (signup, invitations, code requests) lives under /api/v1/auth.
  if (pathname.startsWith("/api/v1/auth")) return "Accounts";
  if (pathname.startsWith("/api/v1/study") || pathname.startsWith("/api/v1/progress")) return "Study";
  if (pathname.startsWith("/api/v1/pbe")) return "PBE";
  if (pathname.startsWith("/api/v1/profile")) return "Profile";
  if (pathname.startsWith("/api/v1/admin")) return "Control center";
  if (pathname.startsWith("/api/v1/organizations")) return "Clubs";
  return "Other";
}

/** Best-effort by design: recording an error must never mask the original
 *  failure or turn a 503 into a thrown 500, so every failure here is
 *  swallowed. */
export async function recordErrorEvent(env: Env, pathname: string, status: number, errorName: string): Promise<void> {
  try {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO ErrorEvents(id, occurred_at, route_area, status, error_name) VALUES(?,?,?,?,?)").bind(crypto.randomUUID(), now, routeArea(pathname), status, errorName.slice(0, 80)),
      env.DB.prepare("DELETE FROM ErrorEvents WHERE occurred_at < ?").bind(now - ROLL_AFTER_MS),
    ]);
  } catch { /* the original error response is already on its way */ }
}
