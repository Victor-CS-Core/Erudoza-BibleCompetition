import type { Env, RequestContext } from "../types";
import { body, HttpError, json } from "../types";
import { atomic, id, requireLearner } from "../application/model";
import type { Season } from "../application/model";
import { buildTeamPracticeNotification, teamPracticeActivityLabel } from "../application/notifications";
import type { TeamPracticeNotification } from "../application/notifications";
import { validateSimulation } from "./simulation";
import type { SimulationSettings } from "./simulation";
import { Store } from "../store";

/** Coach-created Team Practice event (kind 'practice-event'). The event is a
 *  plan — activity settings + season + assigned roster + optional schedule —
 *  that materializes into an ordinary room (see internalCreate in room.ts)
 *  when it opens. Gameplay inside the room is unchanged. */
export interface PracticeEvent {
  id: string;
  orgId: string;
  seasonId: string;
  name: string;
  activity: 'Simulation' | 'HeadToHead';
  format: 'Arcade' | 'Pbe';
  teamCount: 1 | 2;
  teamSize: number;
  questionCount: number;
  coached: boolean;
  bookKey?: string;
  simulation?: SimulationSettings;
  createdByUserId: string;
  roster: { userId: string; team: 1 | 2 }[];
  /** Per-event opt-in: this roster member (their team's captain) may start. */
  captainStartUserId: string | null;
  startsAtUtc: string | null;
  status: 'Scheduled' | 'Open' | 'Playing' | 'Completed' | 'Cancelled' | 'Expired';
  roomId: string | null;
  openedAtUtc: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
}

interface RoomSummary {
  id: string; seasonId: string; ownerId: string; coachId?: string;
  format?: 'Arcade' | 'Pbe'; teamCount?: 1 | 2; teamSize: number; questionCount: number;
  coached: boolean; status: string; memberCount: number;
  members?: { userId: string; displayName: string; team: number; ready: boolean; captain: boolean; scribe: boolean }[];
  eventId?: string | null;
}

const isCoach = (actor: RequestContext["actor"]): boolean => actor.kind === "Adult" && ["Owner", "Admin"].includes(actor.role);
function coachOnly(ctx: RequestContext): void { if (!isCoach(ctx.actor)) throw new HttpError(403, "Only a coach can manage team practice events."); }
function need(ok: unknown, message: string, status = 400): asserts ok { if (!ok) throw new HttpError(status, message); }

interface ParsedEventInput {
  seasonId: string; seasonName: string; name: string;
  activity: 'Simulation' | 'HeadToHead'; format: 'Arcade' | 'Pbe'; teamCount: 1 | 2;
  teamSize: number; questionCount: number; coached: boolean; bookKey?: string;
  simulation?: SimulationSettings;
  roster: { userId: string; team: 1 | 2 }[];
  captainStartUserId: string | null;
  startsAtUtc: string | null;
}

