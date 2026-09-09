import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { LoginPage } from "./LoginPage";

const login = vi.fn();

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

function adult(): Me {
  return {
    userId: "admin-1",
    organizationId: "org-1",
    organizationName: "Development Academy",
    displayName: "Admin",
    userName: "admin",
    email: "admin@erudoza.local",
    kind: "Adult",
    role: "Admin",
  };
}

function student(): Me {
  return {
    userId: "student-1",
    organizationId: "org-1",
    organizationName: "Development Academy",
    displayName: "Daniel Student",
    userName: "daniel.student",
    email: null,
    kind: "Student",
    role: "Student",
  };
}

function renderLogin() {
  const router = createMemoryRouter(
    [
      { path: "/login", element: <LoginPage /> },
      { path: "/student", element: <p>student home</p> },
      { path: "/admin", element: <p>admin home</p> },
    ],
    { initialEntries: ["/login"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

function submitSignIn(identifier: string, password: string) {
  fireEvent.change(screen.getByTestId("login-identifier"), { target: { value: identifier } });
  fireEvent.change(screen.getByTestId("login-password"), { target: { value: password } });
  fireEvent.click(screen.getByTestId("login-submit"));
}

describe("LoginPage Field Guide Academy", () => {
  beforeEach(() => {
    login.mockReset();
    vi.mocked(useAuth).mockReturnValue({
      me: null,
      loading: false,
      login,
      logout: vi.fn(),
      refresh: vi.fn(),
    });
  });

  it("opens on the Field Guide Academy cover and keeps the sign-in form", () => {
    renderLogin();

    const cover = screen.getByTestId("field-guide-academy");
    expect(screen.getByRole("heading", { name: "Field Guide Academy" })).toBeInTheDocument();
    expect(screen.queryByTestId("academy-chapter-line")).not.toBeInTheDocument();
    expect(screen.getByTestId("login-identifier")).toBeInTheDocument();
    expect(screen.getByTestId("login-password")).toBeInTheDocument();
    expect(screen.getByTestId("login-submit")).toBeInTheDocument();
    expect(cover).not.toHaveTextContent("%");
    expect(cover).not.toHaveTextContent("streak");
  });

  it("stacks kraft banner, Field Guide hero, and parchment Sign in in a portrait phone column", () => {
    renderLogin();

    const column = screen.getByTestId("login-phone-column");
    expect(column).toHaveClass("er-login-column");

    const banner = within(column).getByTestId("login-kraft-banner");
    expect(banner).toHaveClass("er-kraft-banner");
    expect(banner).toHaveTextContent("FIELD GUIDE");
    expect(banner).toHaveTextContent("VOL. 7");
    expect(banner).toHaveTextContent("FLORA & TERRAIN");
    expect(within(column).getByText("Pathfinder Bible Experience")).toBeInTheDocument();

    const cover = within(column).getByTestId("field-guide-academy");
    expect(within(column).getByRole("heading", { name: "Field Guide Academy" })).toBeInTheDocument();
    expect(within(column).getByTestId("erudoza-wordmark")).toBeInTheDocument();
    expect(within(column).getByTestId("erudoza-mark")).toHaveAttribute("src", "/brand/erudoza-mark.png");
    expect(within(column).getByTestId("login-motto")).toHaveTextContent("Discover · Interpret · Serve");

    const sheet = within(column).getByTestId("login-signin-sheet");
    expect(sheet).toHaveClass("er-signin-sheet");
    expect(within(sheet).getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(within(sheet).getByTestId("login-identifier")).toBeInTheDocument();
    expect(within(sheet).getByTestId("login-password")).toBeInTheDocument();
    const submit = within(sheet).getByTestId("login-submit");
    expect(submit).toHaveClass("er-denim-action");
    expect(submit).toHaveTextContent("Continue");

    expect(banner.compareDocumentPosition(cover) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cover.compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId("learner-tab-bar")).not.toBeInTheDocument();
    expect(column).not.toHaveTextContent("%");
    expect(column).not.toHaveTextContent("streak");
    expect(column).not.toHaveTextContent("mastery");
  });

  it("keeps Field Guide chrome on the login column", () => {
    renderLogin();

    const chrome = within(screen.getByTestId("login-phone-column")).getByTestId("login-field-guide-chrome");
    expect(chrome).toHaveAttribute("aria-hidden", "true");
    expect(within(chrome).getByTestId("chrome-compass")).toBeInTheDocument();
    expect(within(chrome).getByTestId("chrome-mountain")).toBeInTheDocument();
    expect(within(chrome).getByTestId("chrome-forest")).toBeInTheDocument();
    expect(within(chrome).getByTestId("chrome-leaf")).toBeInTheDocument();
  });

  it("keeps existing academy links without inventing a new auth flow", () => {
    renderLogin();

    const forgot = screen.getByText("Forgot Password?");
    expect(forgot.tagName).toBe("P");
    expect(forgot).toHaveClass("er-login-forgot");
    expect(screen.getByTestId("login-join-academy")).toHaveAttribute("href", "/");
    expect(screen.queryByTestId("login-forgot-submit")).not.toBeInTheDocument();
    expect(screen.queryByTestId("signup-submit")).not.toBeInTheDocument();
  });

  it("lets the explorer reveal the password without changing the login contract", () => {
    renderLogin();

    const password = screen.getByTestId("login-password");
    expect(password).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
    expect(login).not.toHaveBeenCalled();
  });

  it("sends a student to /student after login", async () => {
    login.mockResolvedValue(student());
    const router = renderLogin();

    submitSignIn("daniel.student", "DevStudent!234");

    await waitFor(() => expect(router.state.location.pathname).toBe("/student"));
    expect(login).toHaveBeenCalledWith("daniel.student", "DevStudent!234");
  });

  it("sends an adult to /admin after login", async () => {
    login.mockResolvedValue(adult());
    const router = renderLogin();

    submitSignIn("admin@erudoza.local", "DevAdmin!234");

    await waitFor(() => expect(router.state.location.pathname).toBe("/admin"));
    expect(login).toHaveBeenCalledWith("admin@erudoza.local", "DevAdmin!234");
  });

  it("stays on /login when sign-in fails", async () => {
    login.mockRejectedValue(new Error("Invalid identifier or password."));
    const router = renderLogin();

    submitSignIn("daniel.student", "wrong");

    expect(await screen.findByText("Invalid identifier or password.")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });
});
