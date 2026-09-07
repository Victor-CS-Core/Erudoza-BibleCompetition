import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Progress } from "../../api/types";
import { StudyPage } from "./StudyPage";

vi.mock("../../api/client", () => ({
  api: {
    progress: vi.fn(),
    startSession: vi.fn(),
    nextCard: vi.fn(),
  },
}));

function progress(overrides: Partial<Progress> = {}): Progress {
  return {
    seasonId: "season-1",
    seasonName: "Daniel 2026",
    seasonStatus: "Draft",
    assignments: [],
    masteredCount: 0,
    reviewDueCount: 0,
    attemptCount: 0,
    mastery: [],
    ...overrides,
  };
}

function renderStudy(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter([{ path: "/student/study", element: <StudyPage /> }], {
    initialEntries: [path],
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("StudyPage Field Guide Academy honesty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.startSession).mockResolvedValue({
      id: "session-1",
      seasonId: "season-1",
      status: "Created",
      mode: "Practice",
      targetCardCount: 8,
    });
    vi.mocked(api.nextCard).mockResolvedValue({
      id: "card-1",
      sessionId: "session-1",
      activityType: "MissingWords",
      prompt: "____",
      citation: "Daniel 1:1",
      tokens: [],
      sequence: 1,
      total: 8,
    });
  });

  it("does not start review when the progress API reports none due", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 0 }));
    renderStudy("/student/study?mode=Review");

    expect(await screen.findByTestId("academy-track-unavailable")).toHaveTextContent(
      "No passages are due for review.",
    );
    expect(screen.getByTestId("academy-session-kicker")).toHaveTextContent("Due review");
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it("does not start due reviews until the season is Active", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Draft", reviewDueCount: 2 }));
    renderStudy("/student/study?mode=Review");

    expect(await screen.findByTestId("academy-track-unavailable")).toHaveTextContent(
      "Reviews open when this season is Active.",
    );
    expect(screen.getByTestId("field-guide-academy")).toBeInTheDocument();
    expect(screen.getByTestId("academy-session-kicker")).toHaveTextContent("Due review");
    expect(screen.queryByTestId("challenge-card")).not.toBeInTheDocument();
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it("does not start learner drill until the season is Active", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Draft" }));
    renderStudy("/student/study");

    expect(await screen.findByTestId("academy-track-unavailable")).toHaveTextContent(
      "Learner drill opens when this season is Active.",
    );
    expect(screen.getByTestId("field-guide-academy")).toBeInTheDocument();
    expect(screen.getByTestId("academy-session-kicker")).toHaveTextContent("Learner drill");
    expect(screen.queryByTestId("challenge-card")).not.toBeInTheDocument();
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it("does not start rehearsal until the season is Active", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Draft" }));
    renderStudy("/student/study?mode=Simulation");

    expect(await screen.findByTestId("academy-track-unavailable")).toHaveTextContent(
      "Rehearsal opens when this season is Active.",
    );
    expect(screen.getByTestId("academy-session-kicker")).toHaveTextContent("Rehearsal");
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it("starts learner drill from the existing session API", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 0 }));
    renderStudy("/student/study");

    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith("season-1", "Practice"));
  });

  it("starts due reviews from the existing session API", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 2 }));
    renderStudy("/student/study?mode=Review");

    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith("season-1", "Review"));
  });

  it("starts rehearsal when the season is Active", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 0 }));
    renderStudy("/student/study?mode=Simulation");

    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith("season-1", "Simulation"));
  });

  it("opens learner drill on the Field Guide Academy cover", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", seasonName: "Daniel 2026" }));
    renderStudy("/student/study");

    expect(await screen.findByTestId("field-guide-academy")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Field Guide Academy" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("current-season")).toHaveTextContent("Daniel 2026"));
    expect(screen.getByTestId("academy-session-kicker")).toHaveTextContent("Learner drill");
    expect(screen.queryByLabelText("DUE")).not.toBeInTheDocument();
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith("season-1", "Practice"));
  });

  it("stamps DUE on the study cover only when reviews are due", async () => {
    vi.mocked(api.progress).mockResolvedValue(
      progress({ seasonStatus: "Active", reviewDueCount: 2, seasonName: "Daniel 2026" }),
    );
    renderStudy("/student/study");

    expect(await screen.findByLabelText("DUE")).toBeInTheDocument();
    expect(screen.getByTestId("field-guide-academy")).toBeInTheDocument();
  });

  it("keeps unavailable review copy on the Field Guide cover", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 0 }));
    renderStudy("/student/study?mode=Review");

    expect(await screen.findByTestId("academy-track-unavailable")).toHaveTextContent(
      "No passages are due for review.",
    );
    expect(screen.getByTestId("field-guide-academy")).toBeInTheDocument();
    expect(screen.getByTestId("academy-session-kicker")).toHaveTextContent("Due review");
    expect(screen.queryByTestId("challenge-card")).not.toBeInTheDocument();
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it("starts a new rehearsal session after switching from learner on the same page", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 0 }));
    const router = renderStudy("/student/study");

    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith("season-1", "Practice"));
    vi.mocked(api.startSession).mockClear();

    await router.navigate("/student/study?mode=Simulation");

    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith("season-1", "Simulation"));
    expect(screen.getByTestId("academy-session-kicker")).toHaveTextContent("Rehearsal");
  });

  it("ignores a stale learner start after switching to rehearsal", async () => {
    let releaseLearner: ((session: { id: string; seasonId: string; status: string; mode: string; targetCardCount: number }) => void) | undefined;
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 0 }));
    vi.mocked(api.startSession).mockImplementation((seasonId, mode) => {
      if (mode === "Practice") {
        return new Promise((resolve) => {
          releaseLearner = resolve;
        });
      }
      return Promise.resolve({
        id: "session-rehearsal",
        seasonId,
        status: "Created",
        mode: "Simulation",
        targetCardCount: 10,
      });
    });

    const router = renderStudy("/student/study");
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith("season-1", "Practice"));
    await router.navigate("/student/study?mode=Simulation");
    await waitFor(() => expect(api.nextCard).toHaveBeenCalledWith("session-rehearsal"));

    releaseLearner?.({
      id: "session-stale-learner",
      seasonId: "season-1",
      status: "Created",
      mode: "Practice",
      targetCardCount: 8,
    });

    await waitFor(() => expect(screen.getByTestId("academy-session-kicker")).toHaveTextContent("Rehearsal"));
    expect(api.nextCard).not.toHaveBeenCalledWith("session-stale-learner");
  });
});
