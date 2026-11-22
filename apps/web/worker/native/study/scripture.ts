import { effectiveSources, memberId, requireLearner } from "../application/model";
import type { Season } from "../application/model";
import type { RequestContext } from "../types";
import { HttpError, json } from "../types";

/** Reuse the activity scope so reading cannot reveal unassigned or excluded verses. */
export async function handleScripture(ctx: RequestContext): Promise<Response | null> {  const match = ctx.path.match(/^\/api\/v1\/study\/seasons\/([a-f0-9-]{36})\/scripture$/i);
  if (!match || ctx.request.method !== "GET") return null;
  await requireLearner(ctx);
  const seasonId = match[1].toLowerCase();
  const season = await ctx.store.get<Season>("season", seasonId, ctx.orgId);
  const member = await ctx.store.get("membership", memberId(seasonId, ctx.actor.userId), ctx.orgId);
  if (!season || !member) throw new HttpError(404, "Assigned season was not found.");
  if (season.value.status !== "Active") throw new HttpError(400, "The season must be active for study.");
  const sources = await effectiveSources(ctx, seasonId, ctx.actor.userId);
  if (sources.length > 5000) throw new HttpError(413, "This reading scope is too large. Ask your coach to narrow the assigned passages.");
  await stampReaderAssistance(ctx, seasonId);
  return json({ seasonId, verses: sources.map(source => ({
    id: source.id,
    citation: source.citation,
    bookKey: source.bookKey,
    chapter: source.chapter,
    verse: source.verse,
    ordinal: source.ordinal,
    canonicalText: source.canonicalText,
  })) });
}

interface ReaderMarkSession {
  status: string;
  mode: string;
  cards: { id: string }[];
  attempts: { cardId: string }[];
  readerAssistedCardIds?: string[];
}

/**
 * Server-stamped assistance (mirrors the PBE source aid's assistedAtMs):
 * reading the assigned scripture while a Practice/Review session has an
 * unanswered card marks THAT card as assisted on the session record, so the
 * attempt's credit no longer depends on the client honestly reporting that
 * it opened the reader. Best-effort by design — a failed stamp must never
 * block reading. Simulation sessions are not stamped: their reader is
 * already absent from the UI, and stamping would hard-fail a later submit
 * ("Hints are not permitted in simulation") for a card the student may have
 * read beside a paused session; simulation unaided claims stay an
 * honor-system property of a web app whose assigned texts are, by design,
 * readable by the student elsewhere in the app.
 */
async function stampReaderAssistance(ctx: RequestContext, seasonId: string): Promise<void> {
  try {
    const rows = await ctx.env.DB.prepare("SELECT id FROM Records WHERE kind='session' AND org_id=? AND season_id=? AND owner_id=? ORDER BY json_extract(data,'$.createdAtUtc') DESC LIMIT 5")
      .bind(ctx.orgId, seasonId, ctx.actor.userId).all<{ id: string }>();
    for (const row of rows.results) {
      const stored = await ctx.store.get<ReaderMarkSession>("session", row.id, ctx.orgId);
      if (!stored) continue;
      const session = stored.value;
      if (!["Created", "Active"].includes(session.status) || !["Practice", "Review"].includes(session.mode)) continue;
      const unanswered = session.cards.find(card => !session.attempts.some(attempt => attempt.cardId === card.id));
      if (!unanswered) continue;
      if (session.readerAssistedCardIds?.includes(unanswered.id)) return;
      session.readerAssistedCardIds = [...(session.readerAssistedCardIds ?? []), unanswered.id];
      await ctx.store.put("session", row.id, ctx.orgId, session, stored.revision);
      return;
    }
  } catch {
    // Assistance stamping is best-effort; reading must not fail because of it.
  }
}
