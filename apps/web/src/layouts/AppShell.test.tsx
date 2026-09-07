import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Progress } from "../api/types";
import { AppShell } from "./AppShell";

vi.mock("../api/client", () => ({
  api: {
    progress: vi.fn(),
  },
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    me: {
      userId: "student-1",
      organizationId: "org-1",
      organizationName: "Development Academy",
      displayName: "Daniel Student",
      userName: "daniel.student",
      email: null,
      kind: "Student",
      role: "Student",
    },
    logout: vi.fn(),
  }),
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

function renderShell(path = "/student") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppShell variant="student" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AppShell Field Guide Academy nav", () => {
  beforeEach(() => {
    vi.mocked(api.progress).mockResolvedValue(progress());
  });

  it("keeps learner and hides rehearsal until the season is Active", async () => {
    renderShell();

    expect(await screen.findByTestId("nav-academy-learner")).toHaveAttribute("href", "/student/study");
    expect(screen.getByTestId("nav-academy-learner")).toHaveTextContent("Learner");
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/student");
    expect(screen.getByRole("link", { name: "Progress" })).toHaveAttribute("href", "/student/progress");
    expect(screen.queryByTestId("nav-academy-rehearsal")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nav-academy-review")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Simulate" })).not.toBeInTheDocument();
  });

  it("adds rehearsal only after Active progress", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active" }));
    renderShell();

    expect(await screen.findByTestId("nav-academy-rehearsal")).toHaveAttribute(
      "href",
      "/student/study?mode=Simulation",
    );
    expect(screen.getByTestId("nav-academy-rehearsal")).toHaveTextContent("Rehearsal");
    expect(screen.queryByTestId("nav-academy-review")).not.toBeInTheDocument();
  });

  it("adds reviews only when the progress API reports a positive count", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 3 }));
    renderShell();

    expect(await screen.findByTestId("nav-academy-review")).toHaveAttribute("href", "/student/study?mode=Review");
    expect(screen.getByTestId("nav-academy-review")).toHaveTextContent("Reviews");
  });

  it("marks only the current academy study track as the active page", async () => {
    vi.mocked(api.progress).mockResolvedValue(progress({ seasonStatus: "Active", reviewDueCount: 3 }));
    renderShell("/student/study?mode=Simulation");

    expect(await screen.findByTestId("nav-academy-rehearsal")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("nav-academy-learner")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("nav-academy-review")).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });
});
