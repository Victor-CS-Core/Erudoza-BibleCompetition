import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { ContentPage } from "./ContentPage";

vi.mock("../../api/client", () => ({
  api: {
    contentPacks: vi.fn(),
    sourceUnits: vi.fn(),
    scriptureCatalog: vi.fn(),
    importFromCatalog: vi.fn(),
    importContentPack: vi.fn(),
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

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ContentPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ContentPage Field Guide Academy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    vi.mocked(api.scriptureCatalog).mockResolvedValue({
      translations: [{ id: "web", name: "World English Bible", license: "Public domain", language: "en" }],
      books: [{ bookKey: "DAN", name: "Daniel" }],
    });
    vi.mocked(api.sourceUnits).mockResolvedValue([
      {
        id: "unit-1",
        citation: "Joshua 2:1",
        bookKey: "JOS",
        chapter: 2,
        verse: 1,
        ordinal: 1,
        canonicalText: "And Joshua the son of Nun sent out of Shittim two men to spy secretly.",
      },
    ]);
  });

  it("opens content on the Field Guide Academy cover and keeps import controls", async () => {
    renderPage();

    const cover = await screen.findByTestId("field-guide-academy");
    expect(screen.getByRole("heading", { name: "Field Guide Academy" })).toBeInTheDocument();
    expect(screen.getByTestId("academy-chapter-line")).toHaveTextContent("Development Academy");
    expect(await screen.findByTestId("content-pack")).toHaveTextContent("dev-joshua");
    expect(screen.queryByText("No content packs yet.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("content-pack"));
    expect(await screen.findByText("Joshua 2:1")).toBeInTheDocument();
    expect(screen.getByTestId("source-unit-list")).toHaveTextContent("Joshua 2:1");
    expect(screen.queryByText("No stored verses yet.")).not.toBeInTheDocument();
    expect(screen.getByTestId("load-sample-pack")).toBeInTheDocument();
    expect(screen.getByTestId("import-pack-submit")).toBeInTheDocument();
    expect(cover).not.toHaveTextContent("%");
    expect(cover).not.toHaveTextContent("streak");
  });

  it("explains an empty content packs list without inventing readiness", async () => {
    vi.mocked(api.contentPacks).mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("No content packs yet.")).toBeInTheDocument();
    expect(screen.getByTestId("import-catalog-submit")).toBeInTheDocument();
    expect(screen.getByTestId("load-sample-pack")).toBeInTheDocument();
    expect(screen.getByTestId("import-pack-submit")).toBeInTheDocument();
    expect(screen.queryByTestId("content-pack")).not.toBeInTheDocument();
    expect(screen.queryByTestId("source-unit-list")).not.toBeInTheDocument();
    expect(screen.queryByText("No stored verses yet.")).not.toBeInTheDocument();
  });

  it("explains an empty stored verses list without inventing readiness", async () => {
    vi.mocked(api.sourceUnits).mockResolvedValue([]);

    renderPage();

    fireEvent.click(await screen.findByTestId("content-pack"));

    expect(await screen.findByText("No stored verses yet.")).toBeInTheDocument();
    expect(screen.getByTestId("source-unit-list")).toBeInTheDocument();
    expect(screen.getByTestId("import-catalog-submit")).toBeInTheDocument();
    expect(screen.getByTestId("load-sample-pack")).toBeInTheDocument();
    expect(screen.getByTestId("import-pack-submit")).toBeInTheDocument();
    expect(api.sourceUnits).toHaveBeenCalledWith("org-1", "pack-1");
  });
});
