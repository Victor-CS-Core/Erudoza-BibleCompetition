import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { SeasonWizardPage } from "./SeasonWizardPage";

vi.mock("../../api/client", () => ({
  api: {
    contentPacks: vi.fn(),
    students: vi.fn(),
    season: vi.fn(),
    assignments: vi.fn(),
    defineScope: vi.fn(),
    assign: vi.fn(),
  },
}));

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    me: {
      userId: "admin-1",
      organizationId: "org-1",
      organizationName: "Academy",
      displayName: "Admin",
      userName: "admin",
      email: "admin@erudoza.local",
      kind: "Adult",
      role: "Admin",
    },
  }),
}));

function renderWizard(path = "/admin/seasons/season-1") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/seasons/new" element={<SeasonWizardPage />} />
          <Route path="/admin/seasons/:seasonId" element={<SeasonWizardPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SeasonWizardPage chapter scope", () => {
  beforeEach(() => {
    vi.mocked(api.contentPacks).mockResolvedValue([
      {
        id: "pack-1",
        packKey: "dev-joshua",
        version: 1,
        locale: "en",
        sourceType: "Scripture",
        licensingStatus: "Internal",
        unitCount: 4,
      },
    ]);
    vi.mocked(api.students).mockResolvedValue([
      { userId: "student-1", userName: "daniel.student", displayName: "Daniel Student", email: null },
    ]);
    vi.mocked(api.season).mockResolvedValue({
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
    });
    vi.mocked(api.assignments).mockResolvedValue([]);
    vi.mocked(api.defineScope).mockResolvedValue(undefined);
    vi.mocked(api.assign).mockResolvedValue({
      id: "assignment-1",
      studentUserId: "student-1",
      type: "PrimarySpecialist",
      bookKey: "JOS",
      startChapter: 2,
      startVerse: 1,
      endChapter: 2,
      endVerse: 1,
      studentDisplayName: "Daniel Student",
      studentUserName: "daniel.student",
    });
  });

  it("sends start and end chapter from the scope fields", async () => {
    renderWizard();
    await screen.findByTestId("save-scope");

    fireEvent.change(screen.getByTestId("scope-book"), { target: { value: "JOS" } });
    fireEvent.change(screen.getByTestId("scope-start-chapter"), { target: { value: "2" } });
    fireEvent.change(screen.getByTestId("scope-start"), { target: { value: "1" } });
    fireEvent.change(screen.getByTestId("scope-end-chapter"), { target: { value: "2" } });
    fireEvent.change(screen.getByTestId("scope-end"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("save-scope"));

    await waitFor(() => expect(api.defineScope).toHaveBeenCalled());
    expect(api.defineScope).toHaveBeenCalledWith(
      "org-1",
      "season-1",
      expect.objectContaining({
        contentPackId: "pack-1",
        includes: [{ bookKey: "JOS", startChapter: 2, startVerse: 1, endChapter: 2, endVerse: 1 }],
      }),
    );

    fireEvent.click(screen.getByTestId("assign-student"));
    await waitFor(() => expect(api.assign).toHaveBeenCalled());
    expect(api.assign).toHaveBeenCalledWith(
      "org-1",
      "season-1",
      expect.objectContaining({
        range: { bookKey: "JOS", startChapter: 2, startVerse: 1, endChapter: 2, endVerse: 1 },
      }),
    );
  });
});

describe("SeasonWizardPage Field Guide Academy", () => {
  beforeEach(() => {
    vi.mocked(api.contentPacks).mockClear();
    vi.mocked(api.students).mockClear();
    vi.mocked(api.assignments).mockClear();
    vi.mocked(api.season).mockClear();
    vi.mocked(api.contentPacks).mockResolvedValue([]);
    vi.mocked(api.students).mockResolvedValue([]);
    vi.mocked(api.assignments).mockResolvedValue([]);
    vi.mocked(api.season).mockResolvedValue({
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
    });
  });

  it("names Field Guide Academy on an existing season chapter from real name and status", async () => {
    renderWizard("/admin/seasons/season-1");

    const cover = await screen.findByTestId("field-guide-academy");
    expect(screen.getByRole("heading", { name: "Field Guide Academy" })).toBeInTheDocument();
    await waitFor(() => {
      expect(cover).toHaveTextContent("Imported Joshua");
      expect(cover).toHaveTextContent("Draft");
    });
    expect(cover).not.toHaveTextContent("%");
    expect(cover).not.toHaveTextContent("streak");
    expect(api.season).toHaveBeenCalledWith("org-1", "season-1");
  });

  it("uses New season copy on create without invented readiness", async () => {
    renderWizard("/admin/seasons/new");

    const cover = await screen.findByTestId("field-guide-academy");
    expect(screen.getByRole("heading", { name: "Field Guide Academy" })).toBeInTheDocument();
    expect(cover).toHaveTextContent("New season");
    expect(cover).not.toHaveTextContent("%");
    expect(cover).not.toHaveTextContent("streak");
    expect(api.season).not.toHaveBeenCalled();
  });
});
