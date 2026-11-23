import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SeasonLeaderboardResponse } from "../../api/types";

const apiMocks = vi.hoisted(() => ({
  seasonLeaderboard: vi.fn(),
  assignedSeasons: vi.fn(),
  setLeaderboardOptIn: vi.fn(),
}));
const authState = vi.hoisted(() => ({ me: { userId: "me", organizationId: "org-1", displayName: "Sam Rivera" } as { userId: string; organizationId: string; displayName: string } | null }));

vi.mock("../../api/client", () => ({
  api: {
    seasonLeaderboard: apiMocks.seasonLeaderboard,
    assignedSeasons: apiMocks.assignedSeasons,
    setLeaderboardOptIn: apiMocks.setLeaderboardOptIn,
  },
}));

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ me: authState.me }),
}));

import { SeasonLeaderboardPage } from "./SeasonLeaderboardPage";
const initialsAvatar = { avatarKind: "initials", avatarHonorKey: null, character: null } as const;

const baseBoard: SeasonLeaderboardResponse = {
  seasonId: "season-1",
  seasonName: "Daniel",
  seasonStatus: "Active",
  weekStartLocalDate: "2026-09-14",
  entries: [
    { userId: "maya", displayName: "Maya R.", xp: 845, seasonXp: 845, weekXp: 210, streak: 4, level: 5, levelName: "Scribe", avatar: initialsAvatar },
    { userId: "jonah", displayName: "Jonah K.", xp: 650, seasonXp: 650, weekXp: 240, streak: 0, level: 4, levelName: "Keeper", avatar: initialsAvatar },
    { userId: "me", displayName: "Sam R.", xp: 612, seasonXp: 612, weekXp: 150, streak: 6, level: 4, levelName: "Keeper", avatar: initialsAvatar },
  ],
  me: { userId: "me", optedIn: true, seasonXp: 612, weekXp: 150, streak: 6, totalXp: 612, level: 4, levelName: "Keeper", nextLevelName: "Scribe", xpIntoLevel: 112, xpForNext: 288, avatar: initialsAvatar },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/student/leaderboard"]}><SeasonLeaderboardPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.me = { userId: "me", organizationId: "org-1", displayName: "Sam Rivera" };
  apiMocks.assignedSeasons.mockResolvedValue([{ id: "season-1", name: "Daniel", status: "Active" }]);
  apiMocks.setLeaderboardOptIn.mockResolvedValue(undefined);
  apiMocks.seasonLeaderboard.mockResolvedValue(baseBoard);
});

