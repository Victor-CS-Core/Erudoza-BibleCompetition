import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

/** One completed practice session joins the durable daily rollup
 *  (DailyActivity, migration 0009). `day` is the learner's credited local
 *  date — the same day key XP uses — so the control-center chart, the
 *  sessions-today KPI, and XP-by-day all agree about what "today" means.
 *  Returns the statement so callers fold it into the completion write's
 *  atomic batch: a session is never Completed without being counted. */
export function dailyActivityIncrement(db: D1Database, day: string, orgId: string): D1PreparedStatement {
  return db.prepare("INSERT INTO DailyActivity(day, org_id, sessions) VALUES(?,?,1) ON CONFLICT(day, org_id) DO UPDATE SET sessions = sessions + 1").bind(day, orgId);
}
