import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { trainingApi } from "../../api/training";
import { StudentHomePage } from "./StudentHomePage";
import { todayFixture, journeyFixture } from "./trainingFixtures";

vi.mock("../../api/client", () => ({ api: { assignedSeasons: vi.fn().mockResolvedValue([]), progress: vi.fn() } }));
vi.mock("../../api/training", () => ({ trainingApi: { today: vi.fn(), journey: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org", userId: "student" } }) }));
it("reports saved weekly and passage evidence without inventing readiness", async () => {
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture());
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyFixture());
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><StudentHomePage /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByRole("link", { name: "Continue review" })).toHaveAttribute("href", expect.stringContaining("seasonId=s"));
  expect(screen.getByText("2 of 5 practice days")).toBeVisible();
  expect(await screen.findByText("1 of 2 assigned passages practiced · 0 Strong or Mastered")).toBeVisible();
  expect(screen.queryByText("72%")).not.toBeInTheDocument();
  expect(api.progress).not.toHaveBeenCalled();
});
