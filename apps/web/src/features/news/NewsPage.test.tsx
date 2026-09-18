import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { NewsPage } from "./NewsPage";
import { ArticleTypeArt } from "./articleTypeArt";

vi.mock("../../api/client", () => ({ api: { pbeNews: vi.fn(), pbeNewsArticle: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org-1", userId: "user-1" } }) }));

const articles = [
  { id: "art-1", title: "New PBE materials detected", summary: "NAD posted a new Commentary PDF for the 2026–27 competition year.", publishedAtUtc: "2026-09-16T12:00:00Z", sourceUrl: "https://nadpbe.org/wp-content/uploads/x.pdf", sourceLabel: "nadpbe.org" },
  { id: "art-2", title: "Event update", summary: "Division finals moved to April.", publishedAtUtc: "2026-09-10T12:00:00Z" },
];

function renderNews(path: string, base = "/student/news") {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/news" element={<NewsPage base={base} />} />
      <Route path="/news/:id" element={<NewsPage base={base} />} />
    </Routes>
  </MemoryRouter></QueryClientProvider>);
}

beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.pbeNews).mockResolvedValue(articles); });

it("renders feed cards with type kickers, summaries, dates, and source chips", async () => {
  renderNews("/news");
  expect(await screen.findByText("New PBE materials detected")).toBeInTheDocument();
  // Old records without a type fall back to the Announcement art.
  const kickers = [...document.querySelectorAll(".news-card .news-kicker")].map(kicker => kicker.textContent);
  expect(kickers).toEqual(["Announcement", "Announcement"]);
  const strips = document.querySelectorAll(".article-art-strip");
  expect(strips).toHaveLength(2);
  expect(strips[0]).toHaveAttribute("data-type", "announcement");
  expect(screen.getByText("Event update")).toBeInTheDocument();
  expect(screen.getByText("NAD posted a new Commentary PDF for the 2026–27 competition year.")).toBeInTheDocument();
  const chip = screen.getByRole("link", { name: "nadpbe.org" });
  expect(chip).toHaveAttribute("href", "https://nadpbe.org/wp-content/uploads/x.pdf");
  expect(chip).toHaveAttribute("target", "_blank");
  // The article without a source shows no chip.
  expect(screen.getAllByRole("link", { name: "nadpbe.org" })).toHaveLength(1);
  expect(screen.getByText("September 16, 2026")).toBeInTheDocument();
  expect(api.pbeNews).toHaveBeenCalledWith("org-1");
});

it("opens the article reader from a card link", async () => {
  vi.mocked(api.pbeNewsArticle).mockResolvedValue({ ...fullArticle, id: "art-2", title: "Event update" } as never);
  renderNews("/news", "/news");
  fireEvent.click(await screen.findByRole("link", { name: "Event update" }));
  expect(await screen.findByRole("heading", { name: "Event update" })).toBeInTheDocument();
  expect(api.pbeNewsArticle).toHaveBeenCalledWith("org-1", "art-2");
});

it("shows the empty state when nothing is published", async () => {
  vi.mocked(api.pbeNews).mockResolvedValue([]);
  renderNews("/news");
  expect(await screen.findByText("No PBE news yet")).toBeInTheDocument();
});

