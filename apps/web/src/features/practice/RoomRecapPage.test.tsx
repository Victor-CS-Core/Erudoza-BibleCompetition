import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { practiceApi } from "../../api/practice";
import type { RoomRecap } from "../../api/practice";
import { RoomRecapPage } from "./RoomRecapPage";
vi.mock("../../api/practice", () => ({ practiceApi: { roomRecap: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org", userId: "student" } }) }));
const roomRecapFixture = (overrides: Partial<RoomRecap> = {}): RoomRecap => ({
  roomId: "room-1", seasonId: "s", format: "Pbe", status: "Completed",
  completedAtUtc: "2026-09-11T14:00:00Z", teamCount: 2, simulation: false, questionCount: 10,
  myTeam: 1,
  teamScore: { accuracyHundredths: 1800, speedHundredths: 0, availableHundredths: 2000 },
  contributions: { questionsAnswered: 4, accuracyHundredths: 700 },
  xp: { earned: 40, tracked: true },
  dayCredited: true,
  questsCompleted: [{ key: "teammate", title: "Teammate" }],
  awards: [{ key: "first-fellowship", title: "First Fellowship" }],
  ...overrides,
});
function page() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={["/student/practice/rooms/room-1/recap"]}><Routes><Route path="/student/practice/rooms/:roomId/recap" element={<RoomRecapPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { vi.mocked(practiceApi.roomRecap).mockResolvedValue(roomRecapFixture()); });
it("shows the room result, team score, contributions, XP, and day credit", async () => {
  page();
  expect(await screen.findByRole("heading", { name: "Match complete." })).toBeInTheDocument();
  expect(screen.getByText("PBE team practice · Completed")).toBeInTheDocument();
  expect(screen.getByText("Team 1")).toBeInTheDocument();
  expect(screen.getByText("18 points")).toBeInTheDocument();
  expect(screen.getByText("4 of 10 questions")).toBeInTheDocument();
  expect(screen.getByText("+40")).toBeInTheDocument();
  expect(screen.getByText("Practice day credited.")).toBeInTheDocument();
  expect(screen.getByText("First Fellowship")).toBeInTheDocument();
  expect(practiceApi.roomRecap).toHaveBeenCalledWith("org", "room-1");
});
it("celebrates completed quests with their XP reward and shares them", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  page();
  expect(await screen.findByText("Quest complete: Teammate!")).toBeInTheDocument();
  expect(screen.getByText("+25 XP")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Share your progress" }));
  expect(await screen.findByRole("button", { name: "Copied to clipboard" })).toBeInTheDocument();
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Completed quests: Teammate (+25 XP)"));
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Team 1 scored 18 points"));
});
it("labels full-event team rehearsals and their Simulation honor path", async () => {
  vi.mocked(practiceApi.roomRecap).mockResolvedValue(roomRecapFixture({ simulation: true, questsCompleted: [] }));
  page();
  expect(await screen.findByText("Full-event team rehearsal · Completed")).toBeInTheDocument();
  expect(screen.getByText(/counts toward Simulation honors/)).toBeInTheDocument();
});
it("is honest when the room predates XP tracking", async () => {
  vi.mocked(practiceApi.roomRecap).mockResolvedValue(roomRecapFixture({ xp: { earned: null, tracked: false }, dayCredited: false, questsCompleted: [] }));
  page();
  expect(await screen.findByText("Not tracked")).toBeInTheDocument();
  expect(screen.getByText(/played before room XP tracking/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Share your progress" })).not.toBeInTheDocument();
});
it("shows arcade speed bonus separately from accuracy", async () => {
  vi.mocked(practiceApi.roomRecap).mockResolvedValue(roomRecapFixture({ format: "Arcade", teamScore: { accuracyHundredths: 1600, speedHundredths: 300, availableHundredths: 2000 }, questsCompleted: [] }));
  page();
  expect(await screen.findByText(/16 points/)).toHaveTextContent("16 points (+3 speed bonus)");
});
it("missing and denied recaps have safe recovery", async () => {
  vi.mocked(practiceApi.roomRecap).mockRejectedValue(new Error("not found"));
  page();
  expect(await screen.findByRole("alert")).toHaveTextContent("unavailable or you do not have access");
  expect(screen.getByRole("link", { name: "Back to Team Practice" })).toBeInTheDocument();
});
it("incomplete rooms explain that the recap comes after completion", async () => {
  const { ApiError } = await import("../../api/client");
  vi.mocked(practiceApi.roomRecap).mockRejectedValue(new ApiError("Incomplete", 409));
  page();
  expect(await screen.findByRole("heading", { name: "This room has not completed yet" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open room" })).toHaveAttribute("href", "/student/practice/room-1");
});
