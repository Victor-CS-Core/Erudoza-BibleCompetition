import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { profileApi } from "../profile/profile";
import { api } from "../../api/client";
import { practiceApi } from "../../api/practice";
import { lifecycleApi } from "../../api/lifecycle";
vi.mock("../../api/lifecycle", () => ({ lifecycleApi: { removeAssignment: vi.fn(), correctAssignment: vi.fn(), transitionSeason: vi.fn() } }));
vi.mock("../../api/practice", () => ({ practiceApi: { bootstrap: vi.fn(), enabled: vi.fn() } }));
import { SeasonAssignmentEditor, SeasonWizardPage } from "./SeasonWizardPage";
import { ToastProvider } from "../../components/ui";
import { multiScope } from "./passageRanges";

vi.mock("../../api/client", () => ({ api: { library: vi.fn(), contentPacks: vi.fn(), sourceUnits: vi.fn(), scriptureCatalog: vi.fn(), students: vi.fn(), season: vi.fn(), seasonScope: vi.fn(), assignments: vi.fn(), defineScope: vi.fn(), assign: vi.fn(), setDifficulty: vi.fn(), createSeason: vi.fn(), activate: vi.fn(), deleteSeason: vi.fn(), myAssignments: vi.fn(), assignMyself: vi.fn(), removeMyAssignment: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org-1", userId: "coach", displayName: "Coach", kind: "Adult", role: "Owner" } }) }));
const range = { bookKey: "DAN", startChapter: 2, startVerse: 1, endChapter: 2, endVerse: 8 };
const season = { id: "season-1", organizationId: "org-1", name: "Daniel 2026", yearLabel: "2026", status: "ContentReady", ruleProfileKey: "PBE_STYLE_V1", ruleProfileVersion: 1, startDate: null, targetCompetitionDate: null, scopeUnitCount: 8, assignmentCount: 0 };
const assignment = { id: "a1", studentUserId: "student-1", type: "PrimarySpecialist", ...range, difficulty: "Foundation" as const, studentDisplayName: "Daniel Student" };
function renderWizard(path = "/admin/seasons/season-1") {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter initialEntries={[path]}><Routes><Route path="/admin/seasons" element={<h1>All seasons list</h1>} /><Route path="/admin/seasons/new" element={<ToastProvider><SeasonWizardPage /></ToastProvider>} /><Route path="/admin/seasons/:seasonId" element={<ToastProvider><SeasonWizardPage /></ToastProvider>} /></Routes></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(profileApi, "identities").mockImplementation(async ids => ids.map(userId => ({ userId, avatarHonorKey: userId === "student-1" ? "solo:exact-recall" : null })));
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
  vi.mocked(api.assignMyself).mockImplementation(async (_org, _season, input) => ({ ...assignment, id: `self-${input.range.startChapter}-${input.range.startVerse}`, ...input.range, contentPackId: input.contentPackId, studentUserId: "coach", type: input.type, difficulty: input.difficulty ?? "Standard" }));
  vi.mocked(api.defineScope).mockResolvedValue(undefined);
  vi.mocked(api.assign).mockImplementation(async (_org, _season, input) => ({ ...assignment, id: `a-${input.range.startChapter}-${input.range.startVerse}`, ...input.range, contentPackId: input.contentPackId, studentUserId: input.studentUserId, type: input.type, difficulty: input.difficulty ?? "Standard" }));
  vi.mocked(api.setDifficulty).mockResolvedValue({ difficulty: "Advanced" });
  vi.mocked(api.createSeason).mockResolvedValue(season);
  vi.mocked(api.activate).mockResolvedValue({ activated: true, blockingProblems: [] });
  vi.mocked(practiceApi.bootstrap).mockResolvedValue({ enabled: true, seasons: [], players: [], rooms: [], invitations: [], achievements: [], questions: [] });
  vi.mocked(practiceApi.enabled).mockResolvedValue(undefined);
  vi.mocked(api.deleteSeason).mockResolvedValue(undefined);
});

describe("Two-step season planner", () => {
  it("creates a draft with whole books then allows assigning later", async () => {
    renderWizard("/admin/seasons/new");
    fireEvent.change(screen.getByLabelText("Season name"), { target: { value: "Autumn" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Ephesians/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save & assign students →" }));
    expect(await screen.findByRole("heading", { name: "Student assignments" })).toBeInTheDocument();
    expect(api.defineScope).toHaveBeenCalledWith("org-1", "season-1", expect.objectContaining({ packs: [expect.objectContaining({ contentPackId: "eph", includes: [{ bookKey: "EPH", startChapter: 1, startVerse: 1, endChapter: 6, endVerse: 3 }] })] }));
    fireEvent.click(screen.getByRole("button", { name: "Save as a draft" }));
    expect(await screen.findByRole("heading", { name: "All seasons list" })).toBeInTheDocument();
    expect(lifecycleApi.transitionSeason).not.toHaveBeenCalled();
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
    fireEvent.click(await screen.findByRole("button", { name: "Select all chapters" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & next student →" }));
    expect(await screen.findByRole("heading", { name: "Sarah Student" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Daniel Student/ })).toBeInTheDocument();
    expect(api.assign).toHaveBeenCalledWith("org-1", "season-1", expect.objectContaining({ studentUserId: "student-1" }), expect.any(AbortSignal));
    expect(document.querySelector(".planner-strip-count")).toHaveTextContent("0 of 1 chapters selected");
  });
  it("shows one book at a time in tabs and keeps each book's selection while switching", async () => {
    vi.mocked(api.seasonScope).mockResolvedValue(multiScope([
      { contentPackId: "eph", includes: [{ bookKey: "EPH", startChapter: 1, startVerse: 1, endChapter: 6, endVerse: 3 }], excludes: [] },
      { contentPackId: "jude", includes: [{ bookKey: "JUD", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 3 }], excludes: [] },
    ]));
    renderWizard("/admin/seasons/season-1?step=students&studentId=student-1");
    const tabs = await screen.findByRole("tablist", { name: "Season books" });
    const ephTab = within(tabs).getByRole("tab", { name: /Ephesians/ });
    const judeTab = within(tabs).getByRole("tab", { name: /Jude/ });
    expect(ephTab).toHaveAttribute("aria-selected", "true");
    // Only the active book's strip renders: six Ephesians cells, no Jude cells.
    expect(screen.getAllByRole("button", { name: /^Chapter \d+$/ }).length).toBe(6);
    fireEvent.click(screen.getByRole("button", { name: "Chapter 1" }));
    expect(ephTab).toHaveTextContent("1 selected");
    expect(screen.getByLabelText("Selection summary")).toHaveTextContent("Ephesians 1");
    fireEvent.click(judeTab);
    expect(judeTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("button", { name: /^Chapter \d+$/ }).length).toBe(1);
    fireEvent.click(ephTab);
    expect(document.querySelector(".planner-strip-count")).toHaveTextContent("1 of 6 chapters selected");
  });
  it("keeps selection and student on a failed save", async () => {
    vi.mocked(api.assign).mockRejectedValue(new Error("Offline"));
    renderWizard("/admin/seasons/season-1?step=students&studentId=student-1");
    fireEvent.click(await screen.findByRole("button", { name: "Select all chapters" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & next student →" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
    expect(screen.getByRole("heading", { name: "Daniel Student" })).toBeInTheDocument();
    expect(document.querySelector(".planner-strip-count")).toHaveTextContent("1 of 1 chapters selected");
  });
  it("uses personal assignments for the coach and links to that season in Student Mode", async () => {
    renderWizard("/admin/seasons/season-1?step=students&studentId=coach");
    fireEvent.click(await screen.findByRole("button", { name: "Select all chapters" }));
    fireEvent.click(screen.getByRole("button", { name: "Save assignments" }));
    expect(await screen.findByText("Assignments saved.")).toBeInTheDocument();
    expect(api.assignMyself).toHaveBeenCalledWith("org-1", "season-1", expect.objectContaining({ contentPackId: "pack-1" }), expect.any(AbortSignal));
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
    expect(await screen.findByRole("button", { name: /^Chapter 2/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Start season" })).not.toBeInTheDocument();
  });
  it("does not silently change an unavailable student", async () => {
    renderWizard("/admin/seasons/season-1?step=students&studentId=missing");
    expect(await screen.findByText(/This student is unavailable/)).toBeInTheDocument();
  });
  it("reuses the book editor without setup chrome from student management", async () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ToastProvider><SeasonAssignmentEditor seasonId="season-1" studentId="student-1" /></ToastProvider></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole("button", { name: /^Chapter 2/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Season planner" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Start verse")).not.toBeInTheDocument();
  });
});

it("shows the Team Practice toggle in the season editor and switches it off", async () => {
  renderWizard("/admin/seasons/season-1?step=details");
  const toggle = await screen.findByRole("checkbox", { name: /Enable Team Practice for your club/ });
  expect(toggle).toBeChecked();
  const panel = (await screen.findByRole("heading", { name: "Team Practice" })).closest("section")!;
  expect(within(panel).getByText("On")).toBeInTheDocument();
  fireEvent.click(toggle);
  await waitFor(() => expect(practiceApi.enabled).toHaveBeenCalledWith("org-1", false));
});

it("switches Team Practice back on from the season editor", async () => {
  vi.mocked(practiceApi.bootstrap).mockResolvedValue({ enabled: false, seasons: [], players: [], rooms: [], invitations: [], achievements: [], questions: [] });
  renderWizard("/admin/seasons/season-1?step=details");
  const toggle = await screen.findByRole("checkbox", { name: /Enable Team Practice for your club/ });
  expect(toggle).not.toBeChecked();
  const panel = (await screen.findByRole("heading", { name: "Team Practice" })).closest("section")!;
  expect(within(panel).getByText("Off")).toBeInTheDocument();
  fireEvent.click(toggle);
  await waitFor(() => expect(practiceApi.enabled).toHaveBeenCalledWith("org-1", true));
});

it("shows the Team Practice toggle on the new season page", async () => {
  renderWizard("/admin/seasons/new");
  const toggle = await screen.findByRole("checkbox", { name: /Enable Team Practice for your club/ });
  expect(toggle).toBeChecked();
  const panel = (await screen.findByRole("heading", { name: "Team Practice" })).closest("section")!;
  expect(within(panel).getByText("On")).toBeInTheDocument();
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

it("warns before deleting an active season and returns to the season list after confirmation", async () => {
  vi.mocked(api.season).mockResolvedValue({ ...season, status: "Active" });
  renderWizard();
  fireEvent.click(await screen.findByRole("button", { name: "Delete season" }));
  expect(api.deleteSeason).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toHaveTextContent("permanently delete");
  expect(screen.getByRole("dialog")).toHaveTextContent("assignments, progress, study history, and competition records");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete season" }));
  await waitFor(() => expect(api.deleteSeason).toHaveBeenCalledWith("org-1", "season-1"));
  expect(await screen.findByRole("heading", { name: "All seasons list" })).toBeInTheDocument();
});

it("keeps the deletion warning open and reports a failed delete", async () => {
  vi.mocked(api.deleteSeason).mockRejectedValue(new Error("Offline"));
  renderWizard();
  fireEvent.click(await screen.findByRole("button", { name: "Delete season" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete season" }));
  expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("Offline");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
  fireEvent.click(await screen.findByRole("button", { name: "Delete season" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("locks the deletion warning while the request is pending", async () => {
  let resolveDelete!: () => void;
  vi.mocked(api.deleteSeason).mockImplementation(() => new Promise<void>(resolve => { resolveDelete = resolve; }));
  renderWizard();
  fireEvent.click(await screen.findByRole("button", { name: "Delete season" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete season" }));
  expect(await within(dialog).findByRole("button", { name: "Deleting…" })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(api.deleteSeason).toHaveBeenCalledTimes(1);
  resolveDelete();
  expect(await screen.findByRole("heading", { name: "All seasons list" })).toBeInTheDocument();
});

it("cancels deletion without calling the API", async () => {
  renderWizard();
  fireEvent.click(await screen.findByRole("button", { name: "Delete season" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
  expect(api.deleteSeason).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it.each(["student-1", "coach"])("assigns only selected season chapters for %s", async studentId => {
  vi.mocked(api.seasonScope).mockResolvedValue({ contentPackId: "eph", includes: [{ bookKey: "EPH", startChapter: 1, startVerse: 1, endChapter: 6, endVerse: 3 }], excludes: [] });
  renderWizard(`/admin/seasons/season-1?step=students&studentId=${studentId}`);
  fireEvent.click(await screen.findByRole("button", { name: "Chapter 2" }));
  fireEvent.click(screen.getByRole("button", { name: "Chapter 4" }));
  fireEvent.click(screen.getByRole("button", { name: "Save assignments" }));
  await screen.findByText("Assignments saved.");
  const calls = vi.mocked(studentId === "coach" ? api.assignMyself : api.assign).mock.calls;
  expect(calls.map(call => call[2].range)).toEqual([2, 4].map(chapter => ({ bookKey: "EPH", startChapter: chapter, startVerse: 1, endChapter: chapter, endVerse: 3 })));
  expect(screen.queryByLabelText(/start verse|end verse/i)).not.toBeInTheDocument();
});

it("shows current Honor or initials in the roster and selected assignment identity", async () => {
  const view = renderWizard();
  await screen.findByRole("heading", { name: "Daniel Student" });
  await waitFor(() => expect(view.container.querySelectorAll('[data-profile-user="student-1"][data-profile-honor="solo:exact-recall"]')).toHaveLength(2));
  expect(view.container.querySelector('[data-profile-user="student-2"]')).toHaveTextContent("SS");
});

it("keeps draft and start actions visible but locked until assignment edits are saved", async () => {
  renderWizard();
  fireEvent.click(await screen.findByRole("button", { name: "Select all chapters" }));
  expect(screen.getByRole("button", { name: "Save as a draft" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Start season" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Archive season" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save assignments" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Save as a draft" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Save as a draft" }));
  expect(await screen.findByRole("heading", { name: "All seasons list" })).toBeInTheDocument();
  expect(api.assign).toHaveBeenCalled();
  expect(api.activate).not.toHaveBeenCalled();
  expect(lifecycleApi.transitionSeason).not.toHaveBeenCalled();
});

it("retains lifecycle actions for an active season without offering draft save", async () => {
  vi.mocked(api.season).mockResolvedValue({ ...season, status: "Active" });
  renderWizard();
  expect(await screen.findByRole("button", { name: "Close season" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Archive season" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save as a draft" })).not.toBeInTheDocument();
});

it("unlocks draft and start after confirmed saves even when background refresh stalls", async () => {
  renderWizard();
  fireEvent.click(await screen.findByRole("button", { name: "Select all chapters" }));
  vi.mocked(api.assign).mockImplementationOnce(async (_org, _season, input) => {
    vi.mocked(api.assignments).mockImplementation(() => new Promise(() => {}));
    vi.mocked(api.season).mockImplementation(() => new Promise(() => {}));
    return { ...assignment, ...input.range, contentPackId: input.contentPackId };
  });
  fireEvent.click(screen.getByRole("button", { name: "Save assignments" }));
  expect(await screen.findByText("Assignments saved.")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Save as a draft" })).toBeEnabled());
  expect(screen.getByRole("button", { name: "Start season" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Chapter 2 (already saved)" })).toBeDisabled();
});

it("keeps a failed save retryable when reconciliation and background refresh also fail", async () => {
  renderWizard();
  fireEvent.click(await screen.findByRole("button", { name: "Select all chapters" }));
  vi.mocked(api.assign).mockImplementationOnce(async () => {
    vi.mocked(api.assignments).mockRejectedValue(new Error("Readback offline"));
    vi.mocked(api.season).mockRejectedValue(new Error("Season refresh offline"));
    throw new Error("Write response lost");
  });
  fireEvent.click(screen.getByRole("button", { name: "Save assignments" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Write response lost");
  await waitFor(() => expect(screen.getByRole("button", { name: "Save assignments" })).toBeEnabled());
  expect(document.querySelector(".planner-strip-count")).toHaveTextContent("1 of 1 chapters selected");
  expect(screen.getByRole("button", { name: "Start season" })).toBeDisabled();
});

it("lets a coach start a season with only their own study plan", async () => {
  vi.mocked(api.assignments).mockResolvedValue([]);
  vi.mocked(api.myAssignments).mockResolvedValue([{ ...assignment, id: "self-1", studentUserId: "coach" }]);
  renderWizard();
  const start = await screen.findByRole("button", { name: "Start season" });
  expect(start).toBeEnabled();
  expect(screen.queryByText(/Assign at least one student/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /My assignments/ })).toHaveTextContent("Assigned");
  fireEvent.click(start);
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/Your own study plan is the only assignment/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Start season" }));
  await waitFor(() => expect(api.activate).toHaveBeenCalled());
});

it("retains confirmed difficulty for subsequent saves while refresh stalls", async () => {
  vi.mocked(api.assignments).mockResolvedValue([assignment]);
  renderWizard();
  await screen.findByRole("heading", { name: "Daniel Student" });
  fireEvent.change(screen.getByLabelText("Training difficulty"), { target: { value: "Advanced" } });
  vi.mocked(api.setDifficulty).mockImplementationOnce(async () => {
    vi.mocked(api.assignments).mockImplementation(() => new Promise(() => {}));
    return { difficulty: "Advanced" };
  });
  fireEvent.click(screen.getByRole("button", { name: "Save assignments" }));
  await screen.findByText("Assignments saved.");
  expect(screen.getByLabelText("Training difficulty")).toHaveValue("Advanced");
});

it("keeps coach difficulty confirmed by a new chapter when refresh stalls", async () => {
  const existing = { ...assignment, ...{ bookKey: "EPH", startChapter: 1, endChapter: 1, startVerse: 1, endVerse: 3 }, studentUserId: "coach", contentPackId: "eph" };
  vi.mocked(api.myAssignments).mockResolvedValue([existing]);
  vi.mocked(api.seasonScope).mockResolvedValue({ contentPackId: "eph", includes: [{ bookKey: "EPH", startChapter: 1, startVerse: 1, endChapter: 6, endVerse: 3 }], excludes: [] });
  renderWizard("/admin/seasons/season-1?step=students&studentId=coach");
  fireEvent.click(await screen.findByRole("button", { name: "Chapter 2" }));
  fireEvent.change(screen.getByLabelText("Training difficulty"), { target: { value: "Advanced" } });
  vi.mocked(api.assignMyself).mockImplementationOnce(async (_org, _season, input) => {
    vi.mocked(api.myAssignments).mockImplementation(() => new Promise(() => {}));
    return { ...existing, id: "new-chapter", ...input.range, difficulty: "Advanced" };
  });
  fireEvent.click(screen.getByRole("button", { name: "Save assignments" }));
  await screen.findByText("Assignments saved.");
  expect(screen.getByLabelText("Training difficulty")).toHaveValue("Advanced");
});
