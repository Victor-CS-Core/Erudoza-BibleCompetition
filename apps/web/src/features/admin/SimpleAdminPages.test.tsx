import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { lifecycleApi } from "../../api/lifecycle";
vi.mock("../../api/lifecycle", () => ({ lifecycleApi: { setStudentActive: vi.fn() } }));
import type { Season, SeasonCoverage } from "../../api/types";
import { AssignmentsPage, SeasonsListPage, StudentsPage } from "./SimpleAdminPages";
import { ToastProvider } from "../../components/ui";

vi.mock("../../api/client", () => ({ api: { seasons: vi.fn(), students: vi.fn(), coverage: vi.fn(), createStudent: vi.fn(), resetStudentPassword: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org-1" } }) }));
function season(id: string, name: string, status: string): Season {
  return { id, name, status, organizationId: "org-1", yearLabel: "2026", ruleProfileKey: "PBE_STYLE_V1", ruleProfileVersion: 1, startDate: null, targetCompetitionDate: null, scopeUnitCount: 4, assignmentCount: 2 };
}
const student = { userId: "student-1", userName: "daniel.student", displayName: "Daniel Student", email: null };
const coverage: SeasonCoverage = { seasonId: "active", seasonName: "Daniel", seasonStatus: "Active", students: [{ studentUserId: "student-1", displayName: "Daniel Student", userName: "daniel.student", assignmentType: "PrimarySpecialist", bookKey: "DAN", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 4, eligibleUnitCount: 4, masteredCount: 1, reviewDueCount: 0, attemptCount: 2 }] };
function Location() { return <output data-testid="location">{useLocation().search}</output>; }
/** Mimics the context nav links "Student directory" / "Add student". */
function HashJumper({ hash, label }: { hash: string; label: string }) {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate({ hash })}>{label}</button>;
}
function renderPage(ui: ReactNode, route = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}><ToastProvider>{ui}</ToastProvider><Location /></MemoryRouter></QueryClientProvider>);
}

describe("Coach directory pages", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
    vi.mocked(api.seasons).mockResolvedValue([season("draft", "Joshua", "Draft"), season("active", "Daniel", "Active")]);
    vi.mocked(api.students).mockResolvedValue([student]);
    vi.mocked(api.coverage).mockResolvedValue(coverage);
    vi.mocked(api.createStudent).mockResolvedValue(student);
    vi.mocked(api.resetStudentPassword).mockResolvedValue(undefined);
  });
  it("lists named seasons with actual counts and creation link", async () => {
    renderPage(<SeasonsListPage />);
    expect(await screen.findByRole("link", { name: /Joshua/ })).toHaveAttribute("href", "/admin/seasons/draft");
    expect(screen.getByRole("link", { name: /Joshua/ })).toHaveTextContent("4 verses · 2 assignments");
    expect(screen.queryByText(/PBE_STYLE/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create season" })).toHaveAttribute("href", "/admin/seasons/new");
  });
  it.each([true, false])("confirms student account state change from active=%s", async isActive => {
    vi.mocked(api.students).mockResolvedValue([{ ...student, isActive }]);
    vi.mocked(lifecycleApi.setStudentActive).mockResolvedValue(undefined);
    renderPage(<StudentsPage />);
    fireEvent.click(await screen.findByRole("button", { name: `${isActive ? "Deactivate" : "Reactivate"} Daniel Student` }));
    expect(lifecycleApi.setStudentActive).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: `${isActive ? "Deactivate" : "Reactivate"} student` }));
    await waitFor(() => expect(lifecycleApi.setStudentActive).toHaveBeenCalledWith("org-1", "student-1", !isActive));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("shows load errors and retries seasons", async () => {
    vi.mocked(api.seasons).mockRejectedValueOnce(new Error("offline"));
    renderPage(<SeasonsListPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load seasons");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: /Joshua/ })).toBeInTheDocument();
  });
  it("creates a student only with labeled valid details and clears the password", async () => {
    renderPage(<StudentsPage />);
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Add student" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "new.student" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "New Student" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "UniquePass!123" } });
    fireEvent.click(screen.getByRole("button", { name: "Add student" }));
    expect(await screen.findByText("Student added.")).toBeInTheDocument();
    expect(api.createStudent).toHaveBeenCalledWith("org-1", { userName: "new.student", displayName: "New Student", password: "UniquePass!123" });
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });
  it("disables duplicate creation while pending and reports failure", async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(api.createStudent).mockReturnValue(new Promise((_, fail) => { reject = fail; }));
    renderPage(<StudentsPage />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "name" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Name" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "LongPass123" } });
    fireEvent.click(screen.getByRole("button", { name: "Add student" }));
    expect(await screen.findByRole("button", { name: "Adding student…" })).toBeDisabled();
    reject(new Error("Username already exists."));
    expect(await screen.findByRole("alert")).toHaveTextContent("Username already exists.");
  });
  it("resets the chosen student's password", async () => {
    renderPage(<StudentsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Reset password for Daniel Student" }));
    fireEvent.change(screen.getByLabelText("New password for Daniel Student"), { target: { value: "ChangedPass123" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByText("Password updated.")).toBeInTheDocument();
    expect(api.resetStudentPassword).toHaveBeenCalledWith("org-1", "student-1", "ChangedPass123");
  });
  it("switches to the Directory tab when a hash link targets a directory panel", async () => {
    renderPage(<><HashJumper hash="#add-student" label="Add student" /><StudentsPage /></>);
    fireEvent.click(screen.getByRole("tab", { name: "Engagement" }));
    expect(screen.getByRole("tab", { name: "Engagement" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("heading", { name: "Add a student" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add student" }));
    expect(await screen.findByRole("heading", { name: "Add a student" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Directory" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("heading", { name: "Engagement" })).not.toBeInTheDocument();
  });
  it("reveals, scrolls to, and focuses the hash-targeted panel", async () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    try {
      renderPage(<><HashJumper hash="#student-directory" label="Student directory" /><StudentsPage /></>);
      fireEvent.click(screen.getByRole("tab", { name: "Engagement" }));
      fireEvent.click(screen.getByRole("button", { name: "Student directory" }));
      await waitFor(() => expect(document.activeElement).toHaveAttribute("id", "student-directory"));
      expect(scrollIntoView).toHaveBeenCalled();
    } finally {
      // @ts-expect-error restoring the jsdom default (no scrollIntoView)
      delete window.HTMLElement.prototype.scrollIntoView;
    }
  });
  it("honors and retains explicit season selection and deep links assignment management", async () => {
    renderPage(<AssignmentsPage />, "/admin/assignments?seasonId=draft");
    expect(await screen.findByTestId("coverage-table")).toHaveTextContent("Specialist");
    expect(api.coverage).toHaveBeenCalledWith("org-1", "draft");
    expect(screen.getByRole("link", { name: "Manage assignments for Daniel Student" })).toHaveAttribute("href", "/admin/assignments?seasonId=draft&studentId=student-1");
    fireEvent.change(screen.getByRole("combobox", { name: "Season" }), { target: { value: "active" } });
    await waitFor(() => expect(api.coverage).toHaveBeenCalledWith("org-1", "active"));
    expect(screen.getByTestId("location")).toHaveTextContent("seasonId=active");
  });
  it("gives unassigned seasons a visible next step", async () => {
    vi.mocked(api.coverage).mockResolvedValue({ ...coverage, students: [] });
    renderPage(<AssignmentsPage />);
    expect(await screen.findByText(/No assigned students yet/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Student" })).toHaveValue("");
    expect(screen.getByRole("option", { name: /Daniel Student/ })).toBeInTheDocument();
  });
  it("handles no seasons without requesting coverage", async () => {
    vi.mocked(api.seasons).mockResolvedValue([]);
    renderPage(<AssignmentsPage />);
    expect(await screen.findByText("No seasons yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create season" })).toBeInTheDocument();
    expect(api.coverage).not.toHaveBeenCalled();
  });
  it("does not silently substitute an unavailable season", async () => {
    renderPage(<AssignmentsPage />, "/admin/assignments?seasonId=missing");
    expect(await screen.findByRole("alert")).toHaveTextContent("This season is unavailable");
    expect(api.coverage).not.toHaveBeenCalled();
  });
  it("shows a coverage error with retry instead of empty success", async () => {
    vi.mocked(api.coverage).mockRejectedValue(new Error("offline"));
    renderPage(<AssignmentsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load assignments");
    expect(screen.queryByText(/No assigned students/)).not.toBeInTheDocument();
  });
});
