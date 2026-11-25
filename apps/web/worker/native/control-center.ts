import type { RequestContext } from "./types";
import { body, HttpError, json, masterAdmin, MASTER_ADMIN_EMAIL, requiredString } from "./types";
import { LIBRARY_ORG } from "./application/library-access";
import { APP_VERSION } from "./version";
import { configured, sendEmail } from "./onboarding/providers";

/** Admin Control Center — the app-wide, master-admin-only surface.
 *
 *  Every other admin read in the worker is scoped to the caller's club; this
 *  module is the deliberate exception. All aggregates cross organizations,
 *  every handler opens with masterAdmin(), and there is no club-scoped
 *  variant of any of it. The client mirrors the gate for UX only.
 *
 *  Day windows come from the viewer (the master admin's browser) as ISO
 *  dates — `today` and the Monday `weekStart` — because "today" and "this
 *  week" are the viewer's days, the same convention the leaderboard uses.
 *  XP and activity day keys in storage are each learner's local date, so
 *  app-wide sums over a viewer window are the established approximation. */

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SUPPORT_ADDRESS = "ktr0nn@muse.ai";

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function dayMs(iso: string): number { return Date.parse(`${iso}T00:00:00Z`); }

interface Windows { today: string; weekStart: string; weekEnd: string; prevStart: string; prevEnd: string }
function windows(request: Request): Windows {
  const q = new URL(request.url).searchParams;
  const now = new Date();
  const utcToday = now.toISOString().slice(0, 10);
  const today = q.get("today") && DATE_RE.test(q.get("today")!) ? q.get("today")! : utcToday;
  // Monday of the viewer's week: default to the Monday of today's week (UTC).
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const weekStart = q.get("weekStart") && DATE_RE.test(q.get("weekStart")!) ? q.get("weekStart")! : addDays(today, -dow);
  return { today, weekStart, weekEnd: addDays(weekStart, 6), prevStart: addDays(weekStart, -7), prevEnd: addDays(weekStart, -1) };
}

async function xpWindow(ctx: RequestContext, start: string, end: string): Promise<{ xp: number; users: number }> {
  const row = await ctx.env.DB.prepare(
    `SELECT COALESCE(sum(CAST(j.value AS INTEGER)), 0) AS xp, count(DISTINCT r.id) AS users
     FROM Records r, json_each(r.data, '$.xpByDay') j
     WHERE r.kind = 'training-xp' AND j.key BETWEEN ? AND ? AND CAST(j.value AS INTEGER) > 0`,
  ).bind(start, end).first<{ xp: number; users: number }>();
  return { xp: row?.xp ?? 0, users: row?.users ?? 0 };
}

async function overview(ctx: RequestContext) {
  const w = windows(ctx.request);
  const db = ctx.env.DB;
  const [total, fresh, week, prev, sessionsToday, chartRows, clubRows] = await Promise.all([
    db.prepare("SELECT count(*) AS n FROM Users").first<{ n: number }>(),
    db.prepare("SELECT count(*) AS n FROM Users WHERE created_at >= ?").bind(dayMs(w.today.slice(0, 8) + "01")).first<{ n: number }>(),
    xpWindow(ctx, w.weekStart, w.weekEnd),
    xpWindow(ctx, w.prevStart, w.prevEnd),
    db.prepare("SELECT COALESCE(sum(sessions), 0) AS n FROM DailyActivity WHERE day = ?").bind(w.today).first<{ n: number }>(),
    db.prepare("SELECT day, sum(sessions) AS sessions FROM DailyActivity WHERE day BETWEEN ? AND ? GROUP BY day").bind(addDays(w.today, -13), w.today).all<{ day: string; sessions: number }>(),
    db.prepare(`SELECT o.id AS orgId, o.name AS name, COALESCE(a.sessions, 0) AS sessions,
      (SELECT count(*) FROM Users u WHERE u.org_id = o.id AND u.kind = 'Student' AND u.active = 1) AS students
      FROM Organizations o LEFT JOIN DailyActivity a ON a.org_id = o.id AND a.day = ?
      WHERE o.id != ? ORDER BY sessions DESC, o.name`).bind(w.today, LIBRARY_ORG).all<{ orgId: string; name: string; sessions: number; students: number }>(),
  ]);
  const byDay = new Map(chartRows.results.map(r => [r.day, r.sessions]));
  const chart = Array.from({ length: 14 }, (_, i) => { const day = addDays(w.today, i - 13); return { day, sessions: byDay.get(day) ?? 0 }; });
  const prev13 = chart.slice(0, 13).reduce((n, d) => n + d.sessions, 0) / 13;
  return json({
    today: w.today, weekStart: w.weekStart,
    totalUsers: total?.n ?? 0, newThisMonth: fresh?.n ?? 0,
    activeThisWeek: week.users, activeLastWeek: prev.users,
    xpThisWeek: week.xp, xpLastWeek: prev.xp,
    sessionsToday: sessionsToday?.n ?? 0, sessionsDailyAverage: Math.round(prev13 * 10) / 10,
    chart, todayByClub: clubRows.results,
  });
}

