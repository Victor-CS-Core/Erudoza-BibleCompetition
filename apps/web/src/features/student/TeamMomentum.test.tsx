import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { TeamActivityStrip, LeaderboardCard } from "./TeamMomentum";
vi.mock("../../api/client", () => ({ api: { teamActivity: vi.fn(), leaderboard: vi.fn(), seasonLeaderboard: vi.fn(), setLeaderboardOptIn: vi.fn() } }));
const account = vi.hoisted(() => ({ organizationId: "org", userId: "student", kind: "Student" }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: account }) }));
function renderWith(component: React.ReactNode) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } }})}>{component}</QueryClientProvider>);
}
beforeEach(() => { vi.mocked(api.setLeaderboardOptIn).mockResolvedValue({ leaderboardOptIn: true }); });

it("renders the team activity strip with counts and dots", async () => {
  vi.mocked(api.teamActivity).mockResolvedValue({ practicedToday: 2, practicedThisWeek: 4, memberCount: 6 });
  renderWith(<TeamActivityStrip />);
  const strip = await screen.findByTestId("team-activity-strip");
  expect(strip).toHaveTextContent("4 teammates");
  expect(strip).toHaveTextContent("2");
  expect(strip).toHaveTextContent("6 Pathfinders on your team");
});

it("encourages the first practicer when the team is quiet", async () => {
  vi.mocked(api.teamActivity).mockResolvedValue({ practicedToday: 0, practicedThisWeek: 0, memberCount: 6 });
  renderWith(<TeamActivityStrip />);
  expect(await screen.findByTestId("team-activity-strip")).toHaveTextContent("Be the first on your team");
});

it("prompts opt-in when the student has not joined the board", async () => {
  vi.mocked(api.leaderboard).mockResolvedValue({ weekStartLocalDate: "2026-09-14", entries: [], me: { userId: "student", rank: null, xp: 0, optedIn: false } });
  renderWith(<LeaderboardCard />);
  expect(await screen.findByRole("button", { name: "Show me on the team board" })).toBeInTheDocument();
  expect(screen.queryByTestId("leaderboard-row-1")).not.toBeInTheDocument();
});

it("joins the board through the opt-in button", async () => {
  vi.mocked(api.leaderboard).mockResolvedValue({ weekStartLocalDate: "2026-09-14", entries: [], me: { userId: "student", rank: null, xp: 0, optedIn: false } });
  renderWith(<LeaderboardCard />);
  fireEvent.click(await screen.findByRole("button", { name: "Show me on the team board" }));
  await waitFor(() => expect(api.setLeaderboardOptIn).toHaveBeenCalledWith(true));
});

it("shows the top five, masked names and the viewer rank outside it", async () => {
  vi.mocked(api.leaderboard).mockResolvedValue({
    weekStartLocalDate: "2026-09-14",
    entries: [
      { userId: "a", displayName: "Ada L.", xp: 500, level: 4, levelName: "Keeper" },
      { userId: "b", displayName: "Grace H.", xp: 400, level: 3, levelName: "Reader" },
      { userId: "c", displayName: "Katherine J.", xp: 300, level: 3, levelName: "Reader" },
      { userId: "d", displayName: "Mary W.", xp: 200, level: 2, levelName: "Seeker" },
      { userId: "e", displayName: "Alan T.", xp: 100, level: 2, levelName: "Seeker" },
      { userId: "student", displayName: "Sam R.", xp: 50, level: 1, levelName: "Seedling" },
    ],
    me: { userId: "student", rank: 6, xp: 50, optedIn: true },
  });
  renderWith(<LeaderboardCard />);
  expect(await screen.findByTestId("leaderboard-row-1")).toHaveTextContent("Ada L.");
  expect(screen.getByTestId("leaderboard-row-5")).toHaveTextContent("Alan T.");
  expect(screen.queryByTestId("leaderboard-row-6")).not.toBeInTheDocument();
  expect(document.querySelector(".leaderboard-own-rank")?.textContent).toBe("You’re #6 with 50 XP this week.");
  expect(screen.getByRole("button", { name: "Hide me from the board" })).toBeInTheDocument();
});

