/**
 * Storage TTL for terminal timed-rehearsal (PbeSoloRound) sessions.
 *
 * Settled/Interrupted state stays live for idempotent replays and next-card
 * transitions, then the object wipes its own SQLite storage — which is
 * invisible to D1 and would otherwise leak forever. Kept in its own module
 * so the pure predicate is unit-testable without the cloudflare:workers
 * import that the Durable Object class needs.
 */
export const SOLO_STORAGE_WIPE_TTL_MS = 24 * 3600_000;

/** True once the post-terminal wipe deadline has passed for a terminal state. */
export function soloWipeDue(state: { status: string } | null, wipeAfter: number | undefined, now: number): boolean {
  return typeof wipeAfter === 'number' && now >= wipeAfter && !!state && (state.status === 'Settled' || state.status === 'Interrupted');
}
