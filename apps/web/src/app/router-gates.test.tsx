import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { useAuth } from "../auth/AuthContext";
import { ContentManagerGate, MasterAdminGate, MaterialsNewsGate } from "./router";

vi.mock("../auth/AuthContext", () => ({ useAuth: vi.fn() }));

const owner = { kind: "Adult", role: "Owner", organizationId: "org-1", userId: "u-1" };
const admin = { ...owner, userId: "u-2", role: "Admin" };
const contentManager = { ...owner, userId: "u-3", role: "Content Manager" };

function authAs(me: unknown, loading = false) {
  vi.mocked(useAuth).mockReturnValue({ me, loading, error: null, login: vi.fn(), logout: vi.fn(), refresh: vi.fn(), acceptSession: vi.fn() } as never);
}
function renderGate(gate: "materials" | "restricted", me: unknown) {
  authAs(me);
  const children = <p>Management content</p>;
  render(<MemoryRouter>{gate === "materials" ? <MaterialsNewsGate>{children}</MaterialsNewsGate> : <ContentManagerGate>{children}</ContentManagerGate>}</MemoryRouter>);
}

beforeEach(() => { vi.resetAllMocks(); });

it("denies regular admins on PBE materials/news management routes", () => {
  renderGate("materials", admin);
  expect(screen.getByText(/PBE materials and PBE news management is limited to the club Owner and Content Managers/)).toBeInTheDocument();
  expect(screen.queryByText("Management content")).not.toBeInTheDocument();
});

it("admits owners and content managers to PBE materials/news management", () => {
  renderGate("materials", owner);
  expect(screen.getByText("Management content")).toBeInTheDocument();
});

it("admits content managers to PBE materials/news management", () => {
  renderGate("materials", contentManager);
  expect(screen.getByText("Management content")).toBeInTheDocument();
});

it("keeps content managers out of the other admin areas", () => {
  renderGate("restricted", contentManager);
  expect(screen.getByText(/Your Content Manager role only includes PBE materials and PBE news/)).toBeInTheDocument();
  expect(screen.queryByText("Management content")).not.toBeInTheDocument();
});

it("admits owners and admins to the other admin areas", () => {
  for (const me of [owner, admin]) {
    cleanup();
    renderGate("restricted", me);
    expect(screen.getByText("Management content")).toBeInTheDocument();
  }
});

it("admits only the master admin account to the Control Center", () => {
  authAs({ ...owner, email: "viticopq12@gmail.com" });
  render(<MemoryRouter><MasterAdminGate><p>Management content</p></MasterAdminGate></MemoryRouter>);
  expect(screen.getByText("Management content")).toBeInTheDocument();
});

it("matches the master email case-insensitively", () => {
  authAs({ ...owner, email: "  Viticopq12@Gmail.com " });
  render(<MemoryRouter><MasterAdminGate><p>Management content</p></MasterAdminGate></MemoryRouter>);
  expect(screen.getByText("Management content")).toBeInTheDocument();
});

it("denies owners, admins, content managers, and students without the master email", () => {
  for (const me of [{ ...owner, email: "owner@example.com" }, { ...admin, email: null }, contentManager, { kind: "Student", role: "Student", organizationId: "org-1", userId: "u-9", email: "student@example.com" }]) {
    cleanup();
    authAs(me);
    render(<MemoryRouter><MasterAdminGate><p>Management content</p></MasterAdminGate></MemoryRouter>);
    expect(screen.getByText(/limited to the master admin account/)).toBeInTheDocument();
    expect(screen.queryByText("Management content")).not.toBeInTheDocument();
  }
});
