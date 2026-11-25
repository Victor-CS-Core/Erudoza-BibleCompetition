import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { request } from "../../api/client";
import { ToastProvider } from "../../components/ui";
import ControlCenterPage from "./ControlCenterPage";

vi.mock("../../api/client", async importOriginal => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return { ...actual, request: vi.fn() };
});

const chart = Array.from({ length: 14 }, (_, i) => ({ day: `2026-11-${String(11 + i).padStart(2, "0")}`, sessions: i === 13 ? 5 : i === 12 ? 4 : 1 }));
const overview = { totalUsers: 7, newThisMonth: 1, xpThisWeek: 100, xpLastWeek: 85, activeThisWeek: 2, activeLastWeek: 2, sessionsToday: 5, sessionsDailyAverage: 1.5, chart, todayByClub: [{ orgId: "o1", name: "Practice Club", sessions: 3, students: 2 }, { orgId: "o2", name: "Northgate Club", sessions: 2, students: 1 }] };
const users = { clubs: 2, newest: [{ id: "u1", displayName: "Ana Ruiz", userName: "ana", email: "ana@example.com", kind: "Student", role: "Student", orgName: "Practice Club", active: true, joinedAtUtc: "2026-11-05T00:00:00Z" }, { id: "u2", displayName: "Coach Pat", userName: "pat", email: null, kind: "Adult", role: "Owner", orgName: "Northgate Club", active: true, joinedAtUtc: null }] };
const clubs = { clubs: [{ orgId: "o1", name: "Practice Club", learners: 2, activeLearners: 1, sessionsThisWeek: 7, quietLearners: 1 }, { orgId: "o2", name: "Northgate Club", learners: 1, activeLearners: 1, sessionsThisWeek: 2, quietLearners: 0 }] };
const funnel = { steps: [{ key: "invitations", label: "Invitations sent", count: 3, source: "Coach invitations" }, { key: "accounts", label: "Accounts created", count: 7, source: "User accounts" }, { key: "first-practice", label: "First practice attempt", count: 2, source: "Recorded attempts (Memory + PBE)" }, { key: "active-week", label: "Active this week", count: 2, source: "XP activity this week" }] };
const content = { watcher: { checkedAtUtc: "2026-11-23T10:00:00Z", mediaChecked: 12, notes: null }, proposalsPending: 2, proposalsOldestAtUtc: "2026-11-20T00:00:00Z", releasesLive: 1, newsSuggestions: 1, newsDrafts: 0, newsPublished: 1, newsOldestSuggestionAtUtc: "2026-11-21T00:00:00Z", libraryPacks: 1, libraryVerses: 3 };
const seasons = { openDisputes: 1, oldestDisputeAtUtc: "2026-11-22T09:00:00Z", seasons: [{ id: "s1", name: "2026-27 PBE Season", status: "Active", orgName: "Practice Club", members: 2 }] };
const system = { version: "2026.11.1", database: "ok", cron: { expression: "0 10 * * 1", label: "Mondays 10:00 UTC — NAD watcher, retention, Monday digest" }, secrets: [{ name: "RESEND_API_KEY", present: true }, { name: "TURNSTILE_SECRET_KEY", present: false }], supportIngestConfigured: false, supportAddress: "ktr0nn@muse.ai", errors: { last24h: 1, last7d: 3, byArea: [{ area: "Accounts", last24h: 1, last7d: 2 }] } };
const digest = { digest: { weekStart: "2026-11-16", weekEnd: "2026-11-22", newUsers: 0, activeClubs: 0, activeUsers: 2, sessions: 0, xpAwarded: 15, openTickets: 0, errors7d: 3, composedAtUtc: "2026-11-23T10:00:00Z" } };
const ticket = (over: Record<string, unknown> = {}) => ({ id: "t1", number: 101, source: "email", requesterName: "Ana Ruiz", requesterEmail: "ana@example.com", subject: "Cannot sign in", body: "The code never arrives.", status: "New", createdAtUtc: "2026-11-24T08:00:00Z", updatedAtUtc: "2026-11-24T08:00:00Z", ageHours: 1, ...over });
const support = {
  supportAddress: "ktr0nn@muse.ai",
  supportIngestConfigured: true,
  ticketStatus: "all",
  ticketsTotal: 3,
  inboxTotal: 1,
  counts: { newEmails: 1, openTickets: 3, aging48h: 2, stale7d: 1 },
  inbox: [{ id: "in1", requesterName: "Ana Ruiz", requesterEmail: "ana@example.com", subject: "Cannot sign in", body: "The code never arrives.", snippet: "The code never arrives.", receivedAtUtc: "2026-11-24T08:00:00Z", ticketId: null, ticketNumber: null }],
  tickets: [ticket(), ticket({ id: "t2", number: 102, subject: "Question about seasons", status: "Open", ageHours: 60 }), ticket({ id: "t3", number: 103, subject: "Old request", status: "Waiting", ageHours: 200 })],
};

