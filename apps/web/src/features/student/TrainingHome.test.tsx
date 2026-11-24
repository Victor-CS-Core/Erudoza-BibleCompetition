import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { trainingApi } from "../../api/training";
import { StudentHomePage } from "./StudentHomePage";
import { todayFixture, journeyFixture, questFixture } from "./trainingFixtures";

vi.mock("../../api/client", () => ({ api: { assignedSeasons: vi.fn().mockResolvedValue([]), progress: vi.fn().mockResolvedValue({ seasonId: "s", seasonName: "Daniel", seasonStatus: "Active", assignments: [], masteredCount: 0, reviewDueCount: 0, attemptCount: 0, mastery: [], recentAttempts: [] }) } }));
vi.mock("../../api/training", () => ({ trainingApi: { today: vi.fn(), journey: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org", userId: "student" } }) }));
it("shows the PlayerCard with level, XP total and progress to the next level", async () => {
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture());
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyFixture());
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><StudentHomePage /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText("Level 2 · Seeker")).toBeInTheDocument();
  expect(screen.getByText(/120 XP/)).toBeInTheDocument();
  expect(screen.getByText(/130 XP to Reader/)).toBeInTheDocument();
  expect(screen.getByLabelText("Progress to the next level")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Rank 2" })).not.toBeInTheDocument();
});

it("renders the daily quest board with progress and completed states", async () => {
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture({ quests: [questFixture(), questFixture({ key: "sharpshooter", title: "Sharpshooter", description: "Finish a session at 90%+", target: 1, progress: 1, completed: true })] }));
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyFixture());
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><StudentHomePage /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByRole("heading", { name: "Today’s bonus quests" })).toBeInTheDocument();
  expect(screen.getByText("Little extras — no penalty for skipping.")).toBeVisible();
  expect(screen.getByRole("img", { name: "Warm-up: 0 of 1 done" })).toBeInTheDocument();
  expect(screen.getByText("Completed")).toBeInTheDocument();
  expect(screen.getByText("1 of 2 done")).toBeInTheDocument();
});

it("hides the quest board when no quests are available", async () => {
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture({ quests: [] }));
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyFixture());
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><StudentHomePage /></MemoryRouter></QueryClientProvider>);
  await screen.findByText("Level 2 · Seeker");
  expect(screen.queryByRole("heading", { name: "Today’s bonus quests" })).not.toBeInTheDocument();
});

it("shows the paused-streak chip only when the streak is paused", async () => {
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyFixture());
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture({ streakNudge: true }));
  const { unmount } = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><StudentHomePage /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText("Streak paused — practice today to restart")).toBeInTheDocument();
  expect(screen.queryByTestId("streak-nudge")).not.toBeInTheDocument();
  unmount();
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture({ streakNudge: false }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><StudentHomePage /></MemoryRouter></QueryClientProvider>);
  await screen.findByText("Level 2 · Seeker");
  expect(screen.queryByText("Streak paused — practice today to restart")).not.toBeInTheDocument();
});
it("reports saved weekly and passage evidence without inventing readiness", async () => {
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture());
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyFixture());
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><StudentHomePage /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByRole("link", { name: "Continue review" })).toHaveAttribute("href", expect.stringContaining("seasonId=s"));
  expect(screen.getByLabelText("2 of 5 practice days")).toBeVisible();
  // Chapter passage evidence now lives in the passage picker's chapter details.
  fireEvent.click(await screen.findByText("Passage details for Daniel 1"));
  expect(await screen.findByLabelText("DAN 1 assigned passages practiced")).toBeVisible();
  expect(screen.queryByText("72%")).not.toBeInTheDocument();
});
