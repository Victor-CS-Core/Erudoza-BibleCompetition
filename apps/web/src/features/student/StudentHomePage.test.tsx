import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { trainingApi } from "../../api/training";
import { StudentHomePage } from "./StudentHomePage";
import { todayFixture, journeyFixture } from "./trainingFixtures";
vi.mock("../../api/client", () => ({ api: { progress: vi.fn(), assignedSeasons: vi.fn() } }));
vi.mock("../../api/training", () => ({ trainingApi: { today: vi.fn(), journey: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org", userId: "student" } }) }));
function home() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><StudentHomePage /></MemoryRouter></QueryClientProvider>); }
beforeEach(() => { vi.mocked(trainingApi.journey).mockResolvedValue(journeyFixture()); vi.mocked(trainingApi.today).mockResolvedValue(todayFixture()); vi.mocked(api.assignedSeasons).mockResolvedValue([{ id: "s", name: "Daniel" }, { id: "other", name: "Joshua" }]); });
it("uses bounded today and carries frozen mission and selected season into review", async () => { home(); expect(await screen.findByRole("link", { name: "Continue review" })).toHaveAttribute("href", "/student/study?mode=Review&sessionId=r&step=Review&missionId=m&missionRevision=3&seasonId=s"); expect(api.progress).not.toHaveBeenCalled(); expect(screen.getByText("2 of 4 passages completed")).toBeInTheDocument(); expect(screen.getByRole("link", { name: "Team Practice" })).toHaveAttribute("href", "/student/practice?seasonId=s"); });
it("invalidated missions explain scope changes and do not start study", async () => { const data = todayFixture(); vi.mocked(trainingApi.today).mockResolvedValue({ ...data, mission: { ...data.mission, status: "Invalidated" } }); home(); expect(await screen.findByTestId("academy-track-unavailable")).toHaveTextContent("assignment changed"); expect(screen.queryByTestId("start-todays-deck")).not.toBeInTheDocument(); });
it("unassigned students receive honest recovery", async () => { vi.mocked(trainingApi.today).mockResolvedValue(todayFixture({ seasonId: null, seasonStatus: "None", mission: { id: null, revision: null, status: "Unavailable", scopeVersion: null, explanation: null, steps: [] }, nextAction: null })); home(); expect(await screen.findByText("Your coach will add your study assignment here.")).toBeInTheDocument(); });
it("retries failures without showing zero progress", async () => { vi.mocked(trainingApi.today).mockRejectedValueOnce(new Error("offline")); home(); expect(await screen.findByRole("alert")).toHaveTextContent("could not load"); fireEvent.click(screen.getByRole("button", { name: "Try again" })); expect(await screen.findByRole("link", { name: "Continue review" })).toBeInTheDocument(); });
it("switches the bounded request and retained season", async () => { vi.mocked(trainingApi.today).mockImplementation(async id => todayFixture({ seasonId: id ?? "s" })); home(); fireEvent.change(await screen.findByLabelText("Assigned season"), { target: { value: "other" } }); expect(await screen.findByRole("link", { name: "Continue review" })).toHaveAttribute("href", expect.stringContaining("seasonId=other")); });

it("starts an updated invalidated mission without stale identifiers", async () => { const data = todayFixture(); vi.mocked(trainingApi.today).mockResolvedValue({ ...data, mission: { ...data.mission, status: "Invalidated" } }); home(); const action = await screen.findByRole("link", { name: "Start updated training" }); expect(action).toHaveAttribute("href", "/student/study?mode=Review&step=Review&seasonId=s"); });
it("completed missions link their saved recap without a next action", async () => { const data = todayFixture(); vi.mocked(trainingApi.today).mockResolvedValue({ ...data, nextAction: null, mission: { ...data.mission, status: "Complete", steps: [{ kind: "Review", target: 4, completed: 4, status: "Complete", sessionId: "review-done" }, { kind: "Practice", target: 8, completed: 8, status: "Complete", sessionId: "practice-done" }] } }); home(); expect(await screen.findByRole("link", { name: "See today’s recap" })).toHaveAttribute("href", "/student/sessions/practice-done/recap?seasonId=s"); });

it("counts an unneeded review as resolved without inventing completed practice", async () => {
  const data = todayFixture();
  data.mission.steps[0] = { kind: "Review", target: 0, completed: 0, status: "NotNeeded", sessionId: null };
  data.nextAction = { label: "Start daily drill", mode: "Practice", sessionId: null };
  vi.mocked(trainingApi.today).mockResolvedValue(data);
  home();
  const progress = await screen.findByRole("progressbar", { name: "Today's training steps" });
  expect(progress).toHaveAttribute("value", "1");
  expect(progress).toHaveAttribute("max", "2");
  expect(screen.getByText("No review needed today")).toBeInTheDocument();
  expect(screen.getByText("0 of 8 cards completed")).toBeInTheDocument();
});

it("labels effort-based sidebar progress as a milestone", async () => {
  home(); expect(await screen.findByRole("heading", { name: "Your next milestone" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Your next Honor" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Explore mastery Honors" })).toHaveAttribute("href", "/student/honors?seasonId=s");
});

it("disables the PBE rehearsal entry until timed presentation is implemented", async () => {
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture({ format: "Pbe" }));
  home();
  expect(await screen.findByTestId("start-simulation")).toBeDisabled();
  expect(screen.queryByRole("link", { name: "Start rehearsal" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Practice another drill" })).toHaveAttribute("href", expect.stringContaining("format=Pbe"));
});

it("offers the saved PBE mission resume action after its published bank becomes unavailable", async () => {
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture({
    format: "Pbe",
    mission: { id: "frozen", revision: 1, status: "Active", scopeVersion: "unchanged", explanation: null, steps: [{ kind: "Practice", target: 2, completed: 0, status: "Active", sessionId: "frozen" }] },
    nextAction: { label: "Resume PBE practice", mode: "Practice", sessionId: "frozen" },
  }));
  home();
  expect(await screen.findByTestId("start-todays-deck")).toHaveAttribute("href", "/student/study?mode=Practice&format=Pbe&sessionId=frozen&step=Practice&missionId=frozen&missionRevision=1&seasonId=s");
  expect(screen.queryByTestId("academy-track-unavailable")).not.toBeInTheDocument();
});
