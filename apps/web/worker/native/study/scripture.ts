import { effectiveSources, memberId } from "../application/model";
import type { Season } from "../application/model";
import type { RequestContext } from "../types";
import { HttpError, json } from "../types";

/** Reuse the activity scope so reading cannot reveal unassigned or excluded verses. */
export async function handleScripture(ctx: RequestContext): Promise<Response | null> {
  const match = ctx.path.match(/^\/api\/v1\/study\/seasons\/([a-f0-9-]{36})\/scripture$/i);
  if (!match || ctx.request.method !== "GET") return null;
  if (ctx.actor.kind !== "Student" || ctx.actor.role !== "Student") throw new HttpError(403, "Student access is required.");
  const seasonId = match[1].toLowerCase();
  const season = await ctx.store.get<Season>("season", seasonId, ctx.orgId);
  const member = await ctx.store.get("membership", memberId(seasonId, ctx.actor.userId), ctx.orgId);
  if (!season || !member) throw new HttpError(404, "Assigned season was not found.");
  if (season.value.status !== "Active") throw new HttpError(400, "The season must be active for study.");
  const sources = await effectiveSources(ctx, seasonId, ctx.actor.userId);
  if (sources.length > 5000) throw new HttpError(413, "This reading scope is too large. Ask your coach to narrow the assigned passages.");
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
