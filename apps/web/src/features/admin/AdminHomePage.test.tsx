import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
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
    expect(screen.getByTestId("create-season")).toHaveClass("er-create-season");
    expect(screen.getByTestId("create-season")).toHaveTextContent("Create season");
  });

  it("uses the Field Guide Folio spine and season readiness chapter language", async () => {
    renderHome();

    const cover = await screen.findByTestId("field-guide-academy");
    expect(cover).toHaveClass("er-field-guide-folio");
    expect(screen.getByTestId("folio-spine")).toHaveTextContent("FIELD GUIDE");
    expect(screen.getByRole("heading", { name: "Season readiness" })).toBeInTheDocument();
    expect(cover).not.toHaveTextContent("%");
    expect(cover).not.toHaveTextContent("streak");
  });

  it("lists season readiness from real season.status values only", async () => {
    renderHome();

    const folio = await screen.findByTestId("season-readiness-folio");
    await waitFor(() => expect(folio).toHaveTextContent("Imported Joshua"));
    expect(folio).toHaveTextContent("Imported Joshua");
    expect(folio).toHaveTextContent("Draft");
    expect(folio).toHaveTextContent("Daniel Gauntlet");
    expect(folio).toHaveTextContent("Active");
    const badges = within(folio).getAllByTestId("season-status-badge");
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveTextContent("Draft");
    expect(badges[0].querySelector("svg")).toBeTruthy();
    expect(badges[1]).toHaveTextContent("Active");
    expect(badges[1].querySelector("svg")).toBeTruthy();
    expect(folio).not.toHaveTextContent("No seasons yet.");
    expect(folio).not.toHaveTextContent("%");
    expect(folio).not.toHaveTextContent("streak");
  });

  it("does not dress a ContentReady season as a Draft badge", async () => {
    vi.mocked(api.seasons).mockResolvedValue([
      season({ id: "season-ready", name: "Scope Saved", status: "ContentReady" }),
    ]);

    renderHome();

    const folio = await screen.findByTestId("season-readiness-folio");
    const badge = await within(folio).findByTestId("season-status-badge");
    expect(badge).toHaveTextContent("ContentReady");
    expect(badge).toHaveClass("er-season-badge-ready");
    expect(badge).not.toHaveClass("er-season-badge-draft");
    expect(badge).not.toHaveClass("er-season-badge-active");
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