async function users(ctx: RequestContext) {
  const db = ctx.env.DB;
  const [clubs, rows] = await Promise.all([
    db.prepare("SELECT count(*) AS n FROM Organizations WHERE id != ?").bind(LIBRARY_ORG).first<{ n: number }>(),
    db.prepare(`SELECT u.id, u.display_name AS displayName, u.user_name AS userName, u.email AS email, u.kind, u.role, u.active, u.created_at AS createdAtMs, o.name AS orgName
      FROM Users u JOIN Organizations o ON o.id = u.org_id
      ORDER BY (u.created_at IS NULL), u.created_at DESC, u.display_name LIMIT 10`).all<{ id: string; displayName: string; userName: string; email: string | null; kind: string; role: string; active: number; createdAtMs: number | null; orgName: string }>(),
  ]);
  return json({
    clubs: clubs?.n ?? 0,
    newest: rows.results.map(r => ({ id: r.id, displayName: r.displayName, userName: r.userName, email: r.email, kind: r.kind, role: r.role, orgName: r.orgName, active: r.active === 1, joinedAtUtc: r.createdAtMs ? new Date(r.createdAtMs).toISOString() : null })),
  });
}

async function content(ctx: RequestContext) {
  const db = ctx.env.DB;
  const lib = (sql: string) => db.prepare(sql).bind(LIBRARY_ORG);
  const [run, proposals, releases, articles, packs, verses] = await Promise.all([
    lib("SELECT data FROM Records WHERE kind = 'pbe-watcher-run' AND org_id = ? ORDER BY json_extract(data, '$.checkedAt') DESC LIMIT 1").first<{ data: string }>(),
    lib("SELECT json_extract(data, '$.status') AS status, count(*) AS n, min(json_extract(data, '$.proposedAtUtc')) AS oldest FROM Records WHERE kind = 'pbe-material-proposal' AND org_id = ? GROUP BY status").all<{ status: string; n: number; oldest: string | null }>(),
    lib("SELECT count(*) AS n FROM Records WHERE kind = 'pbe-material' AND org_id = ?").first<{ n: number }>(),
    lib(`SELECT count(*) AS n,
      sum(CASE WHEN json_extract(data, '$.status') = 'draft' AND json_extract(data, '$.createdBy') = 'nad-watcher' THEN 1 ELSE 0 END) AS suggestions,
      sum(CASE WHEN json_extract(data, '$.status') = 'draft' THEN 1 ELSE 0 END) AS drafts,
      sum(CASE WHEN json_extract(data, '$.status') = 'published' THEN 1 ELSE 0 END) AS published,
      min(CASE WHEN json_extract(data, '$.status') = 'draft' AND json_extract(data, '$.createdBy') = 'nad-watcher' THEN json_extract(data, '$.createdAtUtc') END) AS suggestionOldest
      FROM Records WHERE kind = 'pbe-news-article' AND org_id = ?`).first<{ n: number; suggestions: number; drafts: number; published: number; suggestionOldest: string | null }>(),
    lib("SELECT count(*) AS n FROM Records WHERE kind = 'pack' AND org_id = ? AND json_extract(data, '$.isBuiltIn') = 1").first<{ n: number }>(),
    lib("SELECT count(*) AS n FROM Records WHERE kind = 'source' AND org_id = ?").first<{ n: number }>(),
  ]);
  const drafts = proposals.results.find(r => r.status === "draft");
  // The response speaks the client's contract dialect (api/controlCenter.ts
  // ContentData). The stored watcher record keeps its own field names
  // (checkedAt, no notes), so it is mapped explicitly — returning the raw
  // record here is what crashed the Content tab in production on Nov 24.
  let watcher: { checkedAtUtc: string | null; mediaChecked: number; notes: string | null } | null = null;
  if (run) {
    const parsed = JSON.parse(run.data) as { checkedAt?: unknown; mediaChecked?: unknown; notes?: unknown };
    watcher = {
      checkedAtUtc: typeof parsed.checkedAt === "string" ? parsed.checkedAt : null,
      mediaChecked: typeof parsed.mediaChecked === "number" ? parsed.mediaChecked : 0,
      notes: typeof parsed.notes === "string" ? parsed.notes : null,
    };
  }
  return json({
    watcher,
    proposalsPending: drafts?.n ?? 0, proposalsOldestAtUtc: drafts?.oldest ?? null,
    releasesLive: releases?.n ?? 0,
    newsSuggestions: articles?.suggestions ?? 0, newsOldestSuggestionAtUtc: articles?.suggestionOldest ?? null,
    newsDrafts: articles?.drafts ?? 0, newsPublished: articles?.published ?? 0,
    libraryPacks: packs?.n ?? 0, libraryVerses: verses?.n ?? 0,
  });
}

