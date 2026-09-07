import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Progress } from "../../api/types";
import { StudentHomePage } from "./StudentHomePage";

vi.mock("../../api/client", () => ({
  api: {
    progress: vi.fn(),
  },
}));

function progress(overrides: Partial<Progress> = {}): Progress {
  return {
    seasonId: "season-1",
    seasonName: "Daniel 2026",
    seasonStatus: "Draft",
    assignments: [
      {
        id: "assignment-1",
        studentUserId: "student-1",
        type: "PrimarySpecialist",
        bookKey: "DAN",
        startChapter: 1,
        startVerse: 1,
        endChapter: 1,
        endVerse: 4,
      },
    ],
    masteredCount: 0,
    reviewDueCount: 0,
    attemptCount: 0,
    mastery: [],
    ...overrides,
  };
}

function renderHome() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StudentHomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("StudentHomePage Field Guide Academy", () => {
  beforeEach(() => {
    vi.mocked(api.progress).mockResolvedValue(progress());
  });

  it("opens on the learner cover with today's deck CTA", async () => {
    renderHome();

    expect(await screen.findByRole("heading", { name: "Field Guide Academy" })).toBeInTheDocument();
    expect(await screen.findByText("Daniel 2026")).toBeInTheDocument();
    expect(screen.getByTestId("start-todays-deck")).toHaveAttribute("href", "/student/study");
    expect(screen.getByTestId("assignment-range")).toHaveTextContent("DAN 1:1–1:4");
    expect(screen.queryByTestId("start-simulation")).not.toBeInTheDocument();
    expect(screen.queryByTestId("start-reviews")).not.toBeInTheDocument();
  });

  it("shows rehearsal only after an Active season tab is selected", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active" }));
    renderHome();

    await screen.findByTestId("academy-track-rehearsal");
    expect(screen.getByLabelText("DUE")).toBeInTheDocument();
    expect(screen.getByTestId("start-todays-deck")).toBeInTheDocument();
    expect(screen.queryByTestId("start-simulation")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("academy-track-rehearsal"));

    expect(screen.getByTestId("start-simulation")).toHaveAttribute("href", "/student/study?mode=Simulation");
    expect(screen.queryByTestId("start-todays-deck")).not.toBeInTheDocument();
  });

  it("shows due reviews only when the progress API reports a positive count", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 3 }));
    renderHome();

    await screen.findByTestId("academy-track-review");
    fireEvent.click(screen.getByTestId("academy-track-review"));

    expect(screen.getByTestId("start-reviews")).toHaveAttribute("href", "/student/study?mode=Review");
    expect(screen.getByTestId("deck-review")).toHaveTextContent("3");
  });
});
