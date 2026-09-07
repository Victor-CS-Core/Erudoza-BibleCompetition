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
