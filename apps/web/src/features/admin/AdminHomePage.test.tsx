import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Season, CoverageStudent } from "../../api/types";
import { AdminHomePage } from "./AdminHomePage";
vi.mock("../../api/client", () => ({ request: vi.fn().mockResolvedValue([]), api: { seasons: vi.fn(), coverage: vi.fn(), engagement: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org", organizationName: "Academy" } }) }));
const season = (id: string, status: string): Season => ({ id, organizationId: "org", name: id, status, yearLabel: "2026", ruleProfileKey: "PBE_STYLE_V1", ruleProfileVersion: 1, startDate: null, targetCompetitionDate: null, scopeUnitCount: 10, assignmentCount: 2 });
const student: CoverageStudent = { studentUserId: "u", displayName: "Daniel", userName: "daniel", assignmentType: "PrimarySpecialist", bookKey: "DAN", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 10, rangeCount: 1, otherRanges: [], eligibleUnitCount: 10, masteredCount: 7, reviewDueCount: 2, attemptCount: 12 };
function home() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><AdminHomePage /></MemoryRouter></QueryClientProvider>); }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.seasons).mockResolvedValue([season("draft", "Draft"), season("active", "Active")]); vi.mocked(api.coverage).mockResolvedValue({ seasonId: "active", seasonName: "active", seasonStatus: "Active", students: [student] }); });
it("defaults to the active season and shows real coverage", async () => {
  home(); expect(await screen.findByRole("table")).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Season" })).toHaveValue("active");
  expect(api.coverage).toHaveBeenCalledWith("org", "active");
  expect(screen.getByText("70%")).toBeInTheDocument(); expect(screen.getByText("2 due")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Daniel" })).toHaveAttribute("href", "/admin/seasons/active/students/u/progress");
});
it("loads the selected season independently", async () => {
  home(); await screen.findByRole("table");
  fireEvent.change(screen.getByRole("combobox", { name: "Season" }), { target: { value: "draft" } });
  await waitFor(() => expect(api.coverage).toHaveBeenCalledWith("org", "draft"));
  expect(screen.getByTestId("season-status-badge")).toHaveTextContent("Draft");
});
it("counts a student once even with multiple assignments", async () => {
  vi.mocked(api.coverage).mockResolvedValue({ seasonId: "active", seasonName: "active", seasonStatus: "Active", students: [student, { ...student, startChapter: 2 }] });
  home(); await screen.findByRole("table");
  expect(screen.getByText("Assigned students").parentElement).toHaveTextContent("1Assigned students");
  expect(screen.getByText("Need review").parentElement).toHaveTextContent("1Need review");
});
it("links the Need review stat card to the directory filtered to students who need review", async () => {
  home(); await screen.findByRole("table");
  expect(screen.getByRole("link", { name: /needs review — open the students who need review/ })).toHaveAttribute("href", "/admin/students?filter=review&seasonId=active");
});

it("links the attention items to their filtered student views", async () => {
  vi.mocked(api.coverage).mockResolvedValue({ seasonId: "active", seasonName: "active", seasonStatus: "Active", students: [student, { ...student, studentUserId: "v", displayName: "Ruth", attemptCount: 0, reviewDueCount: 0 }] });
  home(); await screen.findByRole("table");
  expect(screen.getByRole("link", { name: /passages due for review/ })).toHaveAttribute("href", "/admin/students?filter=review&seasonId=active");
  expect(screen.getByRole("link", { name: /hasn't started the assigned passage yet/ })).toHaveAttribute("href", "/admin/students?filter=not-started&seasonId=active");
});
it("labels a multi-range row with the first range plus the extra range count", async () => {
  vi.mocked(api.coverage).mockResolvedValue({ seasonId: "active", seasonName: "active", seasonStatus: "Active", students: [{ ...student, endVerse: 3, masteredCount: 3, rangeCount: 2, otherRanges: [{ bookKey: "DAN", startChapter: 2, startVerse: 1, endChapter: 2, endVerse: 2 }], eligibleUnitCount: 5 }] });
  home(); const table = await screen.findByRole("table");
  expect(within(table).getByText("DAN 1:1–3 and 1 more range")).toBeInTheDocument();
  expect(within(table).getByText("3 of 5 required verses")).toBeInTheDocument(); // the total spans both ranges, and the label now says so
});
it("joins the streak and last-practiced caption from the engagement payload", async () => {
  vi.mocked(api.coverage).mockResolvedValue({ seasonId: "active", seasonName: "active", seasonStatus: "Active", students: [student, { ...student, studentUserId: "v", displayName: "Ruth" }] });
  vi.mocked(api.engagement).mockResolvedValue([
    { studentId: "u", name: "Daniel", streak: 4, xpThisWeek: 40, practiceDaysThisWeek: 2, level: 2, levelName: "Seeker", honorsEarned: 0, lastActiveAtUtc: new Date().toISOString(), quests: { completedThisWeek: 1, totalThisWeek: 3, rate: 1 / 3 } },
    { studentId: "v", name: "Ruth", streak: 0, xpThisWeek: 0, practiceDaysThisWeek: 0, level: 1, levelName: "Seedling", honorsEarned: 0, lastActiveAtUtc: null, quests: { completedThisWeek: 0, totalThisWeek: 0, rate: 0 } },
  ]);
  home(); await screen.findByRole("table");
  expect(await screen.findByText("Streak 4 · practiced today")).toBeInTheDocument();
  expect(screen.getByText("No practice yet")).toBeInTheDocument();
});
it("shows no percentage for an empty scope", async () => {
  vi.mocked(api.coverage).mockResolvedValue({ seasonId: "active", seasonName: "active", seasonStatus: "Active", students: [{ ...student, eligibleUnitCount: 0, masteredCount: 0 }] });
  home(); const table = await screen.findByRole("table"); expect(within(table).getByText("—")).toBeInTheDocument(); expect(within(table).queryByRole("progressbar")).not.toBeInTheDocument();
});
it("preserves create-season access with an empty account", async () => {
  vi.mocked(api.seasons).mockResolvedValue([]); home();
  expect(await screen.findByText(/No seasons yet/)).toBeInTheDocument(); expect(screen.getByTestId("create-season")).toHaveAttribute("href", "/admin/seasons/new"); expect(api.coverage).not.toHaveBeenCalled();
});
it("does not render zero progress after a coverage failure", async () => {
  vi.mocked(api.coverage).mockRejectedValue(new Error("offline")); home();
  expect(await screen.findByRole("alert")).toHaveTextContent("could not load"); expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
it("counts a student once in the not-started attention item even with multiple unstarted assignments", async () => {
  vi.mocked(api.coverage).mockResolvedValue({ seasonId: "active", seasonName: "active", seasonStatus: "Active", students: [{ ...student, attemptCount: 0 }, { ...student, startChapter: 2, attemptCount: 0 }] });
  home(); await screen.findByRole("table");
  expect(await screen.findByText("1 student hasn't started the assigned passage yet.")).toBeInTheDocument();
  expect(screen.queryByText(/2 students haven't started/)).not.toBeInTheDocument();
});
