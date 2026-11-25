import { request } from "./client";

/** The one account the Control Center opens for. The server enforces this;
 *  the client mirror only shapes the UI (navigation + route gate). */
export const MASTER_ADMIN_EMAIL = "viticopq12@gmail.com";
export const SUPPORT_ADDRESS = "ktr0nn@muse.ai";

export function isMasterAdminEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.trim().toLowerCase() === MASTER_ADMIN_EMAIL;
}

/** Viewer-local windows the server uses for week/today aggregates. */
export function viewerWindows(now = new Date()): { today: string; weekStart: string } {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return { today: iso(now), weekStart: iso(monday) };
}

export interface OverviewData {
  totalUsers: number;
  newThisMonth: number;
  xpThisWeek: number;
  xpLastWeek: number;
  activeThisWeek: number;
  activeLastWeek: number;
  sessionsToday: number;
  sessionsDailyAverage: number;
  chart: Array<{ day: string; sessions: number }>;
  todayByClub: Array<{ orgId: string; name: string; sessions: number; students: number }>;
}
export interface UsersData {
  clubs: number;
  newest: Array<{ id: string; displayName: string; userName: string; email: string | null; kind: string; role: string; orgName: string; active: boolean; joinedAtUtc: string | null }>;
}
export interface ClubsData {
  clubs: Array<{ orgId: string; name: string; learners: number; activeLearners: number; sessionsThisWeek: number; quietLearners: number }>;
}
export interface FunnelData {
  steps: Array<{ key: string; label: string; count: number; source: string }>;
}
export interface ContentData {
  watcher: { checkedAtUtc: string | null; mediaChecked: number; notes: string | null } | null;
  proposalsPending: number;
  proposalsOldestAtUtc: string | null;
  releasesLive: number;
  newsSuggestions: number;
  newsDrafts: number;
  newsPublished: number;
  newsOldestSuggestionAtUtc: string | null;
  libraryPacks: number;
  libraryVerses: number;
}
export interface SeasonsData {
  openDisputes: number;
  oldestDisputeAtUtc: string | null;
  seasons: Array<{ id: string; name: string; status: string; orgName: string; members: number }>;
}
export interface SystemData {
  version: string;
  database: string;
  cron: { expression: string; label: string };
  secrets: Array<{ name: string; present: boolean }>;
  supportIngestConfigured: boolean;
  supportAddress: string;
  errors: { last24h: number; last7d: number; byArea: Array<{ area: string; last24h: number; last7d: number }> };
}
export interface DigestData {
  digest: { weekStart: string; weekEnd: string; newUsers: number; activeClubs: number; activeUsers: number; sessions: number; xpAwarded: number; openTickets: number; errors7d: number; composedAtUtc: string } | null;
}
export type TicketStatus = "New" | "Open" | "Waiting" | "Resolved";
export interface SupportTicket {
  id: string;
  number: number;
  source: "email" | "manual";
  requesterName: string;
  requesterEmail: string | null;
  subject: string;
  body: string | null;
  status: TicketStatus;
  createdAtUtc: string;
  updatedAtUtc: string;
  ageHours: number;
}
export interface SupportInboxEntry {
  id: string;
  requesterName: string;
  requesterEmail: string | null;
  subject: string;
  snippet: string | null;
  body: string | null;
  receivedAtUtc: string;
  ticketId: string | null;
  ticketNumber: number | null;
}
export type TicketFilter = "all" | "open" | TicketStatus;
export interface SupportData {
  supportAddress: string;
  supportIngestConfigured: boolean;
  counts: { newEmails: number; openTickets: number; aging48h: number; stale7d: number };
  inbox: SupportInboxEntry[];
  tickets: SupportTicket[];
  ticketStatus: TicketFilter;
  ticketsTotal: number;
  inboxTotal: number;
}

const BASE = "/api/v1/admin/control-center";
const windows = () => {
  const { today, weekStart } = viewerWindows();
  return `today=${today}&weekStart=${weekStart}`;
};

export const controlCenterApi = {
  overview: () => request<OverviewData>(`${BASE}/overview?${windows()}`),
  users: () => request<UsersData>(`${BASE}/users`),
  clubs: () => request<ClubsData>(`${BASE}/clubs?${windows()}`),
  funnel: () => request<FunnelData>(`${BASE}/funnel?${windows()}`),
  content: () => request<ContentData>(`${BASE}/content`),
  seasons: () => request<SeasonsData>(`${BASE}/seasons`),
  system: () => request<SystemData>(`${BASE}/system`),
  digest: () => request<DigestData>(`${BASE}/digest`),
  support: (view: { ticketStatus?: TicketFilter; ticketOffset?: number; inboxOffset?: number } = {}) => {
    const params = new URLSearchParams();
    if (view.ticketStatus && view.ticketStatus !== "all") params.set("ticketStatus", view.ticketStatus);
    if (view.ticketOffset) params.set("ticketOffset", String(view.ticketOffset));
    if (view.inboxOffset) params.set("inboxOffset", String(view.inboxOffset));
    const qs = params.toString();
    return request<SupportData>(`${BASE}/support${qs ? `?${qs}` : ""}`);
  },
  createTicketFromInbox: (inboxId: string) => request<{ ticket: SupportTicket; alreadyProcessed: boolean }>(`${BASE}/support/tickets`, { method: "POST", body: JSON.stringify({ inboxId }) }),
  createTicketManual: (input: { requesterName: string; requesterEmail?: string; subject: string; body?: string }) => request<{ ticket: SupportTicket; alreadyProcessed: boolean }>(`${BASE}/support/tickets`, { method: "POST", body: JSON.stringify(input) }),
  setTicketStatus: (id: string, status: TicketStatus) => request<{ ticket: SupportTicket }>(`${BASE}/support/tickets/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
};