async function seasons(ctx: RequestContext) {
  const db = ctx.env.DB;
  const [rows, disputes] = await Promise.all([
    db.prepare(`SELECT o.name AS organizationName, json_extract(r.data, '$.id') AS id, json_extract(r.data, '$.name') AS name, json_extract(r.data, '$.status') AS status,
      (SELECT count(*) FROM Records m WHERE m.kind = 'membership' AND m.org_id = r.org_id AND m.season_id = r.id) AS students
      FROM Records r JOIN Organizations o ON o.id = r.org_id WHERE r.kind = 'season'
      ORDER BY o.name, name LIMIT 50`).all<{ organizationName: string; id: string; name: string; status: string; students: number }>(),
    db.prepare("SELECT count(*) AS n, min(json_extract(data, '$.acceptedAtUtc')) AS oldest FROM Records WHERE kind = 'pbe-dispute' AND json_extract(data, '$.status') = 'Pending'").first<{ n: number; oldest: string | null }>(),
  ]);
  return json({
    seasons: rows.results.map(r => ({ id: r.id, name: r.name, status: r.status, orgName: r.organizationName, members: r.students })),
    openDisputes: disputes?.n ?? 0, oldestDisputeAtUtc: disputes?.oldest ?? null,
  });
}

async function clubs(ctx: RequestContext) {
  const w = windows(ctx.request);
  const db = ctx.env.DB;
  const quietCutoff = addDays(w.today, -7); // no XP day in the last 7 days, today included
  const rows = await db.prepare(`SELECT o.id AS orgId, o.name AS name,
    (SELECT count(*) FROM Users u WHERE u.org_id = o.id AND u.kind = 'Student' AND u.active = 1) AS learners,
    (SELECT count(DISTINCT u.id) FROM Users u, Records r, json_each(r.data, '$.xpByDay') j
       WHERE u.org_id = o.id AND u.kind = 'Student' AND r.kind = 'training-xp' AND r.org_id = o.id AND r.id = o.id || ':' || u.id
         AND j.key BETWEEN ? AND ? AND CAST(j.value AS INTEGER) > 0) AS activeLearners,
    COALESCE((SELECT sum(a.sessions) FROM DailyActivity a WHERE a.org_id = o.id AND a.day BETWEEN ? AND ?), 0) AS sessionsThisWeek,
    (SELECT count(*) FROM Users u WHERE u.org_id = o.id AND u.kind = 'Student' AND u.active = 1 AND NOT EXISTS
       (SELECT 1 FROM Records r, json_each(r.data, '$.xpByDay') j
         WHERE r.kind = 'training-xp' AND r.org_id = o.id AND r.id = o.id || ':' || u.id AND j.key >= ? AND CAST(j.value AS INTEGER) > 0)) AS quietLearners
    FROM Organizations o WHERE o.id != ? ORDER BY learners DESC, o.name`).bind(w.weekStart, w.weekEnd, w.weekStart, w.weekEnd, quietCutoff, LIBRARY_ORG).all<{ orgId: string; name: string; learners: number; activeLearners: number; sessionsThisWeek: number; quietLearners: number }>();
  return json({ weekStart: w.weekStart, clubs: rows.results });
}

