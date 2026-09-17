import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { PbeMaterialProposal, PbeMaterialProposalSummary, PbeNewsArticle } from "../../api/types";
import { MaterialsPage, formatChapters, parseChapterList } from "./MaterialsPage";

vi.mock("../../api/client", () => ({
  api: {
    pbeReleases: vi.fn(), pbeRelease: vi.fn(), createPbeRelease: vi.fn(), updatePbeRelease: vi.fn(),
    reviewPbeRelease: vi.fn(), watchNadMaterials: vi.fn(), pbeNewsArticles: vi.fn(),
    createPbeNewsArticle: vi.fn(), updatePbeNewsArticle: vi.fn(),
    publishPbeNewsArticle: vi.fn(), unpublishPbeNewsArticle: vi.fn(),
  },
}));
const useAuthMock = vi.fn();
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => useAuthMock() }));

const owner = { organizationId: "org-1", userId: "owner-1", kind: "Adult", role: "Owner", organizationName: "Club", displayName: "Olivia Owner", userName: "owner", email: null };
const admin = { ...owner, userId: "admin-1", role: "Admin", displayName: "Ari Admin", userName: "admin" };

const draftPayload = {
  yearLabel: "2025-26",
  books: [{ bookKey: "ISA", bookName: "Isaiah", chapters: [1, 2, 3] }],
  commentary: { bookName: "Isaiah", title: "ISAIAH", sections: [{ heading: "Title and Authorship", body: "The superscription in Isaiah 1:1 gives the identity of the seer." }] },
  sourceUrls: { resourcesPage: "https://nadpbe.org/pbe-resources/", commentaryPdf: "https://example.com/commentary.pdf" },
};
const proposalSummary: PbeMaterialProposalSummary = { id: "prop-1", yearLabel: "2025-26", status: "draft", origin: "watcher", proposedBy: "nad-watcher", proposedAtUtc: "2026-09-16T10:00:00Z" };
const fullProposal: PbeMaterialProposal = { ...proposalSummary, material: draftPayload };
const diff = { booksChanged: false, addedSections: ["Date"], removedSections: ["Old heading"], changedSections: ["Title and Authorship"], rosterChanged: true };

const newsArticle: PbeNewsArticle = {
  id: "art-1", title: "New materials detected", summary: "NAD posted a new Commentary PDF.",
  sections: [{ heading: "Details", body: "Detection details here." }],
  sourceUrl: "https://nadpbe.org/x.pdf", sourceLabel: "nadpbe.org",
  status: "draft", createdBy: "nad-watcher", createdAtUtc: "2026-09-16T10:00:00Z", updatedAtUtc: "2026-09-16T10:00:00Z",
};

function renderPage(path = "/admin/materials", me: typeof owner = owner) {
  useAuthMock.mockReturnValue({ me, loading: false });
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><MaterialsPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthMock.mockReturnValue({ me: owner, loading: false });
  vi.mocked(api.pbeReleases).mockResolvedValue([]);
  vi.mocked(api.pbeNewsArticles).mockResolvedValue([]);
});

