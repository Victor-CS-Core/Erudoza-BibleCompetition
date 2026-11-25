// Training CROSS-BOUNDARY render test (card 15): renders the real
// HonorsPage and PassagePicker from payloads the real worker emitted
// (captured by worker/native/capture-training.test.ts into
// __fixtures__/training-payloads.json, with the profile payload from
// capture-profile.test.ts and the seasons list from capture-study.test.ts),
// so a server/client field drift fails HERE even if each side's own tests
// stay green — the Nov 24 Content-tab lesson, applied to the training
// surface. Only useAuth is mocked (identity, not payload shape); the real
// api client and real components do the rest.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { HonorsPage } from "./HonorsPage";
import { PassagePicker } from "./PassagePicker";
import trainingFixture from "./__fixtures__/training-payloads.json";
import studyFixture from "./__fixtures__/study-payloads.json";
import profileFixture from "../profile/__fixtures__/profile-payloads.json";

type Captured = { status: number; body: never };
const training = trainingFixture as unknown as Record<string, Captured>;
const study = studyFixture as unknown as Record<string, Captured>;
const profile = profileFixture as unknown as Record<string, Captured>;
const seasonId = (study.progress.body as unknown as { seasonId: string }).seasonId;
const honors = training.honors.body as unknown as { key: string; title: string; completed: number; target: number }[];
const progressed = honors.find(h => h.completed > 0)!;
const journeyChapter = (training.journey.body as unknown as { chapters: { passages: { title: string }[] }[] }).chapters[0];

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ me: { organizationId: "11111111-1111-4111-8111-111111111111", userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", displayName: "Coach" } }),
}));

function route(rawUrl: string): { status: number; body: unknown } {
  const url = new URL(rawUrl, "https://erudoza.test");
  const path = url.pathname;
  if (path === "/api/v1/progress/me/seasons") return study.seasons;
  if (path === "/api/v1/progress/me/honors") return training.honors;
  if (path === "/api/v1/progress/me/journey") return training.journey;
  if (path === "/api/v1/progress/me/chapters") return url.searchParams.get("view") === "Stamps" ? training.chapterStamps : training.chapters;
  if (path === "/api/v1/profile/me") return profile.me;
  return { status: 404, body: { detail: `unrouted ${path}` } };
}

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const { status, body } = route(String(input));
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
});
afterEach(() => { cleanup(); });

function wrap(children: React.ReactNode, path = "/student/honors") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
}

it("renders the Honors page from real honors + profile + stamps payloads", async () => {
  wrap(<HonorsPage />, `/student/honors?seasonId=${seasonId}`);
  // Profile payload: exactly one mastery patch earned server-side.
  expect(await screen.findByText("1 Achievement patch earned")).toBeTruthy();
  expect(screen.getAllByText("Exact Recall").length).toBeGreaterThan(0);
  // Training honors payload: milestone progress renders as completed/target.
  fireEvent.click(screen.getByText("Practice milestones", { selector: "summary" }));
  expect(await screen.findByText(`${progressed.completed} / ${progressed.target}`)).toBeTruthy();
  expect(screen.getAllByText(progressed.title).length).toBeGreaterThan(0);
  // Stamps payload (empty page from the real projection): honest empty state.
  expect(screen.getByText("No chapter stamps yet this season.")).toBeTruthy();
  expect(document.body.textContent).not.toContain("could not load");
}, 30000);

it("renders the passage picker from the real journey payload", async () => {
  wrap(<PassagePicker seasonId={seasonId} />, "/student");
  // Every passage title the server emitted for the chapter becomes a tile.
  for (const passage of journeyChapter.passages) {
    await waitFor(() => expect(document.body.textContent).toContain(passage.title));
  }
  expect(document.body.textContent).toContain("Genesis");
  expect(document.body.textContent).not.toContain("could not load");
}, 30000);
