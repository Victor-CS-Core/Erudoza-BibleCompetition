import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { lifecycleApi } from "../../api/lifecycle";
vi.mock("../../api/lifecycle", () => ({ lifecycleApi: { removeAssignment: vi.fn(), correctAssignment: vi.fn(), transitionSeason: vi.fn() } }));
import { SeasonAssignmentEditor, SeasonWizardPage } from "./SeasonWizardPage";

vi.mock("../../api/client", () => ({ api: { library: vi.fn(), contentPacks: vi.fn(), sourceUnits: vi.fn(), scriptureCatalog: vi.fn(), students: vi.fn(), season: vi.fn(), seasonScope: vi.fn(), assignments: vi.fn(), defineScope: vi.fn(), assign: vi.fn(), setDifficulty: vi.fn(), createSeason: vi.fn(), activate: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org-1" } }) }));
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
  vi.mocked(api.defineScope).mockResolvedValue(undefined);
  vi.mocked(api.assign).mockResolvedValue(assignment);
  vi.mocked(api.setDifficulty).mockResolvedValue({ difficulty: "Advanced" });
  vi.mocked(api.createSeason).mockResolvedValue(season);
  vi.mocked(api.activate).mockResolvedValue({ activated: true, blockingProblems: [] });
});
describe("Guided season setup", () => {
  it("confirms removal and keeps failed removal in the dialog", async () => {
    vi.mocked(api.assignments).mockResolvedValue([assignment]);
    vi.mocked(lifecycleApi.removeAssignment).mockRejectedValue(new Error("Please retry"));
    renderWizard("/admin/seasons/season-1?step=students&studentId=student-1");
    fireEvent.click(await screen.findByRole("button", { name: /Remove assignment DAN/ }));
    expect(lifecycleApi.removeAssignment).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Previous attempts and progress are preserved");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove assignment" }));
    await waitFor(() => expect(lifecycleApi.removeAssignment).toHaveBeenCalledWith("org-1", "season-1", "a1"));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Please retry");
  });
  it("corrects a saved range after confirmation", async () => {
    vi.mocked(api.assignments).mockResolvedValue([assignment]);
    vi.mocked(lifecycleApi.correctAssignment).mockResolvedValue(undefined);
    renderWizard("/admin/seasons/season-1?step=students&studentId=student-1");
    fireEvent.click(await screen.findByRole("button", { name: /Correct passage DAN/ }));
    fireEvent.change(screen.getByTestId("correct-start"), { target: { value: "3" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save corrected passage" }));
    await waitFor(() => expect(lifecycleApi.correctAssignment).toHaveBeenCalledWith("org-1", "season-1", "a1", expect.objectContaining({ startVerse: 3 })));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("allows cancellation before closing and confirms archive", async () => {
    vi.mocked(api.season).mockResolvedValue({ ...season, status: "Active" });
    vi.mocked(lifecycleApi.transitionSeason).mockResolvedValue(undefined);
    renderWizard();
    fireEvent.click(await screen.findByRole("button", { name: "Close season" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(lifecycleApi.transitionSeason).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Archive season" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive season" }));
    await waitFor(() => expect(lifecycleApi.transitionSeason).toHaveBeenCalledWith("org-1", "season-1", "archive"));
  });
  it("opens assignments only from a student row and returns to the same roster page", async () => {
    vi.mocked(api.students).mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ userId: `student-${i + 1}`, userName: `student${i + 1}`, displayName: `Student ${String(i + 1).padStart(2, "0")}`, email: null })));
    renderWizard("/admin/seasons/season-1?step=students");
    await screen.findByRole("table");
    expect(screen.queryByLabelText("Passage to assign")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("11–12 of 12 students")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.click(screen.getByRole("link", { name: "Manage assignments for Student 11" }));
    expect(screen.getByRole("heading", { name: "Student 11" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add passage assignment" }));
    await waitFor(() => expect(api.assign).toHaveBeenCalledWith("org-1", "season-1", expect.objectContaining({ studentUserId: "student-11" })));
    await screen.findByText("Assignment saved.");
    fireEvent.click(screen.getByRole("button", { name: "Back to students" }));
    expect(screen.getByText("11–12 of 12 students")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Student 03" } });
    expect(screen.getByText("1–1 of 1 students")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Nobody" } });
    expect(screen.getByText("No students match your search.")).toBeInTheDocument();
  });
  it("does not silently select another student for an invalid deep link", async () => {
    renderWizard("/admin/seasons/season-1?step=students&studentId=missing");
    expect(await screen.findByRole("alert")).toHaveTextContent("This student is unavailable");
    expect(screen.queryByLabelText("Passage to assign")).not.toBeInTheDocument();
  });
  it("opens a standalone assignment editor without season setup navigation", async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={["/admin/assignments?seasonId=season-1&studentId=student-2"]}><SeasonAssignmentEditor seasonId="season-1" studentId="student-2" /></MemoryRouter></QueryClientProvider>);
    await screen.findByRole("heading", { name: "Sarah Student" });
    expect(screen.queryByRole("navigation", { name: "Season setup steps" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back to students" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review season →" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Foundation"));
    fireEvent.click(screen.getByRole("button", { name: "Add passage assignment" }));
    await waitFor(() => expect(api.assign).toHaveBeenCalledWith("org-1", "season-1", expect.objectContaining({ studentUserId: "student-2", difficulty: "Foundation" })));
  });
  it("starts with details and advances to passages after saving", async () => {
    renderWizard("/admin/seasons/new");
    expect(screen.getByRole("heading", { name: "Create a season" })).toBeInTheDocument();
    expect(screen.queryByTestId("field-guide-academy")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Season name"), { target: { value: "Autumn Daniel" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and choose passages" }));
    await screen.findByRole("heading", { name: "Choose season passages" });
    expect(api.createSeason).toHaveBeenCalledWith("org-1", expect.objectContaining({ name: "Autumn Daniel" }));
  });
  it("keeps historical book keys while saving the multi-book shape", async () => {
    renderWizard("/admin/seasons/season-1?step=passages");
    fireEvent.click(await screen.findByRole("button", { name: "Edit season passages" }));
    expect(screen.getByRole("option", { name: "DAN" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Book"), { target: { value: "JOS" } });
    fireEvent.click(screen.getByTestId("save-scope"));
    await waitFor(() => expect(api.defineScope).toHaveBeenCalledWith("org-1", "season-1", expect.objectContaining({ packs: [{ contentPackId: "pack-1", includes: [{ ...range, bookKey: "JOS", endVerse: 1 }], excludes: [] }] })));
  });
  it("retains an imported custom book in the selector", async () => {
    vi.mocked(api.seasonScope).mockResolvedValue({ contentPackId: "pack-1", includes: [{ ...range, bookKey: "CUSTOM" }], excludes: [] });
    renderWizard("/admin/seasons/season-1?step=passages");
    fireEvent.click(await screen.findByRole("button", { name: "Edit season passages" }));
    expect(screen.getByLabelText("Book")).toHaveValue("CUSTOM");
    expect(screen.getByRole("option", { name: "CUSTOM" })).toBeInTheDocument();
  });
  it("keeps stored book choices when the naming catalog is unavailable", async () => {
    vi.mocked(api.library).mockRejectedValue(new Error("Unavailable"));
    renderWizard("/admin/seasons/season-1?step=passages");
    fireEvent.click(await screen.findByRole("button", { name: "Edit season passages" }));
    expect(screen.getByLabelText("Book")).toHaveValue("DAN");
    expect(screen.getByTestId("save-scope")).toBeEnabled();
  });
  it("loads saved passages and preserves every inclusion and exclusion when editing", async () => {
    const excluded = { ...range, startVerse: 3, endVerse: 3 };
    const extra = { ...range, startChapter: 3, endChapter: 3 };
    vi.mocked(api.seasonScope).mockResolvedValue({ contentPackId: "pack-1", includes: [range, extra], excludes: [excluded] });
    renderWizard("/admin/seasons/season-1?step=passages");
    await screen.findByText("DAN 2:1–2:8");
    expect(screen.queryByTestId("save-scope")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit season passages" }));
    fireEvent.click(screen.getByTestId("save-scope"));
    await waitFor(() => expect(api.defineScope).toHaveBeenCalledWith("org-1", "season-1", { contentPackId: null, includes: [], excludes: [], packs: [{ contentPackId: "pack-1", includes: [range, extra], excludes: [excluded] }] }));
  });
  it("keeps assignment edits separate from the saved season passages", async () => {
    renderWizard("/admin/seasons/season-1?step=students&studentId=student-1");
    await screen.findByRole("heading", { name: "Daniel Student" });
    fireEvent.change(screen.getByLabelText("Passage to assign"), { target: { value: "custom" } });
    fireEvent.change(screen.getByTestId("assignment-end"), { target: { value: "4" } });
    fireEvent.click(screen.getByLabelText("Advanced"));
    fireEvent.click(screen.getByRole("button", { name: "Add passage assignment" }));
    await waitFor(() => expect(api.assign).toHaveBeenCalledWith("org-1", "season-1", expect.objectContaining({ difficulty: "Advanced", range: { ...range, endVerse: 4 } })));
    expect(api.defineScope).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /2.*Passages/ }));
    expect(await screen.findByText("DAN 2:1–2:8")).toBeInTheDocument();
  });
  it("loads each student's own difficulty and saves changes for future sessions", async () => {
    vi.mocked(api.assignments).mockResolvedValue([assignment, { ...assignment, id: "a2", studentUserId: "student-2", studentDisplayName: "Sarah Student", difficulty: "Standard" }]);
    renderWizard("/admin/seasons/season-1?step=students&studentId=student-1");
    await waitFor(() => expect(screen.getByLabelText("Foundation")).toBeChecked());
    fireEvent.click(screen.getByRole("button", { name: "Back to students" }));
    fireEvent.click(screen.getByRole("link", { name: "Manage assignments for Sarah Student" }));
    expect(screen.getByLabelText("Standard")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Advanced"));
    fireEvent.click(screen.getByRole("button", { name: "Save difficulty for future sessions" }));
    expect(await screen.findByText("Difficulty saved for future sessions.")).toBeInTheDocument();
    expect(api.setDifficulty).toHaveBeenCalledWith("org-1", "season-1", "student-2", "Advanced");
  });
  it("shows active passages without offering to replace them", async () => {
    vi.mocked(api.season).mockResolvedValue({ ...season, status: "Active" });
    renderWizard("/admin/seasons/season-1?step=passages");
    await screen.findByText("DAN 2:1–2:8");
    expect(screen.queryByRole("button", { name: "Edit season passages" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("save-scope")).not.toBeInTheDocument();
  });
  it("requires assignments before starting and shows the saved roster in review", async () => {
    vi.mocked(api.assignments).mockResolvedValue([assignment]);
    renderWizard("/admin/seasons/season-1?step=review");
    const review = await screen.findByTestId("season-review");
    await waitFor(() => expect(within(review).getByText("Daniel Student")).toBeInTheDocument());
    expect(within(review).getByText("Foundation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start season" }));
    expect(api.activate).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Start season" }));
    await waitFor(() => expect(api.activate).toHaveBeenCalledWith("org-1", "season-1"));
  });
  it("keeps activation unavailable for an empty roster", async () => {
    renderWizard("/admin/seasons/season-1?step=review");
    await screen.findByTestId("season-review");
    expect(screen.getByRole("button", { name: "Start season" })).toBeDisabled();
  });
  it("keeps archived seasons read-only and labels their real state", async () => {
    vi.mocked(api.season).mockResolvedValue({ ...season, status: "Archived" });
    vi.mocked(api.assignments).mockResolvedValue([assignment]);
    renderWizard("/admin/seasons/season-1?step=students&studentId=student-1");
    await screen.findByRole("heading", { name: "Daniel Student" });
    expect(screen.getByTestId("season-status")).toHaveTextContent("Archived");
    expect(screen.getByRole("button", { name: "Add passage assignment" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save difficulty for future sessions" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /4.*Review/ }));
    expect(screen.queryByRole("button", { name: "Start season" })).not.toBeInTheDocument();
  });
  it("prevents duplicate passage assignments while retaining difficulty adjustment", async () => {
    vi.mocked(api.assignments).mockResolvedValue([assignment]);
    renderWizard("/admin/seasons/season-1?step=students&studentId=student-1");
    await screen.findByRole("heading", { name: "Daniel Student" });
    expect(screen.getByRole("button", { name: "Add passage assignment" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save difficulty for future sessions" })).toBeEnabled();
  });
  it("freezes passage editing while a save is in flight", async () => {
    vi.mocked(api.defineScope).mockImplementation(() => new Promise(() => {}));
    renderWizard("/admin/seasons/season-1?step=passages");
    fireEvent.click(await screen.findByRole("button", { name: "Edit season passages" }));
    fireEvent.click(screen.getByTestId("save-scope"));
    await waitFor(() => expect(screen.getByTestId("scope-end")).toBeDisabled());
    expect(screen.getByRole("button", { name: /3.*Students/ })).toBeDisabled();
  });
  it("does not show a blank replacement editor when saved scope cannot load", async () => {
    vi.mocked(api.seasonScope).mockRejectedValue(new Error("Offline"));
    renderWizard("/admin/seasons/season-1?step=passages");
    expect(await screen.findByRole("alert")).toHaveTextContent("could not load");
    expect(screen.queryByTestId("save-scope")).not.toBeInTheDocument();
  });
});


it("saves multiple library books in packs with empty legacy fields", async () => {
  vi.mocked(api.seasonScope).mockResolvedValue({ contentPackId: null, includes: [], excludes: [] });
  renderWizard("/admin/seasons/season-1?step=passages");
  fireEvent.click(await screen.findByRole("button", { name: "Choose passages" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Add a library book" }), { target: { value: "eph" } });
  fireEvent.click(screen.getByRole("button", { name: "Add book" }));
  expect(screen.getByTestId("scope-start-chapter").querySelector('option[value="7"]')).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: "Add a library book" }), { target: { value: "jude" } });
  fireEvent.click(screen.getByRole("button", { name: "Add book" }));
  fireEvent.click(screen.getByTestId("save-scope"));
  await waitFor(() => expect(api.defineScope).toHaveBeenCalledWith("org-1", "season-1", { contentPackId: null, includes: [], excludes: [], packs: [
    { contentPackId: "eph", includes: [{ bookKey: "EPH", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1 }], excludes: [] },
    { contentPackId: "jude", includes: [{ bookKey: "JUD", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1 }], excludes: [] },
  ] }));
});
it("assigns selected books and prevents ranges crossing excluded verses", async () => {
  vi.mocked(api.seasonScope).mockResolvedValue({ contentPackId: null, includes: [], excludes: [], packs: [
    { contentPackId: "eph", includes: [{ bookKey: "EPH", startChapter: 6, startVerse: 1, endChapter: 6, endVerse: 3 }], excludes: [{ bookKey: "EPH", startChapter: 6, startVerse: 2, endChapter: 6, endVerse: 2 }] },
    { contentPackId: "jude", includes: [{ bookKey: "JUD", startChapter: 1, startVerse: 2, endChapter: 1, endVerse: 3 }], excludes: [] },
  ] });
  renderWizard("/admin/seasons/season-1?step=students&studentId=student-1");
  const book = await screen.findByRole("combobox", { name: "Assignment book" });
  expect(Array.from(book.querySelectorAll("option")).map(o => o.value)).toEqual(["eph", "jude"]);
  fireEvent.change(screen.getByLabelText("Passage to assign"), { target: { value: "custom" } });
  expect(screen.getByTestId("assignment-start").querySelector('option[value="2"]')).toBeNull();
  expect(screen.getByTestId("assignment-end").querySelector('option[value="3"]')).toBeNull();
  fireEvent.change(book, { target: { value: "jude" } });
  fireEvent.click(screen.getByRole("button", { name: "Add passage assignment" }));
  await waitFor(() => expect(api.assign).toHaveBeenCalledWith("org-1", "season-1", expect.objectContaining({ contentPackId: "jude", range: { bookKey: "JUD", startChapter: 1, startVerse: 2, endChapter: 1, endVerse: 3 } })));
});
