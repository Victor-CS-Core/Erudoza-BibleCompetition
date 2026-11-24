import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import type { Progress } from "../../api/types";
import type { PassageJourneyPage } from "../../api/trainingTypes";
import { trainingApi } from "../../api/training";
import { PassagePicker } from "./PassagePicker";
import { skills } from "./trainingFixtures";

vi.mock("../../api/training", () => ({ trainingApi: { journey: vi.fn() } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org", userId: "student" } }) }));

type JourneyChapter = PassageJourneyPage["chapters"][number];
type JourneyPassage = JourneyChapter["passages"][number];
type MasteryItem = Progress["mastery"][number];

const passage = (overrides: Partial<JourneyPassage> = {}): JourneyPassage => ({ knowledgeUnitId: "k1", title: "Daniel 1:1", level: "Learning", algorithmVersion: "v2-skill-evidence", skills, dueAtUtc: null, ...overrides });
const chapter = (overrides: Partial<JourneyChapter> = {}): JourneyChapter => ({ bookKey: "DAN", chapter: 1, scopeLabel: "Assigned scope", eligibleCount: 1, seenCount: 1, strongCount: 0, passages: [passage()], ...overrides });
const journeyPage = (chapters: JourneyChapter[], after: string | null = null): PassageJourneyPage => ({ seasonId: "s", scopeVersion: "scope", after, chapters });
const masteryItem = (overrides: Partial<MasteryItem> = {}): MasteryItem => ({ knowledgeUnitId: "k1", title: "Daniel 1:1", level: "Learning", exactWordingScore: 40, recognitionScore: 40, reviewDueAtUtc: null, ...overrides });

function view(mastery: MasteryItem[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><PassagePicker seasonId="s" mastery={mastery} difficulty="Standard" /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => { vi.resetAllMocks(); });

it("switches books and re-renders the verse grid", async () => {
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyPage([
    chapter(),
    chapter({ bookKey: "JON", passages: [passage({ knowledgeUnitId: "j1", title: "Jonah 1:1", level: "Unseen", algorithmVersion: "unknown" })] }),
  ]));
  view();
  expect(await screen.findByRole("link", { name: /Daniel 1:1:/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Jonah: 1 of 1 passages practiced/ }));
  expect(await screen.findByRole("link", { name: /Jonah 1:1:/ })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Daniel 1:1:/ })).not.toBeInTheDocument();
});

it("switches chapters within a book and flags chapters holding a due verse", async () => {
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyPage([
    chapter(),
    chapter({ chapter: 2, seenCount: 0, passages: [passage({ knowledgeUnitId: "k2", title: "Daniel 2:1", level: "Review", dueAtUtc: "2026-01-01T00:00:00Z" })] }),
  ]));
  view();
  expect(await screen.findByRole("link", { name: /Daniel 1:1:/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Chapter 2: 0 of 1 practiced, has a review due/ }));
  expect(await screen.findByRole("link", { name: /Daniel 2:1:/ })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Daniel 1:1:/ })).not.toBeInTheDocument();
});

it("renders every tile state from the passage data", async () => {
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyPage([
    chapter({ eligibleCount: 5, seenCount: 3, strongCount: 2, passages: [
      passage({ knowledgeUnitId: "m", title: "Daniel 1:1", level: "Mastered" }),
      passage({ knowledgeUnitId: "st", title: "Daniel 1:2", level: "Strong" }),
      passage({ knowledgeUnitId: "l", title: "Daniel 1:3", level: "Learning" }),
      passage({ knowledgeUnitId: "u", title: "Daniel 1:4", level: "Unseen", algorithmVersion: "unknown" }),
      passage({ knowledgeUnitId: "d", title: "Daniel 1:5", level: "Review", dueAtUtc: "2026-01-01T00:00:00Z" }),
    ] }),
  ]));
  view();
  const mastered = await screen.findByRole("link", { name: "Daniel 1:1: mastered" });
  expect(mastered).toHaveClass("is-mastered");
  expect(mastered.querySelector("svg")).not.toBeNull();
  expect(screen.getByRole("link", { name: "Daniel 1:2: strong" })).toHaveClass("is-strong");
  const learning = screen.getByRole("link", { name: "Daniel 1:3: in progress, 34 percent" });
  expect(learning).toHaveClass("is-progress");
  expect(learning.querySelector(".passage-picker-sliver > span")).toHaveStyle({ width: "34%" });
  const unseen = screen.getByRole("link", { name: "Daniel 1:4: not started" });
  expect(unseen).toHaveClass("is-unseen");
  expect(unseen.querySelector("svg")).toBeNull();
  expect(screen.getByRole("link", { name: /Daniel 1:5:.*review due/ })).toHaveClass("is-due");
});