async function parseEventInput(ctx: RequestContext, raw: Record<string, unknown>): Promise<ParsedEventInput> {
  const seasonId = typeof raw.seasonId === "string" ? raw.seasonId : "";
  need(seasonId, "Choose a season.");
  const season = await ctx.store.require<Season>("season", seasonId, ctx.orgId);
  need(season.value.status === "Active", "Choose an active season.");
  const activity: 'Simulation' | 'HeadToHead' = raw.activity === "Simulation" || (raw.activity === undefined && raw.simulation !== undefined) ? "Simulation" : "HeadToHead";
  let format: 'Arcade' | 'Pbe', teamCount: 1 | 2, coached = false, simulation: SimulationSettings | undefined;
  if (activity === "Simulation") {
    need(raw.simulation && typeof raw.simulation === "object", "Provide simulation settings.");
    need(season.value.pbeEnabled, "PBE training is not enabled for this season.", 403);
    format = "Pbe"; teamCount = 1; simulation = raw.simulation as SimulationSettings;
  } else {
    format = raw.format === "Pbe" ? "Pbe" : "Arcade";
    if (format === "Pbe") need(season.value.pbeEnabled, "PBE training is not enabled for this season.", 403);
    teamCount = 2; coached = raw.coached === true;
  }
  const pbe = format === "Pbe";
  const teamSize = Number(raw.teamSize);
  need(Number.isInteger(teamSize) && teamSize >= (pbe ? 2 : 1) && teamSize <= (pbe ? 6 : 5), pbe ? "Choose a team size from two to six." : "Choose a team size from one to five.");
  const questionCount = Number(raw.questionCount);
  need([10, 30, 90].includes(questionCount), "Choose 10, 30 or 90 questions.");
  const bookKey = typeof raw.bookKey === "string" && raw.bookKey.trim() ? raw.bookKey.trim().toUpperCase() : undefined;
  // Roster: exact seat fill, season members only (adults may be rostered as
  // learners without a membership record — learner parity, spec §4.4).
  need(Array.isArray(raw.roster) && raw.roster.length > 0, "Assign players to every seat.");
  const roster: { userId: string; team: 1 | 2 }[] = [];
  const seen = new Set<string>();
  for (const entry of raw.roster as { userId?: unknown; team?: unknown }[]) {
    need(entry && typeof entry.userId === "string" && (entry.team === 1 || entry.team === 2), "Choose a player and team for every seat.");
    need(!seen.has(entry.userId), "Each player can only hold one seat.");
    seen.add(entry.userId as string);
    roster.push({ userId: entry.userId as string, team: entry.team as 1 | 2 });
  }
  const teams = teamCount === 1 ? [1] : [1, 2];
  for (const team of teams) need(roster.filter(e => e.team === team).length === teamSize, `Team ${team} needs exactly ${teamSize} assigned players. Fill every seat before saving.`);
  need(roster.every(e => teams.includes(e.team)), "Players can only be assigned to a team in this event.");
  const userRows = await ctx.env.DB.prepare(`SELECT id,display_name AS displayName,kind,role,active FROM Users WHERE org_id=? AND id IN (SELECT value FROM json_each(?))`).bind(ctx.orgId, JSON.stringify(roster.map(e => e.userId))).all<{ id: string; displayName: string; kind: string; role: string; active: number }>();
  const users = new Map(userRows.results.map(u => [u.id, u]));
  const memberships = await ctx.store.getMany<{ userId: string }>("membership", roster.map(e => `${seasonId}:${e.userId}`), ctx.orgId);
  const memberIds = new Set(memberships.map(m => m.value.userId));
  for (const entry of roster) {
    const user = users.get(entry.userId);
    need(user && user.active === 1, "An assigned player is no longer available.");
    const learnerKind = (user!.kind === "Student" && user!.role === "Student") || (user!.kind === "Adult" && ["Owner", "Admin"].includes(user!.role));
    need(learnerKind, "Assigned players must be students or coaches in learner mode.");
    need(memberIds.has(entry.userId) || user!.kind === "Adult", `${user!.displayName} is not on this season's roster. Assign their passages first.`);
  }
  if (simulation) {
    const withPresenter: SimulationSettings = { ...simulation, audioPresenterId: simulation.audioPresenterId ?? roster[0].userId };
    simulation = validateSimulation(withPresenter, questionCount, roster.map(e => e.userId));
  }
  let captainStartUserId: string | null = null;
  if (raw.captainStartUserId !== undefined && raw.captainStartUserId !== null) {
    need(typeof raw.captainStartUserId === "string" && roster.some(e => e.userId === raw.captainStartUserId), "The designated captain must be assigned to this event.");
    captainStartUserId = raw.captainStartUserId as string;
  }
  let startsAtUtc: string | null = null;
  if (raw.startsAtUtc !== undefined && raw.startsAtUtc !== null) {
    need(typeof raw.startsAtUtc === "string" && Number.isFinite(Date.parse(raw.startsAtUtc)), "Choose a valid start time.");
    startsAtUtc = new Date(Date.parse(raw.startsAtUtc as string)).toISOString();
  }
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 120) : `${teamPracticeActivityLabel(activity)} · ${season.value.name}`;
  return { seasonId, seasonName: season.value.name, name, activity, format, teamCount, teamSize, questionCount, coached, bookKey, simulation, roster, captainStartUserId, startsAtUtc };
}

