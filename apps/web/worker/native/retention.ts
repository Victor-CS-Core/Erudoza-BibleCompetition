import type { Env } from "./types";

/**
 * Retention policy for unbounded-growth Records kinds. (Records is a
 * WITHOUT ROWID table, so there is no rowid to order or watermark by;
 * ordering uses the JSON createdAtUtc timestamp, with NULLs first.)
 *
 * - Audit rows (kind='audit'): one row is written per mutation by `atomic()`
 *   and by several PBE guard verifications, and nothing ever deleted them.
 *   Rows older than 90 days are purged. Most audit rows carry `createdAtUtc`
 *   in their data JSON; guard receipts written as '{}' (content.ts) or
 *   `{id, action}` (chapter-manifest.ts) have none and their age cannot be
 *   determined. They are write-verification receipts whose purpose is served
 *   at write time, so they are purged as well, oldest timestamps first.
 * - Notification rows (kind='notification'): one per assignment add/remove/
 *   update, cleaned only on season delete. The newest 100 per user are kept;
 *   anything beyond that is purged. Timestamp ties break on id, which is
 *   arbitrary but stable, keeping the cap idempotent.
 *
 * Both purges are bounded (LIMIT per run) so a weekly cron pass can never
 * scan-delete the whole table at once; the next run picks up the remainder.
 */
export const AUDIT_RETENTION_DAYS = 90;
export const AUDIT_PURGE_BATCH = 1000;
export const NOTIFICATION_KEEP_PER_USER = 100;
export const NOTIFICATION_PURGE_BATCH = 1000;

/** Delete audit rows older than the retention window (plus dateless guard receipts). Returns rows deleted. */
export async function purgeAuditRows(env: Pick<Env, 'DB'>, now: number = Date.now(), batch: number = AUDIT_PURGE_BATCH): Promise<number> {
  const cutoff = new Date(now - AUDIT_RETENTION_DAYS * 86400_000).toISOString();
  const result = await env.DB.prepare(`
    DELETE FROM Records
    WHERE kind='audit'
      AND (json_extract(data,'$.createdAtUtc') IS NULL OR json_extract(data,'$.createdAtUtc') < ?1)
    ORDER BY json_extract(data,'$.createdAtUtc')
    LIMIT ?2`).bind(cutoff, batch).run();
  return result.meta.changes ?? 0;
}

/** Keep only the newest NOTIFICATION_KEEP_PER_USER notifications per user. Returns rows deleted. */
export async function purgeNotifications(env: Pick<Env, 'DB'>, batch: number = NOTIFICATION_PURGE_BATCH): Promise<number> {
  const result = await env.DB.prepare(`
    DELETE FROM Records
    WHERE kind='notification' AND id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY org_id, owner_id
          ORDER BY json_extract(data,'$.createdAtUtc') DESC, id DESC
        ) AS rn
        FROM Records WHERE kind='notification'
      ) WHERE rn > ?1 LIMIT ?2
    )`).bind(NOTIFICATION_KEEP_PER_USER, batch).run();
  return result.meta.changes ?? 0;
}

/** Run every retention purge. Invoked from the weekly cron; safe to call directly in tests. */
export async function runRetentionPurge(env: Pick<Env, 'DB'>, now: number = Date.now()): Promise<{ audit: number; notifications: number }> {
  const audit = await purgeAuditRows(env, now);
  const notifications = await purgeNotifications(env);
  return { audit, notifications };
}
