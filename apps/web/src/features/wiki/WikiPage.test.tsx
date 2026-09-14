import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { WikiPage } from "./WikiPage";

vi.mock("../../auth/AuthContext", () => ({ useAuth: vi.fn() }));

const student: Me = {
  userId: "student-1",
  organizationId: "org-1",
  organizationName: "Erudoza Academy",
  displayName: "Daniel Student",
  userName: "daniel.student",
  email: null,
  kind: "Student",
  role: "Student",
};

const coach: Me = { ...student, userId: "coach-1", displayName: "Coach", userName: "coach", kind: "Adult", role: "Admin" };

function renderWiki(me: Me | null, entry = "/wiki") {
  vi.mocked(useAuth).mockReturnValue({
    me,
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    acceptSession: vi.fn(),
  });
  const router = createMemoryRouter([
    { path: "/wiki", element: <WikiPage /> },
    { path: "/login", element: <h1>Sign in</h1> },
    { path: "/student", element: <h1>Training HQ</h1> },
    { path: "/admin", element: <h1>Season overview</h1> },
  ], { initialEntries: [entry] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

describe("authenticated platform wiki", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects signed-out visitors to sign in", async () => {
    const router = renderWiki(null);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("keeps search in the URL and finds explanations in article details", () => {
    const router = renderWiki(student, "/wiki?q=assignment");
    expect(screen.getByRole("heading", { name: "Erudoza wiki" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search the wiki" })).toHaveValue("assignment");
    expect(screen.getAllByText(/Save assignments/).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search the wiki" }), { target: { value: "team practice" } });

    expect(router.state.location.search).toBe("?q=team+practice");
    expect(screen.getAllByText(/practice together/).length).toBeGreaterThan(0);
  });

  it("shows all role content while identifying the current workspace", () => {
    renderWiki(coach);
    expect(screen.getByText("Coach workspace", { selector: "small" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Student" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Coach" })).toBeInTheDocument();
    expect(screen.getAllByText(/Season setup/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Training HQ").length).toBeGreaterThan(0);
  });

  it("narrows the contents and articles with an audience filter", () => {
    renderWiki(student);
    expect(screen.getAllByRole("link", { name: "Assignments and chapter plans" }).every(link => link.getAttribute("href") === "#wiki-assignments")).toBe(true);
    expect(screen.getByAltText(/Sanitized Training HQ/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Student" }));
    expect(screen.getByRole("heading", { name: "Study Scripture, build evidence, and practice with your team." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Build seasons, support students, and run the club workspace." })).not.toBeInTheDocument();
    expect(screen.queryByText("Create a club, recover access, or join as a coach", { exact: true })).not.toBeInTheDocument();
  });

  it("explains empty searches and returns to the complete guide list", () => {
    const router = renderWiki(student, "/wiki?q=not-a-real-feature");
    expect(screen.getByRole("heading", { name: "No matching guides" })).toBeInTheDocument();
    expect(screen.getByText(/button label, status, or troubleshooting phrase/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all guides" }));
    expect(router.state.location.search).toBe("");
    expect(screen.getByRole("heading", { name: "Find an explanation" })).toBeInTheDocument();
  });
});
