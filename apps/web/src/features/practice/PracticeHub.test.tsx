import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { practiceApi, pbeApi, type PracticeBootstrap, type PracticeEvent } from "../../api/practice";
import { ToastProvider } from "../../components/ui/toast";
import { PracticeHub } from "./PracticeHub";
import { useMyProfile } from "../profile/profile";

const avatarMutate = vi.hoisted(() => vi.fn());
vi.mock("../profile/profile", () => ({ useMyProfile: vi.fn(), useSetProfileAvatar: () => ({ mutate: avatarMutate, isPending: false }) }));
const account = vi.hoisted(() => ({ userId: "coach", organizationId: "org", kind: "Adult" }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: account }) }));
vi.mock("../../api/practice", () => ({ practiceApi: { bootstrap: vi.fn(), create: vi.fn(), accept: vi.fn(), enabled: vi.fn(), simulationMaterial: vi.fn(), simulationAvailability: vi.fn(), events: vi.fn(), eventRoster: vi.fn(), createEvent: vi.fn(), updateEvent: vi.fn(), openEvent: vi.fn(), cancelEvent: vi.fn(), duplicateEvent: vi.fn() }, pbeApi: { enabled: vi.fn() } }));
vi.mock("../../api/client", () => ({ api: { library: vi.fn(), seasonScope: vi.fn(), contentPacks: vi.fn(), sourceUnits: vi.fn() } }));

const data: PracticeBootstrap = {
  enabled: true, seasons: [{ id: "daniel", name: "Daniel 2026" }, { id: "luke", name: "Luke 2026" }],
  players: [], rooms: [], invitations: [], achievements: [], questions: [], trends: [],
};
const rosterMembers = [
  { userId: "p1", displayName: "Ana", kind: "Student", role: "Student" },
  { userId: "p2", displayName: "Ben", kind: "Student", role: "Student" },
  { userId: "p3", displayName: "Cid", kind: "Student", role: "Student" },
  { userId: "p4", displayName: "Dee", kind: "Student", role: "Student" },
];
const event = (overrides: Partial<PracticeEvent>): PracticeEvent => ({
  id: "event-1", seasonId: "daniel", seasonName: "Daniel 2026", name: "Friday practice",
  activity: "HeadToHead", format: "Arcade", teamCount: 2, teamSize: 2, questionCount: 10,
  coached: false, bookKey: null, simulation: null, createdByUserId: "coach",
  roster: rosterMembers.map((member, index) => ({ userId: member.userId, displayName: member.displayName, team: (index < 2 ? 1 : 2) as 1 | 2 })),
  captainStartUserId: null, startsAtUtc: null, status: "Open", roomId: "room-1",
  myTeam: null, room: { id: "room-1", status: "Lobby", memberCount: 4, members: [] },
  createdAtUtc: "2026-11-20T12:00:00Z", updatedAtUtc: "2026-11-20T12:00:00Z", ...overrides,
});
function Destination() { return <output aria-label="Current destination">{useLocation().pathname}</output>; }
function mount(path = "/admin/practice") {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { cache, ...render(<QueryClientProvider client={cache}><ToastProvider><MemoryRouter initialEntries={[path]}><PracticeHub /><Destination /></MemoryRouter></ToastProvider></QueryClientProvider>) };
}
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  account.kind = "Adult"; account.userId = "coach";
  vi.mocked(useMyProfile).mockReturnValue({ data: { userId: "coach", displayName: "Coach", avatarHonorKey: null, honors: [] }, isPending: false, isError: false, isSuccess: true, refetch: vi.fn() } as unknown as ReturnType<typeof useMyProfile>);
  vi.mocked(practiceApi.bootstrap).mockResolvedValue(data);
  vi.mocked(practiceApi.events).mockResolvedValue({ events: [] });
  vi.mocked(practiceApi.eventRoster).mockResolvedValue({ members: rosterMembers });
  vi.mocked(practiceApi.createEvent).mockResolvedValue(event({}));
  vi.mocked(practiceApi.cancelEvent).mockResolvedValue(event({ status: "Cancelled" }));
  vi.mocked(practiceApi.enabled).mockResolvedValue();
  vi.mocked(pbeApi.enabled).mockResolvedValue();
  vi.mocked(api.library).mockResolvedValue({ translationId: "nkjv", translationName: "NKJV", version: 1, books: [] });
  vi.mocked(api.seasonScope).mockResolvedValue({ contentPackId: null, includes: [], excludes: [] });
  vi.mocked(api.contentPacks).mockResolvedValue([]);
  vi.mocked(api.sourceUnits).mockResolvedValue([]);
});
afterEach(cleanup);

