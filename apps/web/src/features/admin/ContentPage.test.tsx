import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { ContentPage } from "./ContentPage";
vi.mock("../../api/client", () => ({ api: { library: vi.fn(), sourceUnits: vi.fn(), contentPacks: vi.fn(), scriptureCatalog: vi.fn(), scriptureBooks: vi.fn(), scriptureChapters: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org-1" } }) }));
const library = { translationId: "nkjv" as const, translationName: "New King James Version", version: 1, books: [
  { contentPackId: "eph", bookKey: "EPH", name: "Ephesians", verseCount: 12, chapters: [1,2,3,4,5,6].map(number => ({ number, verses: [1,2] })) },
  { contentPackId: "jude", bookKey: "JUD", name: "Jude", verseCount: 2, chapters: [{ number: 1, verses: [1,2] }] },
] };
function renderPage() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ContentPage /></MemoryRouter></QueryClientProvider>); }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.library).mockResolvedValue(library); vi.mocked(api.contentPacks).mockResolvedValue([]); vi.mocked(api.sourceUnits).mockResolvedValue([{ id: "v", bookKey: "EPH", chapter: 1, verse: 1, ordinal: 1, citation: "Ephesians 1:1", canonicalText: "Preview fixture" }]); });
it("searches built-in books and previews text without import or deletion controls", async () => {
  renderPage();
  fireEvent.change(await screen.findByRole("searchbox", { name: "Search books" }), { target: { value: "Ephes" } });
  expect(screen.queryByRole("button", { name: /Jude/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Ephesians/ }));
  expect(await screen.findByText("Preview fixture")).toBeInTheDocument();
  expect(screen.getByText("New King James Version")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /import|delete|load sample/i })).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/translation/i)).not.toBeInTheDocument();
});
it("limits preview chapters to server metadata and resets for a shorter book", async () => {
  renderPage(); fireEvent.click(await screen.findByRole("button", { name: /Ephesians/ }));
  const chapter = screen.getByRole("combobox", { name: "Preview chapter" });
  expect(chapter.querySelector('option[value="7"]')).toBeNull();
  fireEvent.change(chapter, { target: { value: "6" } });
  fireEvent.click(screen.getByRole("button", { name: /Jude/ }));
  expect(chapter).toHaveValue("1"); expect(chapter.querySelectorAll("option")).toHaveLength(1);
});
it("reports unavailable installation and lets coaches retry", async () => {
  vi.mocked(api.library).mockRejectedValue(new Error("The library is not installed.")); renderPage();
  expect(await screen.findByRole("alert")).toHaveTextContent("The library is not installed.");
  expect(screen.getByRole("button", { name: "Retry library" })).toBeInTheDocument();
});
it("allows retrying a failed source preview", async () => {
  vi.mocked(api.sourceUnits).mockRejectedValue(new Error("Offline")); renderPage();
  fireEvent.click(await screen.findByRole("button", { name: /Ephesians/ }));
  expect(await screen.findByRole("button", { name: "Retry verses" })).toBeInTheDocument();
});
