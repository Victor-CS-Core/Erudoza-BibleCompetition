// News CROSS-BOUNDARY render test (card 15): renders the real NewsPage feed
// and article reader from payloads the real worker emitted (captured by
// worker/native/capture-news.test.ts into __fixtures__/news-payloads.json),
// so a server/client field drift fails HERE even if each side's own tests
// stay green — the Nov 24 Content-tab lesson, applied to the news surface.
// Only useAuth is mocked (identity, not payload shape); the real api client
// and the real page do the rest.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { NewsPage } from "./NewsPage";
import fixture from "./__fixtures__/news-payloads.json";

type Captured = { status: number; body: never };
const payloads = fixture as unknown as Record<string, Captured>;

vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "11111111-1111-4111-8111-111111111111", userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } }) }));

let emptyFeed = false;
function route(rawUrl: string): { status: number; body: unknown } {
  const url = new URL(rawUrl, "https://erudoza.test");
  if (url.pathname.endsWith("/pbe-news")) return emptyFeed ? { status: 200, body: [] } : payloads.feed;
  if (url.pathname.includes("/pbe-news/")) return payloads.article;
  return { status: 404, body: { detail: `unrouted ${url.pathname}` } };
}

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const { status, body } = route(String(input));
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { cleanup(); emptyFeed = false; });

function page(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/news" element={<NewsPage base="/news" />} />
          <Route path="/news/:id" element={<NewsPage base="/news" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("renders the feed from real server payloads", async () => {
  page("/news");
  expect(await screen.findByText("New PBE materials detected")).toBeTruthy();
  expect(screen.getByText("NAD posted a new Commentary PDF for the 2026–27 competition year.")).toBeTruthy();
  // Server-emitted source label becomes the source chip; the legacy article
  // (null sourceUrl in the real payload) shows no chip.
  expect(screen.getAllByRole("link", { name: "nadpbe.org" })).toHaveLength(1);
  expect(screen.getByText("Event update")).toBeTruthy();
  expect(screen.getByText("November 19, 2026")).toBeTruthy();
  // Server-emitted key points and read time survive the wire.
  expect(screen.getByText("New commentary PDF")).toBeTruthy();
  expect(document.body.textContent).not.toContain("could not load");
}, 30000);

it("renders the article reader from the real server payload", async () => {
  page("/news/news-capture-1");
  expect(await screen.findByText("What changed")).toBeTruthy();
  expect(screen.getByText("The commentary file was replaced on the resources page.")).toBeTruthy();
  expect(screen.getByText("Jump to the reading material")).toBeTruthy();
  expect(document.body.textContent).not.toContain("isn't available anymore");
}, 30000);

it("renders the honest empty state from an empty real-shaped feed", async () => {
  emptyFeed = true;
  page("/news");
  expect(await screen.findByText("Nothing new yet")).toBeTruthy();
}, 30000);
