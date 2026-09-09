import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
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

describe("Learner AppShell", () => {
  beforeEach(() => {
    vi.mocked(api.progress).mockResolvedValue(progress());
  });

  it("renders a bottom tab bar with labeled Home, Learner, and Progress tabs", () => {
    renderShell();

    const tabs = screen.getByTestId("learner-tab-bar");
    expect(tabs).toHaveAttribute("aria-label", "Learner");
    expect(within(tabs).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/student");
    expect(within(tabs).getByRole("link", { name: "Learner" })).toHaveAttribute("href", "/student/study");
    expect(within(tabs).getByRole("link", { name: "Progress" })).toHaveAttribute("href", "/student/progress");
    expect(within(tabs).getByTestId("nav-academy-learner")).toHaveTextContent("Learner");
    expect(within(tabs).queryByRole("link", { name: "Reviews" })).not.toBeInTheDocument();
    expect(within(tabs).queryByRole("link", { name: "Rehearsal" })).not.toBeInTheDocument();
    expect(within(tabs).queryByRole("link", { name: "Students" })).not.toBeInTheDocument();
    expect(within(tabs).queryByRole("link", { name: "More" })).not.toBeInTheDocument();
  });

  it("sizes each learner tab to at least 44 by 44 and clears the home indicator", () => {
    renderShell();

    const tabs = screen.getByTestId("learner-tab-bar");
    expect(tabs.className).toMatch(/er-learner-tabbar/);
    for (const name of ["Home", "Learner", "Progress"]) {
      expect(within(tabs).getByRole("link", { name })).toHaveClass("er-learner-tab");
    }
  });

  it("centers a 28rem phone column inside a 100dvh safe-area shell", () => {
    renderShell();

    expect(screen.getByTestId("learner-app-shell")).toHaveClass("er-learner-shell");
    expect(screen.getByTestId("learner-phone-column")).toHaveClass("er-learner-column");
  });

  it("keeps header menu, wordmark, and sign-out on the learner chrome", () => {
    renderShell();

    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
    expect(screen.getByTestId("erudoza-wordmark")).toBeInTheDocument();
    expect(screen.getByTestId("logout")).toBeInTheDocument();
  });

  it("marks Home current on /student and Learner current on study routes", () => {
    const home = renderShell("/student");
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Learner" })).not.toHaveAttribute("aria-current");
    home.unmount();

    renderShell("/student/study?mode=Simulation");
    expect(screen.getByTestId("nav-academy-learner")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Progress" })).not.toHaveAttribute("aria-current");
  });

  it("marks Progress current on the progress route", () => {
    renderShell("/student/progress");

    expect(screen.getByRole("link", { name: "Progress" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });
});