it("starts a Review session from a due tile and Practice from the rest", async () => {
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyPage([
    chapter({ eligibleCount: 2, passages: [
      passage({ knowledgeUnitId: "d", title: "Daniel 1:1", level: "Review", dueAtUtc: "2026-01-01T00:00:00Z" }),
      passage({ knowledgeUnitId: "p", title: "Daniel 1:2", level: "Learning" }),
    ] }),
  ]));
  view();
  expect(await screen.findByRole("link", { name: /Daniel 1:1:/ })).toHaveAttribute("href", "/student/study?mode=Review&format=Memory&knowledgeUnitId=d&seasonId=s");
  expect(screen.getByRole("link", { name: /Daniel 1:2:/ })).toHaveAttribute("href", "/student/study?mode=Practice&knowledgeUnitId=p&seasonId=s");
});

it("carries Memory format on the detail card link only when its passage is due", async () => {
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyPage([
    chapter({ eligibleCount: 2, passages: [
      passage({ knowledgeUnitId: "d", title: "Daniel 1:1", level: "Review", dueAtUtc: "2026-01-01T00:00:00Z" }),
      passage({ knowledgeUnitId: "p", title: "Daniel 1:2", level: "Learning" }),
    ] }),
  ]));
  view();
  expect(await screen.findByText("Passage details for Daniel 1")).toBeInTheDocument();
  const links = document.querySelectorAll(".journey-practice-link");
  expect(links).toHaveLength(2);
  expect(links[0]).toHaveAttribute("href", "/student/study?mode=Review&format=Memory&knowledgeUnitId=d&seasonId=s");
  expect(links[1]).toHaveAttribute("href", "/student/study?mode=Practice&knowledgeUnitId=p&seasonId=s");
});

it("puts a due review Up next ahead of a weaker unmastered passage", async () => {
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyPage([
    chapter({ eligibleCount: 2, passages: [
      passage({ knowledgeUnitId: "weak", title: "Daniel 1:3" }),
      passage({ knowledgeUnitId: "due1", title: "Daniel 1:8", level: "Review", dueAtUtc: "2026-01-01T00:00:00Z" }),
    ] }),
  ]));
  view([
    masteryItem({ knowledgeUnitId: "weak", title: "Daniel 1:3", level: "Learning", exactWordingScore: 10 }),
    masteryItem({ knowledgeUnitId: "due1", title: "Daniel 1:8", level: "Review", exactWordingScore: 62, reviewDueAtUtc: "2026-01-01T00:00:00Z" }),
  ]);
  const card = await screen.findByTestId("passage-picker-upnext");
  expect(within(card).getByText("Daniel 1:8")).toBeInTheDocument();
  expect(within(card).getByText("Review due · Last score 62")).toBeInTheDocument();
  expect(within(card).getByRole("link", { name: /Review this passage/ })).toHaveAttribute("href", "/student/study?mode=Review&format=Memory&knowledgeUnitId=due1&seasonId=s");
});

it("falls back to the weakest unmastered passage when nothing is due", async () => {
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyPage([chapter()]));
  view([
    masteryItem({ knowledgeUnitId: "s1", title: "Daniel 1:1", level: "Strong", exactWordingScore: 90 }),
    masteryItem({ knowledgeUnitId: "w1", title: "Daniel 1:2", level: "Learning", exactWordingScore: 25 }),
    masteryItem({ knowledgeUnitId: "w2", title: "Daniel 1:3", level: "Learning", exactWordingScore: 15 }),
  ]);
  const card = await screen.findByTestId("passage-picker-upnext");
  expect(within(card).getByText("Daniel 1:3")).toBeInTheDocument();
  expect(within(card).getByText("Needs practice · Last score 15")).toBeInTheDocument();
  expect(within(card).getByRole("link", { name: /Practice this passage/ })).toHaveAttribute("href", "/student/study?mode=Practice&knowledgeUnitId=w2&seasonId=s");
});

