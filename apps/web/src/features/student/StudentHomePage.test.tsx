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

  it("opens on the learner cover without today's deck CTA while the season is Draft", async () => {
    renderHome();

    expect(await screen.findByRole("heading", { name: "Field Guide Academy" })).toBeInTheDocument();
    expect(await screen.findByText("Daniel 2026")).toBeInTheDocument();
    expect(screen.getByTestId("academy-track-learner")).toBeInTheDocument();
    expect(screen.getByTestId("academy-track-review")).toBeInTheDocument();
    expect(screen.getByTestId("academy-track-unavailable")).toHaveTextContent(
      "Learner drill opens when this season is Active.",
    );
    expect(screen.queryByTestId("start-todays-deck")).not.toBeInTheDocument();
    expect(screen.getByTestId("assignment-range")).toHaveTextContent("DAN 1:1–1:4");
    expect(screen.getByTestId("deck-learner")).toHaveTextContent("1");
    expect(screen.getByTestId("deck-reviews")).toHaveTextContent("0");
    expect(screen.getByTestId("deck-rehearsal")).toHaveTextContent("Draft");
    expect(screen.queryByTestId("start-simulation")).not.toBeInTheDocument();
    expect(screen.queryByTestId("start-reviews")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("academy-track-review"));

    expect(screen.getByTestId("academy-track-unavailable")).toHaveTextContent(
      "No passages are due for review.",
    );
    expect(screen.queryByTestId("start-reviews")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("DUE")).not.toBeInTheDocument();
  });

  it("shows rehearsal only after an Active season tab is selected", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active" }));
    renderHome();

    await screen.findByTestId("academy-track-rehearsal");
    expect(screen.queryByLabelText("DUE")).not.toBeInTheDocument();
    expect(screen.getByTestId("start-todays-deck")).toHaveAttribute("href", "/student/study");
    expect(screen.queryByTestId("start-simulation")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("academy-track-rehearsal"));

    expect(screen.getByTestId("start-simulation")).toHaveAttribute("href", "/student/study?mode=Simulation");
    expect(screen.getByTestId("start-simulation")).toHaveTextContent("Start rehearsal");
    expect(screen.getByText("Run a PBE-style rehearsal from the assigned Scripture.")).toBeInTheDocument();
    expect(screen.queryByText(/practice/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/simulation/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("start-todays-deck")).not.toBeInTheDocument();
  });

  it("shows due reviews and the DUE stamp when the progress API reports a positive count", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 3 }));
    renderHome();

    await screen.findByTestId("academy-track-review");
    fireEvent.click(screen.getByTestId("academy-track-review"));

    expect(screen.getByTestId("start-reviews")).toHaveAttribute("href", "/student/study?mode=Review");
    expect(screen.getByLabelText("DUE")).toBeInTheDocument();
    expect(screen.getByTestId("deck-learner")).toHaveTextContent("1");
    expect(screen.getByTestId("deck-reviews")).toHaveTextContent("3");
    expect(screen.getByTestId("deck-rehearsal")).toHaveTextContent("Active");
  });

  it("keeps the Reviews chapter visible on Draft seasons but hides the start CTA", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Draft", reviewDueCount: 3 }));
    renderHome();

    await screen.findByTestId("academy-track-review");
    fireEvent.click(screen.getByTestId("academy-track-review"));

    expect(screen.getByTestId("academy-track-unavailable")).toHaveTextContent(
      "Reviews open when this season is Active.",
    );
    expect(screen.queryByTestId("start-reviews")).not.toBeInTheDocument();
    expect(screen.getByLabelText("DUE")).toBeInTheDocument();
  });

  it("shows a readable folio chapter, art-backed decks, and assignment strip", async () => {
    renderHome();

    const cover = await screen.findByTestId("field-guide-academy");
    expect(cover).toHaveClass("er-field-guide-folio");
    expect(screen.getByTestId("folio-spine")).toHaveTextContent("FIELD GUIDE");
    expect(screen.getByRole("heading", { name: "Field Guide Academy" })).toBeInTheDocument();
    expect(await screen.findByText("Daniel 2026")).toBeInTheDocument();
    expect(screen.getByTestId("current-season")).toHaveTextContent("CHAPTER");
    expect(screen.getByTestId("current-season")).toHaveTextContent("Daniel 2026");
    expect(screen.getByTestId("folio-season-status")).toHaveTextContent("Draft");
    expect(screen.getByTestId("deck-stack")).toHaveClass("er-deck-art");
    expect(screen.getByTestId("deck-card-learner")).toHaveTextContent("Learner");
    expect(screen.getByTestId("deck-card-reviews")).toHaveTextContent("Reviews");
    expect(screen.getByTestId("deck-card-rehearsal")).toHaveTextContent("Rehearsal");
    expect(screen.getByTestId("deck-learner")).toHaveTextContent("1");
    expect(screen.getByTestId("deck-reviews")).toHaveTextContent("0");
    expect(screen.getByRole("img", { name: "Learner deck" })).toHaveAttribute("src", "/brand/deck-learner.webp");
    expect(screen.getByRole("img", { name: "Reviews deck" })).toHaveAttribute("src", "/brand/deck-reviews.webp");
    expect(screen.getByRole("img", { name: "Rehearsal deck" })).toHaveAttribute(
      "src",
      "/brand/deck-rehearsal.webp",
    );
    expect(screen.getByTestId("deck-stack").innerHTML).not.toMatch(
      /deck-new\.webp|deck-simulation\.webp|NEW DECK|REVIEW DECK|SIMULATION/,
    );
    expect(screen.getByTestId("assignment-packet")).toHaveClass("er-assignment-strip");
    expect(screen.getByTestId("assignment-range")).toHaveTextContent("DAN 1:1–1:4");
    expect(cover).not.toHaveTextContent("%");
    expect(cover).not.toHaveTextContent("streak");
    expect(screen.queryByText(/mastery ring/i)).not.toBeInTheDocument();
  });
});
