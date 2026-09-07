import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Season, SeasonCoverage } from "../../api/types";
import { AssignmentsPage, QuestionsPage, SeasonsListPage, StudentsPage } from "./SimpleAdminPages";

vi.mock("../../api/client", () => ({
  api: {
    seasons: vi.fn(),
    students: vi.fn(),
    coverage: vi.fn(),
    questions: vi.fn(),
    generationJobs: vi.fn(),
    generationStatus: vi.fn(),
  },
}));

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    me: {
      userId: "admin-1",
      organizationId: "org-1",
      organizationName: "Development Academy",
      displayName: "Admin",
      userName: "admin",
      email: "admin@erudoza.local",
      kind: "Adult",
      role: "Admin",
    },
  }),
}));

function season(overrides: Partial<Season> = {}): Season {
  return {
    id: "season-1",
    organizationId: "org-1",
    name: "Imported Joshua",
    yearLabel: "2026",
    status: "Draft",
    ruleProfileKey: "PBE_STYLE_V1",
    ruleProfileVersion: 1,
    startDate: null,
    targetCompetitionDate: null,
    scopeUnitCount: 0,
    assignmentCount: 0,
    ...overrides,
  };
}

function coverage(overrides: Partial<SeasonCoverage> = {}): SeasonCoverage {
  return {
    seasonId: "season-active",
    seasonName: "Daniel Gauntlet",
    seasonStatus: "Active",
    students: [
      {
        studentUserId: "student-1",
        displayName: "Daniel Student",
        userName: "daniel.student",
        assignmentType: "PrimarySpecialist",
        bookKey: "DAN",
        startChapter: 1,
        startVerse: 1,
        endChapter: 1,
        endVerse: 4,
        eligibleUnitCount: 4,
        masteredCount: 1,
        reviewDueCount: 0,
        attemptCount: 2,
      },
    ],
    ...overrides,
  };
}

function renderPage(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Coach list pages Field Guide Academy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.seasons).mockResolvedValue([
      season({ id: "season-draft", name: "Imported Joshua", status: "Draft" }),
      season({ id: "season-active", name: "Daniel Gauntlet", status: "Active" }),
    ]);
    vi.mocked(api.students).mockResolvedValue([
      { userId: "student-1", userName: "daniel.student", displayName: "Daniel Student", email: null },
    ]);
    vi.mocked(api.coverage).mockResolvedValue(coverage());
    vi.mocked(api.questions).mockResolvedValue([]);
    vi.mocked(api.generationJobs).mockResolvedValue([]);
    vi.mocked(api.generationStatus).mockResolvedValue({
      openAiEnabled: false,
      model: "local-fallback",
      generator: "local",
    });
  });

  it("opens seasons on the Field Guide Academy cover with the organization chapter", async () => {
    renderPage(<SeasonsListPage />);

    const cover = await screen.findByTestId("field-guide-academy");
    expect(screen.getByRole("heading", { name: "Field Guide Academy" })).toBeInTheDocument();
    expect(screen.getByTestId("academy-chapter-line")).toHaveTextContent("Development Academy");
    expect(screen.getByTestId("create-season")).toHaveAttribute("href", "/admin/seasons/new");
    await waitFor(() => expect(screen.getByText(/Imported Joshua/)).toBeInTheDocument());
    expect(cover).not.toHaveTextContent("%");
    expect(cover).not.toHaveTextContent("streak");
  });

  it("opens students on the Field Guide Academy cover and keeps the roster form", async () => {
    renderPage(<StudentsPage />);

    expect(await screen.findByTestId("field-guide-academy")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Field Guide Academy" })).toBeInTheDocument();
    expect(screen.getByTestId("academy-chapter-line")).toHaveTextContent("Development Academy");
    expect(await screen.findByTestId("student-list")).toHaveTextContent("daniel.student");
    expect(screen.getByTestId("add-student")).toBeInTheDocument();
  });

  it("opens coverage on the Field Guide Academy cover from real season fields", async () => {
    renderPage(<AssignmentsPage />);

    const cover = await screen.findByTestId("field-guide-academy");
    expect(screen.getByRole("heading", { name: "Field Guide Academy" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("academy-chapter-line")).toHaveTextContent("Daniel Gauntlet · Active");
    });
    expect(await screen.findByTestId("coverage-table")).toHaveTextContent("daniel.student");
    expect(cover).not.toHaveTextContent("%");
    expect(cover).not.toHaveTextContent("streak");
    expect(api.coverage).toHaveBeenCalledWith("org-1", "season-active");
  });

  it("uses the organization chapter on coverage when no season exists", async () => {
    vi.mocked(api.seasons).mockResolvedValue([]);

    renderPage(<AssignmentsPage />);

    expect(await screen.findByTestId("field-guide-academy")).toBeInTheDocument();
    expect(screen.getByTestId("academy-chapter-line")).toHaveTextContent("Development Academy");
    expect(screen.queryByTestId("coverage-table")).not.toBeInTheDocument();
    expect(api.coverage).not.toHaveBeenCalled();
  });

  it("opens questions on the Field Guide Academy cover from real season fields", async () => {
    renderPage(<QuestionsPage />);

    expect(await screen.findByTestId("field-guide-academy")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Field Guide Academy" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("academy-chapter-line")).toHaveTextContent("Daniel Gauntlet · Active");
    });
    expect(screen.getByTestId("run-generation")).toBeInTheDocument();
    expect(screen.getByTestId("question-review-list")).toBeInTheDocument();
  });
});