function noticeFor(ctx: RequestContext, event: Pick<PracticeEvent, "id" | "name" | "activity" | "seasonId">, seasonName: string, studentUserId: string, action: TeamPracticeNotification["action"], startsAtUtc: string | null): TeamPracticeNotification {
  return buildTeamPracticeNotification({ eventId: event.id, eventName: event.name, activity: event.activity, seasonId: event.seasonId, seasonName, studentUserId, actorUserId: ctx.actor.userId, actorDisplayName: ctx.actor.displayName, action, startsAtUtc });
}
const noticeWrites = (ctx: RequestContext, notices: TeamPracticeNotification[], seasonId: string) =>
  notices.map(n => ctx.store.insertion("notification", n.id, ctx.orgId, n, { seasonId, ownerId: n.studentUserId }));

async function roomSummaries(ctx: { env: Env; orgId: string }, roomIds: string[]): Promise<Map<string, RoomSummary>> {
  const map = new Map<string, RoomSummary>();
  if (!roomIds.length) return map;
  const rows = await ctx.env.DB.prepare("SELECT data FROM Records WHERE kind='room' AND org_id=? AND id IN (SELECT value FROM json_each(?))").bind(ctx.orgId, JSON.stringify(roomIds)).all<{ data: string }>();
  for (const row of rows.results) { const summary = JSON.parse(row.data) as RoomSummary; map.set(summary.id, summary); }
  return map;
}

function derivedStatus(event: PracticeEvent, room?: RoomSummary): PracticeEvent["status"] {
  if (["Scheduled", "Cancelled", "Expired"].includes(event.status)) return event.status;
  if (!room) return event.status;
  switch (room.status) {
    case "Lobby": return "Open";
    case "Playing": return "Playing";
    case "Completed": case "Interrupted": return "Completed";
    case "Abandoned": return "Expired";
    default: return event.status;
  }
}

async function eventDto(ctx: RequestContext, event: PracticeEvent, rooms?: Map<string, RoomSummary>) {
  const season = await ctx.store.get<Season>("season", event.seasonId, ctx.orgId);
  const room = event.roomId ? (rooms ?? await roomSummaries(ctx, [event.roomId])).get(event.roomId) : undefined;
  const userRows = await ctx.env.DB.prepare("SELECT id,display_name AS displayName FROM Users WHERE org_id=? AND id IN (SELECT value FROM json_each(?))").bind(ctx.orgId, JSON.stringify(event.roster.map(e => e.userId))).all<{ id: string; displayName: string }>();
  const names = new Map(userRows.results.map(u => [u.id, u.displayName]));
  return {
    id: event.id, seasonId: event.seasonId, seasonName: season?.value.name ?? "Past season", name: event.name,
    activity: event.activity, format: event.format, teamCount: event.teamCount, teamSize: event.teamSize,
    questionCount: event.questionCount, coached: event.coached, bookKey: event.bookKey ?? null,
    simulation: event.simulation ?? null, createdByUserId: event.createdByUserId,
    roster: event.roster.map(e => ({ userId: e.userId, displayName: names.get(e.userId) ?? "Player", team: e.team })),
    captainStartUserId: event.captainStartUserId, startsAtUtc: event.startsAtUtc,
    status: derivedStatus(event, room), roomId: event.roomId,
    myTeam: event.roster.find(e => e.userId === ctx.actor.userId)?.team ?? null,
    room: room ? { id: room.id, status: room.status, memberCount: room.memberCount, members: room.members ?? [] } : null,
    createdAtUtc: event.createdAtUtc, updatedAtUtc: event.updatedAtUtc,
  };
}

