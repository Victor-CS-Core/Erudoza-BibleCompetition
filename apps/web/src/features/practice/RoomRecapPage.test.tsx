import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { practiceApi } from "../../api/practice";
import type { PracticeRoom, RoomRecap } from "../../api/practice";
import { RoomRecapPage, recapFinality } from "./RoomRecapPage";
vi.mock("../../api/practice", () => ({ practiceApi: { roomRecap: vi.fn(), room: vi.fn() } }));
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
const roomFixture = (overrides: Partial<PracticeRoom> = {}): PracticeRoom => ({ status: "Completed", provisional: false, pendingCount: 0, ...overrides } as unknown as PracticeRoom);
function page() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={["/student/practice/rooms/room-1/recap"]}><Routes><Route path="/student/practice/rooms/:roomId/recap" element={<RoomRecapPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.mocked(practiceApi.roomRecap).mockResolvedValue(roomRecapFixture());
  // The finality-only room read is absent by default: finality derives from the recap alone.
  vi.mocked(practiceApi.room).mockRejectedValue(new Error("room unavailable"));
});
it("shows the room result, team score, contributions, XP, and day credit", async () => {
  page();
  expect(await screen.findByRole("heading", { name: "Match complete." })).toBeInTheDocument();
  expect(screen.getByText("PBE team practice · Completed")).toBeInTheDocument();
  expect(screen.getByText("Team 1")).toBeInTheDocument();
  expect(screen.getByText("18 points")).toBeInTheDocument();
  expect(screen.getByText("20 points")).toBeInTheDocument();
  expect(screen.getByText("4 of 10 questions")).toBeInTheDocument();
  expect(screen.getByText("+40")).toBeInTheDocument();
  expect(screen.getByText("Practice day credited.")).toBeInTheDocument();
  expect(screen.getByText("First Fellowship")).toBeInTheDocument();
  expect(practiceApi.roomRecap).toHaveBeenCalledWith("org", "room-1");
});
it("leads with the Finalized state once the result is final", async () => {
  page();
  expect(await screen.findByText("Finalized")).toBeInTheDocument();
  expect(screen.getByText("This result is final.")).toBeInTheDocument();
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
it("shows the Arcade speed bonus as its own group, separate from accuracy", async () => {
  vi.mocked(practiceApi.roomRecap).mockResolvedValue(roomRecapFixture({ format: "Arcade", teamScore: { accuracyHundredths: 1600, speedHundredths: 300, availableHundredths: 2000 }, questsCompleted: [] }));
  page();
  expect(await screen.findByText("Speed bonus")).toBeInTheDocument();
  expect(screen.getByText("16 points")).toBeInTheDocument();
  expect(screen.getByText("+3 points")).toBeInTheDocument();
});
it("never shows a speed bonus for PBE, even if the payload carried one", async () => {
  vi.mocked(practiceApi.roomRecap).mockResolvedValue(roomRecapFixture({ format: "Pbe", teamScore: { accuracyHundredths: 1800, speedHundredths: 300, availableHundredths: 2000 }, questsCompleted: [] }));
  page();
  expect(await screen.findByText("Finalized")).toBeInTheDocument();
  expect(screen.queryByText("Speed bonus")).not.toBeInTheDocument();
});
it("keeps rewards provisional while a coach review is pending — no celebration, no share", async () => {
  vi.mocked(practiceApi.room).mockResolvedValue(roomFixture({ provisional: true, pendingCount: 2 }));
  page();
  expect(await screen.findByText("Review pending")).toBeInTheDocument();
  expect(screen.getByText(/2 answers are awaiting coach review/)).toBeInTheDocument();
  expect(screen.getByText(/stay provisional until every review is resolved/)).toBeInTheDocument();
  // The recorded quest is listed plainly, not celebrated as final, and nothing is shareable yet.
  expect(screen.getByText("Quest complete: Teammate")).toBeInTheDocument();
  expect(screen.queryByText("Quest complete: Teammate!")).not.toBeInTheDocument();
  expect(screen.getByText(/Rewards from this room can change while reviews are open/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Share your progress" })).not.toBeInTheDocument();
  expect(screen.getByText("+40")).toBeInTheDocument();
});
it("shows an interrupted room's finality with no XP presentation and one next action", async () => {
  const { ApiError } = await import("../../api/client");
  vi.mocked(practiceApi.roomRecap).mockRejectedValue(new ApiError("Incomplete", 409));
  vi.mocked(practiceApi.room).mockResolvedValue(roomFixture({ status: "Interrupted", interruptionReason: "UnarmedReserveUnavailable" }));
  page();
  expect(await screen.findByRole("heading", { name: "This match was interrupted." })).toBeInTheDocument();
  expect(screen.getByText("Interrupted")).toBeInTheDocument();
  expect(screen.getByText(/no verified reserve question was available/)).toBeInTheDocument();
  expect(screen.getByText(/recorded no XP, quest, or day credit/)).toBeInTheDocument();
  expect(screen.queryByText("XP earned")).not.toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "Back to Team Practice" }).length).toBeGreaterThan(0);
  expect(screen.queryByRole("link", { name: "Review answers" })).not.toBeInTheDocument();
});
it("shows an abandoned room as Incomplete with no rewards", async () => {
  const { ApiError } = await import("../../api/client");
  vi.mocked(practiceApi.roomRecap).mockRejectedValue(new ApiError("Incomplete", 409));
  vi.mocked(practiceApi.room).mockResolvedValue(roomFixture({ status: "Abandoned" }));
  page();
  expect(await screen.findByRole("heading", { name: "This match ended early." })).toBeInTheDocument();
  expect(screen.getByText("Incomplete")).toBeInTheDocument();
  expect(screen.getByText(/Incomplete matches do not grant completion honors/)).toBeInTheDocument();
  expect(screen.queryByText("XP earned")).not.toBeInTheDocument();
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

it("offers Review answers on the room page — the onward path, not a dead end", async () => {
  page();
  expect(await screen.findByRole("link", { name: "Review answers" })).toHaveAttribute("href", "/student/practice/room-1?seasonId=s");
  // Exactly one next action closes the recap; the header back link is page chrome.
  expect(screen.getAllByRole("link", { name: "Review answers" })).toHaveLength(1);
  expect(screen.getAllByRole("link", { name: "Back to Team Practice" })).toHaveLength(1);
});

describe("recapFinality derivation", () => {
  it("maps the recap status and the room projection's pending signals", () => {
    expect(recapFinality({ status: "Completed" }, null)).toBe("finalized");
    expect(recapFinality({ status: "Completed" }, { provisional: true, pendingCount: 0 })).toBe("review-pending");
    expect(recapFinality({ status: "Completed" }, { provisional: false, pendingCount: 1 })).toBe("review-pending");
    expect(recapFinality({ status: "Completed" }, { provisional: false, pendingCount: 0 })).toBe("finalized");
    expect(recapFinality({ status: "Interrupted" }, null)).toBe("interrupted");
    expect(recapFinality({ status: "Abandoned" }, null)).toBe("incomplete");
  });
});