// Production-shaped payloads (Nov 24, sanitized): the values the live
// endpoint serves for the real young workspace — a manual watcher run that
// morning, 17 watcher drafts waiting since September, one live release, no
// news suggestions, 66 packs / 31,102 verses, three seasons, no disputes.
const prodContent = { watcher: { checkedAtUtc: "2026-11-24T00:17:48.370Z", mediaChecked: 18, notes: null }, proposalsPending: 17, proposalsOldestAtUtc: "2026-09-20T10:02:11.742Z", releasesLive: 1, newsSuggestions: 0, newsDrafts: 0, newsPublished: 3, newsOldestSuggestionAtUtc: null, libraryPacks: 66, libraryVerses: 31102 };
const prodSeasons = { openDisputes: 0, oldestDisputeAtUtc: null, seasons: [{ id: "s1", name: "Test01", status: "ContentReady", orgName: "Practice Club", members: 1 }, { id: "s2", name: "26-27", status: "Active", orgName: "Northgate Club", members: 1 }, { id: "s3", name: "Summer 2027", status: "Active", orgName: "Riverside Pathfinders", members: 3 }] };
// The pre-fix server dialect, byte-for-byte the shape production served
// while the Content tab crashed (the worker's own field names, which the
// client never rendered). The tab must degrade, never crash, on it.
const legacyContent = { watcher: { id: "ac0e10e3-7d51-421e-af6d-122068376d25", checkedAt: "2026-11-24T00:17:48.370Z", trigger: "manual", mediaChecked: 18, drafted: 0, newsDrafted: 3 }, materialDrafts: 17, materialDraftOldestAt: "2026-09-20T10:02:11.742Z", liveReleases: 1, newsSuggestions: 0, newsSuggestionOldestAt: null, newsDrafts: 0, newsPublished: 3, libraryPacks: 66, libraryVerses: 31102 };
const legacySeasons = { seasons: [{ organizationName: "Practice Club", id: "s1", name: "Test01", status: "ContentReady", students: 1 }, { organizationName: "Riverside Pathfinders", id: "s3", name: "Summer 2027", status: "Active", students: 3 }], openDisputes: 0, oldestDisputeAt: null };

const getFixtures: Record<string, unknown> = { overview, users, clubs, funnel, content, seasons, system, digest, support };
let failOverview = false;
let failStatusOnce = false;
let duplicateConvert = false;

function mockRequest() {
  vi.mocked(request).mockImplementation(async (path: string, init?: RequestInit) => {
    const url = String(path);
    if (init?.method === "POST" && url.endsWith("/support/tickets")) {
      const body = JSON.parse(String(init.body)) as { inboxId?: string };
      if (duplicateConvert) return { ticket: ticket({ id: "t9", number: 104 }), alreadyProcessed: true, fromInbox: body.inboxId } as never;
      return { ticket: ticket(), alreadyProcessed: false, fromInbox: body.inboxId } as never;
    }
    if (init?.method === "POST" && url.includes("/support/tickets/") && url.endsWith("/status")) {
      if (failStatusOnce) { failStatusOnce = false; throw new Error("offline"); }
      const body = JSON.parse(String(init.body)) as { status: string };
      return { ticket: ticket({ status: body.status }) } as never;
    }
    const key = Object.keys(getFixtures).find(k => url.includes(`/control-center/${k}`));
    if (key === "overview" && failOverview) throw new Error("offline");
    if (key) return getFixtures[key] as never;
    throw new Error(`unexpected request ${url}`);
  });
}

function page(initialEntry = "/admin/control-center") {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter initialEntries={[initialEntry]}><ControlCenterPage /></MemoryRouter></ToastProvider></QueryClientProvider>);
}