/** Ask the room DO to create this event's room with the roster pre-seeded. */
export async function materializeEvent(base: { env: Env; store: RequestContext["store"]; orgId: string; nowHeader?: string | null }, event: PracticeEvent): Promise<PracticeEvent> {
  if (event.roomId) return event;
  if (!base.env.ROOMS) throw new HttpError(503, "Room storage is not configured.");
  const roomId = id();
  const creation = { seasonId: event.seasonId, teamSize: event.teamSize, questionCount: event.questionCount, coached: event.coached, bookKey: event.bookKey, format: event.format, teamCount: event.teamCount, simulation: event.simulation, eventId: event.id, captainStartUserId: event.captainStartUserId, roster: event.roster };
  const url = new URL("https://internal/practice"); url.pathname = `/api/v1/organizations/${base.orgId}/practice/rooms/${roomId}`;
  const headers: Record<string, string> = { "x-erudoza-event-internal": "1", "content-type": "application/json" };
  if (base.nowHeader) headers["x-test-room-now"] = base.nowHeader;
  const response = await base.env.ROOMS.getByName(`${base.orgId}:${roomId}`).fetch(new Request(url, { method: "POST", headers, body: JSON.stringify({ actorUserId: event.createdByUserId, creation }) }) as never) as unknown as Response;
  if (!response.ok) { const problem = await response.json().catch(() => null) as { title?: string } | null; throw new HttpError(response.status >= 400 && response.status < 600 ? response.status : 503, problem?.title ?? "The event room could not be opened."); }
  const opened: PracticeEvent = { ...event, roomId, status: "Open", openedAtUtc: new Date().toISOString(), updatedAtUtc: new Date().toISOString() };
  const stored = await base.store.require<PracticeEvent>("practice-event", event.id, base.orgId);
  await base.store.put("practice-event", event.id, base.orgId, opened, stored.revision);
  return opened;
}

async function abandonEventRoom(env: Env, orgId: string, roomId: string): Promise<void> {
  if (!env.ROOMS) return;
  const url = new URL("https://internal/practice"); url.pathname = `/api/v1/organizations/${orgId}/practice/rooms/${roomId}/abandon`;
  await env.ROOMS.getByName(`${orgId}:${roomId}`).fetch(new Request(url, { method: "POST", headers: { "x-erudoza-event-internal": "1", "content-type": "application/json" }, body: "{}" }) as never).catch(() => undefined);
}

/** Open due scheduled events and expire stale open lobbies for one org.
 *  Runs from the cron scan and lazily from event reads (no-cron edge). */
export async function runEventScan(env: Env, orgId: string): Promise<{ opened: number; expired: number }> {
  const store = new Store(env.DB);
  let opened = 0, expired = 0;
  const nowIso = new Date().toISOString();
  const events = await store.list<PracticeEvent>("practice-event", orgId);
  for (const event of events) {
    if (event.status === "Scheduled" && event.startsAtUtc && event.startsAtUtc <= nowIso) {
      try { await materializeEvent({ env, store, orgId }, event); opened++; } catch { /* retried on the next scan/read */ }
    }
  }
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  const rooms = await roomSummaries({ env, orgId }, events.filter(e => e.status === "Open" && e.roomId).map(e => e.roomId!));
  for (const event of events) {
    if (event.status !== "Open" || !event.roomId || !event.openedAtUtc || event.openedAtUtc > cutoff) continue;
    if (rooms.get(event.roomId)?.status !== "Lobby") continue;
    await abandonEventRoom(env, orgId, event.roomId);
    const stored = await store.get<PracticeEvent>("practice-event", event.id, orgId);
    if (stored) { await store.put("practice-event", event.id, orgId, { ...stored.value, status: "Expired", updatedAtUtc: new Date().toISOString() }, stored.revision).catch(() => undefined); expired++; }
  }
  return { opened, expired };
}

