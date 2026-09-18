import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { TeamActivityStrip, LeaderboardCard } from "./TeamMomentum";
vi.mock("../../api/client", () => ({ api: { teamActivity: vi.fn(), leaderboard: vi.fn(), setLeaderboardOptIn: vi.fn() } }));
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

it("recovers when the leaderboard fails to load", async () => {
  vi.mocked(api.leaderboard).mockRejectedValueOnce(new Error("offline"));
  renderWith(<LeaderboardCard />);
  expect(await screen.findByText("The leaderboard couldn’t load.")).toBeInTheDocument();
  vi.mocked(api.leaderboard).mockResolvedValue({ weekStartLocalDate: "2026-09-14", entries: [], me: { userId: "student", rank: null, xp: 0, optedIn: false } });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("button", { name: "Show me on the team board" })).toBeInTheDocument();
});