function sidebar() {
  return within(screen.getByRole("complementary", { name: "Erudoza Control Center" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  failOverview = false; failStatusOnce = false; duplicateConvert = false;
  getFixtures.content = content; getFixtures.seasons = seasons;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  mockRequest();
});

it("defaults to Overview with the shell nav, KPIs, chart, clubs, digest, and attention", async () => {
  const { container } = page();
  expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
  expect(sidebar().getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  expect(await screen.findByText("Total users")).toBeInTheDocument();
  expect(screen.getByText("Practice activity")).toBeInTheDocument();
  expect(container.querySelectorAll(".cc-day")).toHaveLength(14);
  expect(screen.getByText("Today by club")).toBeInTheDocument();
  expect(screen.getByText("Practice Club")).toBeInTheDocument();
  expect(await screen.findByText("Weekly digest")).toBeInTheDocument();
  expect(screen.getByText(/Nov 16–22, 2026/)).toBeInTheDocument();
  expect(await screen.findByText("Needs attention")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Tickets open 7\+ days/ })).toHaveAttribute("href", "/admin/control-center?tab=support&ticketStatus=open&focus=ticket-103");
  expect(screen.getByRole("link", { name: /Tickets open 48h\+/ })).toHaveAttribute("href", "/admin/control-center?tab=support&ticketStatus=open&focus=ticket-102");
  expect(screen.getByRole("link", { name: /Material drafts awaiting review/ })).toHaveAttribute("href", "/admin/control-center?tab=content&focus=materials");
  expect(screen.getByRole("link", { name: /Open answer disputes/ })).toHaveAttribute("href", "/admin/control-center?tab=content&focus=seasons");
  expect(screen.getByRole("link", { name: /Server errors in the last 24 hours/ })).toHaveAttribute("href", "/admin/control-center?tab=system");
  expect(screen.getByText("Service operational")).toBeInTheDocument();
  await waitFor(() => expect(sidebar().getByRole("link", { name: "Support & tickets" })).toHaveTextContent("3"));
});

it("slices the chart between 14D and 7D without touching the KPIs or digest", async () => {
  const { container } = page();
  await screen.findByText("Total users");
  expect(container.querySelectorAll(".cc-day")).toHaveLength(14);
  fireEvent.click(screen.getByRole("button", { name: "7D" }));
  expect(container.querySelectorAll(".cc-day")).toHaveLength(7);
  expect(screen.getByText("Total users")).toBeInTheDocument();
  expect(screen.getByText("Weekly digest")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "14D" }));
  expect(container.querySelectorAll(".cc-day")).toHaveLength(14);
});

it("switches tabs from the sidebar and shows the Users & clubs panels", async () => {
  page();
  await screen.findByRole("heading", { name: "Overview" });
  fireEvent.click(sidebar().getByRole("link", { name: "Users & clubs" }));
  expect(await screen.findByRole("heading", { name: "Users & clubs" })).toBeInTheDocument();
  expect(sidebar().getByRole("link", { name: "Users & clubs" })).toHaveAttribute("aria-current", "page");
  expect(await screen.findByText("Club health")).toBeInTheDocument();
  const table = await screen.findByRole("table");
  expect(within(table).getByText("Practice Club")).toBeInTheDocument();
  expect(within(table).getByText("1 quiet")).toBeInTheDocument();
  expect(await screen.findByText("Onboarding funnel")).toBeInTheDocument();
  expect(screen.getByText("Invitations sent")).toBeInTheDocument();
  expect(screen.getByText("Coach invitations")).toBeInTheDocument();
  expect(screen.queryByText("Source: Coach invitations")).not.toBeInTheDocument();
  expect(screen.getByText("Ana Ruiz")).toBeInTheDocument();
  expect(screen.getByText(/Joined Nov 5, 2026/)).toBeInTheDocument();
  expect(screen.getByText(/Join date unavailable/)).toBeInTheDocument();
});

it("honors a deep-linked tab and renders Content panels", async () => {
  page("/admin/control-center?tab=content");
  expect(await screen.findByRole("heading", { name: "Content" })).toBeInTheDocument();
  expect(sidebar().getByRole("link", { name: "Content" })).toHaveAttribute("aria-current", "page");
  expect(await screen.findByText("NAD watcher")).toBeInTheDocument();
  expect(screen.getByText("Last run")).toBeInTheDocument();
  expect(screen.getByText(/Nov 23/)).toBeInTheDocument();
  expect(screen.getByText("12 items checked")).toBeInTheDocument();
  expect(await screen.findByText("Seasons & teams")).toBeInTheDocument();
  expect(screen.getByText("Answer disputes")).toBeInTheDocument();
});