/** Cron entry: scan every org that has practice events. */
export async function runTeamPracticeScan(env: Env): Promise<{ opened: number; expired: number }> {
  const rows = await env.DB.prepare("SELECT DISTINCT org_id AS orgId FROM Records WHERE kind='practice-event'").all<{ orgId: string }>();
  let opened = 0, expired = 0;
  for (const row of rows.results) { const result = await runEventScan(env, row.orgId); opened += result.opened; expired += result.expired; }
  return { opened, expired };
}

export async function practiceEventRoutes(ctx: RequestContext): Promise<Response | null> {
  const path = ctx.path;
  if (path === "/practice/events/roster" && ctx.request.method === "GET") {
    coachOnly(ctx);
    const seasonId = new URL(ctx.request.url).searchParams.get("seasonId") ?? "";
    need(seasonId, "Choose a season.");
    await ctx.store.require<Season>("season", seasonId, ctx.orgId);
    const memberships = await ctx.store.list<{ userId: string }>("membership", ctx.orgId, { seasonId });
    const ids = new Set(memberships.map(m => m.userId));
    const adults = await ctx.env.DB.prepare("SELECT id FROM Users WHERE org_id=? AND active=1 AND kind='Adult' AND role IN ('Owner','Admin')").bind(ctx.orgId).all<{ id: string }>();
    for (const adult of adults.results) ids.add(adult.id);
    if (!ids.size) return json({ members: [] });
    const rows = await ctx.env.DB.prepare("SELECT id,display_name AS displayName,kind,role FROM Users WHERE org_id=? AND active=1 AND id IN (SELECT value FROM json_each(?)) ORDER BY display_name").bind(ctx.orgId, JSON.stringify([...ids])).all<{ id: string; displayName: string; kind: string; role: string }>();
    return json({ members: rows.results.map(u => ({ userId: u.id, displayName: u.displayName, kind: u.kind, role: u.role })) });
  }
  if (path === "/practice/events" && ctx.request.method === "POST") {
    coachOnly(ctx);
    const raw = await body<Record<string, unknown>>(ctx.request, 32768);
    const parsed = await parseEventInput(ctx, raw);
    const openNow = !parsed.startsAtUtc || Date.parse(parsed.startsAtUtc) <= Date.now();
    const now = new Date().toISOString();
    const event: PracticeEvent = {
      id: id(), orgId: ctx.orgId, seasonId: parsed.seasonId, name: parsed.name, activity: parsed.activity,
      format: parsed.format, teamCount: parsed.teamCount, teamSize: parsed.teamSize, questionCount: parsed.questionCount,
      coached: parsed.coached, bookKey: parsed.bookKey, simulation: parsed.simulation, createdByUserId: ctx.actor.userId,
      roster: parsed.roster, captainStartUserId: parsed.captainStartUserId,
      startsAtUtc: openNow ? null : parsed.startsAtUtc, status: openNow ? "Open" : "Scheduled",
      roomId: null, openedAtUtc: null, createdAtUtc: now, updatedAtUtc: now,
    };
    const notices = event.roster.map(e => noticeFor(ctx, event, parsed.seasonName, e.userId, "assigned", openNow ? null : event.startsAtUtc));
    await atomic(ctx, "practice-event.create", [ctx.store.insertion("practice-event", event.id, ctx.orgId, event, { seasonId: event.seasonId }), ...noticeWrites(ctx, notices, event.seasonId)], [{ kind: "@active-admin", id: ctx.actor.userId, revision: 0 }]);
    const saved = openNow ? await materializeEvent({ env: ctx.env, store: ctx.store, orgId: ctx.orgId, nowHeader: ctx.request.headers.get("x-test-room-now") }, event) : event;
    return json(await eventDto(ctx, saved), 201);
  }
  if (path === "/practice/events" && ctx.request.method === "GET") {
    await runEventScan(ctx.env, ctx.orgId).catch(() => undefined);
    const coach = isCoach(ctx.actor);
    if (!coach) await requireLearner(ctx);
    let events = await ctx.store.list<PracticeEvent>("practice-event", ctx.orgId);
    if (!coach) events = events.filter(e => e.roster.some(r => r.userId === ctx.actor.userId));
    events.sort((a, b) => (a.startsAtUtc ?? a.createdAtUtc).localeCompare(b.startsAtUtc ?? b.createdAtUtc));
    const rooms = await roomSummaries(ctx, events.map(e => e.roomId).filter((x): x is string => !!x));
    return json({ events: await Promise.all(events.map(e => eventDto(ctx, e, rooms))) });
  }
  const match = path.match(/^\/practice\/events\/([a-f0-9-]{36})(\/open|\/cancel|\/duplicate)?$/i);
  if (!match) return null;
  const eventId = match[1], action = match[2] ?? "";
  const stored = await ctx.store.get<PracticeEvent>("practice-event", eventId, ctx.orgId);
  if (action === "" && ctx.request.method === "GET") {
    if (!stored) throw new HttpError(404, "Event not found.");
    if (isCoach(ctx.actor)) return json(await eventDto(ctx, stored.value));
    await requireLearner(ctx);
    if (!stored.value.roster.some(r => r.userId === ctx.actor.userId)) throw new HttpError(404, "Event not found.");
    await runEventScan(ctx.env, ctx.orgId).catch(() => undefined);
    const fresh = await ctx.store.get<PracticeEvent>("practice-event", eventId, ctx.orgId);
    return json(await eventDto(ctx, fresh?.value ?? stored.value));
  }
  if (action === "" && ctx.request.method === "PATCH") {
    coachOnly(ctx);
    if (!stored) throw new HttpError(404, "Event not found.");
    const event = stored.value;
    need(event.status === "Scheduled", "Only scheduled events can be edited. Once an event opens, manage its roster in the room.", 409);
    const raw = await body<Record<string, unknown>>(ctx.request, 32768);
    need(raw.seasonId === undefined || raw.seasonId === event.seasonId, "An event stays in its season. Cancel and recreate it to move seasons.");
    const parsed = await parseEventInput(ctx, { ...raw, seasonId: event.seasonId });
    const updated: PracticeEvent = { ...event, name: parsed.name, activity: parsed.activity, format: parsed.format, teamCount: parsed.teamCount, teamSize: parsed.teamSize, questionCount: parsed.questionCount, coached: parsed.coached, bookKey: parsed.bookKey, simulation: parsed.simulation, roster: parsed.roster, captainStartUserId: parsed.captainStartUserId, startsAtUtc: parsed.startsAtUtc, updatedAtUtc: new Date().toISOString() };
    const before = new Map(event.roster.map(e => [e.userId, e.team])), after = new Map(parsed.roster.map(e => [e.userId, e.team]));
    const notices: TeamPracticeNotification[] = [];
    for (const entry of parsed.roster) if (!before.has(entry.userId)) notices.push(noticeFor(ctx, updated, parsed.seasonName, entry.userId, "assigned", parsed.startsAtUtc));
    for (const entry of event.roster) if (!after.has(entry.userId)) notices.push(noticeFor(ctx, updated, parsed.seasonName, entry.userId, "removed", null));
    if (event.startsAtUtc !== parsed.startsAtUtc) for (const entry of parsed.roster) if (before.has(entry.userId)) notices.push(noticeFor(ctx, updated, parsed.seasonName, entry.userId, "rescheduled", parsed.startsAtUtc));
    await atomic(ctx, "practice-event.update", [ctx.store.update("practice-event", event.id, ctx.orgId, updated, stored.revision), ...noticeWrites(ctx, notices, event.seasonId)], [{ kind: "practice-event", id: event.id, revision: stored.revision }, { kind: "@active-admin", id: ctx.actor.userId, revision: 0 }]);
    const openNow = raw.openNow === true || (parsed.startsAtUtc !== null && Date.parse(parsed.startsAtUtc) <= Date.now());
    const saved = openNow ? await materializeEvent({ env: ctx.env, store: ctx.store, orgId: ctx.orgId, nowHeader: ctx.request.headers.get("x-test-room-now") }, updated) : updated;
    return json(await eventDto(ctx, saved));
  }
  if (action === "/open" && ctx.request.method === "POST") {
    coachOnly(ctx);
    if (!stored) throw new HttpError(404, "Event not found.");
    need(!["Cancelled", "Expired"].includes(stored.value.status), "This event can no longer be opened.", 409);
    const opened = await materializeEvent({ env: ctx.env, store: ctx.store, orgId: ctx.orgId, nowHeader: ctx.request.headers.get("x-test-room-now") }, stored.value);
    return json(await eventDto(ctx, opened));
  }
  if (action === "/cancel" && ctx.request.method === "POST") {
    coachOnly(ctx);
    if (!stored) throw new HttpError(404, "Event not found.");
    const event = stored.value;
    need(!["Cancelled", "Expired", "Completed"].includes(event.status), "This event can no longer be cancelled.", 409);
    if (event.roomId) {
      const room = (await roomSummaries(ctx, [event.roomId])).get(event.roomId);
      need(room?.status !== "Playing", "The match has already started and cannot be cancelled.", 409);
      need(room?.status !== "Completed", "This event has already completed.", 409);
      if (room?.status === "Lobby") await abandonEventRoom(ctx.env, ctx.orgId, event.roomId);
    }
    const season = await ctx.store.get<Season>("season", event.seasonId, ctx.orgId);
    const cancelled: PracticeEvent = { ...event, status: "Cancelled", updatedAtUtc: new Date().toISOString() };
    const notices = event.roster.map(e => noticeFor(ctx, event, season?.value.name ?? "Past season", e.userId, "cancelled", null));
    await atomic(ctx, "practice-event.cancel", [ctx.store.update("practice-event", event.id, ctx.orgId, cancelled, stored.revision), ...noticeWrites(ctx, notices, event.seasonId)], [{ kind: "practice-event", id: event.id, revision: stored.revision }, { kind: "@active-admin", id: ctx.actor.userId, revision: 0 }]);
    return json(await eventDto(ctx, cancelled));
  }
  if (action === "/duplicate" && ctx.request.method === "POST") {
    coachOnly(ctx);
    if (!stored) throw new HttpError(404, "Event not found.");
    const source = stored.value;
    const raw = await body<Record<string, unknown>>(ctx.request, 4096).catch(() => ({} as Record<string, unknown>));
    const parsed = await parseEventInput(ctx, { seasonId: source.seasonId, activity: source.activity, format: source.format, teamSize: source.teamSize, questionCount: source.questionCount, coached: source.coached, bookKey: source.bookKey, simulation: source.simulation, roster: source.roster, captainStartUserId: source.captainStartUserId, startsAtUtc: typeof raw.startsAtUtc === "string" ? raw.startsAtUtc : null, name: typeof raw.name === "string" && raw.name.trim() ? raw.name : source.name });
    const now = new Date().toISOString();
    const event: PracticeEvent = { id: id(), orgId: ctx.orgId, seasonId: source.seasonId, name: parsed.name, activity: parsed.activity, format: parsed.format, teamCount: parsed.teamCount, teamSize: parsed.teamSize, questionCount: parsed.questionCount, coached: parsed.coached, bookKey: parsed.bookKey, simulation: parsed.simulation, createdByUserId: ctx.actor.userId, roster: parsed.roster, captainStartUserId: parsed.captainStartUserId, startsAtUtc: parsed.startsAtUtc, status: "Scheduled", roomId: null, openedAtUtc: null, createdAtUtc: now, updatedAtUtc: now };
    const notices = event.roster.map(e => noticeFor(ctx, event, parsed.seasonName, e.userId, "assigned", event.startsAtUtc));
    await atomic(ctx, "practice-event.duplicate", [ctx.store.insertion("practice-event", event.id, ctx.orgId, event, { seasonId: event.seasonId }), ...noticeWrites(ctx, notices, event.seasonId)], [{ kind: "@active-admin", id: ctx.actor.userId, revision: 0 }]);
    return json(await eventDto(ctx, event), 201);
  }
  return null;
}