async function funnel(ctx: RequestContext) {
  const w = windows(ctx.request);
  const db = ctx.env.DB;
  const [invitations, accounts, firstPractice, week] = await Promise.all([
    db.prepare("SELECT count(*) AS n FROM CoachInvitations").first<{ n: number }>(),
    db.prepare("SELECT count(*) AS n FROM Users").first<{ n: number }>(),
    db.prepare("SELECT count(DISTINCT owner_id) AS n FROM Records WHERE kind IN ('attempt', 'pbe-attempt') AND owner_id IS NOT NULL").first<{ n: number }>(),
    xpWindow(ctx, w.weekStart, w.weekEnd),
  ]);
  return json({
    steps: [
      { key: "invitations", label: "Invitations sent", count: invitations?.n ?? 0, source: "CoachInvitations table (coach invitations)" },
      { key: "accounts", label: "Accounts created", count: accounts?.n ?? 0, source: "Users table (all roles, all clubs)" },
      { key: "first-practice", label: "Had a first practice", count: firstPractice?.n ?? 0, source: "Distinct owners of Study + PBE attempt records" },
      { key: "active-week", label: "Active this week", count: week.users, source: "XP by day on training-xp records" },
    ],
  });
}

async function system(ctx: RequestContext) {
  const db = ctx.env.DB;
  const now = Date.now();
  const [errors, byArea] = await Promise.all([
    db.prepare("SELECT sum(CASE WHEN occurred_at >= ? THEN 1 ELSE 0 END) AS last24h, count(*) AS last7d FROM ErrorEvents WHERE occurred_at >= ?").bind(now - DAY_MS, now - 7 * DAY_MS).first<{ last24h: number | null; last7d: number }>(),
    db.prepare("SELECT route_area AS area, sum(CASE WHEN occurred_at >= ? THEN 1 ELSE 0 END) AS last24h, count(*) AS last7d FROM ErrorEvents WHERE occurred_at >= ? GROUP BY route_area ORDER BY last7d DESC").bind(now - DAY_MS, now - 7 * DAY_MS).all<{ area: string; last24h: number; last7d: number }>(),
  ]);
  await db.prepare("SELECT 1").first();
  const secret = (value: string | undefined) => value !== undefined && value.length > 0;
  return json({
    version: APP_VERSION, database: "ok",
    cron: { expression: "0 10 * * 1", label: "Mondays 10:00 UTC — NAD watcher, retention, Monday digest" },
    secrets: [
      { name: "RESEND_API_KEY", present: secret(ctx.env.RESEND_API_KEY) },
      { name: "TURNSTILE_SECRET_KEY", present: secret(ctx.env.TURNSTILE_SECRET_KEY) },
      { name: "AUTH_CODE_SECRET", present: secret(ctx.env.AUTH_CODE_SECRET) },
    ],
    supportIngestConfigured: secret(ctx.env.SUPPORT_INGEST_TOKEN),
    supportAddress: SUPPORT_ADDRESS,
    errors: { last24h: errors?.last24h ?? 0, last7d: errors?.last7d ?? 0, byArea: byArea.results },
  });
}

/* ---------------- Support & tickets ---------------- */

export const TICKET_STATUSES = ["New", "Open", "Waiting", "Resolved"] as const;
export type TicketStatus = typeof TICKET_STATUSES[number];
const AGING_MS = 48 * 3_600_000, STALE_MS = 7 * DAY_MS;

interface TicketRow { id: string; number: number; source: string; source_message_id: string | null; requester_name: string; requester_email: string | null; subject: string; body: string; status: string; created_at: number; updated_at: number }
const ticketDto = (r: TicketRow) => ({
  id: r.id, number: r.number, label: `#S-${r.number}`, source: r.source, sourceMessageId: r.source_message_id,
  requesterName: r.requester_name, requesterEmail: r.requester_email, subject: r.subject, body: r.body,
  status: r.status, createdAtUtc: new Date(r.created_at).toISOString(), updatedAtUtc: new Date(r.updated_at).toISOString(),
  // Aging is measured from created_at: how long the request has been waiting
  // in total, not since the last touch. The client colors open tickets from
  // the same field and thresholds (48h amber, 7d red).
  ageHours: Math.max(0, Math.floor((Date.now() - r.created_at) / 3_600_000)),
});
interface InboxRow { id: string; source_message_id: string; requester_name: string; requester_email: string | null; subject: string; snippet: string; body: string; received_at: number; ticket_id: string | null; ticket_number?: number | null }
const inboxDto = (r: InboxRow) => ({
  id: r.id, sourceMessageId: r.source_message_id, requesterName: r.requester_name, requesterEmail: r.requester_email,
  subject: r.subject, snippet: r.snippet, body: r.body, receivedAtUtc: new Date(r.received_at).toISOString(), ticketId: r.ticket_id,
  ticketNumber: r.ticket_number ?? null,
});

