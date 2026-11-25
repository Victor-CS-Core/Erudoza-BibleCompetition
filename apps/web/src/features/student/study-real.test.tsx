// Study/session CROSS-BOUNDARY render test (card 15): renders the real
// StudyPage and SessionRecapPage from payloads the real worker emitted
// (captured by worker/native/capture-study.test.ts into
// __fixtures__/study-payloads.json; the HQ "today" payload comes from
// capture-training.test.ts), so a server/client field drift fails HERE even
// if each side's own tests stay green — the Nov 24 Content-tab lesson,
// applied to the highest-traffic surface. Only useAuth is mocked (identity,
// not payload shape); the real api client and real pages do the rest.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/ui";
import { StudyPage } from "./StudyPage";
import { SessionRecapPage } from "./SessionRecapPage";
import studyFixture from "./__fixtures__/study-payloads.json";
import trainingFixture from "./__fixtures__/training-payloads.json";

type Captured = { status: number; body: never };
const study = studyFixture as unknown as Record<string, Captured>;
const training = trainingFixture as unknown as Record<string, Captured>;
const progress = study.progress.body as unknown as { seasonId: string; studentUserId: string };
const sessionId = (study.start.body as unknown as { id: string }).id;
// Expected strings come from the captured payloads themselves (the deck is
// shuffled server-side, so the drawn citation varies between captures).
const drawnCitation = (study.card.body as unknown as { citation: string }).citation;
const recapTitle = (study.recap.body as unknown as { passageChanges: { title: string }[] }).passageChanges[0].title;
const todayXp = (training.today.body as unknown as { xp: { total: number; level: number; levelName: string } }).xp;

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ me: { organizationId: "11111111-1111-4111-8111-111111111111", userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", displayName: "Coach" } }),
}));
vi.mock("../admin/ContentPage", () => ({ ContentPage: () => <div data-testid="library-embed">Scripture library</div> }));

function route(rawUrl: string, method: string): { status: number; body: unknown } {
  const url = new URL(rawUrl, "https://erudoza.test");
  const path = url.pathname;
  if (path === "/api/v1/progress/me") return study.progress;
  if (path === "/api/v1/progress/me/seasons") return study.seasons;
  if (path === "/api/v1/progress/me/today") return training.today;
  if (path === `/api/v1/study/sessions/${sessionId}` && method === "GET") return study.resume;
  if (path === `/api/v1/study/sessions/${sessionId}/next`) return study.card;
  if (path === `/api/v1/study/sessions/${sessionId}/recap`) return study.recap;
  return { status: 404, body: { detail: `unrouted ${method} ${path}` } };
}

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { status, body } = route(String(input), init?.method ?? "GET");
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
});
afterEach(() => { cleanup(); });

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter([
    { path: "/student/study", element: <StudyPage /> },
    { path: "/student/sessions/:sessionId/recap", element: <SessionRecapPage /> },
    { path: "/student", element: <p>Training HQ</p> },
    { path: "/student/honors", element: <p>Honors</p> },
    { path: "/student/progress", element: <p>Progress</p> },
  ], { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { view, router };
}

it("renders the session recap from the real server payload", async () => {
  renderAt(`/student/sessions/${sessionId}/recap`);
  // Server-emitted counts and XP land in the recap's own words.
  expect(await screen.findByText("You got 1 of 1 right.")).toBeTruthy();
  expect(screen.getByText("Your practice is saved.")).toBeTruthy();
  expect(screen.getByText("+60")).toBeTruthy();
  // Quests the server recorded mid-session + at completion are celebrated.
  expect(screen.getByText("Quest complete: Explorer!")).toBeTruthy();
  expect(screen.getByText("Quest complete: Sharpshooter!")).toBeTruthy();
  // The passage the server says changed renders with its title.
  expect(document.body.textContent).toContain(recapTitle);
  expect(document.body.textContent).not.toContain("could not be loaded");
  expect(document.body.textContent).not.toContain("not available");
}, 30000);

it("reopens a saved session from the real resume payload", async () => {
  renderAt(`/student/study?sessionId=${sessionId}`);
  // The attempted card's citation renders from the server payload, and the
  // resume does not fall into the error state.
  await waitFor(() => expect(document.body.textContent).toContain(drawnCitation));
  expect(document.body.textContent).not.toContain("couldn't reopen your saved session");
}, 30000);

it("renders the study setup from real progress + today payloads", async () => {
  renderAt(`/student/study?seasonId=${progress.seasonId}`);
  // The mode-select header renders the TODAY payload's level line and XP
  // total verbatim — server numbers, not client recomputation.
  await waitFor(() => expect(document.body.textContent).toContain(`Level ${todayXp.level} · ${todayXp.levelName}`));
  expect(document.body.textContent).toContain(`${todayXp.total} XP`);
  expect(document.body.textContent).not.toContain("could not load");
}, 30000);
