import type { Env } from "../types";

/**
 * Wipe Durable Object storage left behind by season deletion.
 *
 * Room and report Durable Objects persist in SQLite that is invisible to D1,
 * so deleting the season's D1 rows alone leaks that storage forever. This
 * best-effort pass addresses each room object by name (`${orgId}:${roomId}`)
 * and the season's reports object (`${orgId}:${seasonId}`) via their internal
 * `/wipe` endpoint. Failures (missing binding, rejected fetch, non-2xx) are
 * logged and swallowed — the D1 delete must proceed regardless.
 *
 * Ordering: collect the room ids BEFORE the D1 delete (the delete removes
 * the rows this lookup needs), then wipe AFTER the delete succeeds. A failed
 * revision guard therefore never orphans Durable Object storage, and a
 * failed wipe never blocks the season delete.
 */
export async function listSeasonRoomIds(env: Pick<Env, 'DB'>, orgId: string, seasonId: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    "SELECT id FROM Records WHERE kind='room' AND org_id=? AND season_id=?"
  ).bind(orgId, seasonId).all<{ id: string }>();
  return (rows.results ?? []).map(row => String(row.id).toLowerCase()).filter(Boolean);
}

export async function wipeSeasonObjects(
  env: Pick<Env, 'DB' | 'ROOMS' | 'REPORTS'>,
  orgId: string,
  seasonId: string,
  roomIds?: string[],
): Promise<{ rooms: number; reports: number; failed: number }> {
  const tally = { rooms: 0, reports: 0, failed: 0 };
  const wipe = async (target: string, name: string) => {
    const namespace = target === "room" ? env.ROOMS : env.REPORTS;
    if (!namespace) return;
    try {
      const response = await namespace.getByName(name).fetch(new Request("https://internal/wipe", { method: "POST" }) as never);
      if (response.ok) {
        if (target === "room") tally.rooms++;
        else tally.reports++;
      } else {
        tally.failed++;
        console.warn(`season-wipe: ${target} ${name} returned ${response.status}`);
      }
    } catch (error) {
      tally.failed++;
      console.warn(`season-wipe: ${target} ${name} failed`, error);
    }
  };
  const ids = roomIds ?? await listSeasonRoomIds(env, orgId, seasonId);
  for (const roomId of ids) await wipe("room", `${orgId}:${roomId}`);
  await wipe("reports", `${orgId}:${seasonId}`);
  return tally;
}
