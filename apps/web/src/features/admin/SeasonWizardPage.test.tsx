import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
vi.mock("../../api/lifecycle", () => ({ lifecycleApi: { removeAssignment: vi.fn(), correctAssignment: vi.fn(), transitionSeason: vi.fn() } }));
import { SeasonAssignmentEditor, SeasonWizardPage } from "./SeasonWizardPage";

vi.mock("../../api/client", () => ({ api: { library: vi.fn(), contentPacks: vi.fn(), sourceUnits: vi.fn(), scriptureCatalog: vi.fn(), students: vi.fn(), season: vi.fn(), seasonScope: vi.fn(), assignments: vi.fn(), defineScope: vi.fn(), assign: vi.fn(), setDifficulty: vi.fn(), createSeason: vi.fn(), activate: vi.fn(), myAssignments: vi.fn(), assignMyself: vi.fn(), removeMyAssignment: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org-1", userId: "coach", displayName: "Coach", kind: "Adult", role: "Owner" } }) }));
const range = { bookKey: "DAN", startChapter: 2, startVerse: 1, endChapter: 2, endVerse: 8 };
const season = { id: "season-1", organizationId: "org-1", name: "Daniel 2026", yearLabel: "2026", status: "ContentReady", ruleProfileKey: "PBE_STYLE_V1", ruleProfileVersion: 1, startDate: null, targetCompetitionDate: null, scopeUnitCount: 8, assignmentCount: 0 };
const assignment = { id: "a1", studentUserId: "student-1", type: "PrimarySpecialist", ...range, difficulty: "Foundation" as const, studentDisplayName: "Daniel Student" };
function renderWizard(path = "/admin/seasons/season-1") {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter initialEntries={[path]}><Routes><Route path="/admin/seasons/new" element={<SeasonWizardPage />} /><Route path="/admin/seasons/:seasonId" element={<SeasonWizardPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.library).mockResolvedValue({ translationId: "nkjv", translationName: "New King James Version", version: 1, books: [{ contentPackId: "eph", bookKey: "EPH", name: "Ephesians", verseCount: 18, chapters: [1,2,3,4,5,6].map(number => ({ number, verses: [1,2,3] })) }, { contentPackId: "jude", bookKey: "JUD", name: "Jude", verseCount: 3, chapters: [{ number: 1, verses: [1,2,3] }] }] });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.mocked(api.sourceUnits).mockResolvedValue(["DAN", "JOS", "CUSTOM"].flatMap(bookKey => [2,3].flatMap(chapter => Array.from({ length: 8 }, (_, index) => ({ id: `${bookKey}-${chapter}-${index}`, bookKey, chapter, verse: index + 1, ordinal: index, citation: "Fixture", canonicalText: "Fixture verse" })))));
  vi.mocked(api.scriptureCatalog).mockResolvedValue({ translations: [], books: [{ bookKey: "DAN", name: "Daniel" }, { bookKey: "JOS", name: "Joshua" }] });
  vi.mocked(api.contentPacks).mockResolvedValue([{ id: "pack-1", packKey: "Daniel", version: 1, locale: "en", sourceType: "Scripture", licensingStatus: "Internal", unitCount: 8 }]);
  vi.mocked(api.students).mockResolvedValue([{ userId: "student-1", userName: "daniel", displayName: "Daniel Student", email: null }, { userId: "student-2", userName: "sarah", displayName: "Sarah Student", email: null }]);
  vi.mocked(api.season).mockResolvedValue(season);
  vi.mocked(api.seasonScope).mockResolvedValue({ contentPackId: "pack-1", includes: [range], excludes: [] });
  vi.mocked(api.assignments).mockResolvedValue([]);
  vi.mocked(api.myAssignments).mockResolvedValue([]);
  vi.mocked(api.assignMyself).mockImplementation(async (_org, _season, input) => ({ ...assignment, ...input.range, contentPackId: input.contentPackId, studentUserId: "coach", type: input.type, difficulty: input.difficulty ?? "Standard" }));
  vi.mocked(api.defineScope).mockResolvedValue(undefined);
  vi.mocked(api.assign).mockImplementation(async (_org, _season, input) => ({ ...assignment, id: `a-${input.range.startChapter}-${input.range.startVerse}`, ...input.range, contentPackId: input.contentPackId, studentUserId: input.studentUserId, type: input.type, difficulty: input.difficulty ?? "Standard" }));
  vi.mocked(api.setDifficulty).mockResolvedValue({ difficulty: "Advanced" });
  vi.mocked(api.createSeason).mockResolvedValue(season);
  vi.mocked(api.activate).mockResolvedValue({ activated: true, blockingProblems: [] });
});

describe("Two-step season planner", () => {
  it("creates a draft with whole books then allows assigning later", async () => {
    renderWizard("/admin/seasons/new");
    fireEvent.change(screen.getByLabelText("Season name"), { target: { value: "Autumn" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Ephesians/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save & assign students →" }));
    expect(await screen.findByRole("heading", { name: "Student assignments" })).toBeInTheDocument();
    expect(api.defineScope).toHaveBeenCalledWith("org-1", "season-1", expect.objectContaining({ packs: [expect.objectContaining({ contentPackId: "eph", includes: [{ bookKey: "EPH", startChapter: 1, startVerse: 1, endChapter: 6, endVerse: 3 }] })] }));
    expect(screen.getByRole("link", { name: "Skip for now" })).toHaveAttribute("href", "/admin/seasons");
    expect(api.activate).not.toHaveBeenCalled();
  });
  it("retains a created draft after scope save failure and retries without another season", async () => {
    vi.mocked(api.defineScope).mockRejectedValueOnce(new Error("Offline"));
    renderWizard("/admin/seasons/new");
    fireEvent.change(screen.getByLabelText("Season name"), { target: { value: "Autumn" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Ephesians/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save & assign students →" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
    fireEvent.click(screen.getByRole("button", { name: "Save & assign students →" }));
    await screen.findByRole("heading", { name: "Student assignments" });
    expect(api.createSeason).toHaveBeenCalledTimes(1);
  });
  it("saves a book and advances inside the persistent student roster", async () => {
    renderWizard("/admin/seasons/season-1?step=students&studentId=student-1");
    fireEvent.click(await screen.findByRole("checkbox", { name: /DAN/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save & next student →" }));
    expect(await screen.findByRole("heading", { name: "Sarah Student" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Daniel Student/ })).toBeInTheDocument();
    expect(api.assign).toHaveBeenCalledWith("org-1", "season-1", expect.objectContaining({ studentUserId: "student-1" }));
    expect(screen.getByRole("checkbox", { name: /DAN/ })).not.toBeChecked();
  });
  it("keeps selection and student on a failed save", async () => {
    vi.mocked(api.assign).mockRejectedValue(new Error("Offline"));
    renderWizard("/admin/seasons/season-1?step=students&studentId=student-1");
    fireEvent.click(await screen.findByRole("checkbox", { name: /DAN/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save & next student →" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
    expect(screen.getByRole("heading", { name: "Daniel Student" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /DAN/ })).toBeChecked();
  });
  it("uses personal assignments for the coach and links to that season in Student Mode", async () => {
    renderWizard("/admin/seasons/season-1?step=students&studentId=coach");
    fireEvent.click(await screen.findByRole("checkbox", { name: /DAN/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save assignments" }));
    expect(await screen.findByText("Assignments saved.")).toBeInTheDocument();
    expect(api.assignMyself).toHaveBeenCalledWith("org-1", "season-1", expect.objectContaining({ contentPackId: "pack-1" }));
    expect(api.assign).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Open Student Mode" })).toHaveAttribute("href", "/student?seasonId=season-1");
  });
  it("requires a confirmation to start and leaves active books read-only", async () => {
    vi.mocked(api.assignments).mockResolvedValue([assignment]);
    renderWizard("/admin/seasons/season-1?step=students");
    fireEvent.click(await screen.findByRole("button", { name: "Start season" }));
    expect(api.activate).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Start season" }));
    await waitFor(() => expect(api.activate).toHaveBeenCalled());
  });
  it("keeps archived seasons read-only", async () => {
    vi.mocked(api.season).mockResolvedValue({ ...season, status: "Archived" });
    renderWizard("/admin/seasons/season-1?step=students&studentId=student-1");
    expect(await screen.findByRole("checkbox", { name: /DAN/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Start season" })).not.toBeInTheDocument();
  });
  it("does not silently change an unavailable student", async () => {
    renderWizard("/admin/seasons/season-1?step=students&studentId=missing");
    expect(await screen.findByText(/This student is unavailable/)).toBeInTheDocument();
  });
  it("reuses the book editor without setup chrome from student management", async () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><SeasonAssignmentEditor seasonId="season-1" studentId="student-1" /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole("checkbox", { name: /DAN/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Season planner" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Start verse")).not.toBeInTheDocument();
  });
});

it("preserves unsaved season book selections until saved or cancelled", async () => {
  renderWizard("/admin/seasons/season-1?step=details");
  fireEvent.click(await screen.findByRole("checkbox", { name: /Ephesians/ }));
  expect(screen.getByRole("button", { name: "2 · Assignments" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
  expect(screen.getByRole("checkbox", { name: /Ephesians/ })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "2 · Assignments" })).toBeEnabled();
});
it("allows archiving a completed season", async () => {
  vi.mocked(api.season).mockResolvedValue({ ...season, status: "Completed" });
  renderWizard();
  fireEvent.click(await screen.findByRole("button", { name: "Archive season" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Archive season");
});