describe("SeasonLeaderboardPage", () => {
  it("shows the pinned your-rank card with gap-to-next and level progress", async () => {
    renderPage();
    const card = await screen.findByTestId("season-board-your-rank");
    expect(card).toHaveTextContent("#3");
    expect(card).toHaveTextContent("612 XP");
    expect(card).toHaveTextContent("this season");
    // 650 (Jonah, directly above) − 612 = 38 XP behind.
    expect(card).toHaveTextContent("38 XP");
    expect(card).toHaveTextContent("behind Jonah K.");
    expect(card).toHaveTextContent("Progress to next rank");
    expect(card).toHaveTextContent("Scribe");
    expect(card).toHaveTextContent("612 / 900 XP");
    expect(card).toHaveTextContent("Level 4 · Keeper");
    expect(card).toHaveTextContent("6-day streak");
    // Board rows: season order, medallions, week sub-lines, You badge.
    expect(screen.getByTestId("season-board-row-1")).toHaveTextContent("Maya R.");
    expect(screen.getByTestId("season-board-row-1")).toHaveTextContent("+210 XP this week");
    expect(screen.getByTestId("season-board-row-3")).toHaveTextContent("You");
    expect(screen.getByText("Only teammates who joined the board are shown. Names show as first name + last initial.")).toBeInTheDocument();
  });

  it("re-sorts by week XP and swaps sub-lines when This week is toggled", async () => {
    renderPage();
    await screen.findByTestId("season-board-your-rank");
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    // Week XP: Jonah 240 > Maya 210 > Sam 150.
    expect(screen.getByTestId("season-board-row-1")).toHaveTextContent("Jonah K.");
    expect(screen.getByTestId("season-board-row-1")).toHaveTextContent("650 XP this season");
    const card = screen.getByTestId("season-board-your-rank");
    expect(card).toHaveTextContent("150 XP");
    expect(card).toHaveTextContent("this week");
    // Maya (210) sits directly above Sam in week mode: 210 − 150 = 60 XP behind her.
    expect(card).toHaveTextContent("60 XP");
    expect(card).toHaveTextContent("behind Maya R.");
  });

  it("shows the empty state when nobody has scored yet", async () => {
    apiMocks.seasonLeaderboard.mockResolvedValue({
      ...baseBoard,
      entries: [],
      me: { ...baseBoard.me!, seasonXp: 0, weekXp: 0, streak: 0, totalXp: 0, level: 1, levelName: "Seedling", nextLevelName: "Seeker", xpIntoLevel: 0, xpForNext: 100, avatar: initialsAvatar },
    });
    renderPage();
    expect(await screen.findByText("No scores yet — be the first on the board")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start practice" })).toBeInTheDocument();
    expect(screen.queryByTestId("season-board-your-rank")).not.toBeInTheDocument();
  });

  it("puts the top three on a podium above the flat race-bar rows", async () => {
    renderPage();
    await screen.findByTestId("season-board-your-rank");
    const first = screen.getByTestId("leaderboard-podium-1");
    expect(first).toHaveTextContent("Maya R.");
    expect(first).toHaveTextContent("845 XP");
    expect(screen.getByTestId("leaderboard-podium-2")).toHaveTextContent("Jonah K.");
    expect(screen.getByTestId("leaderboard-podium-3")).toHaveTextContent("Sam R.");
    // Rows stay a flat list (no card-in-card) and each carries a race bar.
    const row = screen.getByTestId("season-board-row-3");
    expect(row.querySelector(".game-chase-bar")).not.toBeNull();
    expect(row).toHaveTextContent("Level 4 · Keeper");
  });

  it("scales row race bars to the active mode's leader, monotonic with the ranking XP", async () => {
    const barWidth = (container: HTMLElement) => parseFloat(container.querySelector<HTMLElement>(".game-chase-bar__track > span")!.style.width);
    renderPage();
    await screen.findByTestId("season-board-your-rank");
    // Season mode: leader Maya 845. Every row bar is xp/845. The podium carries
    // no bars — its blocks show name, XP and the rank numeral only.
    const season: [string, number][] = [["Maya R.", 845], ["Jonah K.", 650], ["Sam R.", 612]];
    season.forEach(([name, xp], index) => {
      const expected = (xp / 845) * 100;
      const podiumItem = screen.getByTestId(`leaderboard-podium-${index + 1}`);
      expect(podiumItem).toHaveTextContent(name);
      expect(podiumItem.querySelector(".game-chase-bar")).toBeNull();
      expect(barWidth(screen.getByTestId(`season-board-row-${index + 1}`))).toBeCloseTo(expected, 3);
    });
    // This week: re-ranked Jonah 240 > Maya 210 > Sam 150, and the yardstick moves to 240.
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    const week: [string, number][] = [["Jonah K.", 240], ["Maya R.", 210], ["Sam R.", 150]];
    week.forEach(([name, xp], index) => {
      const expected = (xp / 240) * 100;
      const podiumItem = screen.getByTestId(`leaderboard-podium-${index + 1}`);
      expect(podiumItem).toHaveTextContent(name);
      expect(podiumItem.querySelector(".game-chase-bar")).toBeNull();
      expect(barWidth(screen.getByTestId(`season-board-row-${index + 1}`))).toBeCloseTo(expected, 3);
    });
  });

  it("shows the designed zero state with a starting line when members have not scored", async () => {
    apiMocks.seasonLeaderboard.mockResolvedValue({
      ...baseBoard,
      entries: baseBoard.entries.map(entry => ({ ...entry, xp: 0, seasonXp: 0, weekXp: 0 })),
      me: { ...baseBoard.me!, seasonXp: 0, weekXp: 0, totalXp: 0, level: 1, levelName: "Seedling", nextLevelName: "Seeker", xpIntoLevel: 0, xpForNext: 100, avatar: initialsAvatar },
    });
    renderPage();
    const zero = await screen.findByTestId("season-board-zero");
    expect(zero).toHaveTextContent("The race is about to start");
    expect(zero).toHaveTextContent("At the starting line");
    expect(zero).toHaveTextContent("Maya R.");
    expect(screen.getByRole("link", { name: "Start practice" })).toBeInTheDocument();
    expect(screen.queryByTestId("leaderboard-podium")).not.toBeInTheDocument();
    expect(screen.queryByTestId("season-board-row-1")).not.toBeInTheDocument();
  });

  it("shows the opt-in prompt with accurate name-privacy copy for students who have not joined", async () => {
    apiMocks.seasonLeaderboard.mockResolvedValue({ ...baseBoard, me: { ...baseBoard.me!, optedIn: false } });
    renderPage();
    expect(await screen.findByText("Your season, at a glance")).toBeInTheDocument();
    expect(screen.getByText(/Names show as first name \+ last initial/)).toBeInTheDocument();
    expect(screen.queryByTestId("season-board-row-1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show me on the board" }));
    await waitFor(() => expect(apiMocks.setLeaderboardOptIn).toHaveBeenCalledWith(true));
  });

  it("shows coaches the full board without a pinned card or opt-in prompt", async () => {
    apiMocks.seasonLeaderboard.mockResolvedValue({ ...baseBoard, me: null });
    renderPage();
    expect(await screen.findByTestId("season-board-row-1")).toHaveTextContent("Maya R.");
    expect(screen.queryByTestId("season-board-your-rank")).not.toBeInTheDocument();
    expect(screen.getByText("Every student assigned in this season is shown.")).toBeInTheDocument();
  });
});
