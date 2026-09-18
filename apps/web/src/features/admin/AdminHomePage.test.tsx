import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Season, CoverageStudent } from "../../api/types";
import { AdminHomePage } from "./AdminHomePage";
vi.mock("../../api/client", () => ({ request: vi.fn().mockResolvedValue([]), api: { seasons: vi.fn(), coverage: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org", organizationName: "Academy" } }) }));
const season = (id: string, status: string): Season => ({ id, organizationId: "org", name: id, status, yearLabel: "2026", ruleProfileKey: "PBE_STYLE_V1", ruleProfileVersion: 1, startDate: null, targetCompetitionDate: null, scopeUnitCount: 10, assignmentCount: 2 });
const student: CoverageStudent = { studentUserId: "u", displayName: "Daniel", userName: "daniel", assignmentType: "PrimarySpecialist", bookKey: "DAN", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 10, eligibleUnitCount: 10, masteredCount: 7, reviewDueCount: 2, attemptCount: 12 };
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
it("links the Need review stat card to the student directory", async () => {
  home(); await screen.findByRole("table");
  expect(screen.getByRole("link", { name: /needs review — open the student directory/ })).toHaveAttribute("href", "/admin/students");
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
