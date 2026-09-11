import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    organizationName: "Erudoza Academy",
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
    organizationName: "Erudoza Academy",
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
      error: null,
      login,
      logout: vi.fn(),
      refresh: vi.fn(),
      acceptSession: vi.fn(),
    });
  });

  it("shows the training brand and accessible sign-in controls", () => {
    renderLogin();
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email or username")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByTestId("erudoza-mark")).toHaveAttribute("src", "/brand/erudoza-mark.png");
    expect(screen.getByText(/Ask your coach or academy administrator\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Back to home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Create a club" })).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("link", { name: "reset your password" })).toHaveAttribute("href", "/forgot-password");
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