it("shows no Up next card when every passage is mastered or strong", async () => {
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyPage([chapter()]));
  view([masteryItem({ level: "Mastered", exactWordingScore: 100 }), masteryItem({ knowledgeUnitId: "k2", title: "Daniel 1:2", level: "Strong", exactWordingScore: 88 })]);
  expect(await screen.findByRole("link", { name: /Daniel 1:1:/ })).toBeInTheDocument();
  expect(screen.queryByTestId("passage-picker-upnext")).not.toBeInTheDocument();
});

it("shows the empty state when no passages are eligible", async () => {
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyPage([]));
  view();
  expect(await screen.findByText("No eligible passages yet")).toBeInTheDocument();
  expect(screen.getByText("Your coach will add your study assignment here.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Choose a passage to practice" })).toBeInTheDocument();
});

it("loads the remaining journey pages automatically — no Load more button", async () => {
  vi.mocked(trainingApi.journey)
    .mockResolvedValueOnce(journeyPage([chapter()], "cursor"))
    .mockResolvedValue(journeyPage([chapter({ bookKey: "JON", passages: [passage({ knowledgeUnitId: "j1", title: "Jonah 1:1" })] })]));
  view();
  expect(await screen.findByRole("button", { name: /Jonah: 1 of 1 passages practiced/ })).toBeInTheDocument();
  expect(trainingApi.journey).toHaveBeenCalledWith("s", "cursor");
  expect(screen.queryByRole("button", { name: "Load more passages" })).not.toBeInTheDocument();
});

it("merges a chapter split across two journey pages instead of doubling it", async () => {
  vi.mocked(trainingApi.journey)
    .mockResolvedValueOnce(journeyPage([
      chapter({ eligibleCount: 3, seenCount: 1, passages: [passage(), passage({ knowledgeUnitId: "k2", title: "Daniel 1:2" })] }),
    ], "cursor"))
    .mockResolvedValue(journeyPage([
      chapter({ eligibleCount: 3, seenCount: 1, passages: [passage({ knowledgeUnitId: "k3", title: "Daniel 1:3" })] }),
      chapter({ bookKey: "JON", passages: [passage({ knowledgeUnitId: "j1", title: "Jonah 1:1" })] }),
    ]));
  view();
  // Book totals count the split chapter once (1 of 3, not 2 of 6).
  expect(await screen.findByRole("button", { name: /Daniel: 1 of 3 passages practiced/ })).toBeInTheDocument();
  // One chapter entry in the strip, and every verse from both fragments has a tile.
  expect(screen.getAllByRole("button", { name: /Chapter 1:/ })).toHaveLength(1);
  expect(screen.getByRole("link", { name: /Daniel 1:1:/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Daniel 1:2:/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Daniel 1:3:/ })).toBeInTheDocument();
});

it("keeps per-passage skill breakdowns and chapter stats in the chapter details", async () => {
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyPage([chapter({ eligibleCount: 2 })]));
  view();
  expect(await screen.findByText("Passage details for Daniel 1")).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "DAN 1 assigned passages practiced" })).toHaveAttribute("value", "1");
  expect(screen.getByRole("progressbar", { name: "DAN 1 assigned passages practiced" })).toHaveAttribute("max", "2");
  expect(screen.getByRole("progressbar", { name: "Daniel 1:1: Wording" })).toHaveAttribute("value", "20");
  expect(screen.getByRole("progressbar", { name: "Daniel 1:1: Reference" })).toHaveAttribute("value", "70");
  expect(screen.getByText("Assigned scope")).toBeInTheDocument();
});

it("labels legacy-scored passages in the details instead of inventing skill scores", async () => {
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyPage([
    chapter({ passages: [passage({ level: "Learning", algorithmVersion: "v1-scaffold" })] }),
  ]));
  view();
  expect(await screen.findByText(/Earlier scoring/)).toBeInTheDocument();
  expect(screen.queryByRole("progressbar", { name: "Daniel 1:1: Wording" })).not.toBeInTheDocument();
});

it("gives unseen passages a plain start state in the details", async () => {
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyPage([
    chapter({ seenCount: 0, passages: [passage({ level: "Unseen", algorithmVersion: "unknown" })] }),
  ]));
  view();
  expect(await screen.findByText("Not practiced yet.")).toBeInTheDocument();
  expect(screen.queryByText(/Earlier scoring/)).not.toBeInTheDocument();
});
