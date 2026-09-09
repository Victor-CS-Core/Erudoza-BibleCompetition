import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Season } from "../../api/types";
import { AdminHomePage } from "./AdminHomePage";

vi.mock("../../api/client", () => ({
  api: {
    organization: vi.fn(),
    seasons: vi.fn(),
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

function renderHome() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminHomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AdminHomePage Field Guide Academy", () => {
  beforeEach(() => {
    vi.mocked(api.organization).mockResolvedValue({
      id: "org-1",
      name: "Development Academy",
      slug: "development-academy",
    });
    vi.mocked(api.seasons).mockResolvedValue([
      season({ id: "season-draft", name: "Imported Joshua", status: "Draft" }),
      season({ id: "season-active", name: "Daniel Gauntlet", status: "Active" }),
    ]);
  });

  it("opens on the Field Guide Academy cover and keeps create-season", async () => {
    renderHome();

    expect(await screen.findByTestId("field-guide-academy")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Field Guide Academy" })).toBeInTheDocument();
    expect(screen.getByTestId("organization-name")).toHaveTextContent("Development Academy");
    expect(screen.getByTestId("create-season")).toHaveAttribute("href", "/admin/seasons/new");
  });

  it("lists season readiness from real season.status values only", async () => {
    renderHome();

    const folio = await screen.findByTestId("season-readiness-folio");
    await waitFor(() => expect(folio).toHaveTextContent("Imported Joshua"));
    expect(folio).toHaveTextContent("Imported Joshua");
    expect(folio).toHaveTextContent("Draft");
    expect(folio).toHaveTextContent("Daniel Gauntlet");
    expect(folio).toHaveTextContent("Active");
    expect(folio).not.toHaveTextContent("No seasons yet.");
    expect(folio).not.toHaveTextContent("%");
    expect(folio).not.toHaveTextContent("streak");
  });

  it("explains an empty seasons folio without inventing readiness", async () => {
    vi.mocked(api.seasons).mockResolvedValue([]);

    renderHome();

    const folio = await screen.findByTestId("season-readiness-folio");
    await waitFor(() => expect(folio).toHaveTextContent("No seasons yet."));
    expect(folio).not.toHaveTextContent("%");
    expect(folio).not.toHaveTextContent("streak");
    expect(screen.getByTestId("create-season")).toHaveAttribute("href", "/admin/seasons/new");
  });
});
