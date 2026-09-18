import { fireEvent, render, screen, within } from "@testing-library/react";
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

function renderWiki(me: Me | null, entry: string) {
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
    { path: "/wiki", element: <WikiPage scope="public" /> },
    { path: "/help", element: <WikiPage scope="app" /> },
    { path: "/login", element: <h1>Sign in</h1> },
    { path: "/student", element: <h1>Training HQ</h1> },
    { path: "/admin", element: <h1>Season overview</h1> },
  ], { initialEntries: [entry] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

describe("public wiki", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders without sign-in and offers entry points", async () => {
    renderWiki(null, "/wiki");
    expect(await screen.findByRole("heading", { name: "Erudoza wiki" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.getAllByRole("link", { name: "Create a club" }).some(link => link.getAttribute("href") === "/signup")).toBe(true);
    // Public concept articles are present; operational how-tos are not.
    expect(screen.getAllByText(/PBE, Arcade, and team scoring/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Training HQ", { exact: true })).not.toBeInTheDocument();
  });

  it("searches public articles", () => {
    renderWiki(null, "/wiki?q=club");
    expect(screen.getByRole("searchbox", { name: "Search the wiki" })).toHaveValue("club");
    expect(screen.getAllByText(/Create a club/).length).toBeGreaterThan(0);
  });

  it("shows the workspace account block instead of sign-in entry points when signed in", async () => {
    renderWiki(coach, "/wiki");
    expect(await screen.findByRole("heading", { name: "Erudoza wiki" })).toBeInTheDocument();
    const header = document.querySelector(".wiki-header");
    expect(header).not.toBeNull();
    const headerScope = within(header as HTMLElement);
    expect(headerScope.getByRole("link", { name: "Back to workspace" })).toHaveAttribute("href", "/admin");
    expect(headerScope.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    expect(headerScope.queryByRole("link", { name: "Create a club" })).not.toBeInTheDocument();
  });
});

describe("in-app help", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects signed-out visitors to sign in", async () => {
    const router = renderWiki(null, "/help");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("keeps search in the URL and finds explanations in article details", () => {
    const router = renderWiki(student, "/help?q=assignment");
    expect(screen.getByRole("heading", { name: "Help" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search help" })).toHaveValue("assignment");
    expect(screen.getAllByText(/Save assignments/).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search help" }), { target: { value: "review" } });

    expect(router.state.location.search).toBe("?q=review");
    expect(screen.getAllByText(/due for review/).length).toBeGreaterThan(0);
  });

  it("shows app guides while identifying the current workspace", () => {
    renderWiki(coach, "/help");
    expect(screen.getByText("Coach workspace", { selector: "small" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Student" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Coach" })).toBeInTheDocument();
    expect(screen.getAllByText(/Season setup/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Training HQ").length).toBeGreaterThan(0);
    // Public concept articles stay out of the logged-in help.
    expect(screen.queryByText("PBE, Arcade, and team scoring", { exact: true })).not.toBeInTheDocument();
  });

  it("narrows the contents and articles with an audience filter", () => {
    renderWiki(student, "/help");
    expect(screen.getAllByRole("link", { name: "Assignments and chapter plans" }).every(link => link.getAttribute("href") === "#wiki-assignments")).toBe(true);
    expect(screen.getByAltText(/Sanitized Training HQ/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Student" }));
    expect(screen.getByRole("heading", { name: "Study Scripture, build evidence, and manage your profile." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Build seasons, support students, and run the club workspace." })).not.toBeInTheDocument();
    expect(screen.queryByText("Create a club, recover access, or join as a coach", { exact: true })).not.toBeInTheDocument();
  });

  it("explains empty searches and returns to the complete guide list", () => {
    const router = renderWiki(student, "/help?q=not-a-real-feature");
    expect(screen.getByRole("heading", { name: "No matching guides" })).toBeInTheDocument();
    expect(screen.getByText(/button label, status, or troubleshooting phrase/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all guides" }));
    expect(router.state.location.search).toBe("");
    expect(screen.getByRole("heading", { name: "Find an explanation" })).toBeInTheDocument();
  });

  it("labels the shared-audience filter Everyone", () => {
    renderWiki(student, "/help");
    expect(screen.getByRole("button", { name: "Everyone" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Shared" })).not.toBeInTheDocument();
  });

  it("opens the article targeted by a contents link", () => {
    renderWiki(student, "/help");
    const details = document.getElementById("wiki-assignments");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(screen.getAllByRole("link", { name: "Assignments and chapter plans" })[0]);
    expect(document.getElementById("wiki-assignments")).toHaveAttribute("open");
  });

  it("opens the article targeted by a deep link on load", () => {
    window.location.hash = "#wiki-assignments";
    try {
      renderWiki(student, "/help");
      expect(document.getElementById("wiki-assignments")).toHaveAttribute("open");
    } finally {
      window.location.hash = "";
    }
  });

  it("reopens the article when its contents link is clicked again after closing", () => {
    renderWiki(student, "/help");
    const link = screen.getAllByRole("link", { name: "Assignments and chapter plans" })[0];
    fireEvent.click(link);
    const details = document.getElementById("wiki-assignments") as HTMLDetailsElement;
    expect(details).toHaveAttribute("open");
    details.open = false;
    fireEvent(details, new Event("toggle"));
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(link);
    expect(details).toHaveAttribute("open");
  });
});
