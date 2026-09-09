import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Progress } from "../api/types";
import { AdminHomePage } from "../features/admin/AdminHomePage";
import { AppShell } from "./AppShell";

const authState = vi.hoisted(() => ({
  variant: "student" as "student" | "admin",
  logout: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: {
    progress: vi.fn(),
    organization: vi.fn(),
    seasons: vi.fn(),
  },
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    me:
      authState.variant === "admin"
        ? {
            userId: "admin-1",
            organizationId: "org-1",
            organizationName: "Development Academy",
            displayName: "Admin",
            userName: "admin",
            email: "admin@erudoza.local",
            kind: "Adult",
            role: "Admin",
          }
        : {
            userId: "student-1",
            organizationId: "org-1",
            organizationName: "Development Academy",
            displayName: "Daniel Student",
            userName: "daniel.student",
            email: null,
            kind: "Student",
            role: "Student",
          },
    logout: authState.logout,
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

function renderCoachShell(path = "/admin") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppShell variant="admin" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderCoachSeasons() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route element={<AppShell variant="admin" />}>
            <Route path="/admin" element={<AdminHomePage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Learner AppShell", () => {
  beforeEach(() => {
    authState.variant = "student";
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
    const homeTabs = within(screen.getByTestId("learner-tab-bar"));
    expect(homeTabs.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(homeTabs.getByRole("link", { name: "Learner" })).not.toHaveAttribute("aria-current");
    home.unmount();

    renderShell("/student/study?mode=Simulation");
    const studyTabs = within(screen.getByTestId("learner-tab-bar"));
    expect(screen.getByTestId("nav-academy-learner")).toHaveAttribute("aria-current", "page");
    expect(studyTabs.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(studyTabs.getByRole("link", { name: "Progress" })).not.toHaveAttribute("aria-current");
  });

  it("marks Progress current on the progress route", () => {
    renderShell("/student/progress");

    const tabs = within(screen.getByTestId("learner-tab-bar"));
    expect(tabs.getByRole("link", { name: "Progress" })).toHaveAttribute("aria-current", "page");
    expect(tabs.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(tabs.getByRole("link", { name: "Learner" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
  });

  it("offers Back to Home on Study and keeps sign-out instead of an invented Save", () => {
    renderShell("/student/study");

    expect(screen.getByTestId("study-back")).toHaveAttribute("href", "/student");
    expect(screen.getByTestId("study-page-title")).toHaveTextContent("Study");
    expect(screen.getByTestId("logout")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Menu" })).not.toBeInTheDocument();
    expect(screen.queryByText("Save")).not.toBeInTheDocument();
    expect(screen.getByTestId("nav-academy-learner")).toHaveAttribute("aria-current", "page");
  });
});

describe("Coach AppShell", () => {
  beforeEach(() => {
    authState.variant = "admin";
    authState.logout.mockReset();
    vi.mocked(api.organization).mockResolvedValue({
      id: "org-1",
      name: "Development Academy",
      slug: "development-academy",
    });
    vi.mocked(api.seasons).mockResolvedValue([
      {
        id: "season-active",
        organizationId: "org-1",
        name: "Daniel 2026",
        yearLabel: "2026",
        status: "Active",
        ruleProfileKey: "PBE_STYLE_V1",
        ruleProfileVersion: 1,
        startDate: null,
        targetCompetitionDate: null,
        scopeUnitCount: 0,
        assignmentCount: 0,
      },
    ]);
  });

  it("renders a bottom tab bar with labeled Seasons, Students, and More tabs", () => {
    renderCoachShell();

    const tabs = screen.getByTestId("coach-tab-bar");
    expect(tabs).toHaveAttribute("aria-label", "Coach");
    expect(within(tabs).getByRole("link", { name: "Seasons" })).toHaveAttribute("href", "/admin");
    expect(within(tabs).getByRole("link", { name: "Students" })).toHaveAttribute("href", "/admin/students");
    expect(within(tabs).getByRole("button", { name: "More" })).toBeInTheDocument();
    expect(within(tabs).getByTestId("coach-tab-seasons")).toHaveTextContent("Seasons");
    expect(within(tabs).getByTestId("coach-tab-students")).toHaveTextContent("Students");
    expect(within(tabs).getByTestId("coach-tab-more")).toHaveTextContent("More");
    expect(within(tabs).queryByRole("link", { name: "Content" })).not.toBeInTheDocument();
    expect(within(tabs).queryByRole("link", { name: "Questions" })).not.toBeInTheDocument();
    expect(within(tabs).queryByRole("link", { name: "Home" })).not.toBeInTheDocument();
  });

  it("sizes each coach tab to at least 44 by 44 and clears the home indicator", () => {
    renderCoachShell();

    const tabs = screen.getByTestId("coach-tab-bar");
    expect(tabs.className).toMatch(/er-coach-tabbar/);
    expect(within(tabs).getByRole("link", { name: "Seasons" })).toHaveClass("er-coach-tab");
    expect(within(tabs).getByRole("link", { name: "Students" })).toHaveClass("er-coach-tab");
    expect(within(tabs).getByRole("button", { name: "More" })).toHaveClass("er-coach-tab");
  });

  it("centers a 430px phone column inside a 100dvh safe-area shell on coach routes", () => {
    renderCoachShell("/admin/students");

    expect(screen.getByTestId("coach-app-shell")).toHaveClass("er-coach-shell");
    expect(screen.getByTestId("coach-phone-column")).toHaveClass("er-coach-column");
  });

  it("keeps Create season inside the coach phone column on seasons", async () => {
    renderCoachSeasons();

    const column = screen.getByTestId("coach-phone-column");
    expect(await within(column).findByTestId("create-season")).toHaveAttribute("href", "/admin/seasons/new");
    expect(within(column).getByTestId("create-season")).toHaveClass("er-create-season");
  });

  it("marks Seasons current on /admin and /admin/seasons, Students on the roster", () => {
    const home = renderCoachShell("/admin");
    const homeTabs = within(screen.getByTestId("coach-tab-bar"));
    expect(homeTabs.getByRole("link", { name: "Seasons" })).toHaveAttribute("aria-current", "page");
    expect(homeTabs.getByRole("link", { name: "Students" })).not.toHaveAttribute("aria-current");
    expect(homeTabs.getByRole("button", { name: "More" })).not.toHaveAttribute("aria-current");
    home.unmount();

    const seasons = renderCoachShell("/admin/seasons/new");
    const seasonTabs = within(screen.getByTestId("coach-tab-bar"));
    expect(seasonTabs.getByRole("link", { name: "Seasons" })).toHaveAttribute("aria-current", "page");
    seasons.unmount();

    renderCoachShell("/admin/students");
    const studentTabs = within(screen.getByTestId("coach-tab-bar"));
    expect(studentTabs.getByRole("link", { name: "Students" })).toHaveAttribute("aria-current", "page");
    expect(studentTabs.getByRole("link", { name: "Seasons" })).not.toHaveAttribute("aria-current");
  });

  it("puts Content, Assignments, Questions, and Sign out under More", () => {
    renderCoachShell("/admin/content");

    const tabs = within(screen.getByTestId("coach-tab-bar"));
    expect(tabs.getByRole("button", { name: "More" })).toHaveAttribute("aria-current", "page");
    expect(tabs.getByRole("link", { name: "Seasons" })).not.toHaveAttribute("aria-current");

    fireEvent.click(screen.getByTestId("coach-tab-more"));
    const more = screen.getByTestId("coach-more-overflow");
    expect(within(more).getByRole("link", { name: "Content" })).toHaveAttribute("href", "/admin/content");
    expect(within(more).getByRole("link", { name: "Assignments" })).toHaveAttribute("href", "/admin/assignments");
    expect(within(more).getByRole("link", { name: "Questions" })).toHaveAttribute("href", "/admin/questions");
    expect(within(more).getByTestId("logout")).toHaveTextContent("Sign out");
    expect(more).not.toHaveTextContent("%");
    expect(more).not.toHaveTextContent("streak");
    expect(more).not.toHaveTextContent("mastery");
  });
});