it("reports feed load failures with a retry", async () => {
  vi.mocked(api.pbeNews).mockRejectedValue(new Error("Offline"));
  renderNews("/news");
  expect(await screen.findByText(/could not load/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(api.pbeNews).toHaveBeenCalledTimes(2);
});

const fullArticle = {
  id: "art-1", title: "New PBE materials detected", summary: "NAD posted a new Commentary PDF.",
  sections: [{ heading: "What appeared", body: "A commentary PDF for Isaiah." }, { heading: "Next steps", body: "Review the draft proposal." }],
  sourceUrl: "https://nadpbe.org/wp-content/uploads/x.pdf", sourceLabel: "nadpbe.org",
  status: "published", createdBy: "nad-watcher", createdAtUtc: "2026-09-16T12:00:00Z", updatedAtUtc: "2026-09-16T12:00:00Z", publishedAtUtc: "2026-09-16T13:00:00Z",
};

it("renders the full article with sections and a view-original link", async () => {
  vi.mocked(api.pbeNewsArticle).mockResolvedValue(fullArticle as never);
  renderNews("/news/art-1");
  expect(await screen.findByRole("heading", { name: "New PBE materials detected" })).toBeInTheDocument();
  expect(screen.getByText("NAD posted a new Commentary PDF.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "What appeared" })).toBeInTheDocument();
  expect(screen.getByText("A commentary PDF for Isaiah.")).toBeInTheDocument();
  const original = screen.getByRole("link", { name: "View original announcement" });
  expect(original).toHaveAttribute("href", "https://nadpbe.org/wp-content/uploads/x.pdf");
  expect(original).toHaveAttribute("target", "_blank");
  expect(screen.getByRole("link", { name: "← All news" })).toHaveAttribute("href", "/student/news");
  expect(api.pbeNewsArticle).toHaveBeenCalledWith("org-1", "art-1");
});

it("omits the view-original link when the article has no source URL", async () => {
  vi.mocked(api.pbeNewsArticle).mockResolvedValue({ ...fullArticle, sourceUrl: undefined } as never);
  renderNews("/news/art-1");
  await screen.findByRole("heading", { name: "New PBE materials detected" });
  expect(screen.queryByRole("link", { name: "View original announcement" })).not.toBeInTheDocument();
});

it("explains when an article is unavailable (draft or unknown)", async () => {
  vi.mocked(api.pbeNewsArticle).mockRejectedValue(new Error("Not found"));
  renderNews("/news/nope");
  expect(await screen.findByText(/not available/)).toBeInTheDocument();
});

it("uses the coach base path for back navigation", async () => {
  vi.mocked(api.pbeNewsArticle).mockResolvedValue(fullArticle as never);
  renderNews("/news/art-1", "/admin/news");
  await screen.findByRole("heading", { name: "New PBE materials detected" });
  expect(screen.getByRole("link", { name: "← All news" })).toHaveAttribute("href", "/admin/news");
});

it("renders an art strip per article type and falls back to announcement", () => {
  const { container, rerender } = render(<ArticleTypeArt type="competition" />);
  expect(container.querySelector('[data-type="competition"]')).not.toBeNull();
  for (const type of ["study-material", "rule-update", "announcement"] as const) {
    rerender(<ArticleTypeArt type={type} />);
    expect(container.querySelector(`[data-type="${type}"]`)).not.toBeNull();
  }
  rerender(<ArticleTypeArt type="something-unknown" />);
  expect(container.querySelector('[data-type="announcement"]')).not.toBeNull();
  rerender(<ArticleTypeArt />);
  expect(container.querySelector('[data-type="announcement"]')).not.toBeNull();
});

const typedArticles = [
  {
    id: "art-1", title: "Finals announced", summary: "The finals schedule is out.",
    publishedAtUtc: "2026-09-16T12:00:00Z", articleType: "competition", readMinutes: 4,
    keyPoints: ["Division finals on April 4", "New 60-second huddle rule"],
    linkedMaterials: [
      { label: "Finals schedule", href: "/student/practice", hint: "Team Practice" },
      { label: "NAD announcement", href: "https://nadpbe.org/finals" },
    ],
  },
  { id: "art-2", title: "Old record", summary: "Legacy article without the new fields.", publishedAtUtc: "2026-09-10T12:00:00Z" },
];

it("shows key-point chips and deep links on the feed card", async () => {
  vi.mocked(api.pbeNews).mockResolvedValue(typedArticles as never);
  renderNews("/news");
  await screen.findByText("Finals announced");
  const kickers = [...document.querySelectorAll(".news-card .news-kicker")].map(kicker => kicker.textContent);
  expect(kickers).toEqual(["Competition", "Announcement"]);
  expect(screen.getByText("In this article")).toBeInTheDocument();
  expect(screen.getByText("Division finals on April 4")).toBeInTheDocument();
  expect(screen.getByText("New 60-second huddle rule")).toBeInTheDocument();
  expect(screen.getByText("4 min read")).toBeInTheDocument();
  const internal = screen.getByRole("link", { name: "Finals schedule" });
  expect(internal).toHaveAttribute("href", "/student/practice");
  expect(internal).not.toHaveAttribute("target");
  const external = screen.getByRole("link", { name: "NAD announcement" });
  expect(external).toHaveAttribute("href", "https://nadpbe.org/finals");
  expect(external).toHaveAttribute("target", "_blank");
  // The legacy card shows no "In this article" block.
  expect(screen.getAllByText("In this article")).toHaveLength(1);
});

it("renders the reading material panel with deep links in the article reader", async () => {
  vi.mocked(api.pbeNewsArticle).mockResolvedValue({
    ...fullArticle,
    articleType: "study-material",
    linkedMaterials: [
      { label: "Isaiah 53 commentary notes", href: "/student/study?book=ISA", hint: "Library › 2025–26 › Isaiah 53" },
      { label: "Official commentary PDF, p. 42", href: "https://nadpbe.org/commentary.pdf" },
    ],
  } as never);
  renderNews("/news/art-1");
  await screen.findByRole("heading", { name: "New PBE materials detected" });
  expect(document.querySelector(".news-article .news-kicker")?.textContent).toBe("Study material");
  const panel = screen.getByRole("region", { name: "Reading material" });
  expect(panel.querySelector(".article-art-strip")).toBeNull();
  const openLinks = within(panel).getAllByRole("link", { name: "Open" });
  expect(openLinks).toHaveLength(2);
  expect(openLinks[0]).toHaveAttribute("href", "/student/study?book=ISA");
  expect(openLinks[0]).not.toHaveAttribute("target");
  expect(openLinks[1]).toHaveAttribute("href", "https://nadpbe.org/commentary.pdf");
  expect(openLinks[1]).toHaveAttribute("target", "_blank");
  expect(within(panel).getByText("Library › 2025–26 › Isaiah 53")).toBeInTheDocument();
});

it("omits the reading material panel when an article has no linked materials", async () => {
  vi.mocked(api.pbeNewsArticle).mockResolvedValue(fullArticle as never);
  renderNews("/news/art-1");
  await screen.findByRole("heading", { name: "New PBE materials detected" });
  expect(screen.queryByRole("region", { name: "Reading material" })).not.toBeInTheDocument();
});
