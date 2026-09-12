import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { trainingApi } from "../../api/training";
import type { Progress, SessionSummary } from "../../api/types";
import { ProgressPage } from "./ProgressPage";
vi.mock("../../api/training", () => ({ trainingApi: { journey: vi.fn() } }));

vi.mock("../../api/client", () => ({
  api: {
    progress: vi.fn(),
    studentProgress: vi.fn(),
  },
}));

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    me: {
      userId: "user-1",
      organizationId: "org-1",
      organizationName: "Erudoza Academy",
      displayName: "Coach",
      userName: "coach",
      email: "admin@erudoza.local",
      kind: "Adult",
      role: "Admin",
    },
  }),
}));

function progress(overrides: Partial<Progress> = {}): Progress {
  return {
    seasonId: "season-1",
    seasonName: "Daniel 2026",
    seasonStatus: "Active",
    assignments: [],
    masteredCount: 1,
    reviewDueCount: 0,
    attemptCount: 3,
    mastery: [
      {
        knowledgeUnitId: "ku-1",
        title: "Daniel 1:1",
        level: "Learning",
        exactWordingScore: 80,
        recognitionScore: 80,
        reviewDueAtUtc: null,
      },
    ],
    recentAttempts: [
      {
        id: "attempt-1",
        title: "Daniel 1:1",
        activityType: "MissingWords",
        isCorrect: true,
        submittedAnswer: "In the third year",
        evaluationResult: "Exact",
        createdAtUtc: "2026-09-07T00:00:00Z",
      },
    ],
    ...overrides,
  };
}

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: "session-1",
    mode: "Practice",
    attempted: 1,
    correct: 1,
    targetCardCount: 8,
    status: "Completed",
    ...overrides,
  };
}

function renderProgress(path: string, state?: SessionSummary | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: "/student/progress", element: <ProgressPage /> },
      { path: "/admin/seasons/:seasonId/students/:studentId/progress", element: <ProgressPage /> },
    ],
    {
      initialEntries: [{ pathname: path, state: state ?? null }],
    },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("ProgressPage recorded evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.progress).mockResolvedValue(progress());
    vi.mocked(trainingApi.journey).mockResolvedValue({ seasonId: "season-1", scopeVersion: "scope-1", after: null, chapters: [] });
    vi.mocked(api.studentProgress).mockResolvedValue(progress({ studentDisplayName: "Daniel Student", reviewDueCount: 2 }));
  });
  it.each(["/student/progress", "/admin/seasons/season-1/students/student-1/progress"])("shows coach difficulty prerequisites at %s",async path=>{
    const data=progress({assignments:[{difficulty:"Standard"} as Progress['assignments'][number]]});
    vi.mocked(api.progress).mockResolvedValue(data);vi.mocked(api.studentProgress).mockResolvedValue(data);
    renderProgress(path);
    expect(await screen.findByText("Coach-set difficulty: Standard")).toBeInTheDocument();
    expect(screen.getByText(/Foundation wording evidence stops at 40/)).toHaveTextContent("Standard at 70");
    expect(screen.getByText(/Advanced mastery challenges require/)).toHaveTextContent("Your difficulty does not change automatically");
  });
  it("shows real learner records without trusting an old route-state recap", async () => {
    renderProgress("/student/progress", summary());
    expect(screen.getByRole("heading", { name: "Your progress" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("progress-student")).toHaveTextContent("Daniel 2026"));
    expect(screen.queryByTestId("session-summary")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your passage journey" })).toBeInTheDocument();
    expect(screen.getByTestId("progress-attempts")).toHaveTextContent("3");
    expect(screen.getByTestId("progress-mastery")).toHaveTextContent("Daniel 1:1");
    expect(screen.getByTestId("progress-mastery")).toHaveTextContent("Exact wording score: 80 / 100");
    expect(screen.getByTestId("recent-attempts")).toHaveTextContent("Missing Words");
    expect(screen.getByTestId("progress-recent")).toHaveTextContent("100%");
    expect(screen.queryByTestId("progress-mastery-pathway")).not.toBeInTheDocument();
    expect(screen.queryByTestId("progress-field-guide-chrome")).not.toBeInTheDocument();
    expect(api.studentProgress).not.toHaveBeenCalled();
  });
  it("identifies legacy scores without granting a mastered badge", async () => {
    renderProgress("/student/progress");
    expect(await screen.findByText("Legacy scoring")).toBeInTheDocument();
    expect(screen.getByText("Learning")).toHaveClass("ds-badge-neutral");
  });
  it("shows the same recorded evidence for the coach", async () => {
    renderProgress("/admin/seasons/season-1/students/student-1/progress");
    await waitFor(() => expect(screen.getByTestId("progress-student")).toHaveTextContent("Daniel Student · Daniel 2026"));
    expect(screen.getByRole("heading", { name: "Student progress" })).toBeInTheDocument();
    expect(screen.getByLabelText("DUE")).toBeInTheDocument();
    expect(api.studentProgress).toHaveBeenCalledWith("org-1", "season-1", "student-1");
    expect(api.progress).not.toHaveBeenCalled();
    expect(trainingApi.journey).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Back to assignments" })).toHaveAttribute("href", "/admin/assignments?studentId=student-1&seasonId=season-1");
    expect(screen.queryByRole("link", { name: "Start due reviews" })).not.toBeInTheDocument();
  });
  it("lets a student act on due reviews in the recorded season", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ reviewDueCount: 2 }));
    renderProgress("/student/progress");
    expect(await screen.findByRole("link", { name: "Start due reviews" })).toHaveAttribute("href", "/student/study?mode=Review&seasonId=season-1");
  });
  it("keeps review actions unavailable for an inactive season", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ reviewDueCount: 2, seasonStatus: "Draft" }));
    renderProgress("/student/progress");
    await screen.findByLabelText("DUE");
    expect(screen.queryByRole("link", { name: "Start due reviews" })).not.toBeInTheDocument();
  });
  it("shows empty evidence honestly", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ recentAttempts: [], mastery: [], attemptCount: 0 }));
    renderProgress("/student/progress");
    expect(await screen.findByText("No attempts yet.")).toBeInTheDocument();
    expect(screen.getByText(/No passage progress yet/)).toBeInTheDocument();
    expect(screen.getByTestId("progress-recent")).toHaveTextContent("—");
  });
  it("reports a load failure without fabricating zero counts", async () => {
    vi.mocked(api.progress).mockRejectedValue(new Error("offline"));
    renderProgress("/student/progress");
    expect(await screen.findByRole("alert")).toHaveTextContent("Progress could not load");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByTestId("progress-attempts")).not.toBeInTheDocument();
  });
});
