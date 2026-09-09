import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Progress, SessionSummary } from "../../api/types";
import { ProgressPage } from "./ProgressPage";

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
      organizationName: "Development Academy",
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
        exactWordingScore: 0.8,
        recognitionScore: 0.8,
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

describe("ProgressPage Field Guide Academy chrome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.progress).mockResolvedValue(progress());
    vi.mocked(api.studentProgress).mockResolvedValue(
      progress({ studentDisplayName: "Daniel Student", reviewDueCount: 2 }),
    );
  });

  it("opens the learner folio on the Field Guide Academy cover", async () => {
    renderProgress("/student/progress", summary());

    expect(await screen.findByTestId("field-guide-academy")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Field Guide Academy" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("progress-student")).toHaveTextContent("Daniel 2026"));
    expect(screen.getByTestId("session-summary")).toHaveTextContent("Last Learner drill session: 1 / 1 exact");
    expect(screen.getByTestId("progress-attempts")).toHaveTextContent("3");
    expect(screen.getByTestId("progress-mastery")).toHaveTextContent("Daniel 1:1");
    expect(screen.getByTestId("recent-attempts")).toHaveTextContent("Missing Words");
    expect(screen.getByTestId("recent-attempts")).not.toHaveTextContent("MissingWords");
    expect(screen.queryByLabelText("DUE")).not.toBeInTheDocument();
    expect(api.studentProgress).not.toHaveBeenCalled();
  });

  it("stamps DUE on the progress cover only when reviews are due", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ reviewDueCount: 4 }));
    renderProgress("/student/progress");

    expect(await screen.findByLabelText("DUE")).toBeInTheDocument();
    expect(screen.getByTestId("progress-reviews")).toHaveTextContent("4");
  });

  it("opens the coach student folio on the same Field Guide cover", async () => {
    renderProgress("/admin/seasons/season-1/students/student-1/progress");

    expect(await screen.findByTestId("field-guide-academy")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("progress-student")).toHaveTextContent("Daniel Student · Daniel 2026"),
    );
    expect(screen.getByRole("heading", { name: "Student progress" })).toBeInTheDocument();
    expect(screen.getByLabelText("DUE")).toBeInTheDocument();
    expect(api.studentProgress).toHaveBeenCalledWith("org-1", "season-1", "student-1");
    expect(api.progress).not.toHaveBeenCalled();
  });
});

describe("ProgressPage TOP FOLIO honesty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.progress).mockResolvedValue(progress());
    vi.mocked(api.studentProgress).mockResolvedValue(
      progress({ studentDisplayName: "Daniel Student", reviewDueCount: 2 }),
    );
  });

  it("puts Attempts, Due reviews, and Recent in TOP FOLIO from progress truth", async () => {
    renderProgress("/student/progress");

    const folio = await screen.findByTestId("progress-top-folio");
    expect(folio).toHaveTextContent("TOP FOLIO");
    await waitFor(() => expect(within(folio).getByTestId("progress-attempts")).toHaveTextContent("3"));
    expect(within(folio).getByTestId("progress-reviews")).toHaveTextContent("0");
    expect(within(folio).getByTestId("progress-recent")).toHaveTextContent("100%");
    expect(within(folio).queryByText(/strong passages/i)).not.toBeInTheDocument();
    expect(folio).not.toHaveTextContent("78%");
    expect(folio).not.toHaveTextContent("streak");
  });

  it("shows an em dash for Recent when there are no recent attempts", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ recentAttempts: [], attemptCount: 0 }));
    renderProgress("/student/progress");

    const folio = await screen.findByTestId("progress-top-folio");
    await waitFor(() => expect(screen.getByTestId("progress-student")).toHaveTextContent("Daniel 2026"));
    expect(within(folio).getByTestId("progress-attempts")).toHaveTextContent("0");
    expect(within(folio).getByTestId("progress-recent")).toHaveTextContent("—");
    expect(folio).not.toHaveTextContent("%");
  });

  it("keeps the mastery pathway aspirational and does not invent live ring scores", async () => {
    renderProgress("/student/progress");

    const pathway = await screen.findByTestId("progress-mastery-pathway");
    expect(pathway).toHaveAttribute("data-aspirational", "true");
    await waitFor(() => expect(pathway).toHaveTextContent("Daniel 2026"));
    expect(pathway).toHaveTextContent("Field Guide Mastery Pathway");
    expect(pathway).toHaveTextContent("product uses attempts/due until API-backed");
    expect(pathway).not.toHaveTextContent("6/8");
    expect(pathway).not.toHaveTextContent("Romans");
    expect(screen.getByTestId("progress-mastery")).toHaveTextContent("Daniel 1:1");
    expect(screen.getByTestId("progress-mastery")).toHaveTextContent("Exact wording 0.8");
  });

  it("keeps Field Guide chrome behind the progress folio", async () => {
    renderProgress("/student/progress");

    const chrome = await screen.findByTestId("progress-field-guide-chrome");
    expect(chrome).toHaveAttribute("aria-hidden", "true");
    expect(within(chrome).getByTestId("chrome-compass")).toBeInTheDocument();
    expect(within(chrome).getByTestId("chrome-mountain")).toBeInTheDocument();
    expect(within(chrome).getByTestId("chrome-forest")).toBeInTheDocument();
    expect(await screen.findByTestId("progress-top-folio")).toBeInTheDocument();
  });
});
