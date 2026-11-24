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

import { SeasonLeaderboardPage, ZeroState, ZERO_ROSTER_CAP } from "./SeasonLeaderboardPage";
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
    expect(card).toHaveTextContent("Progress to Scribe");
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
    // The wireframe podium never renders in the empty state: no plinths, no
    // dashed "?" spots, no empty gold plate, no "Open spot" labels.
    expect(zero.querySelector(".season-board-zero-plinth")).toBeNull();
    expect(zero.querySelector(".season-board-zero-base")).toBeNull();
    expect(zero).not.toHaveTextContent("Open spot");
    expect(zero).not.toHaveTextContent("?");
    // Roster rows are proper rows: face, name, the canonical level pair, 0 XP.
    // (All-zero XP sorts by name, so find Maya's row by her name.)
    const rows = [...zero.querySelectorAll(".season-board-zero-line li")];
    expect(rows).toHaveLength(3);
    const mayaRow = rows.find(row => row.textContent?.includes("Maya R."));
    expect(mayaRow).toHaveTextContent("Level 5 · Scribe");
    expect(mayaRow).toHaveTextContent("0 XP");
    expect(mayaRow?.querySelector(".game-level-crest")).toBeNull();
    expect(mayaRow?.querySelector("[data-entry-avatar]")).not.toBeNull();
  });

  it("seats only the scorer on the podium and ghosts the unclaimed spots when one member has scored", async () => {
    apiMocks.seasonLeaderboard.mockResolvedValue({
      ...baseBoard,
      entries: baseBoard.entries.map(entry => entry.userId === "maya" ? entry : { ...entry, xp: 0, seasonXp: 0, weekXp: 0 }),
      me: { ...baseBoard.me!, seasonXp: 0, weekXp: 0, totalXp: 0, level: 1, levelName: "Seedling", nextLevelName: "Seeker", xpIntoLevel: 0, xpForNext: 100, avatar: initialsAvatar },
    });
    renderPage();
    await screen.findByTestId("season-board-row-1");
    expect(screen.queryByTestId("season-board-zero")).not.toBeInTheDocument();
    const first = screen.getByTestId("leaderboard-podium-1");
    expect(first).toHaveTextContent("Maya R.");
    expect(first).toHaveTextContent("845 XP");
    // Jonah and Sam have not scored: their spots are ghosts, not fake winners.
    expect(screen.queryByTestId("leaderboard-podium-2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("leaderboard-podium-3")).not.toBeInTheDocument();
    for (const rank of [2, 3]) {
      const ghost = screen.getByTestId(`leaderboard-podium-ghost-${rank}`);
      expect(ghost).toHaveTextContent("Open spot");
      expect(ghost.querySelector(".game-podium__block")).toHaveClass("game-podium__block--ghost");
      expect(ghost.querySelector(".game-podium__xp")).toBeNull();
      expect(ghost).not.toHaveTextContent("Jonah K.");
      expect(ghost).not.toHaveTextContent("Sam R.");
      expect(ghost).not.toHaveTextContent("?");
    }
    // The flat list still shows everyone, unscored members included.
    expect(screen.getByTestId("season-board-row-3")).toHaveTextContent("Sam R.");
  });

  it("ghosts only third place when two members have scored", async () => {
    apiMocks.seasonLeaderboard.mockResolvedValue({
      ...baseBoard,
      entries: baseBoard.entries.map(entry => entry.userId === "me" ? { ...entry, xp: 0, seasonXp: 0, weekXp: 0 } : entry),
      me: { ...baseBoard.me!, seasonXp: 0, weekXp: 0, totalXp: 0, level: 1, levelName: "Seedling", nextLevelName: "Seeker", xpIntoLevel: 0, xpForNext: 100, avatar: initialsAvatar },
    });
    renderPage();
    await screen.findByTestId("season-board-row-1");
    expect(screen.getByTestId("leaderboard-podium-1")).toHaveTextContent("Maya R.");
    expect(screen.getByTestId("leaderboard-podium-2")).toHaveTextContent("Jonah K.");
    expect(screen.queryByTestId("leaderboard-podium-3")).not.toBeInTheDocument();
    expect(screen.getByTestId("leaderboard-podium-ghost-3")).toHaveTextContent("Open spot");
    expect(screen.queryByTestId("leaderboard-podium-ghost-2")).not.toBeInTheDocument();
  });

  it("recomputes scored spots per mode: a season scorer with no week XP ghosts on the This week board", async () => {
    apiMocks.seasonLeaderboard.mockResolvedValue({
      ...baseBoard,
      entries: baseBoard.entries.map(entry => entry.userId === "jonah" ? entry : { ...entry, weekXp: 0 }),
    });
    renderPage();
    await screen.findByTestId("season-board-row-1");
    // Season board is full: all three scored this season.
    expect(screen.getByTestId("leaderboard-podium-3")).toHaveTextContent("Sam R.");
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    // This week only Jonah (240) has scored.
    expect(screen.getByTestId("leaderboard-podium-1")).toHaveTextContent("Jonah K.");
    expect(screen.getByTestId("leaderboard-podium-1")).toHaveTextContent("240 XP");
    expect(screen.queryByTestId("leaderboard-podium-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("leaderboard-podium-ghost-2")).toHaveTextContent("Open spot");
    expect(screen.getByTestId("leaderboard-podium-ghost-3")).toHaveTextContent("Open spot");
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

describe("ZeroState roster", () => {
  const rosterEntry = (index: number) => ({
    userId: `u${index}`, displayName: `Student ${index}`, xp: 0, seasonXp: 0, weekXp: 0,
    streak: 0, level: 1, levelName: "Seedling", avatar: initialsAvatar,
  });

  it("caps the starting-line roster and folds the rest into a +N more Pathfinders line", () => {
    const entries = Array.from({ length: ZERO_ROSTER_CAP + 3 }, (_, index) => rosterEntry(index + 1));
    render(<MemoryRouter><ZeroState entries={entries} seasonId="season-1" mode="season" /></MemoryRouter>);
    const zero = screen.getByTestId("season-board-zero");
    const rows = [...zero.querySelectorAll(".season-board-zero-line li:not(.season-board-zero-line__more)")];
    expect(rows).toHaveLength(ZERO_ROSTER_CAP);
    expect(zero).toHaveTextContent("+3 more Pathfinders");
    expect(zero).not.toHaveTextContent("Student 9");
    // Every shown row carries the level pair and the 0 XP score context.
    expect(rows[0]).toHaveTextContent("Level 1 · Seedling");
    expect(rows[0]).toHaveTextContent("0 XP");
  });

  it("shows the week wording and no cap line at exactly the cap", () => {
    const entries = Array.from({ length: ZERO_ROSTER_CAP }, (_, index) => rosterEntry(index + 1));
    render(<MemoryRouter><ZeroState entries={entries} seasonId="season-1" mode="week" /></MemoryRouter>);
    const zero = screen.getByTestId("season-board-zero");
    expect(zero).toHaveTextContent("Nobody has scored yet this week");
    expect(zero).not.toHaveTextContent("more Pathfinders");
  });
});
