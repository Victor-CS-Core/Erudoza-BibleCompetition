import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { trainingApi } from "../../api/training";
import { StudentHomePage } from "./StudentHomePage";
import { todayFixture, journeyFixture, questFixture } from "./trainingFixtures";

vi.mock("../../api/client", () => ({ api: { assignedSeasons: vi.fn().mockResolvedValue([]), progress: vi.fn() } }));
vi.mock("../../api/training", () => ({ trainingApi: { today: vi.fn(), journey: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org", userId: "student" } }) }));
it("shows the XP level panel with progress to the next level", async () => {
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture());
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyFixture());
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><StudentHomePage /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByRole("heading", { name: "Level 2" })).toBeInTheDocument();
  expect(screen.getByText("Seeker")).toBeInTheDocument();
  expect(screen.getByLabelText("120 experience points total")).toBeVisible();
  expect(screen.getByLabelText("Progress to the next level")).toBeVisible();
});

it("renders the daily quest board with progress and completed states", async () => {
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture({ quests: [questFixture(), questFixture({ key: "sharpshooter", title: "Sharpshooter", description: "Finish a session at 90%+", target: 1, progress: 1, completed: true })] }));
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyFixture());
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><StudentHomePage /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByRole("heading", { name: "Today’s bonus quests" })).toBeInTheDocument();
  expect(screen.getByText("Little extras — no penalty for skipping.")).toBeVisible();
  expect(screen.getByLabelText("Warm-up: quest progress")).toBeVisible();
  expect(screen.getByText("Done")).toBeInTheDocument();
});

it("hides the quest board when no quests are available", async () => {
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture({ quests: [] }));
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyFixture());
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><StudentHomePage /></MemoryRouter></QueryClientProvider>);
  await screen.findByRole("heading", { name: "Level 2" });
  expect(screen.queryByRole("heading", { name: "Today’s bonus quests" })).not.toBeInTheDocument();
});

it("shows the gentle streak nudge only when the streak is paused", async () => {
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyFixture());
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture({ streakNudge: true }));
  const { unmount } = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><StudentHomePage /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByTestId("streak-nudge")).toHaveTextContent("One missed day just pauses your streak");
  unmount();
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture({ streakNudge: false }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><StudentHomePage /></MemoryRouter></QueryClientProvider>);
  await screen.findByRole("heading", { name: "Level 2" });
  expect(screen.queryByTestId("streak-nudge")).not.toBeInTheDocument();
});
it("reports saved weekly and passage evidence without inventing readiness", async () => {
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture());
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyFixture());
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><StudentHomePage /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByRole("link", { name: "Continue review" })).toHaveAttribute("href", expect.stringContaining("seasonId=s"));
  expect(screen.getByLabelText("2 of 5 practice days")).toBeVisible();
  expect(await screen.findByText("1 of 2 assigned passages practiced · 0 Strong or Mastered")).toBeVisible();
  expect(screen.queryByText("72%")).not.toBeInTheDocument();
  expect(api.progress).not.toHaveBeenCalled();
});
