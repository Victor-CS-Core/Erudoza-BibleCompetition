import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { NewsPage } from "./NewsPage";

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

it("renders the feed with a hero card, article cards, dates, and source chips", async () => {
  renderNews("/news");
  expect(await screen.findByText("New PBE materials detected")).toBeInTheDocument();
  expect(screen.getByText("Latest update")).toBeInTheDocument();
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
