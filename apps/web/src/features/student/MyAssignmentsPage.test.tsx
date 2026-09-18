import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { profileApi } from "../profile/profile";
import { api } from "../../api/client";
import { MyAssignmentsPage } from "./MyAssignmentsPage";
import { ToastProvider } from "../../components/ui";
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { userId: "coach", displayName: "Demo Coach", organizationId: "org", kind: "Adult", role: "Owner" } }) }));
vi.mock("../../api/client", () => ({ api: { library: vi.fn(), seasons: vi.fn(), seasonScope: vi.fn(), sourceUnits: vi.fn(), myAssignments: vi.fn(), assignMyself: vi.fn(), removeMyAssignment: vi.fn() } }));
const range = { bookKey: "Daniel", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 2 };
beforeEach(() => {
 vi.clearAllMocks();
 vi.spyOn(profileApi, "identities").mockResolvedValue([]);
 vi.mocked(api.library).mockResolvedValue({ books: [] } as never);
 vi.mocked(api.seasons).mockResolvedValue([{ id: "season", name: "Daniel", status: "Active" }] as never);
 vi.mocked(api.seasonScope).mockResolvedValue({ contentPackId: "pack", includes: [range], excludes: [] });
 vi.mocked(api.sourceUnits).mockResolvedValue([1, 2, 3].map(verse => ({ id: String(verse), bookKey: "Daniel", chapter: 1, verse, text: "Scripture" })) as never);
 vi.mocked(api.myAssignments).mockResolvedValue([]);
 vi.mocked(api.assignMyself).mockImplementation(async (_org, _season, input) => ({ id: "assignment", studentUserId: "coach", ...input, ...input.range } as never));
 vi.mocked(api.removeMyAssignment).mockResolvedValue();
});
function mount() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter initialEntries={["/student/assignments?seasonId=season"]}><ToastProvider><MyAssignmentsPage /></ToastProvider></MemoryRouter></QueryClientProvider>); }
it("adds a personal assignment using permitted passages and Standard difficulty", async () => {
 mount();
 const add = await screen.findByRole("button", { name: "Save assignments" });
 fireEvent.click(await screen.findByRole("button", { name: /^Chapter 1/ }));
 await waitFor(() => expect(add).toBeEnabled());
 expect(screen.getByLabelText("Training difficulty")).toHaveValue("Standard");
 fireEvent.click(add);
 await waitFor(() => expect(api.assignMyself).toHaveBeenCalledWith("org", "season", { contentPackId: "pack", type: "PrimarySpecialist", difficulty: "Standard", range }, expect.any(AbortSignal)));
 expect(await screen.findByText("Assignments saved.")).toBeInTheDocument();
});
it("shows an empty organization without offering season creation", async () => {
 vi.mocked(api.seasons).mockResolvedValue([]); mount();
 expect(await screen.findByText(/No seasons are available/)).toBeInTheDocument();
 expect(screen.queryByRole("link", { name: "Create season" })).not.toBeInTheDocument();
});
it("keeps closed season assignments visible without allowing changes", async () => {
 vi.mocked(api.seasons).mockResolvedValue([{ id: "season", name: "Daniel", status: "Completed" }] as never); mount();
 expect(await screen.findByText(/This season is closed/)).toBeInTheDocument();
 expect(screen.getByRole("button", { name: /^Chapter 1/ })).toBeDisabled();
});

it("removes only the selected personal assignment after confirmation", async () => {
 HTMLDialogElement.prototype.showModal = function() { this.setAttribute("open", ""); };
 HTMLDialogElement.prototype.close = function() { this.removeAttribute("open"); };
 vi.mocked(api.myAssignments).mockResolvedValue([{ id: "mine", studentUserId: "coach", ...range, type: "PrimarySpecialist", difficulty: "Standard", contentPackId: "pack" }] as never);
 mount(); fireEvent.click(await screen.findByRole("button", { name: /Remove Daniel/ }));
 expect(api.removeMyAssignment).not.toHaveBeenCalled();
 fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove assignments" }));
 await waitFor(() => expect(api.removeMyAssignment).toHaveBeenCalledWith("org", "season", "mine"));
});

it("refines a checked chapter to specific verses before saving", async () => {
 mount();
 fireEvent.click(await screen.findByRole("button", { name: /^Chapter 1/ }));
 fireEvent.click(await screen.findByRole("button", { name: "Refine" }));
 fireEvent.change(screen.getByLabelText("From verse in chapter 1"), { target: { value: "1" } });
 fireEvent.change(screen.getByLabelText("To verse in chapter 1"), { target: { value: "2" } });
 fireEvent.click(screen.getByRole("button", { name: "Add verses" }));
 expect(within(screen.getByRole("list", { name: "Selected verse ranges for chapter 1" })).getByText("vv. 1–2", { exact: false })).toBeInTheDocument();
 // The season scope only includes verses 1-2, so verse 3 is never offered.
 expect([...(screen.getByLabelText("To verse in chapter 1") as HTMLSelectElement).options].map(item => item.value)).toEqual(["1", "2"]);
 fireEvent.click(screen.getByRole("button", { name: "Save assignments" }));
 await waitFor(() => expect(api.assignMyself).toHaveBeenCalledWith("org", "season",
   { contentPackId: "pack", type: "PrimarySpecialist", difficulty: "Standard", range: { bookKey: "Daniel", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 2 } },
   expect.any(AbortSignal)));
 expect(await screen.findByText("Assignments saved.")).toBeInTheDocument();
});