it("highlights the viewer inside the top five", async () => {
  vi.mocked(api.leaderboard).mockResolvedValue({
    weekStartLocalDate: "2026-09-14",
    entries: [{ userId: "student", displayName: "Sam R.", xp: 500, level: 4, levelName: "Keeper" }],
    me: { userId: "student", rank: 1, xp: 500, optedIn: true },
  });
  renderWith(<LeaderboardCard />);
  const row = await screen.findByTestId("leaderboard-row-1");
  expect(row).toHaveTextContent("You");
  expect(screen.queryByText(/You’re #/)).not.toBeInTheDocument();
});

it("labels the gamification tier as Level so Rank means only board position", async () => {
  vi.mocked(api.leaderboard).mockResolvedValue({
    weekStartLocalDate: "2026-09-14",
    entries: [{ userId: "a", displayName: "Ada L.", xp: 500, level: 4, levelName: "Keeper" }],
    me: { userId: "student", rank: null, xp: 0, optedIn: true },
  });
  renderWith(<LeaderboardCard />);
  const row = await screen.findByTestId("leaderboard-row-1");
  expect(row).toHaveTextContent("Level 4");
  expect(row.querySelector(".leaderboard-rank")).toHaveAttribute("aria-label", "Position 1");
});

it("renders the season mini — podium strip, chase row, team footer — when a season is given", async () => {
  vi.mocked(api.teamActivity).mockResolvedValue({ practicedToday: 2, practicedThisWeek: 4, memberCount: 6 });
  vi.mocked(api.seasonLeaderboard).mockResolvedValue({
    seasonId: "season-1", seasonName: "Daniel", seasonStatus: "Active", weekStartLocalDate: "2026-09-14",
    entries: [
      { userId: "a", displayName: "Ada L.", xp: 500, seasonXp: 500, weekXp: 90, streak: 4, level: 4, levelName: "Keeper" },
      { userId: "student", displayName: "Sam R.", xp: 350, seasonXp: 350, weekXp: 60, streak: 2, level: 3, levelName: "Reader" },
      { userId: "c", displayName: "Katherine J.", xp: 300, seasonXp: 300, weekXp: 40, streak: 0, level: 3, levelName: "Reader" },
    ],
    me: { userId: "student", optedIn: true, seasonXp: 350, weekXp: 60, streak: 2, totalXp: 350, level: 3, levelName: "Reader", nextLevelName: "Keeper", xpIntoLevel: 50, xpForNext: 100 },
  });
  renderWith(<MemoryRouter><LeaderboardCard seasonId="season-1" /></MemoryRouter>);
  const card = await screen.findByTestId("leaderboard-card");
  expect(await screen.findByTestId("leaderboard-mini-row-1")).toHaveTextContent("Ada L.");
  expect(within(card).getByRole("heading", { name: "Season leaderboard" })).toBeInTheDocument();
  expect(screen.getByTestId("leaderboard-mini-row-2")).toHaveTextContent("You");
  // 500 (Ada, directly above) − 350 = 150 XP chase gap in season mode.
  expect(card).toHaveTextContent("150 XP");
  expect(card).toHaveTextContent("behind Ada L.");
  expect(screen.getByTestId("leaderboard-mini-team-line")).toHaveTextContent("4 teammates practiced this week");
  expect(screen.getByRole("link", { name: /See full board/ })).toHaveAttribute("href", "/student/leaderboard?seasonId=season-1");
  expect(screen.queryByText("Team leaderboard")).not.toBeInTheDocument();
});

it("shows the designed zero state in the season mini before anyone scores", async () => {
  vi.mocked(api.teamActivity).mockResolvedValue({ practicedToday: 0, practicedThisWeek: 0, memberCount: 6 });
  vi.mocked(api.seasonLeaderboard).mockResolvedValue({
    seasonId: "season-1", seasonName: "Daniel", seasonStatus: "Active", weekStartLocalDate: "2026-09-14",
    entries: [{ userId: "student", displayName: "Sam R.", xp: 0, seasonXp: 0, weekXp: 0, streak: 0, level: 1, levelName: "Seedling" }],
    me: { userId: "student", optedIn: true, seasonXp: 0, weekXp: 0, streak: 0, totalXp: 0, level: 1, levelName: "Seedling", nextLevelName: "Seeker", xpIntoLevel: 0, xpForNext: 100 },
  });
  renderWith(<MemoryRouter><LeaderboardCard seasonId="season-1" /></MemoryRouter>);
  expect(await screen.findByTestId("leaderboard-mini-zero")).toHaveTextContent("The race is about to start");
  expect(screen.queryByTestId("leaderboard-mini-row-1")).not.toBeInTheDocument();
});

it("recovers when the leaderboard fails to load", async () => {
  vi.mocked(api.leaderboard).mockRejectedValueOnce(new Error("offline"));
  renderWith(<LeaderboardCard />);
  expect(await screen.findByText("The leaderboard couldn’t load.")).toBeInTheDocument();
  vi.mocked(api.leaderboard).mockResolvedValue({ weekStartLocalDate: "2026-09-14", entries: [], me: { userId: "student", rank: null, xp: 0, optedIn: false } });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("button", { name: "Show me on the team board" })).toBeInTheDocument();
});