it("renders the Content tab with the production-shaped payload", async () => {
  getFixtures.content = prodContent; getFixtures.seasons = prodSeasons;
  const { container } = page("/admin/control-center?tab=content");
  expect(await screen.findByText("Materials & news")).toBeInTheDocument();
  // Badge/value text is split across inline elements; match on full text.
  await waitFor(() => expect(container.textContent).toContain("17 awaiting review"));
  expect(container.textContent).toContain("Oldest submitted Sep 20, 2026");
  expect(container.textContent).toContain("1 material");
  expect(container.textContent).toContain("3 published");
  expect(container.textContent).toContain("66 packs · 31,102 verses");
  expect(await screen.findByText("NAD watcher")).toBeInTheDocument();
  expect(container.textContent).toContain("18 items checked");
  expect(await screen.findByText("Seasons & teams")).toBeInTheDocument();
  expect(screen.getByText("Summer 2027")).toBeInTheDocument();
  expect(container.textContent).toContain("Riverside Pathfinders · 3 members");
  expect(screen.getByText("None open")).toBeInTheDocument();
});

it("never crashes the Content tab on the pre-fix server dialect (regression: Nov 24 production crash)", async () => {
  getFixtures.content = legacyContent; getFixtures.seasons = legacySeasons;
  const { container } = page("/admin/control-center?tab=content");
  // Before the fix, num(data.releasesLive) read .toLocaleString of undefined
  // and the whole tab fell to the app error boundary.
  expect(await screen.findByText("Materials & news")).toBeInTheDocument();
  expect(await screen.findByText("NAD watcher")).toBeInTheDocument();
  expect(await screen.findByText("Seasons & teams")).toBeInTheDocument();
  await waitFor(() => expect(container.textContent).toContain("Summer 2027"));
  expect(container.textContent).toContain("0 materials"); // degraded, not crashed
  expect(screen.queryByText(/interrupted/i)).not.toBeInTheDocument();
});