describe("Coach Team Practice events", () => {
  it("shows the event workspace instead of the legacy room setup dialogs", async () => {
    mount();
    expect(await screen.findByRole("button", { name: "Create event" })).toHaveClass("ds-button-primary");
    expect(screen.getByRole("heading", { name: "Your events" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set up PVP" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set up simulation" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Coach question bank" })).toBeInTheDocument();
    expect(screen.getByText("No rooms yet. Create an event above and its room will appear here when it opens.")).toBeInTheDocument();
  });

  it("creates an open-now head-to-head event only when every seat is filled", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Create event" }));
    await screen.findByRole("form", { name: "Create event" });
    fireEvent.click(screen.getByRole("button", { name: "Create and open event" }));
    expect(await screen.findByText(/Fill every seat/)).toBeInTheDocument();
    expect(practiceApi.createEvent).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Team for Ana"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Team for Ben"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Team for Cid"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Team for Dee"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and open event" }));
    await waitFor(() => expect(practiceApi.createEvent).toHaveBeenCalledWith("org", expect.objectContaining({
      seasonId: "daniel", activity: "HeadToHead", format: "Arcade", teamSize: 2, questionCount: 10, startsAtUtc: null,
      roster: expect.arrayContaining([{ userId: "p1", team: 1 }, { userId: "p2", team: 1 }, { userId: "p3", team: 2 }, { userId: "p4", team: 2 }]),
    })));
  });

  it("opens the create form from the create-event anchor", async () => {
    mount("/admin/practice#create-event");
    expect(await screen.findByRole("form", { name: "Create event" })).toBeInTheDocument();
  });

  it("shows the live view for an open event and links to its room", async () => {
    vi.mocked(practiceApi.events).mockResolvedValue({ events: [event({ room: { id: "room-1", status: "Lobby", memberCount: 2, members: [
      { userId: "p1", displayName: "Ana", team: 1, ready: true, captain: true, scribe: true },
      { userId: "p3", displayName: "Cid", team: 2, ready: false, captain: true, scribe: false },
    ] } })] });
    mount();
    expect(await screen.findByText("2 in the room · 1 ready · Waiting in the lobby")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open room" })).toHaveAttribute("href", "/admin/practice/room-1");
  });

  it("cancels a scheduled event after confirmation", async () => {
    vi.mocked(practiceApi.events).mockResolvedValue({ events: [event({ id: "soon", status: "Scheduled", roomId: null, room: null, startsAtUtc: "2026-11-25T23:00:00Z" })] });
    mount();
    expect(await screen.findByRole("heading", { name: "Coming up" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel event" }));
    const dialog = await screen.findByRole("dialog", { name: "Cancel this event?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel event" }));
    await waitFor(() => expect(practiceApi.cancelEvent).toHaveBeenCalledWith("org", "soon"));
  });

  it("prioritizes a playing room using only returned room evidence", async () => {
    vi.mocked(practiceApi.bootstrap).mockResolvedValue({ ...data, rooms: [
      { id: "lobby", seasonId: "daniel", status: "Lobby", teamSize: 5, questionCount: 30, coached: true, ownerId: "other", memberCount: 3 },
      { id: "live", seasonId: "luke", status: "Playing", teamSize: 2, questionCount: 10, coached: false, ownerId: "coach", memberCount: 4 },
    ] });
    mount();
    const current = await screen.findByRole("region", { name: "Current room" });
    expect(within(current).getByRole("link", { name: "Return to match" })).toHaveAttribute("href", "/admin/practice/live");
    expect(within(current).getByText(/Luke 2026/)).toBeInTheDocument();
    expect(within(current).getByText(/4 players/)).toBeInTheDocument();
  });

  it("uses singular labels for one-question, one-player rooms", async () => {
    vi.mocked(practiceApi.bootstrap).mockResolvedValue({ ...data, rooms: [
      { id: "solo", seasonId: "daniel", status: "Lobby", teamSize: 2, questionCount: 1, coached: false, ownerId: "other", memberCount: 1 },
      { id: "pair", seasonId: "daniel", status: "Lobby", teamSize: 2, questionCount: 2, coached: true, ownerId: "other", memberCount: 2 },
    ] });
    mount();
    const current = await screen.findByRole("region", { name: "Current room" });
    expect(within(current).getByText(/1 question · 1 player/)).toBeInTheDocument();
    expect(screen.getByText(/2 questions · Coach-led · 2 players/)).toBeInTheDocument();
    expect(screen.queryByText(/1 questions|1 players/)).not.toBeInTheDocument();
  });

  it("tells a coach to enable Team Practice and lets them enable it", async () => {
    vi.mocked(practiceApi.bootstrap).mockResolvedValueOnce({ ...data, enabled: false }).mockResolvedValue(data);
    mount();
    await screen.findByText("Team Practice is not enabled");
    expect(screen.getByText("Enable Team Practice below to run events, simulations, and answer reviews for your club.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enable Team Practice" }));
    expect(await screen.findByRole("button", { name: "Create event" })).toBeEnabled();
    expect(practiceApi.enabled).toHaveBeenCalledWith("org", true);
  });

  it("keeps Solo answer reviews reachable when Team Practice is disabled", async () => {
    vi.mocked(practiceApi.bootstrap).mockResolvedValue({ ...data, enabled: false });
    mount();
    expect(await screen.findByRole("link", { name: "Open PBE answer reviews" })).toHaveAttribute("href", "/admin/practice/reviews");
  });

  it("shows PBE pending counts beside finalized team accuracy", async () => {
    vi.mocked(practiceApi.bootstrap).mockResolvedValue({ ...data, trends: [{ format: "Pbe", teamCount: 1, seasonId: "daniel", teamSize: 6, bookKey: null, ruleVersion: "pbe-v1", scoringVersion: "pbe-score-v1", matches: 1, wins: 0, draws: 0, accuracyHundredths: 5800, availableHundredths: 5800, speedHundredths: 0, unansweredQuestions: 0, averageResponseMs: 1000, distinctQuestions: 29, distinctPassages: 1, participatedQuestions: 30, pendingCount: 1, provisional: true }] });
    mount();
    expect(await screen.findByText(/1 answer awaiting review/)).toBeVisible();
    expect(screen.getByText("Finalized accuracy")).toBeVisible();
  });

  it("preserves historical milestones and the returned participant-scoped trend", async () => {
    vi.mocked(practiceApi.bootstrap).mockResolvedValue({ ...data,
      achievements: [{ key: "first-fellowship", title: "First Fellowship", seasonId: "daniel" }],
      trends: [{ seasonId: "daniel", teamSize: 3, bookKey: "DAN", ruleVersion: "v1", matches: 2, wins: 1, draws: 0, accuracyHundredths: 1750, availableHundredths: 2000, speedHundredths: 250, unansweredQuestions: 1, averageResponseMs: 12300, distinctQuestions: 10, distinctPassages: 8, participatedQuestions: 6 }],
    });
    mount();
    await screen.findByRole("heading", { name: "Team Achievement patches" });
    fireEvent.click(screen.getByText("Practice milestones", { selector: "summary" }));
    expect(screen.getByText("First Fellowship")).toBeInTheDocument();
    expect(screen.getByText("Milestone recorded")).toBeInTheDocument();
    const progress = screen.getByRole("region", { name: "Team practice progress" });
    expect(within(progress).getByText("88%")).toBeInTheDocument();
    expect(within(progress).getByText("12.3s")).toBeInTheDocument();
  });

  it("retries unavailable bootstrap data without exposing sample rooms", async () => {
    vi.mocked(practiceApi.bootstrap).mockRejectedValueOnce(new Error("Practice is offline.")).mockResolvedValue(data);
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Practice is offline.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Create event" })).toBeEnabled();
  });
});

describe("Student view of the hub", () => {
  it("shows the assignee inbox with no create surface for a student", async () => {
    account.kind = "Student"; account.userId = "player";
    vi.mocked(useMyProfile).mockReturnValue({ data: { userId: "player", displayName: "Player", avatarHonorKey: null, honors: [] }, isPending: false, isError: false, isSuccess: true, refetch: vi.fn() } as unknown as ReturnType<typeof useMyProfile>);
    mount("/student/practice");
    expect(await screen.findByText("No team practice assigned yet. When your coach sets up a practice for you, it will show up here.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create event" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set up PVP" })).not.toBeInTheDocument();
    expect(screen.queryByText("Question bank")).not.toBeInTheDocument();
  });

  it("keeps disabled practice unavailable to a student", async () => {
    account.kind = "Student"; account.userId = "player";
    vi.mocked(practiceApi.bootstrap).mockResolvedValue({ ...data, enabled: false });
    mount("/student/practice");
    await screen.findByText("Team Practice is not enabled");
    expect(screen.getByText("Ask your coach to enable Team Practice for your club.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable Team Practice" })).not.toBeInTheDocument();
  });

  it("shows only mastery-qualified Team Achievement patch profile choices", async () => {
    account.kind = "Student"; account.userId = "player";
    vi.mocked(useMyProfile).mockReturnValue({ data: { userId: "player", displayName: "Player", avatarHonorKey: null, honors: [
      { key: "team:first-fellowship", title: "First Fellowship", category: "Team Practice", requirement: "90% personal accuracy across 10 distinct manual answers.", ruleVersion: "mastery-v1", earnedAtUtc: null },
      { key: "team:team-precision", title: "Team Precision", category: "Team Practice", requirement: "95% team accuracy across 50 questions plus personal mastery.", ruleVersion: "mastery-v1", earnedAtUtc: "2026-09-11T12:00:00Z" },
      { key: "solo:exact-recall", title: "Exact Recall", category: "Scripture", requirement: "12 passages at 90.", ruleVersion: "mastery-v1", earnedAtUtc: "2026-09-11T12:00:00Z" },
    ] }, isPending: false, isError: false, isSuccess: true, refetch: vi.fn() } as unknown as ReturnType<typeof useMyProfile>);
    mount("/student/practice");
    await screen.findByRole("heading", { name: "Team Achievement patches" });
    fireEvent.click(screen.getByRole("button", { name: "First Fellowship: view details" }));
    expect(await screen.findByText("90% personal accuracy across 10 distinct manual answers.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use First Fellowship as profile image" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    fireEvent.click(screen.getByRole("button", { name: "Team Precision: view details" }));
    // A real action now (the avatar endpoint), not a link to the profile page.
    fireEvent.click(await screen.findByRole("button", { name: "Use Team Precision as profile image" }));
    expect(avatarMutate).toHaveBeenCalledWith("team:team-precision", expect.anything());
    expect(screen.queryByText("Exact Recall")).not.toBeInTheDocument();
  });
});
