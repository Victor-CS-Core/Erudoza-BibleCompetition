import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { practiceApi, type PracticeBootstrap, type PracticeEvent } from "../../api/practice";
import { ToastProvider } from "../../components/ui/toast";
import { StudentPracticeInbox } from "./StudentPracticeInbox";

const account = vi.hoisted(() => ({ userId: "player", organizationId: "org", kind: "Student" }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: account }) }));
vi.mock("../../api/practice", () => ({ practiceApi: { events: vi.fn(), accept: vi.fn() } }));

const data: PracticeBootstrap = {
  enabled: true, seasons: [{ id: "daniel", name: "Daniel 2026" }],
  players: [], rooms: [], invitations: [], achievements: [], questions: [], trends: [],
};
const roster = [
  { userId: "player", displayName: "Player One", team: 1 as const },
  { userId: "ana", displayName: "Ana", team: 1 as const },
  { userId: "ben", displayName: "Ben", team: 2 as const },
  { userId: "cid", displayName: "Cid", team: 2 as const },
];
const event = (overrides: Partial<PracticeEvent>): PracticeEvent => ({
  id: "event-1", seasonId: "daniel", seasonName: "Daniel 2026", name: "Friday practice",
  activity: "HeadToHead", format: "Arcade", teamCount: 2, teamSize: 2, questionCount: 10,
  coached: false, bookKey: null, simulation: null, createdByUserId: "coach",
  roster, captainStartUserId: null, startsAtUtc: null, status: "Open", roomId: "room-1",
  myTeam: 1, room: { id: "room-1", status: "Lobby", memberCount: 4, members: [] },
  createdAtUtc: "2026-11-20T12:00:00Z", updatedAtUtc: "2026-11-20T12:00:00Z", ...overrides,
});
function Destination() { return <output aria-label="Current destination">{useLocation().pathname}</output>; }
function mount(bootstrap: PracticeBootstrap = data) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cache}><ToastProvider><MemoryRouter initialEntries={["/student/practice"]}><StudentPracticeInbox org="org" data={bootstrap} /><Destination /></MemoryRouter></ToastProvider></QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(practiceApi.events).mockResolvedValue({ events: [] }); });
afterEach(cleanup);

describe("Student practice inbox", () => {
  it("shows the spec empty state and no create surface", async () => {
    mount();
    expect(await screen.findByText("No team practice assigned yet. When your coach sets up a practice for you, it will show up here.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create|Set up/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Season/)).not.toBeInTheDocument();
  });

  it("groups assigned events into happening now, coming up and recent results", async () => {
    vi.mocked(practiceApi.events).mockResolvedValue({ events: [
      event({ id: "live", status: "Open" }),
      event({ id: "soon", status: "Scheduled", roomId: null, room: null, startsAtUtc: "2026-11-25T23:00:00Z", name: "Tuesday rehearsal" }),
      event({ id: "done", status: "Completed", roomId: "room-9", room: { id: "room-9", status: "Completed", memberCount: 4, members: [] }, name: "Last week" }),
      event({ id: "gone", status: "Cancelled", name: "Cancelled one" }),
    ] });
    mount();
    expect(await screen.findByRole("heading", { name: "Happening now" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Coming up" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent results" })).toBeInTheDocument();
    expect(screen.queryByText("Cancelled one")).not.toBeInTheDocument();
    const liveCard = document.getElementById("event-live")!;
    expect(within(liveCard).getByRole("link", { name: "Join your team" })).toHaveAttribute("href", "/student/practice/room-1?seasonId=daniel");
    expect(within(liveCard).getByText(/You are on/)).toBeInTheDocument();
    const doneCard = document.getElementById("event-done")!;
    expect(within(doneCard).getByRole("link", { name: "View results" })).toHaveAttribute("href", "/student/practice/rooms/room-9/recap?seasonId=daniel");
  });

  it("names the designated captain on their open event", async () => {
    vi.mocked(practiceApi.events).mockResolvedValue({ events: [event({ captainStartUserId: "player" })] });
    mount();
    expect(await screen.findByText(/You are the designated captain/)).toBeInTheDocument();
  });

  it("shows seats, readiness and the start-waiting reason on a live event card", async () => {
    vi.mocked(practiceApi.events).mockResolvedValue({ events: [event({ room: { id: "room-1", status: "Lobby", memberCount: 4, members: [
      { userId: "player", displayName: "Player One", team: 1, ready: true, captain: true, scribe: true },
      { userId: "ana", displayName: "Ana", team: 1, ready: true, captain: false, scribe: false },
      { userId: "ben", displayName: "Ben", team: 2, ready: true, captain: true, scribe: false },
      { userId: "dee", displayName: "Dee", team: 2, ready: false, captain: false, scribe: true },
    ] } })] });
    mount();
    await screen.findByRole("heading", { name: "Happening now" });
    const card = document.getElementById("event-event-1")!;
    expect(within(card).getByText("4 of 4 seats filled · 3 of 4 players ready")).toBeInTheDocument();
    expect(within(card).getByText("Start is waiting on Dee to mark ready.")).toBeInTheDocument();
  });

  it("names the invitation destination room and season from the bootstrap payload", async () => {
    mount({ ...data,
      rooms: [{ id: "room-7", seasonId: "daniel", status: "Lobby", teamSize: 2, teamCount: 2, questionCount: 10, coached: false, ownerId: "coach", memberCount: 3 }],
      invitations: [{ id: "invite", roomId: "room-7", team: 2, inviterName: "Ana", expiresAt: "2026-12-01T12:00:00Z" }],
    });
    const invitations = within(document.getElementById("invitations")!);
    expect(await invitations.findByText("Daniel 2026 · 2v2 room · 3 of 4 seats filled")).toBeInTheDocument();
    expect(invitations.getByText(/Expires/)).toBeInTheDocument();
  });

  it("accepts a team-specific invitation only for its destination team", async () => {
    vi.mocked(practiceApi.accept).mockResolvedValue({ id: "invited-room", seasonId: "daniel" } as Awaited<ReturnType<typeof practiceApi.accept>>);
    mount({ ...data, invitations: [{ id: "invite", roomId: "invited-room", team: 2, inviterName: "Ana", expiresAt: "2026-12-01T12:00:00Z" }] });
    fireEvent.click(await screen.findByRole("button", { name: "Join Team 2" }));
    expect(screen.queryByRole("button", { name: "Join Team 1" })).not.toBeInTheDocument();
    await waitFor(() => expect(practiceApi.accept).toHaveBeenCalledWith("org", "invite", 2));
    expect(await screen.findByText("/student/practice/invited-room")).toBeInTheDocument();
  });
});