it("renders System with version, secret presence only, error counts, and shortcuts", async () => {
  page("/admin/control-center?tab=system");
  expect(await screen.findByRole("heading", { name: "System" })).toBeInTheDocument();
  expect((await screen.findAllByText("2026.11.1")).length).toBeGreaterThan(0);
  expect(screen.getByText("RESEND_API_KEY")).toBeInTheDocument();
  expect(screen.getByText("Present")).toBeInTheDocument();
  expect(screen.getByText("Missing")).toBeInTheDocument();
  expect(screen.getByText("Accounts")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Materials & news" })).toHaveAttribute("href", "/admin/materials");
  expect(screen.getByRole("link", { name: "Answer reviews" })).toHaveAttribute("href", "/admin/practice/reviews");
});

it("shows support metrics with exclusive aging buckets and aging flags on tickets", async () => {
  const { container } = page("/admin/control-center?tab=support");
  expect(await screen.findByText("New emails")).toBeInTheDocument();
  const metrics = within(container.querySelector(".cc-metrics") as HTMLElement);
  const agingCard = metrics.getByText("Open 48h+").closest(".cc-metric");
  expect(agingCard).not.toBeNull();
  expect(within(agingCard as HTMLElement).getByText("1")).toBeInTheDocument();
  expect(within(agingCard as HTMLElement).getByText("Under 7 days")).toBeInTheDocument();
  const staleCard = metrics.getByText("Open 7d+").closest(".cc-metric");
  expect(within(staleCard as HTMLElement).getByText("Needs follow-up")).toBeInTheDocument();
  const staleRow = screen.getByText(/Old request/).closest("article");
  expect(staleRow?.className).toContain("cc-ticket-stale");
  expect(within(staleRow as HTMLElement).getByText("Open 7d+")).toBeInTheDocument();
  const agingRow = screen.getByText(/Question about seasons/).closest("article");
  expect(agingRow?.className).toContain("cc-ticket-aging");
  expect(within(agingRow as HTMLElement).getByText("Open 48h+")).toBeInTheDocument();
});

it("converts an email through the shared dialog with read-only fields", async () => {
  page("/admin/control-center?tab=support");
  await screen.findByText("New emails");
  fireEvent.click(screen.getByRole("button", { name: "Make ticket" }));
  expect(await screen.findByRole("heading", { name: "Make ticket from email" })).toBeInTheDocument();
  const name = screen.getByLabelText("Requester name") as HTMLInputElement;
  expect(name.value).toBe("Ana Ruiz");
  expect(name.readOnly).toBe(true);
  expect(screen.getByText(/From email · Received/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
  await waitFor(() => expect(vi.mocked(request).mock.calls.some(([path, init]) => String(path).endsWith("/support/tickets") && (init as RequestInit)?.method === "POST" && String((init as RequestInit)?.body).includes("in1"))).toBe(true));
  expect(await screen.findByText("Ticket #S-101 created.")).toBeInTheDocument();
});

it("surfaces the server's already-processed result on a duplicate conversion", async () => {
  duplicateConvert = true;
  page("/admin/control-center?tab=support");
  await screen.findByText("New emails");
  fireEvent.click(screen.getByRole("button", { name: "Make ticket" }));
  await screen.findByRole("heading", { name: "Make ticket from email" });
  fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
  expect(await screen.findByText("That email is already ticket #S-104.")).toBeInTheDocument();
});

it("validates the manual ticket dialog and keeps the draft on failure", async () => {
  page("/admin/control-center?tab=support");
  await screen.findByText("New emails");
  fireEvent.click(screen.getByRole("button", { name: "New ticket" }));
  expect(await screen.findByRole("heading", { name: "New ticket" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
  expect((await screen.findAllByText("Enter a value.")).length).toBe(2);
  expect(vi.mocked(request).mock.calls.some(([, init]) => (init as RequestInit)?.method === "POST")).toBe(false);
  fireEvent.change(screen.getByLabelText("Requester name"), { target: { value: "  Sam  " } });
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Help with practice" } });
  fireEvent.change(screen.getByLabelText("Requester email (optional)"), { target: { value: "not-an-email" } });
  fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
  expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
  expect((screen.getByLabelText("Requester name") as HTMLInputElement).value).toBe("  Sam  ");
  fireEvent.change(screen.getByLabelText("Requester email (optional)"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
  await waitFor(() => expect(vi.mocked(request).mock.calls.some(([path, init]) => String(path).endsWith("/support/tickets") && String((init as RequestInit)?.body).includes("Help with practice"))).toBe(true));
  expect(await screen.findByText("Ticket #S-101 created.")).toBeInTheDocument();
});

it("changes ticket status, and restores the last confirmed status with a retry on failure", async () => {
  page("/admin/control-center?tab=support");
  await screen.findByText("New emails");
  const select = screen.getByRole("combobox", { name: "Status for ticket #S-101" }) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: "Open" } });
  await waitFor(() => expect(vi.mocked(request).mock.calls.some(([path, init]) => String(path).includes("/support/tickets/t1/status") && String((init as RequestInit)?.body).includes("\"Open\""))).toBe(true));
  expect(await screen.findByText("#S-101 marked Open.")).toBeInTheDocument();
  failStatusOnce = true;
  fireEvent.change(select, { target: { value: "Waiting" } });
  expect(await screen.findByText(/could not be marked Waiting/)).toBeInTheDocument();
  expect(select.value).toBe("New");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(vi.mocked(request).mock.calls.some(([path, init]) => String(path).includes("/support/tickets/t1/status") && String((init as RequestInit)?.body).includes("\"Waiting\""))).toBe(true));
});

it("keeps the rest of the page usable when one panel fails", async () => {
  failOverview = true;
  page();
  expect(await screen.findByText(/This section could not be loaded/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  expect(await screen.findByText("Weekly digest")).toBeInTheDocument();
  expect(screen.getByText(/Nov 16–22, 2026/)).toBeInTheDocument();
});

it("isolates a panel RENDER throw: a malformed chart degrades only that panel (Nov 24 audit)", async () => {
  // A future field drift that drops `chart` from the overview payload must
  // not take the tab down the way the Content-tab drift did: the chart panel
  // shows its own error box while metrics, digest and attention still render.
  getFixtures.overview = { ...overview, chart: undefined };
  page("/admin/control-center?tab=overview");
  expect(await screen.findByText(/This section could not be displayed/)).toBeInTheDocument();
  expect(await screen.findByText("Total users")).toBeInTheDocument();
  expect(await screen.findByText("Today by club")).toBeInTheDocument();
  expect(await screen.findByText("Weekly digest")).toBeInTheDocument();
  expect(await screen.findByText("Needs attention")).toBeInTheDocument();
});
