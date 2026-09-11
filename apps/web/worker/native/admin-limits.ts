import type { D1PreparedStatement } from '@cloudflare/workers-types';
import type { RequestContext } from './types';
import { admin, HttpError } from './types';
import { budget } from './onboarding/limits';

const DAY_MS = 86_400_000;
const STORAGE_LIMITS = { students: 100, seasons: 12 } as const;
type Collection = keyof typeof STORAGE_LIMITS;

/** Attempt reservations stay charged if validation or later work fails. Training is excluded. */
export async function administrationBudget(ctx: RequestContext, credentials = false): Promise<void> {
  if (ctx.orgId !== ctx.actor.organizationId) throw new HttpError(403, 'Organization access denied.');
  admin(ctx.actor);
  const day = Math.floor(Date.now() / DAY_MS), expiresAt = (day + 2) * DAY_MS;
  const category = credentials ? 'credentials' : 'writes';
  const limits = credentials ? { global: 300, org: 60, actor: 30 } : { global: 3000, org: 600, actor: 300 };
  // A fixed global key is first: persistent counter cardinality and total accepted
  // work stay bounded even when many accounts use different organizations.
  await budget(ctx.env, `admin:${category}:global`, day, limits.global, expiresAt);
  await budget(ctx.env, `admin:${category}:org:${ctx.orgId}`, day, limits.org, expiresAt);
  await budget(ctx.env, `admin:${category}:actor:${ctx.actor.userId}`, day, limits.actor, expiresAt);
}

function countSql(collection: Collection): string {
  // Index-backed, bounded scans also protect installations that already exceed a cap.
  return collection === 'students'
    ? "SELECT count(*) AS used FROM (SELECT id FROM Users WHERE org_id=? AND kind='Student' LIMIT 100)"
    : "SELECT count(*) AS used FROM (SELECT id FROM Records WHERE org_id=? AND kind='season' LIMIT 12)";
}

/** Cheap preflight prevents password work when the roster is already full. */
export async function assertStorageCapacity(ctx: RequestContext, collection: Collection): Promise<void> {
  const count = await ctx.env.DB.prepare(countSql(collection)).bind(ctx.orgId).first<number>('used');
  if (count === null || count >= STORAGE_LIMITS[collection]) {
    throw new HttpError(409, `This club has reached the pilot limit of ${STORAGE_LIMITS[collection]} ${collection}.`);
  }
}

/** Place immediately before insertion inside atomic(). A full collection deliberately
 * violates Records' JSON constraint, rolling back the entity and its audit together.
 * The successful guard inserts no row; a zero-row check alone would not abort a batch. */
export function storageCapacityGuard(ctx: RequestContext, collection: Collection): D1PreparedStatement {
  return ctx.env.DB.prepare(`INSERT INTO Records(kind,id,org_id,data)
    SELECT 'audit',?,?,'invalid-json' WHERE (${countSql(collection)})>=?`)
    .bind(crypto.randomUUID(), ctx.orgId, ctx.orgId, STORAGE_LIMITS[collection]);
}