export const TICKET_PAGE_SIZE = 30, INBOX_PAGE_SIZE = 20;
const secretPresent = (value: string | undefined) => value !== undefined && value.length > 0;
/** Queue views the support endpoint can serve: every ticket, only the
 *  unresolved ones, or one exact status. Anything else falls back to "all". */
export type TicketFilter = "all" | "open" | TicketStatus;

async function support(ctx: RequestContext) {
  const db = ctx.env.DB, now = Date.now();
  const q = new URL(ctx.request.url).searchParams;
  const statusParam = q.get("ticketStatus");
  const ticketStatus: TicketFilter = statusParam === "open" || (TICKET_STATUSES as readonly string[]).includes(statusParam ?? "") ? statusParam as TicketFilter : "all";
  const offsetParam = (name: string) => { const n = Number.parseInt(q.get(name) ?? "", 10); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
  const ticketOffset = offsetParam("ticketOffset"), inboxOffset = offsetParam("inboxOffset");
  const filter = ticketStatus === "open" ? { where: "status != 'Resolved'", binds: [] as string[] }
    : ticketStatus === "all" ? { where: "1 = 1", binds: [] as string[] }
    : { where: "status = ?", binds: [ticketStatus] };
  const [counts, inbox, inboxTotal, tickets, ticketsTotal] = await Promise.all([
    db.prepare(`SELECT
      (SELECT count(*) FROM SupportInbox WHERE ticket_id IS NULL) AS newEmails,
      (SELECT count(*) FROM SupportTickets WHERE status != 'Resolved') AS openTickets,
      (SELECT count(*) FROM SupportTickets WHERE status != 'Resolved' AND created_at < ?) AS aging,
      (SELECT count(*) FROM SupportTickets WHERE status != 'Resolved' AND created_at < ?) AS stale`)
      .bind(now - AGING_MS, now - STALE_MS).first<{ newEmails: number; openTickets: number; aging: number; stale: number }>(),
    db.prepare("SELECT i.*, t.number AS ticket_number FROM SupportInbox i LEFT JOIN SupportTickets t ON t.id = i.ticket_id ORDER BY i.received_at DESC LIMIT ? OFFSET ?").bind(INBOX_PAGE_SIZE, inboxOffset).all<InboxRow>(),
    db.prepare("SELECT count(*) AS total FROM SupportInbox").first<{ total: number }>(),
    db.prepare(`SELECT * FROM SupportTickets WHERE ${filter.where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...filter.binds, TICKET_PAGE_SIZE, ticketOffset).all<TicketRow>(),
    db.prepare(`SELECT count(*) AS total FROM SupportTickets WHERE ${filter.where}`).bind(...filter.binds).first<{ total: number }>(),
  ]);
  return json({
    supportAddress: SUPPORT_ADDRESS,
    supportIngestConfigured: secretPresent(ctx.env.SUPPORT_INGEST_TOKEN),
    counts: { newEmails: counts?.newEmails ?? 0, openTickets: counts?.openTickets ?? 0, aging48h: counts?.aging ?? 0, stale7d: counts?.stale ?? 0 },
    inbox: inbox.results.map(inboxDto), tickets: tickets.results.map(ticketDto),
    ticketStatus, ticketsTotal: ticketsTotal?.total ?? 0, inboxTotal: inboxTotal?.total ?? 0,
  });
}

/** Single-statement ticket insert: the number is max+1 inside the same
 *  statement, so concurrent creates cannot collide on the UNIQUE number. */
function ticketInsertion(ctx: RequestContext, t: { source: string; sourceMessageId: string | null; requesterName: string; requesterEmail: string | null; subject: string; body: string }) {
  const now = Date.now();
  return ctx.env.DB.prepare(
    `INSERT INTO SupportTickets(id, number, source, source_message_id, requester_name, requester_email, subject, body, status, created_at, updated_at)
     SELECT ?, COALESCE((SELECT max(number) FROM SupportTickets), 100) + 1, ?, ?, ?, ?, ?, ?, 'New', ?, ?`,
  ).bind(crypto.randomUUID(), t.source, t.sourceMessageId, t.requesterName, t.requesterEmail, t.subject, t.body, now, now);
}

async function createTicket(ctx: RequestContext) {
  const input = await body<{ inboxId?: unknown; requesterName?: unknown; requesterEmail?: unknown; subject?: unknown; body?: unknown }>(ctx.request);
  const db = ctx.env.DB;
  if (typeof input.inboxId === "string" && input.inboxId) {
    const row = await db.prepare("SELECT * FROM SupportInbox WHERE id = ?").bind(input.inboxId).first<InboxRow>();
    if (!row) throw new HttpError(404, "That inbox message was not found.");
    if (row.ticket_id) {
      const existing = await db.prepare("SELECT * FROM SupportTickets WHERE id = ?").bind(row.ticket_id).first<TicketRow>();
      if (existing) return json({ ticket: ticketDto(existing), alreadyProcessed: true });
    }
    const insert = ticketInsertion(ctx, { source: "email", sourceMessageId: row.source_message_id, requesterName: row.requester_name, requesterEmail: row.requester_email, subject: row.subject, body: row.body });
    // The ticket number is assigned inside the insert; read the row back by
    // its unique source message id to link the inbox entry.
    await insert.run();
    const created = await db.prepare("SELECT * FROM SupportTickets WHERE source_message_id = ?").bind(row.source_message_id).first<TicketRow>();
    if (!created) throw new HttpError(503, "The ticket could not be created. Please retry.");
    await db.prepare("UPDATE SupportInbox SET ticket_id = ? WHERE id = ?").bind(created.id, row.id).run();
    return json({ ticket: ticketDto(created), alreadyProcessed: false }, 201);
  }
  const requesterName = requiredString(input.requesterName, "Requester name", 120);
  const subject = requiredString(input.subject, "Subject", 200);
  const requesterEmail = typeof input.requesterEmail === "string" && input.requesterEmail.trim() ? input.requesterEmail.trim().slice(0, 200) : null;
  const text = typeof input.body === "string" ? input.body.slice(0, 8000) : "";
  const insert = ticketInsertion(ctx, { source: "manual", sourceMessageId: null, requesterName, requesterEmail, subject, body: text });
  const result = await insert.run();
  const created = await db.prepare("SELECT * FROM SupportTickets WHERE rowid = ?").bind(result.meta.last_row_id).first<TicketRow>();
  if (!created) throw new HttpError(503, "The ticket could not be created. Please retry.");
  return json({ ticket: ticketDto(created), alreadyProcessed: false }, 201);
}

async function setTicketStatus(ctx: RequestContext, ticketId: string) {
  const input = await body<{ status?: unknown }>(ctx.request);
  if (typeof input.status !== "string" || !(TICKET_STATUSES as readonly string[]).includes(input.status)) throw new HttpError(400, "Choose a valid ticket status.");
  const db = ctx.env.DB;
  const result = await db.prepare("UPDATE SupportTickets SET status = ?, updated_at = ? WHERE id = ?").bind(input.status, Date.now(), ticketId).run();
  if (result.meta.changes !== 1) throw new HttpError(404, "That ticket was not found.");
  const row = await db.prepare("SELECT * FROM SupportTickets WHERE id = ?").bind(ticketId).first<TicketRow>();
  return json({ ticket: ticketDto(row!) });
}

/** Ingest for real support email. Guarded by the dedicated SUPPORT_INGEST_TOKEN
 *  secret (Authorization: Bearer …) — deliberately NOT a user session, since
 *  the caller is Yanco's mail triage, not a signed-in account. When the secret
 *  is unset the endpoint does not exist (404). Idempotent on messageId: a
 *  re-delivered email returns the stored entry instead of duplicating it. */
export async function handleSupportIngest(request: Request, env: RequestContext["env"]): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== "/api/v1/support/ingest" || request.method !== "POST") return null;
  if (!env.SUPPORT_INGEST_TOKEN) throw new HttpError(404, "Route not found.");
  const auth = request.headers.get("Authorization") ?? "";
  // Compare SHA-256 digests, not the raw strings: a plain string compare
  // short-circuits on the first differing character, leaking how much of a
  // guessed bearer token is right. Digests are fixed-length, so the XOR
  // loop does the same work for every candidate.
  const encoder = new TextEncoder();
  const [givenDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(auth)),
    crypto.subtle.digest("SHA-256", encoder.encode(`Bearer ${env.SUPPORT_INGEST_TOKEN}`)),
  ]);
  const given = new Uint8Array(givenDigest), expected = new Uint8Array(expectedDigest);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= (given[i] ?? 0) ^ (expected[i] ?? 0);
  if (diff !== 0) throw new HttpError(403, "Support ingest token denied.");
  const input = await body<{ messageId?: unknown; fromName?: unknown; fromEmail?: unknown; subject?: unknown; snippet?: unknown; body?: unknown; receivedAt?: unknown }>(request);
  const messageId = requiredString(input.messageId, "Message id", 300);
  const fromName = requiredString(input.fromName, "Sender name", 120);
  const subject = requiredString(input.subject, "Subject", 300);
  const fromEmail = typeof input.fromEmail === "string" && input.fromEmail.trim() ? input.fromEmail.trim().slice(0, 200) : null;
  const snippet = typeof input.snippet === "string" ? input.snippet.slice(0, 300) : "";
  const text = typeof input.body === "string" ? input.body.slice(0, 8000) : "";
  const receivedAt = typeof input.receivedAt === "number" && Number.isFinite(input.receivedAt) ? input.receivedAt : Date.now();
  const insert = await env.DB.prepare("INSERT OR IGNORE INTO SupportInbox(id, source_message_id, requester_name, requester_email, subject, snippet, body, received_at) VALUES(?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), messageId, fromName, fromEmail, subject, snippet, text, receivedAt).run();
  const row = await env.DB.prepare("SELECT * FROM SupportInbox WHERE source_message_id = ?").bind(messageId).first<InboxRow>();
  if (!row) throw new HttpError(503, "The message could not be stored. Please retry.");
  return json({ entry: inboxDto(row), alreadyProcessed: insert.meta.changes === 0 }, insert.meta.changes === 0 ? 200 : 201);
}

/* ---------------- Monday digest ---------------- */

export interface WeeklyDigest {
  weekStart: string; weekEnd: string; generatedAtUtc: string;
  newUsers: number; activeClubs: number; activeUsers: number; sessions: number; xpAwarded: number;
  newTickets: number; openTickets: number; errors7d: number;
}

export async function composeWeeklyDigest(env: RequestContext["env"], weekStart: string): Promise<WeeklyDigest> {
  const db = env.DB, weekEnd = addDays(weekStart, 6);
  const startMs = dayMs(weekStart), endMs = dayMs(weekEnd) + DAY_MS;
  const [fresh, clubsRow, sessionsRow, xp, tickets, errors] = await Promise.all([
    db.prepare("SELECT count(*) AS n FROM Users WHERE created_at >= ? AND created_at < ?").bind(startMs, endMs).first<{ n: number }>(),
    db.prepare("SELECT count(DISTINCT org_id) AS n FROM DailyActivity WHERE day BETWEEN ? AND ? AND sessions > 0").bind(weekStart, weekEnd).first<{ n: number }>(),
    db.prepare("SELECT COALESCE(sum(sessions), 0) AS n FROM DailyActivity WHERE day BETWEEN ? AND ?").bind(weekStart, weekEnd).first<{ n: number }>(),
    db.prepare(`SELECT COALESCE(sum(CAST(j.value AS INTEGER)), 0) AS xp, count(DISTINCT r.id) AS users FROM Records r, json_each(r.data, '$.xpByDay') j WHERE r.kind = 'training-xp' AND j.key BETWEEN ? AND ? AND CAST(j.value AS INTEGER) > 0`).bind(weekStart, weekEnd).first<{ xp: number; users: number }>(),
    db.prepare("SELECT sum(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) AS fresh, sum(CASE WHEN status != 'Resolved' THEN 1 ELSE 0 END) AS open FROM SupportTickets").bind(startMs, endMs).first<{ fresh: number | null; open: number | null }>(),
    db.prepare("SELECT count(*) AS n FROM ErrorEvents WHERE occurred_at >= ?").bind(Date.now() - 7 * DAY_MS).first<{ n: number }>(),
  ]);
  return {
    weekStart, weekEnd, generatedAtUtc: new Date().toISOString(),
    newUsers: fresh?.n ?? 0, activeClubs: clubsRow?.n ?? 0, activeUsers: xp?.users ?? 0,
    sessions: sessionsRow?.n ?? 0, xpAwarded: xp?.xp ?? 0,
    newTickets: tickets?.fresh ?? 0, openTickets: tickets?.open ?? 0, errors7d: errors?.n ?? 0,
  };
}

export function digestText(d: WeeklyDigest): string {
  return [
    `Erudoza weekly digest — week of ${d.weekStart} to ${d.weekEnd}`,
    ``,
    `New users: ${d.newUsers}`,
    `Active clubs: ${d.activeClubs} · Active users: ${d.activeUsers}`,
    `Practice sessions: ${d.sessions} · XP awarded: ${d.xpAwarded}`,
    `Support: ${d.newTickets} new tickets this week, ${d.openTickets} still open`,
    `Server errors (last 7 days): ${d.errors7d}`,
    ``,
    `Full detail: the Admin Control Center.`,
  ].join("\n");
}

/** Cron step (Mondays 10:00 UTC): compose the week that just ended, store it
 *  for the control center, and email it to the master admin through the
 *  existing Resend path when that path is configured. Idempotent per week —
 *  the stored record's id is the week start, and the email only sends when
 *  this run actually stored a new record. */
export async function runMasterDigest(env: RequestContext["env"]): Promise<WeeklyDigest> {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const dow = (new Date(`${todayUtc}T00:00:00Z`).getUTCDay() + 6) % 7;
  const weekStart = addDays(todayUtc, -dow - 7);
  const digest = await composeWeeklyDigest(env, weekStart);
  const stored = await env.DB.prepare("INSERT OR IGNORE INTO Records(kind, id, org_id, data, revision) VALUES('master-digest', ?, ?, ?, 1)")
    .bind(weekStart, LIBRARY_ORG, JSON.stringify(digest)).run();
  if (stored.meta.changes === 1 && configured(env)) {
    await sendEmail(env, MASTER_ADMIN_EMAIL, `Erudoza weekly digest — week of ${weekStart}`, digestText(digest), `master-digest/${weekStart}`);
  }
  return digest;
}

async function digest(ctx: RequestContext) {
  const row = await ctx.env.DB.prepare("SELECT data FROM Records WHERE kind = 'master-digest' AND org_id = ? ORDER BY id DESC LIMIT 1").bind(LIBRARY_ORG).first<{ data: string }>();
  if (!row) return json({ digest: null });
  const d = JSON.parse(row.data) as WeeklyDigest;
  // The stored record calls the timestamp generatedAtUtc; the client
  // contract (DigestData) calls it composedAtUtc.
  return json({ digest: { weekStart: d.weekStart, weekEnd: d.weekEnd, newUsers: d.newUsers, activeClubs: d.activeClubs, activeUsers: d.activeUsers, sessions: d.sessions, xpAwarded: d.xpAwarded, openTickets: d.openTickets, errors7d: d.errors7d, composedAtUtc: d.generatedAtUtc } });
}

/* ---------------- Routing ---------------- */

const BASE = "/api/v1/admin/control-center";

export async function handleControlCenter(ctx: RequestContext): Promise<Response | null> {
  const path = ctx.path, method = ctx.request.method;
  if (path !== BASE && !path.startsWith(BASE + "/")) return null;
  masterAdmin(ctx.actor);
  if (method === "GET" && path === `${BASE}/overview`) return overview(ctx);
  if (method === "GET" && path === `${BASE}/users`) return users(ctx);
  if (method === "GET" && path === `${BASE}/content`) return content(ctx);
  if (method === "GET" && path === `${BASE}/seasons`) return seasons(ctx);
  if (method === "GET" && path === `${BASE}/clubs`) return clubs(ctx);
  if (method === "GET" && path === `${BASE}/funnel`) return funnel(ctx);
  if (method === "GET" && path === `${BASE}/system`) return system(ctx);
  if (method === "GET" && path === `${BASE}/digest`) return digest(ctx);
  if (method === "GET" && path === `${BASE}/support`) return support(ctx);
  if (method === "POST" && path === `${BASE}/support/tickets`) return createTicket(ctx);
  const statusMatch = path.match(new RegExp(`^${BASE.replaceAll("/", "\\/")}\\/support\\/tickets\\/([^/]+)\\/status$`));
  if (method === "POST" && statusMatch) return setTicketStatus(ctx, decodeURIComponent(statusMatch[1]));
  throw new HttpError(404, "Route not found.");
}
