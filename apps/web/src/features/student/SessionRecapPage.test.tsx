import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { pbeDisputeApi } from "../../api/practice";
import { trainingApi } from "../../api/training";
import { SessionRecapPage } from "./SessionRecapPage";
import { recapFixture } from "./trainingFixtures";
vi.mock("../../api/practice", () => ({ pbeDisputeApi: { flag: vi.fn() } }));
vi.mock("../../api/training", () => ({ trainingApi: { recap: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org", userId: "student" } }) }));
function page() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={["/student/sessions/session/recap"]}><Routes><Route path="/student/sessions/:sessionId/recap" element={<SessionRecapPage />} /></Routes></MemoryRouter></QueryClientProvider>); }
beforeEach(() => { vi.mocked(trainingApi.recap).mockResolvedValue(recapFixture()); });
it("loads persisted recap without route state and explains interleaved evidence and date crossing", async () => { page(); expect(await screen.findByText(/6 correct from 8/)).toBeInTheDocument(); expect(trainingApi.recap).toHaveBeenCalledWith("session"); expect(screen.getByText(/Mission date: 2026-09-10/)).toBeInTheDocument(); expect(screen.getByText("+5 contributed")).toBeInTheDocument(); fireEvent.click(screen.getByText("View saved answer evidence")); expect(screen.getByText("20 → 25")).toBeInTheDocument(); expect(screen.queryByText("Honors earned in this session")).not.toBeInTheDocument(); });
it("legacy counts never claim skill improvement", async () => { vi.mocked(trainingApi.recap).mockResolvedValue(recapFixture({ version: "legacy-counts" })); page(); expect(await screen.findByText(/saved counts only/)).toBeInTheDocument(); expect(screen.queryByText("+5 contributed")).not.toBeInTheDocument(); });
it("incomplete sessions offer resume with saved season", async () => { vi.mocked(trainingApi.recap).mockResolvedValue(recapFixture({ completedAtUtc: null })); page(); expect(await screen.findByRole("link", { name: "Resume session" })).toHaveAttribute("href", "/student/study?sessionId=session&mode=Practice&seasonId=s"); });
it("shows accepted partial points and independent restart for an interrupted rehearsal",async()=>{vi.mocked(trainingApi.recap).mockResolvedValue(recapFixture({mode:"Simulation",completedAtUtc:null,attempted:1,correct:0,interrupted:true,results:[{attemptId:"a",earnedPoints:1,availablePoints:2,acceptedAtUtc:"2026-09-12T00:00:00Z"}]}));page();expect(await screen.findByText("1 / 2 points")).toBeVisible();expect(screen.getByRole("link",{name:"Start another shortened timed practice"})).toHaveAttribute("href","/student/study?mode=Simulation&format=Pbe&seasonId=s");});
it("missing and denied recap has safe recovery", async () => { vi.mocked(trainingApi.recap).mockRejectedValue(new Error("not found")); page(); expect(await screen.findByRole("alert")).toHaveTextContent("unavailable or you do not have access"); expect(screen.getByRole("link", { name: "Back to training" })).toBeInTheDocument(); });

it("conflict from incomplete persisted session offers resume", async () => { const { ApiError } = await import("../../api/client"); vi.mocked(trainingApi.recap).mockRejectedValue(new ApiError("Incomplete", 409)); page(); expect(await screen.findByRole("link", { name: "Resume session" })).toHaveAttribute("href", "/student/study?sessionId=session"); });
it("an early frozen review can still have an actual credited day", async () => { vi.mocked(trainingApi.recap).mockResolvedValue(recapFixture({ fullTargetReached: false, attempted: 3, targetCardCount: 8, newlyCreditedDay: true })); page(); expect(await screen.findByText("Practice day credited: 2026-09-11.")).toBeInTheDocument(); expect(screen.queryByText(/did not reach the full target for a practice day/)).not.toBeInTheDocument(); });

it("keeps a frozen earlier award as a milestone without granting a profile unlock", async () => {
  const { honorFixture } = await import("./trainingFixtures");
  vi.mocked(trainingApi.recap).mockResolvedValue(recapFixture({ earnedBadges: [honorFixture({ earnedAtUtc: "2026-09-11T12:00:00Z" })] }));
  page(); expect(await screen.findByText("Milestone recorded")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Exact Recall" })).toBeInTheDocument();
  expect(screen.queryByText("Honor earned")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Use .*profile image/ })).not.toBeInTheDocument();
});

it("flags a saved PBE attempt without blocking replay and refreshes corrected recap scores", async () => {
  const result = { attemptId: "accepted", questionId: "question", earnedPoints: 1, originalEarnedPoints: 1, availablePoints: 2, acceptedAtUtc: "2026-09-12T00:00:00Z" };
  vi.mocked(trainingApi.recap).mockResolvedValue(recapFixture({ version: "pbe-daily-v2", results: [result], attempted: 1, correct: 0 }));
  vi.mocked(pbeDisputeApi.flag).mockResolvedValue({ id: "Solo:session:accepted", status: "Pending", revision: 1 } as never);
  page(); fireEvent.click(await screen.findByRole("button", { name: "Flag answer" }));
  fireEvent.change(screen.getByLabelText("Reason for review"), { target: { value: "The labels are both supported" } });
  fireEvent.click(screen.getByRole("button", { name: "Request coach review" }));
  expect(await screen.findByText("Review pending")).toBeVisible();
  expect(pbeDisputeApi.flag).toHaveBeenCalledWith({ activity: "Solo", sessionId: "session", attemptId: "accepted", reason: "The labels are both supported" });
  expect(screen.getByRole("link", { name: "Practice again" })).toBeVisible();
  vi.mocked(trainingApi.recap).mockResolvedValue(recapFixture({ version: "pbe-daily-v2", results: [{ ...result, earnedPoints: 2, dispute: { id: "Solo:session:accepted", status: "Resolved", revision: 2, questionId: "question", questionVersion: 1, pointsByPart: [1,1] } }], attempted: 1, correct: 1, pendingCount: 0, provisional: false, finalizedEarnedPoints: 2, finalizedAvailablePoints: 2 }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh reviewed scores" }));
  expect(await screen.findByText("2 / 2 points")).toBeVisible();
  expect(screen.getByText("Review resolved")).toBeVisible();
});
