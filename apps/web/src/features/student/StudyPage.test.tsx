import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/student/study" element={<StudyPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("StudyPage Field Guide Academy honesty", () => {
  beforeEach(() => {
    vi.mocked(api.startSession).mockResolvedValue({
      id: "session-1",
      seasonId: "season-1",
      status: "Created",
      mode: "Practice",
      targetCardCount: 8,
    });
    vi.mocked(api.nextCard).mockResolvedValue({
      id: "card-1",
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

  it("does not start rehearsal until the season is Active", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Draft" }));
    renderStudy("/student/study?mode=Simulation");

    expect(await screen.findByTestId("academy-track-unavailable")).toHaveTextContent(
      "Rehearsal opens when this season is Active.",
    );
    expect(screen.getByTestId("academy-session-kicker")).toHaveTextContent("Rehearsal");
    expect(api.startSession).not.toHaveBeenCalled();
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
});
