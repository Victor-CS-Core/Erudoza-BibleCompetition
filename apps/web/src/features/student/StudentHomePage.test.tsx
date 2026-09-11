import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Progress } from "../../api/types";
import { StudentHomePage } from "./StudentHomePage";
vi.mock("../../api/client", () => ({ api: { progress: vi.fn(), assignedSeasons: vi.fn() } }));
const progress = (overrides: Partial<Progress> = {}): Progress => ({ seasonId: "s", seasonName: "Daniel 2026", seasonStatus: "Active", assignments: [{ id: "a", studentUserId: "u", type: "PrimarySpecialist", bookKey: "DAN", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 4 }], masteredCount: 4, reviewDueCount: 3, attemptCount: 8, mastery: [], ...overrides });
function home() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><StudentHomePage /></MemoryRouter></QueryClientProvider>); }
beforeEach(() => { vi.mocked(api.progress).mockResolvedValue(progress()); vi.mocked(api.assignedSeasons).mockResolvedValue([]); });
it("links each available training mode directly", async () => {
  home();
  expect(await screen.findByRole("link", { name: /Continue study/ })).toHaveAttribute("href", "/student/study");
  expect(screen.getByRole("link", { name: "Start due reviews" })).toHaveAttribute("href", "/student/study?mode=Review");
  expect(screen.getByRole("link", { name: "Start rehearsal" })).toHaveAttribute("href", "/student/study?mode=Simulation");
});
it("gates all training links on draft seasons even with due reviews", async () => {
  vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Draft" })); home();
  expect(await screen.findByTestId("academy-track-unavailable")).toHaveTextContent("opens when this season is Active");
  for (const id of ["start-todays-deck", "start-reviews", "start-simulation"]) expect(screen.queryByTestId(id)).not.toBeInTheDocument();
});
it("does not offer due reviews when nothing is due", async () => {
  vi.mocked(api.progress).mockResolvedValue(progress({ reviewDueCount: 0 })); home();
  expect(await screen.findByText("Up to date")).toBeInTheDocument();
  expect(screen.queryByTestId("start-reviews")).not.toBeInTheDocument();
});
it("explains an unassigned student without inventing a passage", async () => {
  vi.mocked(api.progress).mockResolvedValue(progress({ assignments: [] })); home();
  expect(await screen.findByText("Your coach will add your study assignment here.")).toBeInTheDocument();
  expect(screen.queryByTestId("start-todays-deck")).not.toBeInTheDocument();
});
it("shows a recoverable API error instead of zero progress", async () => {
  vi.mocked(api.progress).mockRejectedValueOnce(new Error("offline")); home();
  expect(await screen.findByRole("alert")).toHaveTextContent("could not load");
  expect(screen.queryByTestId("mastered-count")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByTestId("mastered-count")).toHaveTextContent("4");
});

it("selects an assigned active season and carries it into study", async () => {
  vi.mocked(api.assignedSeasons).mockResolvedValue([{ id: "s", name: "Daniel 2026" }, { id: "other", name: "Joshua" }]);
  vi.mocked(api.progress).mockImplementation(async (seasonId) => progress({ seasonId: seasonId ?? "s", seasonName: seasonId === "other" ? "Joshua" : "Daniel 2026" }));
  home();
  fireEvent.change(await screen.findByLabelText("Assigned season"), { target: { value: "other" } });
  expect(await screen.findByText("Joshua", { selector: "strong" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Continue study/ })).toHaveAttribute("href", "/student/study?seasonId=other");
});

vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org", userId: "student" } }) }));