it("lists proposals with year, status, origin, and review actions", async () => {
  vi.mocked(api.pbeReleases).mockResolvedValue([proposalSummary, { ...proposalSummary, id: "prop-2", status: "approved", origin: "manual", proposedBy: "owner-1", decidedAtUtc: "2026-09-16T12:00:00Z" }]);
  renderPage();
  expect(await screen.findAllByText("2025–26")).toHaveLength(2);
  expect(screen.getByText("Draft")).toBeInTheDocument();
  expect(screen.getByText("Approved")).toBeInTheDocument();
  expect(screen.getByText("Watcher")).toBeInTheDocument();
  expect(screen.getByText("Manual")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Review" })).toHaveLength(2);
});

it("shows the empty state when there are no proposals", async () => {
  renderPage();
  expect(await screen.findByText("No proposals yet")).toBeInTheDocument();
});

it("checks the NAD watcher and surfaces drafted proposals", async () => {
  vi.mocked(api.pbeReleases).mockResolvedValue([proposalSummary]);
  vi.mocked(api.watchNadMaterials).mockResolvedValue({
    checkedAt: "2026-09-17T14:00:00Z", mediaChecked: 42,
    drafted: [{ proposalId: "prop-9", yearLabel: "2026-27", title: "2026 Commentary", sourceUrl: "https://nadpbe.org/y.pdf" }],
  });
  renderPage();
  await screen.findByRole("button", { name: "Review" });
  fireEvent.click(screen.getByRole("button", { name: "Check for new NAD materials" }));
  expect(await screen.findByText(/42 media items checked/)).toBeInTheDocument();
  expect(screen.getByText("2026 Commentary")).toBeInTheDocument();
  expect(api.watchNadMaterials).toHaveBeenCalledWith("org-1");
});

it("creates a manual proposal from the form with parsed chapters", async () => {
  vi.mocked(api.createPbeRelease).mockResolvedValue({ ...fullProposal, id: "prop-new" });
  vi.mocked(api.pbeRelease).mockResolvedValue({ proposal: { ...fullProposal, id: "prop-new" }, diff: { booksChanged: false, addedSections: [], removedSections: [], changedSections: [], rosterChanged: false }, live: null });
  renderPage();
  await screen.findByText("No proposals yet");
  fireEvent.click(screen.getByRole("button", { name: "New proposal" }));
  fireEvent.change(screen.getByLabelText("Competition year"), { target: { value: "2025-26" } });
  fireEvent.change(screen.getByLabelText("NAD PBE resources page URL"), { target: { value: "https://nadpbe.org/pbe-resources/" } });
  fireEvent.change(screen.getByLabelText("Book key"), { target: { value: "isa" } });
  fireEvent.change(screen.getByLabelText("Book name"), { target: { value: "Isaiah" } });
  fireEvent.change(screen.getByLabelText("Chapters"), { target: { value: "1-3" } });
  fireEvent.change(screen.getByLabelText("Commentary book name"), { target: { value: "Isaiah" } });
  fireEvent.change(screen.getByLabelText("Commentary title"), { target: { value: "ISAIAH" } });
  fireEvent.change(screen.getByLabelText("Section heading"), { target: { value: "Title and Authorship" } });
  fireEvent.change(screen.getByLabelText("Section body"), { target: { value: "The superscription gives the identity." } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft proposal" }));
  expect(await screen.findByText("2025–26 proposal")).toBeInTheDocument();
  expect(api.createPbeRelease).toHaveBeenCalledWith("org-1", {
    yearLabel: "2025-26",
    material: {
      yearLabel: "2025-26",
      books: [{ bookKey: "ISA", bookName: "Isaiah", chapters: [1, 2, 3] }],
      commentary: { bookName: "Isaiah", title: "ISAIAH", sections: [{ heading: "Title and Authorship", body: "The superscription gives the identity." }] },
      sourceUrls: { resourcesPage: "https://nadpbe.org/pbe-resources/" },
    },
  });
});

it("validates the year label before submitting a proposal", async () => {
  renderPage();
  await screen.findByText("No proposals yet");
  fireEvent.click(screen.getByRole("button", { name: "New proposal" }));
  fireEvent.change(screen.getByLabelText("Competition year"), { target: { value: "2025" } });
  fireEvent.change(screen.getByLabelText("NAD PBE resources page URL"), { target: { value: "https://nadpbe.org/pbe-resources/" } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft proposal" }));
  expect(await screen.findByText(/must look like 2025-26/)).toBeInTheDocument();
  expect(api.createPbeRelease).not.toHaveBeenCalled();
});

it("round-trips formatted chapter ranges back through the parser", () => {
  expect(parseChapterList(formatChapters([1, 2, 3]))).toEqual([1, 2, 3]);
  expect(parseChapterList(formatChapters([1, 3, 5]))).toEqual([1, 3, 5]);
  expect(parseChapterList("1-3")).toEqual([1, 2, 3]);
  expect(parseChapterList("1,2,3")).toEqual([1, 2, 3]);
});

it("shows the full proposal detail with roster, commentary, sources, and diff", async () => {
  vi.mocked(api.pbeReleases).mockResolvedValue([proposalSummary]);
  vi.mocked(api.pbeRelease).mockResolvedValue({ proposal: fullProposal, diff, live: null });
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Review" }));
  expect(await screen.findByText("2025–26 proposal")).toBeInTheDocument();
  expect(screen.getByText("The superscription in Isaiah 1:1 gives the identity of the seer.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View original commentary" })).toHaveAttribute("href", "https://example.com/commentary.pdf");
  expect(screen.getByRole("link", { name: "NAD PBE resources" })).toHaveAttribute("href", "https://nadpbe.org/pbe-resources/");
  const roster = screen.getByRole("region", { name: "Proposed book roster" });
  expect(within(roster).getByText("Isaiah")).toBeInTheDocument();
  expect(within(roster).getByText("1–3")).toBeInTheDocument();
  expect(screen.getByText("The book roster or book details differ from the live release.")).toBeInTheDocument();
  expect(screen.getByText("Date")).toBeInTheDocument();
  expect(screen.getByText("Old heading")).toBeInTheDocument();
  const changedList = screen.getByRole("heading", { name: "Changed sections" }).parentElement?.querySelector("ul");
  expect(changedList).not.toBeNull();
  expect(within(changedList as HTMLElement).getByText("Title and Authorship")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Title and Authorship" })).toBeInTheDocument();
});

it("lets the Owner approve with a review note and shows the student link", async () => {
  vi.mocked(api.pbeRelease).mockResolvedValue({ proposal: fullProposal, diff: { booksChanged: false, addedSections: [], removedSections: [], changedSections: [], rosterChanged: false }, live: null });
  vi.mocked(api.reviewPbeRelease).mockResolvedValue({ ...fullProposal, status: "approved" });
  renderPage("/admin/materials?proposal=prop-1");
  fireEvent.change(await screen.findByLabelText(/Review note/), { target: { value: "Looks good." } });
  fireEvent.click(screen.getByRole("button", { name: "Approve and publish" }));
  await screen.findByText(/are now live for students/);
  expect(api.reviewPbeRelease).toHaveBeenCalledWith("org-1", "prop-1", { decision: "approved", note: "Looks good." });
  expect(screen.getByRole("link", { name: "See what students will see" })).toHaveAttribute("href", "/student/study?mode=Library");
});

it("disables approve and reject for non-Owners with an explanatory notice", async () => {
  vi.mocked(api.pbeRelease).mockResolvedValue({ proposal: fullProposal, diff, live: null });
  renderPage("/admin/materials?proposal=prop-1", admin);
  await screen.findByText("2025–26 proposal");
  expect(screen.getByText(/Approval requires the club Owner/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Approve and publish" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
  expect(api.reviewPbeRelease).not.toHaveBeenCalled();
});

it("disables review for the proposer with a separation notice", async () => {
  vi.mocked(api.pbeRelease).mockResolvedValue({ proposal: { ...fullProposal, proposedBy: "owner-1" }, diff, live: null });
  renderPage("/admin/materials?proposal=prop-1", owner);
  await screen.findByText("2025–26 proposal");
  expect(screen.getByText(/a different approver must review it/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Approve and publish" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
  expect(api.reviewPbeRelease).not.toHaveBeenCalled();
});

it("edits a draft proposal in place", async () => {
  vi.mocked(api.pbeRelease).mockResolvedValue({ proposal: fullProposal, diff, live: null });
  vi.mocked(api.updatePbeRelease).mockResolvedValue(fullProposal);
  renderPage("/admin/materials?proposal=prop-1");
  fireEvent.click(await screen.findByRole("button", { name: "Edit draft" }));
  fireEvent.change(screen.getByLabelText("Commentary title"), { target: { value: "ISAIAH (revised)" } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft changes" }));
  await screen.findByText("2025–26 proposal");
  expect(api.updatePbeRelease).toHaveBeenCalledWith("org-1", "prop-1", expect.objectContaining({
    material: expect.objectContaining({ commentary: expect.objectContaining({ title: "ISAIAH (revised)" }) }),
  }));
});

it("switches to the News tab and lists articles with status badges", async () => {
  vi.mocked(api.pbeNewsArticles).mockResolvedValue([newsArticle, { ...newsArticle, id: "art-2", status: "published", title: "Published one", publishedAtUtc: "2026-09-16T12:00:00Z" }]);
  renderPage("/admin/materials?tab=news");
  expect(await screen.findByText("New materials detected")).toBeInTheDocument();
  expect(screen.getByText("Draft")).toBeInTheDocument();
  expect(screen.getByText("Published")).toBeInTheDocument();
  expect(screen.getAllByText("Watcher")).toHaveLength(2);
});

it("publishes a watcher-suggested draft as the Owner", async () => {
  vi.mocked(api.pbeNewsArticles)
    .mockResolvedValueOnce([newsArticle])
    .mockResolvedValue([{ ...newsArticle, status: "published", publishedAtUtc: "2026-09-17T10:00:00Z" }]);
  vi.mocked(api.publishPbeNewsArticle).mockResolvedValue({ ...newsArticle, status: "published" });
  renderPage("/admin/materials?tab=news");
  fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
  await screen.findByText("Published");
  expect(api.publishPbeNewsArticle).toHaveBeenCalledWith("org-1", "art-1");
});

it("unpublishes an article as the Owner", async () => {
  vi.mocked(api.pbeNewsArticles).mockResolvedValue([{ ...newsArticle, status: "published", publishedAtUtc: "2026-09-16T12:00:00Z" }]);
  vi.mocked(api.unpublishPbeNewsArticle).mockResolvedValue(newsArticle);
  renderPage("/admin/materials?tab=news");
  fireEvent.click(await screen.findByRole("button", { name: "Unpublish" }));
  expect(api.unpublishPbeNewsArticle).toHaveBeenCalledWith("org-1", "art-1");
});

it("disables publish for non-Owners with an explanatory notice", async () => {
  vi.mocked(api.pbeNewsArticles).mockResolvedValue([newsArticle]);
  renderPage("/admin/materials?tab=news", admin);
  await screen.findByText("New materials detected");
  expect(screen.getByText(/Publishing and unpublishing news articles requires the club Owner/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  expect(api.publishPbeNewsArticle).not.toHaveBeenCalled();
});

it("creates a news article from the form", async () => {
  vi.mocked(api.pbeNewsArticles)
    .mockResolvedValueOnce([])
    .mockResolvedValue([{ ...newsArticle, id: "art-new", title: "Big announcement" }]);
  vi.mocked(api.createPbeNewsArticle).mockResolvedValue({ ...newsArticle, id: "art-new" });
  renderPage("/admin/materials?tab=news");
  await screen.findByText("No news articles yet");
  fireEvent.click(screen.getByRole("button", { name: "New article" }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Big announcement" } });
  fireEvent.change(screen.getByLabelText(/Summary/), { target: { value: "Something happened." } });
  fireEvent.change(screen.getByLabelText("Section heading"), { target: { value: "Details" } });
  fireEvent.change(screen.getByLabelText("Section body"), { target: { value: "All the details." } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft article" }));
  await screen.findByText("Big announcement");
  expect(api.createPbeNewsArticle).toHaveBeenCalledWith("org-1", {
    title: "Big announcement", summary: "Something happened.",
    sections: [{ heading: "Details", body: "All the details." }],
  });
});
