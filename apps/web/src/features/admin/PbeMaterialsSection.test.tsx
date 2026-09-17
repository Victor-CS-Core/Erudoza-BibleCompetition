import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { PbeMaterialsSection } from "./PbeMaterialsSection";

vi.mock("../../api/client", () => ({ api: { pbeMaterials: vi.fn(), pbeMaterialCurrent: vi.fn() } }));

const books = [
  { contentPackId: "isa-pack", bookKey: "ISA", name: "Isaiah", verseCount: 100, chapters: [{ number: 1, verses: [1] }, { number: 2, verses: [1] }] },
  { contentPackId: "gen-pack", bookKey: "GEN", name: "Genesis", verseCount: 50, chapters: [{ number: 1, verses: [1] }] },
];

const material = {
  id: "pbe-material-2025-26", yearLabel: "2025-26",
  books: [{ bookKey: "ISA", bookName: "Isaiah", chapters: [1, 2, 3] }],
  commentary: { bookName: "Isaiah", title: "ISAIAH", sections: [
    { heading: "Title and Authorship", body: "The superscription in Isaiah 1:1 gives the identity of the seer, Isaiah son of Amoz, and the mode of revelation." },
    { heading: "Date", body: "Isaiah's commission occurred sometime in 740 B.C." },
  ] },
  sourceUrls: { resourcesPage: "https://nadpbe.org/pbe-resources/", commentaryPdf: "https://example.com/commentary.pdf", versesPdf: "https://example.com/verses.pdf" },
  approvedBy: "owner-1", approvedAtUtc: "2026-09-16T12:00:00Z", version: 1,
};

const summary = {
  yearLabel: "2025-26",
  books: [{ bookKey: "ISA", bookName: "Isaiah", chapters: [1, 2, 3] }],
  commentary: { bookName: "Isaiah", title: "ISAIAH", sectionHeadings: ["Title and Authorship", "Date"] },
  sourceUrls: { resourcesPage: "https://nadpbe.org/pbe-resources/", versesPdf: "https://example.com/verses.pdf" },
  approvedAtUtc: "2026-09-16T12:00:00Z",
};

function renderSection(props: { seasonId?: string | null; onOpenChapter?: (packId: string, chapter: number) => void } = {}) {
  const onOpenChapter = props.onOpenChapter ?? vi.fn();
  const seasonId = props.seasonId === undefined ? "season-1" : props.seasonId;
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>
    <PbeMaterialsSection org="org-1" seasonId={seasonId} books={books as never} onOpenChapter={onOpenChapter} />
  </MemoryRouter></QueryClientProvider>);
  return onOpenChapter;
}

beforeEach(() => { vi.clearAllMocks(); });

it("renders the year badge, roster chips, commentary, and view-original links for a season", async () => {
  vi.mocked(api.pbeMaterialCurrent).mockResolvedValue({ material });
  renderSection();
  expect(await screen.findByText("This year's PBE materials")).toBeInTheDocument();
  expect(await screen.findByText("2025–26")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Read Isaiah in the chapter reader/ })).toHaveTextContent("Isaiah · 1–3");
  expect(screen.getByText("ISAIAH")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Title and Authorship" })).toBeInTheDocument();
  expect(screen.getByText("The superscription in Isaiah 1:1 gives the identity of the seer, Isaiah son of Amoz, and the mode of revelation.")).toBeInTheDocument();
  const originals = screen.getAllByRole("link", { name: "View original" });
  expect(originals.map(link => link.getAttribute("href"))).toEqual(expect.arrayContaining(["https://example.com/commentary.pdf", "https://example.com/verses.pdf"]));
  expect(originals[0]).toHaveAttribute("target", "_blank");
  expect(api.pbeMaterialCurrent).toHaveBeenCalledWith("org-1", "season-1");
});

it("jumps a roster chip into the chapter reader by matching bookKey", async () => {
  vi.mocked(api.pbeMaterialCurrent).mockResolvedValue({ material });
  const onOpenChapter = renderSection();
  fireEvent.click(await screen.findByRole("button", { name: /Read Isaiah in the chapter reader/ }));
  expect(onOpenChapter).toHaveBeenCalledWith("isa-pack", 1);
});

it("shows the empty state when the season's year has no release", async () => {
  vi.mocked(api.pbeMaterialCurrent).mockResolvedValue({ material: null });
  renderSection();
  expect(await screen.findByText("This year's materials haven't been released yet.")).toBeInTheDocument();
});

it("falls back to the most recent live release without a season, badged by year", async () => {
  vi.mocked(api.pbeMaterials).mockResolvedValue([{ ...summary, yearLabel: "2024-25" }, summary]);
  renderSection({ seasonId: null });
  expect(await screen.findByText("2025–26")).toBeInTheDocument();
  expect(screen.getByText(/most recent released year/)).toBeInTheDocument();
  // Summary mode: headings only, no flashcards yet.
  expect(screen.getByText("Title and Authorship")).toBeInTheDocument();
  expect(screen.queryByTestId("pbe-flashcard")).not.toBeInTheDocument();
  expect(api.pbeMaterials).toHaveBeenCalledWith("org-1");
  expect(api.pbeMaterialCurrent).not.toHaveBeenCalled();
});

it("reports load failures with a retry", async () => {
  vi.mocked(api.pbeMaterialCurrent).mockRejectedValue(new Error("Offline"));
  renderSection();
  expect(await screen.findByText(/could not load/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(api.pbeMaterialCurrent).toHaveBeenCalledTimes(2);
});

it("flips flashcards through every section with prev/next", async () => {
  vi.mocked(api.pbeMaterialCurrent).mockResolvedValue({ material });
  renderSection();
  const card = await screen.findByTestId("pbe-flashcard");
  expect(card).toHaveTextContent("What does the introduction say about Title and Authorship?");
  expect(card).toHaveTextContent("Hint: The superscription in Isaiah 1:1 gives the identity of the seer,");
  expect(card).not.toHaveTextContent("740 B.C.");
  expect(screen.getByText("1 of 2")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  expect(card).toHaveTextContent("The superscription in Isaiah 1:1 gives the identity of the seer, Isaiah son of Amoz, and the mode of revelation.");
  fireEvent.click(screen.getByRole("button", { name: "Next flashcard" }));
  expect(card).toHaveTextContent("What does the introduction say about Date?");
  expect(screen.getByText("2 of 2")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Previous flashcard" }));
  expect(card).toHaveTextContent("What does the introduction say about Title and Authorship?");
});
