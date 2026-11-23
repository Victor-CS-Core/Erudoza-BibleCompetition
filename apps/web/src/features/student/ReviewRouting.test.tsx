import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { trainingApi } from "../../api/training";
import { StudentHomePage } from "./StudentHomePage";
import { StudyPage } from "./StudyPage";
import { journeyFixture, todayFixture } from "./trainingFixtures";

vi.mock("../../api/client", async importOriginal => ({
  ...await importOriginal<typeof import("../../api/client")>(),
  api: {
    progress: vi.fn(),
    assignedSeasons: vi.fn(),
    teamActivity: vi.fn(),
    leaderboard: vi.fn(),
    setLeaderboardOptIn: vi.fn(),
    myAssignments: vi.fn(),
    startSession: vi.fn(),
    nextCard: vi.fn(),
    submitAttempt: vi.fn(),
    completeSession: vi.fn(),
    resumeSession: vi.fn(),
    shuffleSession: vi.fn(),
    reblankCard: vi.fn(),
  },
}));
vi.mock("../../api/training", () => ({
  trainingApi: {
    today: vi.fn(),
    journey: vi.fn(),
    chapters: vi.fn(),
    continueChapters: vi.fn(),
    cooperation: vi.fn(),
    continueCooperation: vi.fn(),
    coachCooperation: vi.fn(),
    cooperationStudents: vi.fn(),
  },
}));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { organizationId: "org", userId: "student", kind: "Student", displayName: "Sam" } }) }));
vi.mock("../admin/ContentPage", () => ({ ContentPage: () => <div>Scripture library</div> }));

const dueMastery = Array.from({ length: 7 }, (_, i) => ({
  knowledgeUnitId: `ku-${i + 1}`,
  title: `Daniel 1:${i + 1}`,
  level: "Review",
  exactWordingScore: 55,
  recognitionScore: 60,
  bookKey: "Daniel",
  chapter: 1,
  verse: i + 1,
  reviewDueAtUtc: "2026-09-01T00:00:00Z",
}));

function flow() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter([
    { path: "/student", element: <StudentHomePage /> },
    { path: "/student/study", element: <StudyPage /> },
    { path: "/student/sessions/:sessionId/recap", element: <p>Saved session summary</p> },
  ], { initialEntries: ["/student"] });
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  // The staging report: a PBE-enabled season whose published question bank
  // is empty (today's PBE mission is Unavailable), while 7 Memory-mastery
  // passages are due for review.
  vi.mocked(trainingApi.today).mockResolvedValue(todayFixture({
    seasonId: "season-1",
    seasonName: "PBE verify 2024-25",
    mission: { id: null, revision: null, status: "Unavailable", scopeVersion: "v1", explanation: "No published PBE questions are available for your assignment. Ask your coach to add questions, or choose Memory.", steps: [{ kind: "Practice", target: 0, completed: 0, status: "Pending", sessionId: null }] },
    nextAction: null,
  }));
  vi.mocked(api.progress).mockResolvedValue({
    seasonId: "season-1",
    seasonName: "PBE verify 2024-25",
    seasonStatus: "Active",
    pbeEnabled: true,
    assignments: [{ id: "a1", studentUserId: "student", type: "Primary", bookKey: "Daniel", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 10, difficulty: "Standard" }],
    masteredCount: 0,
    reviewDueCount: 7,
    attemptCount: 3,
    mastery: dueMastery,
    recentAttempts: [],
  } as never);
  vi.mocked(api.assignedSeasons).mockResolvedValue([{ id: "season-1", name: "PBE verify 2024-25" }]);
  vi.mocked(api.teamActivity).mockResolvedValue({ practicedToday: 0, practicedThisWeek: 0, memberCount: 4 });
  vi.mocked(api.leaderboard).mockResolvedValue({ weekStartLocalDate: "2026-09-14", entries: [], me: { userId: "student", rank: null, xp: 0, optedIn: false } });
  vi.mocked(api.setLeaderboardOptIn).mockResolvedValue({ leaderboardOptIn: true });
  vi.mocked(api.myAssignments).mockResolvedValue([{ id: "a1", studentUserId: "student", type: "Primary", bookKey: "Daniel", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 10 }] as never);
  vi.mocked(trainingApi.journey).mockResolvedValue(journeyFixture({ seasonId: "season-1" }));
  vi.mocked(api.startSession).mockResolvedValue({ id: "memory-review-1", seasonId: "season-1", status: "Created", mode: "Review", targetCardCount: 7 });
  vi.mocked(api.nextCard).mockResolvedValue({ id: "card-1", sessionId: "memory-review-1", activityType: "MissingWords", prompt: "____", citation: "Daniel 1:1", tokens: [{ index: 2, display: "____", hidden: true }], sequence: 1, total: 7 });
  vi.mocked(api.resumeSession).mockResolvedValue({ session: { id: "memory-review-1", seasonId: "season-1", status: "Created", mode: "Review", targetCardCount: 7 }, card: null, attempt: null, summary: null });
});

afterEach(() => { sessionStorage.clear(); });

describe("due-review routing", () => {
  it("HQ's Start due reviews opens a Memory Review session over the mission set, not the empty PBE bank", async () => {
    flow();
    // HQ counts the 7 due Memory passages on the mission card.
    expect(await screen.findByText("7 reviews due")).toBeInTheDocument();
    const entry = screen.getByRole("link", { name: "Start due reviews" });
    expect(entry).toHaveAttribute("href", "/student/study?mode=Review&format=Memory&seasonId=season-1");

    fireEvent.click(entry);

    // The click starts a Memory Review session (the client start carries no
    // PBE format) instead of landing on the PBE empty state.
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith("season-1", "Review", expect.anything()));
    for (const call of vi.mocked(api.startSession).mock.calls) expect(call[3]).not.toBe("Pbe");
    expect(await screen.findByTestId("challenge-card")).toBeInTheDocument();
    expect(screen.queryByText("No PBE questions to review")).not.toBeInTheDocument();
    expect(screen.queryByText("Choose your Memory practice")).not.toBeInTheDocument();
  });
});
