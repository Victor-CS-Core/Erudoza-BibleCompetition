// Control Center CROSS-BOUNDARY render test (Nov 24 audit): renders all five
// tabs from payloads the real worker emitted (captured by
// worker/native/capture-control-center.test.ts into
// __fixtures__/control-center-payloads.json), so a server/client field
// drift fails HERE even if each side's own tests stay green — the exact
// blind spot behind the production Content-tab crash. A second pass renders
// every tab from an all-empty payload set (sparse-data audit).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/ui";
import ControlCenterPage from "./ControlCenterPage";
import fixture from "./__fixtures__/control-center-payloads.json";

type Captured = { status: number; body: never };
const payloads = fixture as unknown as Record<string, Captured>;

const empty: Record<string, unknown> = {
  overview: { totalUsers: 0, newThisMonth: 0, xpThisWeek: 0, xpLastWeek: 0, activeThisWeek: 0, activeLastWeek: 0, sessionsToday: 0, sessionsDailyAverage: 0, chart: Array.from({ length: 14 }, (_, i) => ({ day: `2026-11-${String(11 + i).padStart(2, "0")}`, sessions: 0 })), todayByClub: [] },
  users: { clubs: 0, newest: [] },
  clubs: { clubs: [] },
  funnel: { steps: [{ key: "invitations", label: "Invitations sent", count: 0, source: "Coach invitations" }, { key: "accounts", label: "Accounts created", count: 0, source: "User accounts" }, { key: "first-practice", label: "First practice attempt", count: 0, source: "Recorded attempts (Memory + PBE)" }, { key: "active-week", label: "Active this week", count: 0, source: "XP activity this week" }] },
  content: { watcher: null, proposalsPending: 0, proposalsOldestAtUtc: null, releasesLive: 0, newsSuggestions: 0, newsDrafts: 0, newsPublished: 0, newsOldestSuggestionAtUtc: null, libraryPacks: 0, libraryVerses: 0 },
  seasons: { openDisputes: 0, oldestDisputeAtUtc: null, seasons: [] },
  system: { version: "2026.11.1", database: "ok", cron: { expression: "0 10 * * 1", label: "Mondays 10:00 UTC" }, secrets: [], supportIngestConfigured: false, supportAddress: "ktr0nn@muse.ai", errors: { last24h: 0, last7d: 0, byArea: [] } },
  digest: { digest: null },
  support: { supportAddress: "ktr0nn@muse.ai", counts: { newEmails: 0, openTickets: 0, aging48h: 0, stale7d: 0 }, inbox: [], tickets: [] },
};

let mode: "real" | "empty" = "real";
function route(rawUrl: string): { status: number; body: unknown } {
  const url = new URL(rawUrl, "https://erudoza.test");
  const key = Object.keys(payloads).find(k => url.pathname.endsWith(`/control-center/${k}`));
  if (!key) return { status: 404, body: { detail: `unrouted ${url.pathname}` } };
  return mode === "real" ? payloads[key] : { status: 200, body: empty[key] };
}

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const { status, body } = route(String(input));
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
});
afterEach(() => { cleanup(); mode = "real"; });

function page(tab: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/admin/control-center?tab=${tab}`]}>
          <ControlCenterPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
const settle = () => new Promise(r => setTimeout(r, 250));

it("renders the Overview tab from real server payloads, incl. the 7D/14D switch", async () => {
  const view = page("overview");
  await screen.findByText("Today by club");
  expect(screen.getAllByText("Practice Club").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Northgate Club").length).toBeGreaterThan(0);
  expect(screen.getByText("Weekly digest")).toBeTruthy();
  expect(screen.getByText("Needs attention")).toBeTruthy();
  expect(view.container.querySelectorAll(".cc-day")).toHaveLength(14);
  fireEvent.click(screen.getByRole("button", { name: "7D" }));
  expect(view.container.querySelectorAll(".cc-day")).toHaveLength(7);
  expect(document.body.textContent).not.toContain("could not be displayed");
}, 30000);

it("renders Users & clubs from real server payloads", async () => {
  page("users");
  expect((await screen.findAllByText("Practice Club")).length).toBeGreaterThan(0);
  expect(await screen.findByText("Onboarding funnel")).toBeTruthy();
  expect(document.body.textContent).not.toContain("could not be displayed");
}, 30000);

it("renders the Content tab from real server payloads (the Nov 24 crash tab)", async () => {
  page("content");
  expect(await screen.findByText(/Nov 23, \d{1,2}:00 [AP]M/)).toBeTruthy(); // watcher run, server-emitted timestamp
  expect((await screen.findAllByText("2026-27 PBE Season")).length).toBeGreaterThan(0);
  expect(document.body.textContent).not.toContain("could not be displayed");
}, 30000);

it("renders Support from real server payloads", async () => {
  page("support");
  await screen.findByText("Cannot sign in"); // ingested inbox email
  expect(screen.getByText("Question about seasons")).toBeTruthy(); // manual ticket
  expect(screen.getAllByText("#S-101").length).toBeGreaterThan(0);
  expect(document.body.textContent).not.toContain("could not be displayed");
}, 30000);

it("renders System from real server payloads", async () => {
  page("system");
  expect(await screen.findByText("2026.11.1")).toBeTruthy();
  expect(await screen.findByText("RESEND_API_KEY")).toBeTruthy();
  expect(screen.getByText("Club admin pages")).toBeTruthy();
  expect(document.body.textContent).not.toContain("could not be displayed");
}, 30000);

it("renders every tab from an all-empty payload set without crashing", async () => {
  mode = "empty";
  for (const tab of ["overview", "users", "content", "support", "system"]) {
    const view = page(tab);
    await settle();
    expect(document.body.textContent, tab).not.toContain("could not be displayed");
    expect(document.body.textContent, tab).not.toContain("could not be loaded");
    view.unmount();
  }
  // Spot-check the honest zero states.
  const view = page("overview");
  expect(await screen.findByText("No practice sessions recorded yet today.")).toBeTruthy();
  expect(await screen.findByText("No digest yet")).toBeTruthy();
  expect(await screen.findByText(/All clear/)).toBeTruthy();
  view.unmount();
  const support = page("support");
  await settle();
  expect(document.body.textContent).toContain("No tickets yet");
  support.unmount();
}, 60000);
